// The environment-threading tests.
//
// These cover the single most dangerous thing in the port. In bash, `init` ran
// as one process, so `eval "$(brew shellenv)"` at step 1 was automatically
// visible to steps 2-10. Here it has to be explicit, and a broken
// implementation fails ONLY on a machine that doesn't already have brew and
// cargo on PATH — i.e. never on a dev machine, only on a fresh one.
import { describe, expect, it } from "bun:test"
import { Env, extract } from "./exec.ts"

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

describe("extract", () => {
  it("pulls the first capture group", () => {
    expect(extract("Homebrew 6.0.13", /([0-9]+(?:\.[0-9]+)+)/)).toBe("6.0.13")
  })

  it("returns undefined when there is no match", () => {
    expect(extract("no digits here", /([0-9]+)/)).toBeUndefined()
  })
})
