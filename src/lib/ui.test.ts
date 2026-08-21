import { describe, expect, test } from "bun:test"
import { confirm, interpretAnswer } from "./ui.ts"

describe("confirmation policy", () => {
  test("accepts explicit yes and otherwise follows the safe default", () => {
    expect(interpretAnswer("YES", false)).toBe(true)
    expect(interpretAnswer("n", true)).toBe(false)
    expect(interpretAnswer("", true)).toBe(true)
    expect(interpretAnswer(null, false)).toBe(false)
    expect(interpretAnswer("yep", false)).toBe(false)
  })

  test("uses the default instead of reading when no terminal is attached", async () => {
    expect(process.stdin.isTTY).toBeFalsy()
    expect(await confirm("Uninstall these?", false)).toBe(false)
    expect(await confirm("Continue?", true)).toBe(true)
  })
})
