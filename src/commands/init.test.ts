import { describe, expect, it } from "bun:test"
import { initSteps } from "./init.ts"

const indexOf = (id: string) => initSteps().findIndex((step) => step.id === id)

describe("init contract", () => {
  it("preserves dependencies between setup steps", () => {
    expect(indexOf("homebrew")).toBe(0)
    expect(indexOf("rust")).toBeLessThan(indexOf("packages"))
    expect(indexOf("rust-esp")).toBeGreaterThan(indexOf("packages"))
    expect(indexOf("stow")).toBeGreaterThan(indexOf("viteplus"))
    expect(indexOf("pi")).toBeGreaterThan(indexOf("stow"))
    expect(indexOf("skills")).toBe(initSteps().length - 1)
  })

  it("aborts only when a prerequisite fails", () => {
    expect(
      initSteps()
        .filter((step) => step.required)
        .map((step) => step.id)
        .sort(),
    ).toEqual(["homebrew", "packages", "stow"])
  })
})
