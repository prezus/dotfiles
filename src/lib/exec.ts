// Subprocess layer. Every external tool the CLI drives goes through here.
//
// Two things this fixes versus the bash original:
//
//  1. SIGPIPE. `dotfiles.bash:201-203` documents piping `vp` into an
//     early-exiting reader (grep -q, head) turning into "Abort trap: 6". We
//     always drain a child's output fully, so that hazard cannot occur.
//  2. Mutable environment. Bash got this for free — one process, so
//     `eval "$(brew shellenv)"` at init step 1 was visible to steps 2-10. Here
//     it has to be explicit: `Env` is threaded through a run and amended in
//     place. Get this wrong and `init` breaks ONLY on a fresh machine.

import { Result } from "better-result"
import { SpawnError } from "./errors.ts"
import { withTerminal } from "./terminal.ts"
import { getTerminalSink } from "./ui.ts"

/** A process environment that later steps can amend, mimicking a single shell. */
export class Env {
  private vars: Record<string, string>

  constructor(base: Record<string, string | undefined> = process.env) {
    this.vars = {}
    for (const [k, v] of Object.entries(base)) if (v !== undefined) this.vars[k] = v
  }

  get(key: string): string | undefined {
    return this.vars[key]
  }

  set(key: string, value: string): void {
    this.vars[key] = value
  }

  /** Put `value` at the FRONT of a PATH-like variable, de-duplicating. */
  prepend(key: string, value: string): void {
    const current = this.vars[key]
    const parts = current ? current.split(":").filter((p) => p !== value) : []
    this.vars[key] = [value, ...parts].join(":")
  }

  /**
   * Absorb `export KEY=value` lines, as emitted by `brew shellenv` and
   * `~/.cargo/env`. This replaces bash's `eval`, which got the whole job for
   * free by virtue of being a shell.
   *
   * Real `brew shellenv` output looks like:
   *   export HOMEBREW_PREFIX="/opt/homebrew";
   *   export PATH="/opt/homebrew/bin:/opt/homebrew/sbin${PATH+:$PATH}";
   * Note the trailing semicolons and the `${VAR+alt}` self-reference — both
   * must be handled or the resulting PATH is corrupt.
   */
  absorbShellenv(output: string): void {
    for (const line of output.split("\n")) {
      const m = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
      if (!m) continue
      const [, key, rawValue] = m
      if (!key || rawValue === undefined) continue

      let value = rawValue.trim()
      value = value.replace(/;+$/, "") // shellenv terminates every line with `;`
      value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")
      this.vars[key] = this.expand(value)
    }
  }

  /** Minimal shell parameter expansion — the forms shellenv actually emits. */
  private expand(input: string): string {
    // ${VAR+alt} / ${VAR:+alt} — use alt when VAR is set
    let out = input.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*):?\+([^}]*)\}/g,
      (_, name: string, alt: string) => (this.vars[name] ? this.expandSimple(alt) : ""),
    )
    // ${VAR:-default} / ${VAR-default}
    out = out.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*):?-([^}]*)\}/g,
      (_, name: string, fallback: string) => this.vars[name] ?? this.expandSimple(fallback),
    )
    return this.expandSimple(out)
  }

  private expandSimple(input: string): string {
    return input.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
      (_, braced: string | undefined, bare: string | undefined) =>
        this.vars[braced ?? bare ?? ""] ?? "",
    )
  }

  /**
   * A copy of the variables, for handing to a child.
   *
   * Return type deliberately inferred: `vars` is already declared
   * `Record<string, string>`, so annotating the same shape again only restates
   * evidence the field already carries.
   */
  toObject() {
    return { ...this.vars }
  }
}

/** The environment for this CLI run. Steps amend it; children inherit it. */
export const env = new Env()

export type RunResult = {
  code: number
  stdout: string
  stderr: string
  ok: boolean
}

export type RunOptions = {
  cwd?: string
  env?: Env
  /** Extra vars for this call only, e.g. NONINTERACTIVE=1. */
  extraEnv?: Record<string, string>
  stdin?: "inherit" | "ignore"
  /**
   * This child needs the USER's keyboard — a sudo password, chsh, $EDITOR, an
   * installer that prompts. It can never be captured into a pane, because doing
   * so would hide the prompt and swallow the keystrokes.
   *
   * Everything else (brew, stow, rustup toolchains, bun add) only PRINTS, so it
   * streams into the UI instead of taking the screen.
   */
  needsStdin?: boolean
}

/**
 * Run a command and capture its output. Output is fully drained, so the child
 * never sees a closed pipe.
 *
 * A non-zero exit is NOT an error — it is a RunResult with ok:false, because
 * "the tool ran and said no" is usually the answer we wanted. The Err case is
 * reserved for the process failing to start at all, which Bun.spawn throws on
 * and which used to escape this function despite the comment claiming otherwise.
 */
export async function run(
  cmd: string[],
  opts: RunOptions = {},
): Promise<Result<RunResult, SpawnError>> {
  const [bin, ...args] = cmd
  if (!bin) return Result.err(new SpawnError({ command: "", message: "empty command" }))

  const spawned = Result.try(() =>
    Bun.spawn([bin, ...args], {
      cwd: opts.cwd,
      env: { ...(opts.env ?? env).toObject(), ...opts.extraEnv },
      stdin: opts.stdin ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }),
  )
  if (Result.isError(spawned)) {
    return Result.err(new SpawnError({ command: cmd.join(" "), message: String(spawned.error) }))
  }
  const proc = spawned.value

  // Drain both pipes concurrently before awaiting exit, or a child that fills
  // the stderr buffer while we read stdout deadlocks.
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return Result.ok({ code, stdout, stderr, ok: code === 0 })
}

/**
 * Run a command where absence is an expected answer — version probes, feature
 * detection, anything doctor does. A missing binary yields exit 127 with an
 * empty stdout, matching the shell's "command not found" convention, so callers
 * that only care about output stay readable.
 */
export async function probe(cmd: string[], opts: RunOptions = {}): Promise<RunResult> {
  const result = await run(cmd, opts)
  return Result.match(result, {
    ok: (value) => value,
    err: (error) => ({ code: 127, stdout: "", stderr: error.message, ok: false }),
  })
}

/**
 * Width to tell a captured child it has. Children wrap their own output, so a
 * bad value here shows up as ragged wrapping in the pane rather than as an
 * error. Mirrors the pane's padding and status glyph.
 */
const paneColumns = (): number => Math.max(20, (process.stdout.columns ?? 80) - 6)

/**
 * Rows to give the child's PTY.
 *
 * This used to be a hardcoded 24, which is a lie on any other terminal: tools
 * that page or draw progress against the height they are told (brew's own
 * output, rustup, anything using a curses-ish redraw) were sizing to a window
 * that did not exist. Mirrors paneColumns' allowance for our chrome.
 *
 * Deliberately computed here rather than imported from tui/output-pane.ts —
 * lib/ does not depend on the UI layer, which is what lets the same exec paths
 * run under the plain CLI.
 */
const paneTerminalRows = (): number => Math.max(3, (process.stdout.rows ?? 30) - 8)

/**
 * Run `cmd` with its stdin on /dev/null while leaving stdout on the PTY.
 *
 * A PTY is bidirectional, so attaching one silently overrides `stdin: "ignore"`
 * and hands the child a readable terminal nobody is typing at. A child that then
 * prompts — a cask asking for an admin password under `brew bundle install` —
 * blocks forever, with the prompt invisible inside a pane that offers no way to
 * answer it. Captured children are non-interactive by contract (that is exactly
 * what `needsStdin` opts out of), so every read must hit EOF and fail fast, as
 * it did when this was a pipe.
 *
 * The args go after `sh` positionally, so nothing here needs quoting.
 */
const withNullStdin = (cmd: string[]): string[] => [
  "/bin/sh",
  "-c",
  'exec "$@" < /dev/null',
  "sh",
  ...cmd,
]

/**
 * Run a command that produces terminal output.
 *
 * When a terminal sink is installed and the child does not need stdin, it is
 * given a PTY and its raw VT stream is sent to the embedded libghostty session.
 * That keeps `brew`, `stow`, `rustup` and friends inside the TUI without losing
 * the cursor movement and progress output they only produce for a terminal.
 *
 * Children that need the user's keyboard set `needsStdin` and always inherit.
 * A PTY would satisfy them too, but only if we also emulated the rendering
 * side, and $EDITOR in a pane is a much larger project than this.
 */
export async function runInteractive(
  cmd: string[],
  opts: RunOptions = {},
): Promise<Result<number, SpawnError>> {
  const [bin, ...args] = cmd
  if (!bin) return Result.err(new SpawnError({ command: "", message: "empty command" }))

  const sink = getTerminalSink()
  const capture = sink !== null && opts.needsStdin !== true

  // A child that needs the keyboard gets the real terminal for exactly as long
  // as it runs — the UI suspends around THIS child, not around the whole
  // command. Nothing above here has to know a UI exists.
  if (!capture) {
    return await withTerminal(async () => {
      const started = Result.try(() =>
        Bun.spawn([bin, ...args], {
          cwd: opts.cwd,
          env: { ...(opts.env ?? env).toObject(), ...opts.extraEnv },
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }),
      )
      if (Result.isError(started)) {
        return Result.err(new SpawnError({ command: cmd.join(" "), message: String(started.error) }))
      }
      return Result.ok(await started.value.exited)
    })
  }

  // The PTY's own EOF, which is what tells us the output is complete. The
  // subprocess can be reaped before the last read lands, so exit alone is not
  // enough — waiting on it would truncate the final lines.
  let ptyClosed: () => void = () => {}
  const closed = new Promise<void>((resolve) => {
    ptyClosed = resolve
  })

  const spawned = Result.try(() =>
    Bun.spawn(withNullStdin([bin, ...args]), {
      cwd: opts.cwd,
      env: { ...(opts.env ?? env).toObject(), ...opts.extraEnv },
      // A pseudo-terminal, not a pipe. Homebrew gates its output on
      // `$stdout.tty?` — through a pipe it passes `--silent` to curl
      // (utils/curl.rb) and drops the "Downloading …" line entirely, so the
      // slowest part of `brew upgrade` reported nothing at all. Under a PTY it
      // believes it is interactive and talks, while we still read every byte.
      terminal: {
        cols: paneColumns(),
        rows: paneTerminalRows(),
        data: (_terminal, bytes) => sink?.write(bytes),
        exit: () => ptyClosed(),
      },
    }),
  )
  if (Result.isError(spawned)) {
    return Result.err(new SpawnError({ command: cmd.join(" "), message: String(spawned.error) }))
  }
  const proc = spawned.value
  sink.connectPty((bytes) => {
    proc.terminal?.write(bytes)
  })

  // Keep the child's PTY the same size as the window it is being drawn into.
  // Without this a resize mid-run leaves the child wrapping to the width it was
  // given at spawn — and a long `brew upgrade` is exactly the command you are
  // most likely to resize around, because it is the one you are waiting on.
  const onResize = (): void => {
    proc.terminal?.resize(paneColumns(), paneTerminalRows())
  }
  process.stdout.on("resize", onResize)

  try {
    // The PTY `exit` callback reports stream lifecycle, not child status. The
    // real exit code only comes from `proc.exited`.
    const code = await proc.exited
    // PTY EOF normally follows immediately. The timeout prevents a broken PTY
    // lifecycle from hanging the command while still preserving late tail data.
    await Promise.race([closed, Bun.sleep(1000)])
    return Result.ok(code)
  } finally {
    sink.connectPty(undefined)
    process.stdout.off("resize", onResize)
    proc.terminal?.close()
  }
}

/**
 * Exit code for a command that owns the terminal, treating a failure to start
 * as a failure to run. Most callers want this: they are about to `return` it.
 */
export async function runInteractiveCode(cmd: string[], opts: RunOptions = {}): Promise<number> {
  const result = await runInteractive(cmd, opts)
  return Result.unwrapOr(result, 127)
}

/** Resolved path of an executable, or null. Equivalent to `command -v`. */
export async function which(bin: string): Promise<string | null> {
  const res = await probe(["/usr/bin/which", bin])
  const path = res.stdout.trim()
  return res.ok && path ? path : null
}

/** Equivalent to the bash `command_exists`. */
export async function commandExists(bin: string): Promise<boolean> {
  return (await which(bin)) !== null
}

/** First capture group of `re` against `text`, trimmed — or undefined. */
export function extract(text: string, re: RegExp): string | undefined {
  return re.exec(text)?.[1]?.trim()
}
