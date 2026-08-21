import { describe, expect, it } from "bun:test"
import { parseBrewfile } from "./brew.ts"

describe("parseBrewfile", () => {
  it("parses the manifest grammar and rejects lookalike directives", () => {
    const entries = parseBrewfile(
      ['tap "oven-sh/bun"', 'brew "ripgrep", link: false', 'cask "vlc"', 'go "golang.org/x/tools/cmd/godoc"', 'cargo "espup"', 'vscode "ms-python.python"', '# comment', 'brewery "x"', '  brew "z"'].join("\n"),
    )
    expect(entries.map(({ kind, name }) => [kind, name])).toEqual([
      ["tap", "oven-sh/bun"],
      ["brew", "ripgrep"],
      ["cask", "vlc"],
      ["go", "golang.org/x/tools/cmd/godoc"],
      ["cargo", "espup"],
      ["vscode", "ms-python.python"],
      ["brew", "z"],
    ])
    expect(entries[1]?.options).toBe("link: false")
  })
})
