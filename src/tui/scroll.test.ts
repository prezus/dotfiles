import { describe, expect, it } from "bun:test"
import {
  clampOffset,
  fitWindow,
  hiddenCounts,
  maxOffset,
  nextStart,
  tailWindow,
  windowFor,
} from "./scroll.ts"

describe("nextStart", () => {
  it("does not scroll a list that already fits", () => {
    for (let focus = 0; focus < 5; focus++) {
      expect(nextStart(0, 5, focus, 10)).toBe(0)
    }
  })

  it("advances by one row when the cursor walks off the bottom", () => {
    // 20 rows, 5 visible: cursor at 5 is one past the window [0,5).
    expect(nextStart(0, 20, 5, 5)).toBe(1)
    expect(nextStart(1, 20, 6, 5)).toBe(2)
  })

  it("follows the cursor back up without over-scrolling", () => {
    expect(nextStart(10, 20, 9, 5)).toBe(9)
    expect(nextStart(9, 20, 0, 5)).toBe(0)
  })

  it("leaves the window alone while the cursor moves inside it", () => {
    // This is the whole reason it is not centring: no movement, no scroll.
    expect(nextStart(3, 20, 4, 5)).toBe(3)
    expect(nextStart(3, 20, 7, 5)).toBe(3)
  })

  it("clamps a stale start when the list shrinks under it", () => {
    // Doctor folds a section, reconcile resolves a row: `prev` now points past
    // the end and must not leave the window off the list.
    expect(nextStart(18, 6, 0, 5)).toBe(0)
    expect(nextStart(18, 8, 7, 5)).toBe(3)
  })

  it("never returns a negative start", () => {
    expect(nextStart(-5, 3, 0, 5)).toBe(0)
    expect(nextStart(0, 0, 0, 5)).toBe(0)
  })
})

describe("windowFor", () => {
  it("returns the whole list when it fits", () => {
    expect(windowFor(0, 4, 2, 10)).toEqual({ start: 0, end: 4 })
  })

  it("returns exactly viewport rows when it does not", () => {
    const w = windowFor(0, 40, 0, 12)
    expect(w).toEqual({ start: 0, end: 12 })
    expect(w.end - w.start).toBe(12)
  })

  it("keeps the cursor inside the window it returns", () => {
    let start = 0
    for (const focus of [0, 7, 19, 3, 39, 12]) {
      const w = windowFor(start, 40, focus, 9)
      expect(focus).toBeGreaterThanOrEqual(w.start)
      expect(focus).toBeLessThan(w.end)
      start = w.start
    }
  })
})

describe("tailWindow", () => {
  it("shows the tail while following, which is offset 0", () => {
    expect(tailWindow(100, 0, 10)).toEqual({ start: 90, end: 100 })
  })

  it("slides with new output at offset 0 — this is the follow behaviour", () => {
    expect(tailWindow(100, 0, 10).end).toBe(100)
    expect(tailWindow(140, 0, 10).end).toBe(140)
  })

  it("pins the same lines while output keeps arriving above", () => {
    // Scrolled up 20 from a 100-line history, then 40 more lines land. Staying
    // pinned means the offset grows with the list, not that the view jumps.
    expect(tailWindow(100, 20, 10)).toEqual({ start: 70, end: 80 })
    expect(tailWindow(140, 60, 10)).toEqual({ start: 70, end: 80 })
  })

  it("shows the whole list when it is shorter than the viewport", () => {
    expect(tailWindow(3, 0, 10)).toEqual({ start: 0, end: 3 })
  })

  it("clamps an offset that would scroll past the top", () => {
    expect(tailWindow(30, 999, 10)).toEqual({ start: 0, end: 10 })
  })
})

describe("maxOffset / clampOffset", () => {
  it("is zero when everything already fits", () => {
    expect(maxOffset(8, 10)).toBe(0)
    expect(clampOffset(5, 8, 10)).toBe(0)
  })

  it("stops at the top of the history", () => {
    expect(maxOffset(100, 10)).toBe(90)
    expect(clampOffset(999, 100, 10)).toBe(90)
  })

  it("never goes below zero", () => {
    expect(clampOffset(-4, 100, 10)).toBe(0)
  })

  it("shrinks a held offset when history is discarded under it", () => {
    // MAX_HISTORY trimming the list must not leave you scrolled off the end.
    expect(clampOffset(90, 40, 10)).toBe(30)
  })
})

describe("hiddenCounts", () => {
  it("reports nothing hidden when the window covers the list", () => {
    expect(hiddenCounts({ start: 0, end: 5 }, 5)).toEqual({ above: 0, below: 0 })
  })

  it("counts rows on both sides", () => {
    expect(hiddenCounts({ start: 10, end: 20 }, 50)).toEqual({ above: 10, below: 30 })
  })

  it("counts discarded history as hidden above, so the pane stays honest", () => {
    expect(hiddenCounts({ start: 5, end: 15 }, 40, 200)).toEqual({ above: 205, below: 25 })
  })
})

describe("fitWindow", () => {
  const flat = (n: number) => Array.from({ length: n }, () => 1)

  it("behaves like a plain window when every row is one tall", () => {
    expect(fitWindow(flat(20), 0, 5)).toEqual({ start: 0, end: 5 })
    expect(fitWindow(flat(3), 0, 5)).toEqual({ start: 0, end: 3 })
  })

  it("fits fewer items when rows are taller", () => {
    // A failing check with three extra detail lines is four rows, not one.
    expect(fitWindow([4, 4, 4, 1, 1], 0, 8)).toEqual({ start: 0, end: 2 })
  })

  it("scrolls until the focused item is inside the window", () => {
    const w = fitWindow([4, 4, 4, 4], 3, 8)
    expect(3).toBeGreaterThanOrEqual(w.start)
    expect(3).toBeLessThan(w.end)
  })

  it("always returns at least one item, even one taller than the viewport", () => {
    // Clipping one very tall check beats rendering an empty panel.
    expect(fitWindow([50], 0, 4)).toEqual({ start: 0, end: 1 })
    expect(fitWindow([50, 50], 1, 4)).toEqual({ start: 1, end: 2 })
  })

  it("keeps the focus visible for every position in a ragged list", () => {
    const heights = [1, 3, 1, 5, 1, 1, 4, 2, 1, 1]
    let start = 0
    for (let focus = 0; focus < heights.length; focus++) {
      const w = fitWindow(heights, focus, 7, start)
      expect(focus).toBeGreaterThanOrEqual(w.start)
      expect(focus).toBeLessThan(w.end)
      start = w.start
    }
  })

  it("handles an empty list without producing a bogus window", () => {
    expect(fitWindow([], 0, 10)).toEqual({ start: 0, end: 0 })
  })

  it("clamps a focus or prev that points off the list", () => {
    expect(fitWindow(flat(4), 99, 10)).toEqual({ start: 0, end: 4 })
    expect(fitWindow(flat(10), 0, 3, 99)).toEqual({ start: 0, end: 3 })
  })
})
