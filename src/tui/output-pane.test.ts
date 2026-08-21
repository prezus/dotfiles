import { describe, expect, it } from "bun:test"
import { paneRows, statusBar } from "./output-pane.ts"

describe("output pane layout", () => {
  it("fits short and tall terminals while keeping progress on one row", () => {
    expect(paneRows(12)).toBe(4)
    expect(paneRows(60)).toBe(52)
    const bar = statusBar({
      label: "update",
      tick: 2,
      elapsedMs: 83_000,
      step: { index: 1, total: 5, title: "x".repeat(200), state: "running" },
      columns: 80,
    })
    expect(bar).toContain("[2/5]")
    expect(bar.length).toBeLessThanOrEqual(74)
  })
})
