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

  /** Absorb `KEY=value` lines, as emitted by `brew shellenv` / `~/.cargo/env`. */
  absorbShellenv(output: string): void {
    for (const line of output.split("\n")) {
      const m = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
      if (!m) continue
      const [, key, rawValue] = m
      if (!key || rawValue === undefined) continue
      let value = rawValue.trim().replace(/^["']|["']$/g, "")
      // brew shellenv emits self-referential PATH assignments.
      value = value.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, name: string) => this.vars[name] ?? "")
      this.vars[key] = value
    }
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
}

/**
 * Run a command and capture its output. Output is fully drained, so the child
 * never sees a closed pipe. Never throws on a non-zero exit — check `.ok`.
 */
export async function run(cmd: string[], opts: RunOptions = {}): Promise<RunResult> {
  const [bin, ...args] = cmd
  if (!bin) throw new Error("run() called with an empty command")

  const proc = Bun.spawn([bin, ...args], {
    cwd: opts.cwd,
    env: { ...(opts.env ?? env).toObject(), ...opts.extraEnv },
    stdin: opts.stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  // Drain both pipes concurrently before awaiting exit, or a child that fills
  // the stderr buffer while we read stdout deadlocks.
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { code, stdout, stderr, ok: code === 0 }
}

/**
 * Run a command that owns the terminal — sudo prompts, chsh, brew bundle,
 * third-party `curl | bash` installers. Inside a TUI, wrap in withSuspendedUI().
 */
export async function runInteractive(cmd: string[], opts: RunOptions = {}): Promise<number> {
  const [bin, ...args] = cmd
  if (!bin) throw new Error("runInteractive() called with an empty command")

  const proc = Bun.spawn([bin, ...args], {
    cwd: opts.cwd,
    env: { ...(opts.env ?? env).toObject(), ...opts.extraEnv },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  return await proc.exited
}

/** Resolved path of an executable, or null. Equivalent to `command -v`. */
export async function which(bin: string): Promise<string | null> {
  const res = await run(["/usr/bin/which", bin])
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
