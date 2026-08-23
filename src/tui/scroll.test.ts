import { describe, expect, it } from "bun:test"
import { fitWindow, nextStart, windowFor, wrappedRows } from "./scroll.ts"

describe("list windows", () => {
  it("keeps focus visible without moving a window unnecessarily", () => {
    expect(nextStart(3, 20, 4, 5)).toBe(3)
    expect(nextStart(0, 20, 5, 5)).toBe(1)
    expect(nextStart(18, 6, 0, 5)).toBe(0)
    for (const focus of [0, 7, 19, 3, 39]) {
      const window = windowFor(0, 40, focus, 9)
      expect(window.start).toBeLessThanOrEqual(focus)
      expect(window.end).toBeGreaterThan(focus)
      expect(window.end - window.start).toBeLessThanOrEqual(9)
    }
  })

  it("fits ragged rows while preserving the focused item", () => {
    const heights = [1, 3, 1, 5, 1, 1, 4, 2]
    let start = 0
    for (let focus = 0; focus < heights.length; focus++) {
      const window = fitWindow(heights, focus, 7, start)
      expect(window.start).toBeLessThanOrEqual(focus)
      expect(window.end).toBeGreaterThan(focus)
      start = window.start
    }
  })

  it("returns one oversized item and no item for an empty list", () => {
    expect(fitWindow([50, 50], 1, 4)).toEqual({ start: 1, end: 2 })
    expect(fitWindow([], 0, 10)).toEqual({ start: 0, end: 0 })
  })
})

describe("wrappedRows", () => {
  it("counts a line that fits as one row", () => {
    expect(wrappedRows("abc", 80)).toBe(1)
    expect(wrappedRows("", 80)).toBe(1)
  })

  it("counts the rows a long line actually wraps to", () => {
    expect(wrappedRows("x".repeat(80), 80)).toBe(1)
    expect(wrappedRows("x".repeat(81), 80)).toBe(2)
    expect(wrappedRows("x".repeat(235), 80)).toBe(3)
  })

  it("charges the prefix drawn before the text on the same line", () => {
    // 76 + a 5-wide marker/glyph prefix exceeds 80, so it wraps.
    expect(wrappedRows("x".repeat(76), 80, 5)).toBe(2)
    expect(wrappedRows("x".repeat(74), 80, 5)).toBe(1)
  })

  it("never returns zero for a degenerate width", () => {
    expect(wrappedRows("abc", 0)).toBeGreaterThanOrEqual(1)
  })
})
