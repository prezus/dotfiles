import { describe, expect, it } from "bun:test"
import { parseRustList, parseSimpleList } from "./lists.ts"

describe("parseRustList", () => {
  it("parses the real packages/rust.txt shape", () => {
    const entries = parseRustList(`
# Toolchains
toolchain stable
toolchain nightly

# Components
component clippy

# Targets
target aarch64-apple-ios

# ESP
esp true
`)
    expect(entries).toEqual([
      { kind: "toolchain", value: "stable" },
      { kind: "toolchain", value: "nightly" },
      { kind: "component", value: "clippy" },
      { kind: "target", value: "aarch64-apple-ios" },
      { kind: "esp", value: "true" },
    ])
  })

  it("ignores unknown kinds rather than passing them to rustup", () => {
    expect(parseRustList("banana yes\ntoolchain stable")).toEqual([
      { kind: "toolchain", value: "stable" },
    ])
  })

  it("skips a kind with no value", () => {
    expect(parseRustList("toolchain")).toEqual([])
  })
})

describe("parseSimpleList", () => {
  it("parses the real packages/bun-global.txt shape", () => {
    expect(
      parseSimpleList(`
# Global CLIs managed by bun
electron-builder
sharp-cli
svgexport
`),
    ).toEqual(["electron-builder", "sharp-cli", "svgexport"])
  })

  it("strips inline comments", () => {
    expect(parseSimpleList("sharp-cli  # image tooling")).toEqual(["sharp-cli"])
  })

  it("drops blank and whitespace-only lines", () => {
    expect(parseSimpleList("a\n\n   \nb")).toEqual(["a", "b"])
  })
})
