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

/**
 * Run a command that owns the terminal — sudo prompts, chsh, brew bundle,
 * third-party `curl | bash` installers. Inside a TUI, wrap in withSuspendedUI().
 */
/**
 * Read a stream line by line, emitting as the child produces output rather than
 * buffering to the end — so a long `brew install` shows progress live.
 */
async function pump(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      // Strip the child's own colour: the pane applies its own styling, and raw
      // escapes would corrupt the layout.
      const clean = line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "").trimEnd()
      if (clean !== "") onLine(clean)
    }
  }
  if (buffer.trim() !== "") onLine(buffer.trim())
}

/**
 * Run a command that produces terminal output.
 *
 * When a log sink is installed (i.e. a UI is showing a pane) and the child does
 * not need stdin, its output is STREAMED into that sink instead of inheriting
 * the terminal. That is what keeps `brew`, `stow`, `rustup` and friends inside
 * the TUI rather than making the app drop out to run them.
 *
 * Children that need the user's keyboard set `needsStdin` and always inherit.
 */
export async function runInteractive(
  cmd: string[],
  opts: RunOptions = {},
): Promise<Result<number, SpawnError>> {
  const [bin, ...args] = cmd
  if (!bin) return Result.err(new SpawnError({ command: "", message: "empty command" }))

  const sink = getLogSink()
  const capture = sink !== null && opts.needsStdin !== true

  const spawned = Result.try(() =>
    Bun.spawn([bin, ...args], {
      cwd: opts.cwd,
      env: { ...(opts.env ?? env).toObject(), ...opts.extraEnv },
      stdin: capture ? "ignore" : "inherit",
      stdout: capture ? "pipe" : "inherit",
      stderr: capture ? "pipe" : "inherit",
    }),
  )
  if (Result.isError(spawned)) {
    return Result.err(new SpawnError({ command: cmd.join(" "), message: String(spawned.error) }))
  }
  const proc = spawned.value

  if (!capture) return Result.ok(await proc.exited)

  const emit = (line: string) => sink?.("info", line)
  const [, , code] = await Promise.all([
    pump(proc.stdout as ReadableStream<Uint8Array>, emit),
    pump(proc.stderr as ReadableStream<Uint8Array>, emit),
    proc.exited,
  ])
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
