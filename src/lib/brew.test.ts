// The Brewfile parser replaces three separate ad-hoc regex parsers in the bash
// (the retry loop, the go-install loop, and _bundle_norm).
import { describe, expect, it } from "bun:test"
import { installCommand, parseBrewfile, shortName } from "./brew.ts"

describe("parseBrewfile", () => {
  it("parses each directive kind", () => {
    const entries = parseBrewfile(
      ['tap "oven-sh/bun"', 'brew "ripgrep"', 'cask "vlc"', 'go "golang.org/x/tools/cmd/godoc"', 'cargo "espup"'].join(
        "\n",
      ),
    )
    expect(entries.map((e) => e.kind)).toEqual(["tap", "brew", "cask", "go", "cargo"])
  })

  it("captures trailing options separately from the name", () => {
    const [entry] = parseBrewfile('brew "oven-sh/bun/bun", trusted: true')
    expect(entry?.name).toBe("oven-sh/bun/bun")
    expect(entry?.options).toBe("trusted: true")
  })

  it("skips comments and blank lines", () => {
    expect(parseBrewfile('# a comment\n\n   \nbrew "rg"')).toHaveLength(1)
  })

  it("keeps vscode entries parseable but distinguishable", () => {
    // They must never be COMMITTED to the bundle, but if one is present we
    // still want to recognise rather than silently misparse it.
    const [entry] = parseBrewfile('vscode "ms-python.python"')
    expect(entry?.kind).toBe("vscode")
  })

  it("rejects lines that merely start with a directive word", () => {
    expect(parseBrewfile('brewery "x"\nbrew"y"')).toHaveLength(0)
  })

  it("tolerates indentation, unlike the bash grep it replaces", () => {
    const [entry] = parseBrewfile('  brew "z"')
    expect(entry?.name).toBe("z")
  })
})

describe("shortName", () => {
  it("reduces a tapped formula to what `brew list` reports", () => {
    expect(shortName("oven-sh/bun/bun")).toBe("bun")
  })
  it("leaves a bare formula alone", () => {
    expect(shortName("ripgrep")).toBe("ripgrep")
  })
})

describe("installCommand", () => {
  it("uses --cask for casks", () => {
    expect(installCommand({ kind: "cask", name: "vlc", line: "" })).toEqual([
      "brew",
      "install",
      "--cask",
      "vlc",
    ])
  })
  it("uses `brew tap` for taps", () => {
    expect(installCommand({ kind: "tap", name: "a/b", line: "" })).toEqual(["brew", "tap", "a/b"])
  })
  it("installs a formula by its full tapped name", () => {
    expect(installCommand({ kind: "brew", name: "oven-sh/bun/bun", line: "" })).toEqual([
      "brew",
      "install",
      "oven-sh/bun/bun",
    ])
  })
})
