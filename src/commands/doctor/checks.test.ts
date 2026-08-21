import { describe, expect, it } from "bun:test"
import {
  countCriticalIssues,
  doctorExitCode,
  globToRegExp,
  normalizeBundle,
  type CompletedCheck,
} from "./checks.ts"

describe("package drift policy", () => {
  it("normalizes tracked directives without importing VS Code or option churn", () => {
    const result = normalizeBundle(
      ['tap "a/b"', 'brew "rg", link: false', 'brew "rg"', 'cask "vlc"', 'vscode "ms.python"', '  brew "bad"'].join("\n"),
    )
    expect([...result].sort()).toEqual(['brew "rg"', 'cask "vlc"', 'tap "a/b"'])
  })

  it("matches anchored ignore globs without treating literals as regular expressions", () => {
    const wildcard = globToRegExp('vscode "*"')
    expect(wildcard.test('vscode "ms-python.python"')).toBe(true)
    expect(wildcard.test('brew "node"')).toBe(false)
    expect(globToRegExp("a.b").test("aXb")).toBe(false)
    expect(globToRegExp('brew "rg"').test('xbrew "rg"y')).toBe(false)
  })
})

describe("doctor exit policy", () => {
  const check = (critical: boolean, status: "ok" | "warn" | "fail"): CompletedCheck => ({
    id: `${critical}-${status}`,
    section: "Tooling",
    label: status,
    critical,
    run: async () => ({ status, message: "" }),
    result: { status, message: "" },
  })

  it("fails while critical work is pending or a critical check has failed", () => {
    expect(doctorExitCode([], true)).toBe(1)
    expect(countCriticalIssues([check(true, "fail"), check(false, "fail"), check(true, "warn")])).toBe(1)
  })
})
