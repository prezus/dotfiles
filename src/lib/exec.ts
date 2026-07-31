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
import { getLogSink } from "./ui.ts"

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

  toObject(): Record<string, string> {
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

/** How long a line must be mid-redraw before we show it as live progress. */
const TRANSIENT_MS = 80

/**
 * Just enough of a terminal to render progress correctly.
 *
 * Under a PTY the tools we drive redraw ONE line with carriage returns instead
 * of emitting new ones — curl's download bar, git's "Receiving objects",
 * Homebrew's spinner. Splitting on "\n" (what this used to do) meant a progress
 * bar produced NOTHING until it finished and then arrived as a single smeared
 * line, because the frames are separated by "\r" and there is no newline until
 * the very end.
 *
 * So we model a cursor: "\r" rewinds to column 0 and subsequent text overwrites
 * in place, exactly as a real terminal would. The line is reported as it is
 * being redrawn (transient) and again once "\n" commits it.
 *
 * Escape sequences are consumed by a state machine rather than a regex because
 * a sequence can be split across two PTY reads — a regex over one chunk would
 * leak the tail of a torn escape into the pane as literal garbage.
 */
export class LineAssembler {
  private line = ""
  private col = 0
  private state: "text" | "esc" | "csi" | "osc" | "charset" = "text"
  private csi = ""
  private lineStarted = Date.now()

  constructor(private readonly onLine: (text: string, transient: boolean) => void) {}

  write(chunk: string): void {
    for (const ch of chunk) {
      switch (this.state) {
        case "esc":
          this.state = ch === "[" ? "csi" : ch === "]" ? "osc" : /[()]/.test(ch) ? "charset" : "text"
          continue
        case "csi":
          // Parameters and intermediates, then a final byte in @..~ ends it.
          if (ch >= "@" && ch <= "~") {
            this.applyCsi(ch)
            this.state = "text"
            this.csi = ""
          } else this.csi += ch
          continue
        case "osc":
          // Terminated by BEL, or by ST which starts with ESC.
          if (ch === "\x07") this.state = "text"
          else if (ch === "\x1b") this.state = "esc"
          continue
        case "charset":
          this.state = "text"
          continue
        case "text":
          break
      }

      if (ch === "\x1b") {
        this.state = "esc"
        this.csi = ""
      } else if (ch === "\n") this.commit()
      else if (ch === "\r") this.col = 0
      else if (ch === "\b") this.col = Math.max(0, this.col - 1)
      else if (ch === "\t") {
        const next = (Math.floor(this.col / 8) + 1) * 8
        while (this.line.length < next) this.line += " "
        this.col = next
      } else if (ch >= " ") {
        this.line = this.line.slice(0, this.col) + ch + this.line.slice(this.col + 1)
        this.col++
      }
    }

    // Only surface a half-drawn line once it has been in progress long enough to
    // be worth watching. Fast commands finish inside the window and emit purely
    // committed lines, which keeps plain output identical to what it always was.
    if (this.line !== "" && Date.now() - this.lineStarted >= TRANSIENT_MS) {
      this.lineStarted = Date.now()
      const text = this.line.trimEnd()
      if (text !== "") this.onLine(text, true)
    }
  }

  /**
   * The sequences that change what a line SAYS, not just how it looks.
   *
   * Erase-in-line is how a tool shortens a progress line: without it, a frame
   * going from `Downloading foo.tar.gz 100.0%` to `###  30%` keeps the old tail
   * and renders as `###  30%oo.tar.gz 100.0%`. Cursor-column (G) is the same
   * idea as "\r" with an argument. Everything else is styling or cursor motion
   * off this line, and staying ignored is the correct rendering.
   */
  private applyCsi(final: string): void {
    const n = Number.parseInt(this.csi, 10) || 0
    if (final === "K") {
      if (n === 0) this.line = this.line.slice(0, this.col)
      else if (n === 1)
        this.line = " ".repeat(Math.min(this.col + 1, this.line.length)) + this.line.slice(this.col + 1)
      else if (n === 2) this.line = ""
    } else if (final === "G") this.col = Math.max(0, n - 1)
  }

  private commit(): void {
    const text = this.line.trimEnd()
    this.line = ""
    this.col = 0
    this.lineStarted = Date.now()
    if (text !== "") this.onLine(text, false)
  }

  /** Flush a final line the child left without a trailing newline. */
  end(): void {
    this.commit()
  }
}

/**
 * Width to tell a captured child it has. Children wrap their own output, so a
 * bad value here shows up as ragged wrapping in the pane rather than as an
 * error. Mirrors the pane's padding and status glyph.
 */
const paneColumns = (): number => Math.max(40, (process.stdout.columns ?? 80) - 6)

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
 * When a log sink is installed (i.e. a UI is showing a pane) and the child does
 * not need stdin, it is given a PTY and its output is STREAMED into that sink
 * instead of inheriting the terminal. That is what keeps `brew`, `stow`,
 * `rustup` and friends inside the TUI rather than making the app drop out to
 * run them — and, because a PTY still satisfies `isatty`, without costing us
 * the progress output those tools only produce for a terminal.
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

  const sink = getLogSink()
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

  const decoder = new TextDecoder()
  // "raw", not "info": this is the child's own output, not a status message from
  // us. Tagging it "info" stamped a bullet on every line, which flattened
  // brew's aligned tables and `==>` sections into an undifferentiated wall.
  // The pane decides how to draw it — see the classifier in home.tsx.
  const assembler = new LineAssembler((text, transient) =>
    sink?.("raw", text, transient ? { transient: true } : undefined),
  )

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
        rows: 24,
        data: (_terminal, bytes) => assembler.write(decoder.decode(bytes, { stream: true })),
        exit: () => ptyClosed(),
      },
    }),
  )
  if (Result.isError(spawned)) {
    return Result.err(new SpawnError({ command: cmd.join(" "), message: String(spawned.error) }))
  }
  const proc = spawned.value

  // Note the PTY `exit` callback reports stream lifecycle, NOT the child's
  // status — the real exit code only ever comes from `proc.exited`, or every
  // failed brew command would silently report success.
  const code = await proc.exited
  // The PTY's exit callback IS its EOF, so this normally resolves instantly;
  // the timeout is a safety net, not latency. A fixed 50ms nap here used to
  // truncate the tail of `brew upgrade` — the summary of what was upgraded —
  // whenever the last read landed late.
  await Promise.race([closed, Bun.sleep(1000)])
  assembler.write(decoder.decode()) // flush any multi-byte tail the stream decoder buffered
  assembler.end()
  proc.terminal?.close()
  return Result.ok(code)
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
