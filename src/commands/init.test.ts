// The init step ORDER encodes real dependencies that were previously only
// comments. These tests make the ordering a contract rather than folklore.
import { describe, expect, it } from "bun:test"
import { initSteps } from "./init.ts"

const ids = () => initSteps().map((s) => s.id)
const indexOf = (id: string) => ids().indexOf(id)

describe("init step order", () => {
  it("has every machine setup step", () => {
    expect(ids()).toEqual([
      "homebrew",
      "rust",
      "packages",
      "rust-esp",
      "bun",
      "viteplus",
      "plannotator",
      "stow",
      "ssh",
      "fish",
      "skills",
    ])
  })

  it("installs Homebrew first — everything else needs brew on PATH", () => {
    expect(indexOf("homebrew")).toBe(0)
  })

  it("runs rustup BEFORE packages, because the bundle has cargo entries", () => {
    expect(indexOf("rust")).toBeLessThan(indexOf("packages"))
  })

  it("runs the ESP toolchain AFTER packages, because espup is a cargo entry", () => {
    expect(indexOf("rust-esp")).toBeGreaterThan(indexOf("packages"))
  })

  it("stows AFTER Vite+, which writes conf.d/vite-plus.fish into the repo", () => {
    expect(indexOf("stow")).toBeGreaterThan(indexOf("viteplus"))
  })

  it("wires skills last", () => {
    expect(indexOf("skills")).toBe(ids().length - 1)
  })
})

describe("init failure policy", () => {
  it("marks exactly the three steps bash aborted on as required", () => {
    const required = initSteps()
      .filter((s) => s.required)
      .map((s) => s.id)
    // Bash: brew/packages/stow used `|| return 1`; optional installers warn.
    expect(required.sort()).toEqual(["homebrew", "packages", "stow"])
  })

  it("leaves the other eight optional so one installer can't brick init", () => {
    expect(initSteps().filter((s) => !s.required)).toHaveLength(8)
  })

  it("gives every step a unique id", () => {
    expect(new Set(ids()).size).toBe(ids().length)
  })
})
