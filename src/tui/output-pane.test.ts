import { describe, expect, it } from "bun:test"
import {
  appendLog,
  currentActivity,
  emptyPane,
  formatElapsed,
  MAX_HISTORY,
  mergeBatch,
  paneRows,
  pinnedSection,
  SPINNER_FRAMES,
  spinnerFrame,
  statusBar,
  styleFor,
  truncate,
  type LogEntry,
} from "./output-pane.ts"
import { theme } from "./theme.ts"

const raw = (message: string, transient = false): LogEntry => ({ level: "raw", message, transient })

describe("appendLog", () => {
  it("stacks committed lines", () => {
    const logs = [raw("one"), raw("two")].reduce(appendLog, [] as LogEntry[])
    expect(logs.map((l) => l.message)).toEqual(["one", "two"])
  })

  it("collapses a redraw onto the row it supersedes", () => {
    // 200 frames of a download bar must not push 200 rows of real output away.
    const frames = ["10%", "20%", "30%"].map((f) => raw(f, true))
    const logs = frames.reduce(appendLog, [raw("==> Downloading node")])
    expect(logs.map((l) => l.message)).toEqual(["==> Downloading node", "30%"])
  })

  it("lets the committed line replace the frames that drew it", () => {
    const logs = [raw("50%", true), raw("100%", true), raw("100% done")].reduce(
      appendLog,
      [] as LogEntry[],
    )
    expect(logs.map((l) => l.message)).toEqual(["100% done"])
  })

  it("keeps a new transient below a committed line rather than eating it", () => {
    const logs = [raw("==> Pouring"), raw("5%", true)].reduce(appendLog, [] as LogEntry[])
    expect(logs.map((l) => l.message)).toEqual(["==> Pouring", "5%"])
  })

  it("slots our own status message ABOVE a live bar instead of destroying it", () => {
    // A printSuccess landing mid-download made the bar vanish for a frame and
    // reappear — flicker. The bar is unrelated to the message; it stays last.
    const logs = appendLog([raw("==> Downloading"), raw("40%", true)], {
      level: "ok",
      message: "repos pulled",
    })
    expect(logs.map((l) => l.message)).toEqual(["==> Downloading", "repos pulled", "40%"])
  })

  it("still lets the child's own committed line replace its bar", () => {
    const logs = appendLog([raw("40%", true)], raw("100% done"))
    expect(logs.map((l) => l.message)).toEqual(["100% done"])
  })
})

describe("styleFor", () => {
  it("draws our own status messages with their glyph", () => {
    expect(styleFor({ level: "ok", message: "done" }).glyph).toBe("✓")
    expect(styleFor({ level: "info", message: "note" }).glyph).toBe("ℹ")
  })

  it("does NOT bullet a child's output — that flattened brew's tables", () => {
    const line = styleFor(raw("node    26.5.0_1  -> 26.5.1"))
    expect(line.glyph).toBe(" ")
    expect(line.text).toBe("node    26.5.0_1  -> 26.5.1")
  })

  it("turns Homebrew's ==> section marker into the pane's", () => {
    const line = styleFor(raw("==> Downloading node-26.5.1.bottle.tar.gz"))
    expect(line.glyph).toBe("▸")
    expect(line.text).toBe("Downloading node-26.5.1.bottle.tar.gz")
    expect(line.fg).toBe(theme.fg)
  })

  it("surfaces a warning a child prints, instead of muting it", () => {
    const line = styleFor(raw("Warning: node 26.5.1 is already installed"))
    expect(line.glyph).toBe("⚠")
    expect(line.fg).toBe(theme.yellow)
  })

  it("surfaces an error a child prints", () => {
    expect(styleFor(raw("Error: cmake failed to build")).fg).toBe(theme.red)
  })

  it("dims a line that is still being redrawn", () => {
    expect(styleFor(raw("#### 40%", true)).fg).toBe(theme.dim)
    expect(styleFor(raw("#### 40%", false)).fg).toBe(theme.fgMuted)
  })
})

describe("truncate", () => {
  it("keeps a line to one row so it cannot wrap and break the column", () => {
    expect(truncate("x".repeat(200), 80)).toHaveLength(74)
    expect(truncate("x".repeat(200), 80).endsWith("…")).toBe(true)
  })

  it("leaves a line that already fits alone", () => {
    expect(truncate("short", 80)).toBe("short")
  })
})

describe("mergeBatch", () => {
  it("folds a whole batch in one go — that is what stops the strobe", () => {
    const batch = ["a", "b", "c"].map((m) => raw(m))
    expect(mergeBatch(emptyPane, batch).lines.map((l) => l.message)).toEqual(["a", "b", "c"])
  })

  it("bounds the history so a long upgrade cannot grow without limit", () => {
    const batch = Array.from({ length: MAX_HISTORY + 120 }, (_, i) => raw(`line ${i}`))
    const state = mergeBatch(emptyPane, batch)
    expect(state.lines).toHaveLength(MAX_HISTORY)
    expect(state.dropped).toBe(120)
    // The tail is what is kept — the end of the output is the interesting part.
    expect(state.lines[state.lines.length - 1]?.message).toBe(`line ${MAX_HISTORY + 119}`)
  })

  it("keeps counting what it discarded, so +N above stays honest", () => {
    let state = mergeBatch(emptyPane, Array.from({ length: MAX_HISTORY }, () => raw("x")))
    expect(state.dropped).toBe(0)
    state = mergeBatch(state, [raw("y"), raw("z")])
    expect(state.dropped).toBe(2)
  })

  it("still collapses redraws across a batch boundary", () => {
    const state = mergeBatch(mergeBatch(emptyPane, [raw("10%", true)]), [raw("90%", true)])
    expect(state.lines.map((l) => l.message)).toEqual(["90%"])
  })
})

describe("pinnedSection", () => {
  const lines = [
    raw("==> Upgrading node"),
    raw("file one"),
    raw("file two"),
    raw("file three"),
  ]

  it("pins the section once its header has scrolled off", () => {
    // Only the last two rows fit, so "==> Upgrading node" is long gone.
    expect(pinnedSection(lines, 2)).toBe("Upgrading node")
  })

  it("does not pin a header that is still on screen", () => {
    expect(pinnedSection(lines, 4)).toBeNull()
  })

  it("pins nothing when the output has no sections at all", () => {
    expect(pinnedSection([raw("plain"), raw("output")], 1)).toBeNull()
  })

  it("tracks the most recent section, not the first", () => {
    const withSecond = [...lines, raw("==> Pouring node"), raw("more"), raw("files")]
    expect(pinnedSection(withSecond, 2)).toBe("Pouring node")
  })
})

describe("paneRows", () => {
  it("leaves room for the header and footer", () => {
    expect(paneRows(30)).toBe(22)
  })

  it("grows with the terminal instead of stopping at a ceiling", () => {
    // The old upper clamp of 24 left most of a tall window blank.
    expect(paneRows(60)).toBe(52)
    expect(paneRows(200)).toBe(192)
  })

  it("shrinks to fit a short terminal rather than overflowing it", () => {
    // The old floor of 8 made the pane taller than a 12-row window, which
    // pushed the footer off the bottom of the screen.
    expect(paneRows(12)).toBe(4)
    expect(paneRows(10)).toBe(3)
    expect(paneRows(4)).toBe(3)
  })
})

describe("spinnerFrame", () => {
  it("cycles through every frame and wraps", () => {
    const seen = Array.from({ length: SPINNER_FRAMES.length }, (_, i) => spinnerFrame(i))
    expect(seen).toEqual([...SPINNER_FRAMES])
    expect(spinnerFrame(SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0] as string)
  })
})

describe("formatElapsed", () => {
  it("counts in whole seconds so the bar does not jitter", () => {
    expect(formatElapsed(0)).toBe("0:00")
    expect(formatElapsed(7_000)).toBe("0:07")
    expect(formatElapsed(7_999)).toBe("0:07")
    expect(formatElapsed(83_000)).toBe("1:23")
    expect(formatElapsed(3_667_000)).toBe("1:01:07")
  })
})

describe("currentActivity", () => {
  it("prefers the line the child is still redrawing", () => {
    expect(currentActivity([raw("==> Downloading node"), raw("####  40%", true)])).toBe("####  40%")
  })

  it("falls back to the most recent section heading", () => {
    const lines = [raw("==> Upgrading node"), raw("some detail"), raw("more detail")]
    expect(currentActivity(lines)).toBe("Upgrading node")
  })

  it("reports nothing before the child has said anything sectioned", () => {
    expect(currentActivity([])).toBeNull()
    expect(currentActivity([raw("plain line")])).toBeNull()
  })
})

describe("statusBar", () => {
  const running = { index: 1, total: 5, title: "Homebrew packages", state: "running" as const }

  it("composes spinner, label, elapsed, step and activity on one row", () => {
    const bar = statusBar({
      label: "update",
      tick: 2,
      elapsedMs: 83_000,
      step: running,
      activity: "Downloading node-26.5.1",
      columns: 120,
    })
    expect(bar).toBe("⠹ update · 1:23 · [2/5] Homebrew packages · Downloading node-26.5.1")
  })

  it("drops the step segment once the step is no longer running", () => {
    const bar = statusBar({
      label: "update",
      tick: 0,
      elapsedMs: 1_000,
      step: { ...running, state: "ok" },
      activity: null,
      columns: 120,
    })
    expect(bar).toBe("⠋ update · 0:01")
  })

  it("stays one row — it is drawn inside the pane's fixed footer", () => {
    const bar = statusBar({
      label: "update",
      tick: 0,
      elapsedMs: 0,
      step: running,
      activity: "x".repeat(200),
      columns: 80,
    })
    expect(bar.length).toBeLessThanOrEqual(74)
    expect(bar.endsWith("…")).toBe(true)
  })
})
