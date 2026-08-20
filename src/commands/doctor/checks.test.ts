// The untracked-package drift detector is the subtlest logic in doctor: it
// exists because `brew bundle check` structurally cannot see a package that was
// installed ad hoc and never added to packages/bundle. Bugs here are silent —
// you find out on the next machine.
import { describe, expect, it } from "bun:test"
import {
  CHECKS,
  SECTIONS,
  countCriticalIssues,
  doctorExitCode,
  globToRegExp,
  newestEspVersionDir,
  normalizeBundle,
  runChecks,
  type CompletedCheck,
} from "./checks.ts"

describe("newestEspVersionDir", () => {
  // The rule is "lexicographically last" ONLY because that is what a fish glob
  // subscript [-1] and the shell for-loops resolve to. Doctor must agree with
  // the shells it is checking, or it reports drift that does not exist.
  it("returns null when nothing is installed", () => {
    expect(newestEspVersionDir([])).toBe(null)
  })

  it("takes the single version dir", () => {
    expect(newestEspVersionDir(["esp-15.2.0_20250920"])).toBe("esp-15.2.0_20250920")
  })

  it("takes the last one alphabetically, matching the shell glob", () => {
    expect(newestEspVersionDir(["esp-15.2.0_20250920", "esp-16.0.0_20260101"])).toBe("esp-16.0.0_20260101")
  })

  it("ignores entries that are not version dirs", () => {
    expect(newestEspVersionDir([".DS_Store", "README", "esp-15.2.0_20250920"])).toBe("esp-15.2.0_20250920")
  })

  it("returns null when the directory holds no version dirs at all", () => {
    expect(newestEspVersionDir([".DS_Store", "README"])).toBe(null)
  })
})

describe("normalizeBundle", () => {
  it("keeps only tracked directive kinds", () => {
    const out = normalizeBundle(
      ['tap "a/b"', 'brew "rg"', 'cask "vlc"', 'go "x"', 'cargo "y"', 'vscode "ms.python"', "# comment", ""].join(
        "\n",
      ),
    )
    expect([...out].sort()).toEqual(['brew "rg"', 'cargo "y"', 'cask "vlc"', 'go "x"', 'tap "a/b"'])
    // vscode lines must never be tracked — they come from Settings Sync.
    expect(out.has('vscode "ms.python"')).toBe(false)
  })

  it("drops trailing options so flag churn is not reported as drift", () => {
    const out = normalizeBundle('brew "bun", trusted: true\nbrew "foo", link: false')
    expect([...out].sort()).toEqual(['brew "bun"', 'brew "foo"'])
  })

  it("de-duplicates", () => {
    expect(normalizeBundle('brew "rg"\nbrew "rg"').size).toBe(1)
  })

  it("ignores indented or malformed lines", () => {
    expect(normalizeBundle('  brew "rg"\nbrewfoo "x"\nbrew"y"').size).toBe(0)
  })
})

describe("globToRegExp", () => {
  it("matches the bundle.ignore wildcard entry for vscode", () => {
    const re = globToRegExp('vscode "*"')
    expect(re.test('vscode "ms-python.python"')).toBe(true)
    expect(re.test('brew "node"')).toBe(false)
  })

  it("matches an exact entry", () => {
    const re = globToRegExp('brew "node"')
    expect(re.test('brew "node"')).toBe(true)
    // Must not also swallow node-adjacent formulae.
    expect(re.test('brew "nodenv"')).toBe(false)
  })

  it("anchors, so a substring does not match", () => {
    expect(globToRegExp('brew "rg"').test('xbrew "rg"y')).toBe(false)
  })

  it("treats regex metacharacters literally", () => {
    expect(globToRegExp("a.b").test("aXb")).toBe(false)
    expect(globToRegExp("a.b").test("a.b")).toBe(true)
  })
})

describe("check registry", () => {
  it("has unique ids", () => {
    const ids = CHECKS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("assigns every check to a known section", () => {
    for (const check of CHECKS) expect(SECTIONS).toContain(check.section)
  })

  it("marks exactly the four tools bash treated as critical", () => {
    expect(CHECKS.filter((c) => c.critical).map((c) => c.id).sort()).toEqual([
      "brew",
      "fish",
      "git",
      "stow",
    ])
  })
})

describe("doctorExitCode", () => {
  it("does not report success while a critical check is still pending", () => {
    expect(doctorExitCode([], true)).toBe(1)
  })
})

describe("countCriticalIssues", () => {
  const make = (id: string, critical: boolean, status: "ok" | "warn" | "fail"): CompletedCheck =>
    ({
      id,
      section: "Tooling",
      label: id,
      critical,
      run: async () => ({ status, message: "" }),
      result: { status, message: "" },
    }) as CompletedCheck

  it("counts only critical failures", () => {
    expect(
      countCriticalIssues([
        make("a", true, "fail"),
        make("b", false, "fail"), // not critical
        make("c", true, "warn"), // critical but only a warning
        make("d", true, "ok"),
      ]),
    ).toBe(1)
  })

  it("is zero on a healthy machine", () => {
    expect(countCriticalIssues([make("a", true, "ok")])).toBe(0)
  })
})

describe("runChecks (integration, runs against this machine)", () => {
  it("returns a result for every check and never throws", async () => {
    const results = await runChecks()
    expect(results.length).toBe(CHECKS.length)
    for (const r of results) {
      expect(r.result).toBeDefined()
      expect(["ok", "warn", "fail", "info"]).toContain(r.result.status)
      expect(r.result.message).toBeTypeOf("string")
    }
  }, 60_000)

  it("invokes the onResult callback once per check", async () => {
    const seen: string[] = []
    await runChecks((c) => seen.push(c.id))
    expect(seen.length).toBe(CHECKS.length)
    expect(new Set(seen).size).toBe(CHECKS.length)
  }, 60_000)
})
