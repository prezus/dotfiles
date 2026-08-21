import { describe, expect, it } from "bun:test"
import { Result } from "better-result"
import { Env, probe, run, runInteractiveCode, type RunOptions } from "./exec.ts"
import { setTerminalSink } from "./ui.ts"

describe("environment threading", () => {
  it("absorbs the shell formats emitted by Homebrew and Cargo", () => {
    const brew = new Env({ PATH: "/usr/bin:/bin" })
    brew.absorbShellenv(`
export HOMEBREW_PREFIX="/opt/homebrew";
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin\${PATH+:$PATH}";
`)
    expect(brew.get("HOMEBREW_PREFIX")).toBe("/opt/homebrew")
    expect(brew.get("PATH")).toBe("/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin")

    const cargo = new Env({ PATH: "/usr/bin", HOME: "/Users/example" })
    cargo.absorbShellenv('export PATH="$HOME/.cargo/bin:$PATH"')
    expect(cargo.get("PATH")).toBe("/Users/example/.cargo/bin:/usr/bin")
  })

  it("handles modern Homebrew shellenv by explicitly prepending without corrupting PATH", () => {
    const base = { PATH: "/usr/bin:/opt/homebrew/bin:/bin" }
    const env = new Env(base)
    env.absorbShellenv(`export HOMEBREW_PREFIX="/opt/homebrew";
eval "$(/usr/bin/env PATH_HELPER_ROOT="/opt/homebrew" /usr/libexec/path_helper -s)"`)
    env.prepend("PATH", "/opt/homebrew/bin")
    env.prepend("PATH", "/opt/homebrew/bin")
    expect(env.get("PATH")).toBe("/opt/homebrew/bin:/usr/bin:/bin")
    expect(base.PATH).toBe("/usr/bin:/opt/homebrew/bin:/bin")
  })
})

describe("process result contract", () => {
  const missing = ["definitely-not-a-real-binary-xyz", "--version"]

  it("distinguishes a spawn failure from a process with a non-zero exit", async () => {
    expect(Result.isError(await run(missing))).toBe(true)
    const failed = await run(["/bin/sh", "-c", "exit 3"])
    expect(Result.isOk(failed)).toBe(true)
    if (Result.isOk(failed)) expect(failed.value.code).toBe(3)
  })

  it("turns missing probes and interactive commands into shell-style exit 127", async () => {
    expect(await probe(missing)).toMatchObject({ ok: false, code: 127, stdout: "" })
    expect(await runInteractiveCode(missing)).toBe(127)
  })
})

describe("embedded terminal process contract", () => {
  const capture = async (command: string[], opts: RunOptions = {}) => {
    const chunks: Uint8Array[] = []
    setTerminalSink({ write: (bytes) => chunks.push(bytes.slice()), connectPty: () => {} })
    try {
      const code = await runInteractiveCode(command, opts)
      return { output: new TextDecoder().decode(Buffer.concat(chunks)), code }
    } finally {
      setTerminalSink(null)
    }
  }

  it("forwards raw stdout, stderr and the real exit code", async () => {
    const { output, code } = await capture([
      "/bin/sh",
      "-c",
      "printf '\\033[1;32mtool\\033[0m\\n'; echo warning >&2; exit 7",
    ])
    expect(output).toContain("\x1b[1;32mtool\x1b[0m")
    expect(output).toContain("warning")
    expect(code).toBe(7)
  })

  it("gives captured tools a tty but closes unreadable stdin", async () => {
    const { output } = await capture([
      "/bin/sh",
      "-c",
      "test -t 1 && echo tty; test -t 0 && echo stdin || echo closed",
    ])
    expect(output).toContain("tty")
    expect(output).toContain("closed")
  })

  it("leaves a child needing input on the real terminal", async () => {
    const { output } = await capture(["/bin/sh", "-c", "echo interactive"], { needsStdin: true })
    expect(output).toBe("")
  })

  it("does not hang when a captured child attempts to read", async () => {
    const started = Date.now()
    const { output } = await capture(["/bin/sh", "-c", "read a; read b; echo survived"])
    expect(output).toContain("survived")
    expect(Date.now() - started).toBeLessThan(2_000)
  }, 5_000)
})
