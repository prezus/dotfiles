// The environment-threading tests.
//
// These cover the single most dangerous thing in the port. In bash, `init` ran
// as one process, so `eval "$(brew shellenv)"` at step 1 was automatically
// visible to steps 2-10. Here it has to be explicit, and a broken
// implementation fails ONLY on a machine that doesn't already have brew and
// cargo on PATH — i.e. never on a dev machine, only on a fresh one.
import { describe, expect, it } from "bun:test"
import { Result } from "better-result"
import { Env, extract, probe, run, runInteractiveCode } from "./exec.ts"

describe("Env.prepend", () => {
  it("puts the new entry first", () => {
    const env = new Env({ PATH: "/usr/bin:/bin" })
    env.prepend("PATH", "/opt/homebrew/bin")
    expect(env.get("PATH")).toBe("/opt/homebrew/bin:/usr/bin:/bin")
  })

  it("de-duplicates instead of growing PATH on every call", () => {
    const env = new Env({ PATH: "/usr/bin:/opt/homebrew/bin:/bin" })
    env.prepend("PATH", "/opt/homebrew/bin")
    expect(env.get("PATH")).toBe("/opt/homebrew/bin:/usr/bin:/bin")
  })

  it("is idempotent, so re-running a step can't corrupt PATH", () => {
    const env = new Env({ PATH: "/usr/bin" })
    env.prepend("PATH", "/opt/homebrew/bin")
    env.prepend("PATH", "/opt/homebrew/bin")
    expect(env.get("PATH")).toBe("/opt/homebrew/bin:/usr/bin")
  })

  it("handles a variable that does not exist yet", () => {
    const env = new Env({})
    env.prepend("PATH", "/opt/homebrew/bin")
    expect(env.get("PATH")).toBe("/opt/homebrew/bin")
  })
})

describe("Env.absorbShellenv", () => {
  // This is the real shape of `brew shellenv` output.
  it("absorbs brew shellenv, resolving self-referential PATH", () => {
    const env = new Env({ PATH: "/usr/bin:/bin" })
    env.absorbShellenv(`
export HOMEBREW_PREFIX="/opt/homebrew";
export HOMEBREW_CELLAR="/opt/homebrew/Cellar";
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin\${PATH+:$PATH}";
`)
    expect(env.get("HOMEBREW_PREFIX")).toBe("/opt/homebrew")
    expect(env.get("PATH")).toContain("/opt/homebrew/bin")
    // The pre-existing PATH must survive, or later steps lose /usr/bin.
    expect(env.get("PATH")).toContain("/usr/bin")
  })

  it("absorbs the cargo env format, expanding $HOME", () => {
    const env = new Env({ PATH: "/usr/bin", HOME: "/Users/arkan" })
    env.absorbShellenv('export PATH="$HOME/.cargo/bin:$PATH"')
    expect(env.get("PATH")).toBe("/Users/arkan/.cargo/bin:/usr/bin")
  })

  it("strips the trailing semicolon shellenv emits", () => {
    const env = new Env({})
    env.absorbShellenv('export HOMEBREW_PREFIX="/opt/homebrew";')
    // A stray ";" here would poison every PATH built from it.
    expect(env.get("HOMEBREW_PREFIX")).toBe("/opt/homebrew")
  })

  it("expands ${VAR+alt} to nothing when VAR is unset", () => {
    const env = new Env({})
    env.absorbShellenv('export PATH="/opt/homebrew/bin${PATH+:$PATH}";')
    expect(env.get("PATH")).toBe("/opt/homebrew/bin")
  })

  it("expands ${VAR:-default}", () => {
    const env = new Env({})
    env.absorbShellenv('export EDITOR="${VISUAL:-nvim}"')
    expect(env.get("EDITOR")).toBe("nvim")
  })

  it("ignores comments and blank lines", () => {
    const env = new Env({})
    env.absorbShellenv('# a comment\n\nexport FOO="bar"\nnot an export\n')
    expect(env.get("FOO")).toBe("bar")
    expect(env.get("not")).toBeUndefined()
  })

  it("strips surrounding quotes", () => {
    const env = new Env({})
    env.absorbShellenv(`export A="double"\nexport B='single'\nexport C=bare`)
    expect(env.get("A")).toBe("double")
    expect(env.get("B")).toBe("single")
    expect(env.get("C")).toBe("bare")
  })
})

describe("Env.absorbShellenv — modern brew emits no PATH line", () => {
  // Real `brew shellenv` output, Homebrew 6.0.13. There is NO `export PATH=`
  // any more: PATH is delegated to path_helper inside a nested eval, which bash
  // got for free via `eval` and we cannot.
  //
  // This test exists to stop anyone "simplifying" activateHomebrew() down to
  // just absorbShellenv(). If that happened, `init` would install Homebrew and
  // then fail at step 2 with "brew: command not found" — but ONLY on a machine
  // that didn't already have brew, i.e. never in local testing.
  const MODERN = `export HOMEBREW_PREFIX="/opt/homebrew";
export HOMEBREW_CELLAR="/opt/homebrew/Cellar";
export HOMEBREW_REPOSITORY="/opt/homebrew";
fpath[1,0]="/opt/homebrew/share/zsh/site-functions";
export FPATH;
eval "$(/usr/bin/env PATH_HELPER_ROOT="/opt/homebrew" /usr/libexec/path_helper -s)"
export INFOPATH="/opt/homebrew/share/info:\${INFOPATH:-}";`

  it("absorbs the HOMEBREW_* variables", () => {
    const env = new Env({ PATH: "/usr/bin" })
    env.absorbShellenv(MODERN)
    expect(env.get("HOMEBREW_PREFIX")).toBe("/opt/homebrew")
    expect(env.get("HOMEBREW_CELLAR")).toBe("/opt/homebrew/Cellar")
  })

  it("does NOT put brew on PATH — hence the explicit prepend in homebrew.ts", () => {
    const env = new Env({ PATH: "/usr/bin" })
    env.absorbShellenv(MODERN)
    expect(env.get("PATH")).toBe("/usr/bin")
    expect(env.get("PATH")).not.toContain("/opt/homebrew/bin")
  })

  it("prepending the prefix explicitly is what makes brew reachable", () => {
    const env = new Env({ PATH: "/usr/bin" })
    env.absorbShellenv(MODERN)
    env.prepend("PATH", "/opt/homebrew/sbin")
    env.prepend("PATH", "/opt/homebrew/bin")
    expect(env.get("PATH")).toBe("/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin")
  })
})

describe("Env isolation", () => {
  it("does not mutate the object it was constructed from", () => {
    const base = { PATH: "/usr/bin" }
    const env = new Env(base)
    env.prepend("PATH", "/opt/homebrew/bin")
    expect(base.PATH).toBe("/usr/bin")
  })

  it("drops undefined values rather than passing them to a child", () => {
    const env = new Env({ SET: "yes", UNSET: undefined })
    expect(env.toObject()).toEqual({ SET: "yes" })
  })
})

describe("missing binaries are values, not exceptions", () => {
  const MISSING = ["definitely-not-a-real-binary-xyz", "--version"]

  it("run() returns Err instead of throwing", async () => {
    // Before better-result this threw `Executable not found in $PATH`, despite
    // the docstring promising it never threw. Call sites were only safe because
    // they happened to guard with commandExists first.
    const result = await run(MISSING)
    expect(Result.isError(result)).toBe(true)
    if (!Result.isError(result)) throw new Error("unreachable")
    expect(result.error._tag).toBe("SpawnError")
    expect(result.error.command).toContain("definitely-not-a-real-binary-xyz")
  })

  it("distinguishes 'could not start' from 'ran and failed'", async () => {
    // A non-zero exit is data, not an error — this distinction is the whole
    // point of the Result boundary being where it is.
    const ranAndFailed = await run(["/bin/sh", "-c", "exit 3"])
    expect(Result.isOk(ranAndFailed)).toBe(true)
    if (!Result.isOk(ranAndFailed)) throw new Error("unreachable")
    expect(ranAndFailed.value.code).toBe(3)
    expect(ranAndFailed.value.ok).toBe(false)
  })

  it("probe() degrades to exit 127, the shell's command-not-found code", async () => {
    const result = await probe(MISSING)
    expect(result.ok).toBe(false)
    expect(result.code).toBe(127)
    expect(result.stdout).toBe("")
  })

  it("probe() still returns real output for a command that exists", async () => {
    const result = await probe(["/bin/echo", "hello"])
    expect(result.ok).toBe(true)
    expect(result.stdout.trim()).toBe("hello")
  })

  it("runInteractiveCode() yields 127 rather than throwing", async () => {
    expect(await runInteractiveCode(MISSING)).toBe(127)
  })

  it("rejects an empty command instead of crashing on undefined", async () => {
    const result = await run([])
    expect(Result.isError(result)).toBe(true)
  })
})

describe("extract", () => {
  it("pulls the first capture group", () => {
    expect(extract("Homebrew 6.0.13", /([0-9]+(?:\.[0-9]+)+)/)).toBe("6.0.13")
  })

  it("returns undefined when there is no match", () => {
    expect(extract("no digits here", /([0-9]+)/)).toBeUndefined()
  })
})
