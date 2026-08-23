// Layout regression tests for the doctor panel.
//
// The scroll arithmetic in tui/scroll.ts was already unit-tested and already
// correct. Both bugs these cover lived in how view.tsx SPENT that budget, which
// only a real render can show — so these drive the actual renderer and read the
// character grid back.
import { expect, test } from "bun:test"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import type { Check } from "./checks.ts"
import { DoctorView } from "./view.tsx"

const KEY_HINT = "↑↓ nav · ⏎ fix · space fold · r re-run · q quit"
const HEADING = /^\s*[▾▸] /
const RULE = /^\s*─+$/

/** The panel from the report that started this: a check with eight extras. */
const CARGO_EXTRAS = [
  "cargo-expand",
  "cargo-update",
  "cargo-zigbuild",
  "create-gpui-app",
  "dioxus-cli",
  "esp-generate",
  "espflash",
  "ldproxy",
]

const check = (
  id: string,
  section: Check["section"],
  label: string,
  message: string,
  status: "ok" | "warn" = "ok",
  extra: string[] = [],
): Check => ({
  id,
  section,
  label,
  run: async () => ({
    status,
    message,
    extra: extra.map((text) => ({ kind: "raw" as const, text: `    ${text}` })),
  }),
})

const PANEL: readonly Check[] = [
  check("pacman", "Tooling", "pacman", "pacman — 7.1.0 · 175 explicit package(s)"),
  check("yay", "Tooling", "yay", "yay — 13.0.1"),
  check("stow", "Tooling", "GNU Stow", "GNU Stow — 2.4.1"),
  check("git", "Tooling", "git", "git — 2.55.0"),
  check("node", "Tooling", "node", "node — v26.7.0 · npm 11.19.0 (/a/very/long/path/to/bin/node)"),
  check("bun", "Tooling", "bun", "bun — v1.4.0 · 4 global(s)"),
  check("fish", "Shell", "fish", "fish — 4.8.1 (/usr/bin/fish)"),
  check("fisher", "Shell", "fisher", "fisher — 2 plugin(s)"),
  check(
    "cargo-tools",
    "Packages",
    "packages/cargo.txt",
    "packages/cargo.txt — 8 of 9 missing:",
    "warn",
    CARGO_EXTRAS,
  ),
  check(
    "go-tools",
    "Packages",
    "packages/go.txt",
    "packages/go.txt — 7 of 7 not on PATH:",
    "warn",
    ["air", "go-blueprint", "goose", "gopls", "sqlc", "staticcheck", "templ"],
  ),
  check("stow-drift", "Environment", "stow", "stow — 49 link(s) in place"),
]

/** Frame lines with trailing padding stripped and blanks dropped. */
const lines = (frame: string): string[] =>
  frame.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l !== "")

const settle = async (setup: TestRendererSetup): Promise<string[]> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
  await setup.flush()
  return lines(setup.captureCharFrame())
}

const render = async (
  width: number,
  height: number,
  fn: (setup: TestRendererSetup) => Promise<void>,
): Promise<void> => {
  const setup = await testRender(<DoctorView onExit={() => {}} checks={PANEL} />, { width, height })
  try {
    await fn(setup)
  } finally {
    await act(async () => setup.renderer.destroy())
  }
}

// Section headings were drawn outside the scroll window, so the budget
// under-counted by two rows per section. At 24 rows that overflowed the box —
// and because every child kept flexbox's default flexShrink, the overflow did
// not clip: rows were squeezed onto each other's terminal line and painted over
// one another. Real captures read `✓ GNU Stow.—.2.4.1` (yay's row on top of
// Stow's), `✓ rustupv—.rustc 1.98.0a·(3)toolchain(s)` (two rows superimposed)
// and `↓─25─below───` (the scroll hint on top of the rule).
for (const [width, height] of [
  [100, 40],
  [100, 24],
  [80, 20],
  [60, 14],
  [40, 10],
] as const) {
  test(`${width}x${height}: content never overruns the footer`, async () => {
    await render(width, height, async (setup) => {
      const frame = await settle(setup)
      // The hint is the last thing on screen and it arrives whole. It may wrap
      // on a narrow terminal — 40 columns splits it — so reassemble rather than
      // demand one line; what must not happen is the list overrunning it and
      // leaving only its tail, ` run · q quit`.
      const hintAt = frame.findIndex((l) => l.includes("↑↓ nav"))
      expect(hintAt).toBeGreaterThan(-1)
      expect(frame.slice(hintAt).map((l) => l.trim()).join("")).toBe(KEY_HINT)
      // Exactly one rule: a duplicate means something was drawn over it.
      expect(frame.filter((l) => RULE.test(l))).toHaveLength(1)
    })
  })
}

test("no check row is drawn on top of another", async () => {
  // Superimposed rows are the signature failure: two messages, one line. Every
  // message here is unique, so a line matching two of them is an overlap.
  const messages = ["7.1.0", "13.0.1", "2.4.1", "2.55.0", "v26.7.0", "v1.4.0", "4.8.1"]
  await render(100, 24, async (setup) => {
    for (const line of await settle(setup)) {
      expect(messages.filter((m) => line.includes(m)).length).toBeLessThan(2)
    }
  })
})

test("a section heading is never drawn over nothing", async () => {
  await render(100, 40, async (setup) => {
    const frame = await settle(setup)
    const content = frame.slice(1, frame.findIndex((l) => RULE.test(l)))
    expect(content.filter((l) => HEADING.test(l)).length).toBeGreaterThan(0)

    for (const [i, line] of content.entries()) {
      if (!HEADING.test(line)) continue
      const next = content[i + 1]
      // The final line may be a heading whose rows fell below the fold.
      if (next === undefined) continue
      expect(next).not.toMatch(HEADING)
    }
  })
})

test("extra detail lines stay on their own rows, under their check", async () => {
  await render(100, 40, async (setup) => {
    const frame = await settle(setup)
    const header = frame.findIndex((l) => l.includes("packages/cargo.txt — 8 of 9 missing:"))
    expect(header).toBeGreaterThan(-1)
    // The header carries the fix hint and nothing else; the extras follow it in
    // order, one per line. The reported symptom was the first extra landing on
    // the header line: ` ❯      cargo-expand⚠ packages/cargo.txt — 8 of 9 …`.
    expect(frame[header]).toContain("[fix ⏎]")
    expect(frame[header]).not.toContain(CARGO_EXTRAS[0])
    for (const [offset, name] of CARGO_EXTRAS.entries()) {
      expect(frame[header + 1 + offset]?.trim()).toBe(name)
    }
  })
})

test("folding a section removes its checks, not just their highlight", async () => {
  await render(100, 40, async (setup) => {
    expect((await settle(setup)).some((l) => l.includes("GNU Stow"))).toBeTrue()
    await act(async () => {
      setup.mockInput.pressKey(" ")
    })
    const frame = await settle(setup)
    expect(frame.some((l) => l.includes("▸ Tooling"))).toBeTrue()
    expect(frame.some((l) => l.includes("GNU Stow"))).toBeFalse()
  })
})
