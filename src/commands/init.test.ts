import { describe, expect, it } from "bun:test"
import { initSteps } from "./init.ts"
import { IS_DARWIN } from "../lib/platform.ts"

const indexOf = (id: string) => initSteps().findIndex((step) => step.id === id)
const requiredIds = () =>
  initSteps()
    .filter((step) => step.required)
    .map((step) => step.id)
    .sort()

describe("init contract", () => {
  it("bootstraps the package manager first, and requires it", () => {
    const bootstrap = IS_DARWIN ? "homebrew" : "pacman"
    expect(indexOf(bootstrap)).toBe(0)
    expect(requiredIds()).toContain(bootstrap)
  })

  it("preserves the ordering shared by both platforms", () => {
    expect(indexOf("mise")).toBeGreaterThan(indexOf("stow"))
    expect(indexOf("pi")).toBeGreaterThan(indexOf("mise"))
    expect(indexOf("rust-esp")).toBeGreaterThan(indexOf("rust"))
    // skills only wires symlinks, so it comes after everything that creates them.
    expect(indexOf("skills")).toBeGreaterThan(indexOf("stow"))
    expect(requiredIds()).toContain("stow")
  })

  it.skipIf(!IS_DARWIN)("ends on skills, which only wires symlinks", () => {
    expect(initSteps().at(-1)?.id).toBe("skills")
  })

  it.skipIf(IS_DARWIN)("ends on the omarchy includes, after stow places them", () => {
    const ids = initSteps().map((s) => s.id)
    expect(ids.at(-1)).toBe("omarchy-includes")
    expect(ids.indexOf("omarchy-includes")).toBeGreaterThan(ids.indexOf("stow"))
  })

  it.skipIf(!IS_DARWIN)("runs rust around the Brewfile's cargo entries", () => {
    expect(indexOf("rust")).toBeLessThan(indexOf("packages"))
    expect(indexOf("rust-esp")).toBeGreaterThan(indexOf("packages"))
    expect(requiredIds()).toEqual(["homebrew", "packages", "stow"])
  })

  it.skipIf(IS_DARWIN)("has no separate packages step — pacman covers it", () => {
    expect(indexOf("packages")).toBe(-1)
    expect(requiredIds()).toEqual(["pacman", "stow"])
  })
})
