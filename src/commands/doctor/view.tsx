// Full-screen doctor panel.
//
// The only OpenTUI-aware file in this command. checks.ts holds the data and
// knows nothing about rendering, which is what lets a breaking OpenTUI bump
// touch src/tui/ and this file rather than the whole feature.
import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BOLD, STATUS_COLOR, STATUS_GLYPH, theme } from "../../tui/theme.ts"
import { initialDoctorNav, reduceDoctorKey } from "../../tui/interaction.ts"
import { clearRenderer, setRenderer } from "../../tui/renderer.ts"
import { fitWindow, wrappedRows } from "../../tui/scroll.ts"
import { useTerminalSize } from "../../tui/use-terminal-size.ts"
import {
  CHECKS,
  SECTIONS,
  doctorExitCode,
  isApplicable,
  type Check,
  type CompletedCheck,
  type Section,
} from "./checks.ts"
import { fixFor } from "./fixes.ts"

type Row = CompletedCheck | { pending: true; id: string; section: Section; label: string }

const isPending = (r: Row): r is Extract<Row, { pending: true }> => "pending" in r

/**
 * One drawn line-group in the panel: a section heading or a check.
 *
 * Headings used to be drawn outside the scroll window, on the theory that a
 * heading is chrome rather than content. It is not — it occupies terminal rows
 * like anything else, and leaving it out of the budget is what let the first
 * section's checks consume the whole window while five other headings stood
 * over nothing. One list, measured end to end.
 */
type Item =
  | { kind: "section"; key: string; section: Section; folded: boolean; issues: number }
  | { kind: "row"; key: string; row: Row }

export async function runDoctorTui(): Promise<number> {
  const renderer = await createCliRenderer()
  setRenderer(renderer)

  return await new Promise<number>((resolve) => {
    createRoot(renderer).render(
      <DoctorView
        onExit={(code) => {
          clearRenderer(renderer)
          renderer.destroy()
          resolve(code)
        }}
      />,
    )
  })
}

/** `   ` marker + `✓ ` glyph. */
const ROW_PREFIX = 5
/** `  [fix ⏎]`, drawn after the message on an actionable row. */
const FIX_HINT = 9
/** Indent on an `extra` detail line. */
const EXTRA_PREFIX = 5
/** Blank spacer + heading text, per section. */
const SECTION_HEIGHT = 2
/** The footer's key hint, hoisted so its wrapped height can be budgeted. */
const KEY_HINT = "↑↓ nav · ⏎ fix · space fold · r re-run · q quit"
/** Root padding (top + bottom), the title line, the rule, the hidden-count line. */
const FIXED_CHROME = 5

/**
 * Rows the frame spends on everything that is not a check.
 *
 * Measured, not assumed. A constant 7 held until the terminal got narrow enough
 * to wrap the key hint — 44 columns — at which point the footer silently became
 * two rows, the list over-committed by one, and the last thing drawn was the
 * hint's own tail with the rest of it pushed off screen. The status line has the
 * same problem the moment a fix fails and reports an error message.
 */
const chromeRows = (status: string, columns: number): number =>
  FIXED_CHROME + wrappedRows(status, columns) + wrappedRows(KEY_HINT, columns)

/**
 * How many TERMINAL rows a check draws.
 *
 * Not one per line of text: a message wider than the window wraps, and counting
 * it as 1 under-budgets the list so it draws past its box and over whatever is
 * below. Measured at 80 columns this repo's own checks overflowed by 7 rows —
 * `skills-vendored` alone is 235 columns, three lines budgeted as one.
 *
 * Windowing on item COUNT would be wrong for the same reason at a coarser
 * grain: a panel of failing checks with detail is several times taller than the
 * same panel when everything is green.
 */
const rowHeight = (row: Row, columns: number, fixable: boolean): number => {
  const width = Math.max(20, columns)
  if (isPending(row)) return wrappedRows(row.label, width, ROW_PREFIX)

  const hint = fixable && row.result.status !== "ok" ? FIX_HINT : 0
  return (
    wrappedRows(row.result.message, width, ROW_PREFIX + hint) +
    (row.result.extra ?? []).reduce(
      (n, e) => n + wrappedRows(e.text.trim(), width, EXTRA_PREFIX),
      0,
    )
  )
}

/**
 * `checks` is injectable so the layout can be tested against a fixed panel.
 * Rendering the real suite makes a layout test slow, network-dependent, and
 * unable to construct the case that actually broke — a check with eight `extra`
 * detail lines sitting near the bottom of a short terminal.
 */
export function DoctorView({
  onExit,
  checks = CHECKS,
}: {
  onExit: (code: number) => void
  checks?: readonly Check[]
}) {
  const size = useTerminalSize()
  // Seed with every check as pending, then replace each as it resolves — the
  // panel fills in progressively instead of blocking on the slowest probe.
  const [rows, setRows] = useState<Row[]>(() =>
    checks.map((c) => ({ pending: true, id: c.id, section: c.section, label: c.label })),
  )
  const [nav, setNav] = useState(initialDoctorNav)
  const cursor = nav.cursor
  const collapsed = nav.collapsed
  const [status, setStatus] = useState("running checks…")
  const [busy, setBusy] = useState(false)

  const runAll = useCallback(() => {
    const started = performance.now()
    let done = 0
    for (const check of checks) {
      void (async () => {
        let completed: CompletedCheck
        try {
          completed = { ...check, result: await check.run() }
        } catch (err) {
          completed = {
            ...check,
            result: { status: "fail", message: `${check.label} — check failed: ${String(err)}` },
          }
        }
        setRows((prev) => prev.map((r) => (r.id === completed.id ? completed : r)))
        if (++done === checks.length) {
          setStatus(`${checks.length} checks in ${Math.round(performance.now() - started)}ms`)
        }
      })()
    }
  }, [checks])

  useEffect(runAll, [runAll])

  // Two lists over the same data. `visible` is what the cursor can land on —
  // checks only, so ↑↓ never stops on a heading. `items` is what actually gets
  // drawn, headings included, and it is the one that gets measured.
  const applicable = useMemo(
    () => rows.filter((r) => isPending(r) || isApplicable(r)),
    [rows],
  )

  const visible = useMemo(
    () =>
      SECTIONS.flatMap((section) =>
        collapsed.has(section) ? [] : applicable.filter((r) => r.section === section),
      ),
    [applicable, collapsed],
  )

  const items = useMemo<Item[]>(
    () =>
      SECTIONS.flatMap((section): Item[] => {
        const sectionRows = applicable.filter((r) => r.section === section)
        if (sectionRows.length === 0) return []
        const folded = collapsed.has(section)
        const heading: Item = {
          kind: "section",
          key: `section:${section}`,
          section,
          folded,
          issues: sectionRows.filter(
            (r) => !isPending(r) && (r.result.status === "warn" || r.result.status === "fail"),
          ).length,
        }
        if (folded) return [heading]
        return [heading, ...sectionRows.map((row): Item => ({ kind: "row", key: row.id, row }))]
      }),
    [applicable, collapsed],
  )

  const selected = visible[Math.min(cursor, visible.length - 1)]

  const startRef = useRef(0)
  const viewport = Math.max(1, size.rows - chromeRows(status, size.columns - 2))
  const focus = items.findIndex((i) => i.kind === "row" && i.row.id === selected?.id)
  const itemWindow = fitWindow(
    items.map((item) =>
      item.kind === "section"
        ? SECTION_HEIGHT
        : rowHeight(item.row, size.columns - 4, fixFor(item.row.id) !== undefined),
    ),
    Math.max(0, focus),
    viewport,
    startRef.current,
  )
  startRef.current = itemWindow.start
  const drawn = items.slice(itemWindow.start, itemWindow.end)
  // Counted in checks, not items: "25 below" has to mean twenty-five more things
  // to look at, not lines that happen to include a heading.
  const above = items.slice(0, itemWindow.start).filter((i) => i.kind === "row").length
  const below = items.slice(itemWindow.end).filter((i) => i.kind === "row").length

  const applyFix = useCallback(
    async (row: Row | undefined) => {
      if (!row || busy) return
      const fix = fixFor(row.id)
      if (!fix) {
        setStatus(`${row.label}: nothing to fix`)
        return
      }
      setBusy(true)
      setStatus(`${fix.label}…`)
      try {
        const outcome = await fix.run()
        setStatus(outcome)
        // Re-run just this check so the panel reflects reality, not hope.
        const check = checks.find((c) => c.id === row.id)
        if (check) {
          const completed = { ...check, result: await check.run() }
          setRows((prev) => prev.map((r) => (r.id === completed.id ? completed : r)))
        }
      } catch (err) {
        setStatus(`fix failed: ${String(err)}`)
      } finally {
        setBusy(false)
      }
    },
    [busy, checks],
  )

  // All the behaviour lives in reduceDoctorKey, which is pure and unit-tested;
  // this component only renders the result and performs the intent.
  useKeyboard((key) => {
    if (busy) return
    const { nav: next, intent } = reduceDoctorKey(nav, key, visible)
    setNav(next)

    switch (intent.kind) {
      case "quit": {
        const done = rows.filter((r): r is CompletedCheck => !isPending(r))
        const pendingCritical = rows.some(
          (row) => isPending(row) && checks.some((check) => check.id === row.id && check.critical),
        )
        onExit(doctorExitCode(done, pendingCritical))
        break
      }
      case "fix":
        void applyFix(visible.find((r) => r.id === intent.id))
        break
      case "rerun":
        setRows(checks.map((c) => ({ pending: true, id: c.id, section: c.section, label: c.label })))
        setStatus("re-running checks…")
        runAll()
        break
      case "none":
        break
    }
  })

  const completed = rows.filter((r): r is CompletedCheck => !isPending(r))
  const warnings = completed.filter((c) => c.result.status === "warn").length
  const failures = completed.filter((c) => c.result.status === "fail").length
  const pendingCount = rows.length - completed.length

  const headline =
    pendingCount > 0
      ? `${pendingCount} running`
      : failures > 0
        ? `${failures} failed · ${warnings} warnings`
        : warnings > 0
          ? `${warnings} warnings`
          : "all clear"

  return (
    <box flexDirection="column" padding={1} flexGrow={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.blue} attributes={BOLD}>
          dotfiles doctor
        </text>
        <text fg={failures > 0 ? theme.red : warnings > 0 ? theme.yellow : theme.green}>
          {headline}
        </text>
      </box>

      {/*
        Fixed height + clipping, so the footer is anchored no matter what the
        list contains. The window budget below normally keeps this from
        mattering — but a single check can be taller than the whole viewport
        (packages/cargo.txt at 40 columns is a wrapped message plus eight extras,
        ten rows), and fitWindow draws at least one item even when it does not
        fit. Without this the overrun pushed the key hint off screen and the last
        thing drawn was its own tail: ` run · q quit`.
      */}
      <box flexDirection="column" height={viewport} overflow="hidden" flexShrink={0}>
        {drawn.map((item) =>
          item.kind === "section" ? (
            <box key={item.key} flexDirection="row" marginTop={1} flexShrink={0}>
              <text fg={theme.fg} attributes={BOLD}>
                {item.folded ? "▸" : "▾"} {item.section}
              </text>
              {item.folded && item.issues > 0 && (
                <text fg={theme.yellow}>{`  ${item.issues} to review`}</text>
              )}
            </box>
          ) : (
            <CheckRow key={item.key} row={item.row} active={selected?.id === item.row.id} />
          ),
        )}
      </box>

      <box marginTop="auto" flexDirection="column" flexShrink={0}>
        <text fg={theme.dim}>{"─".repeat(Math.max(10, size.columns - 4))}</text>
        {(above > 0 || below > 0) && (
          <text fg={theme.dim}>
            {[above > 0 ? `↑ ${above} above` : null, below > 0 ? `↓ ${below} below` : null]
              .filter((line) => line !== null)
              .join(" · ")}
          </text>
        )}
        <text fg={busy ? theme.orange : theme.gray}>{status}</text>
        <text fg={theme.bgHard}>{KEY_HINT}</text>
      </box>
    </box>
  )
}

/**
 * One check, plus its `extra` detail lines.
 *
 * `flexShrink={0}` is load-bearing, not decoration. Flexbox's default is to
 * shrink children when the column runs out of room, and a text box squeezed
 * below its content height does not clip — its siblings land on the same
 * terminal row and paint over each other. That is what produced rows reading
 * `cargo-expand⚠ packages/cargo.txt — 8 of 9 missing` and `✓ rustupv—.rustc
 * 1.98.0a·(3)toolchain(s)`: two rows superimposed, not one row wrapped. The
 * window budget above should mean this never triggers; if it ever does, the
 * failure has to be honest clipping.
 */
function CheckRow({ row, active }: { row: Row; active: boolean }) {
  const marker = active ? " ❯ " : "   "

  if (isPending(row)) {
    return (
      <box flexDirection="row" flexShrink={0}>
        <text fg={theme.orange}>{marker}</text>
        <text fg={theme.dim}>○ {row.label}</text>
      </box>
    )
  }

  const { status: s, message, extra } = row.result
  const fixable = fixFor(row.id) !== undefined
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" flexShrink={0}>
        <text fg={active ? theme.orange : theme.bgSoft}>{marker}</text>
        <text fg={STATUS_COLOR[s]}>{STATUS_GLYPH[s]} </text>
        <text fg={active ? theme.fg : theme.fgMuted}>{message}</text>
        {fixable && s !== "ok" && <text fg={theme.yellow}>{"  [fix ⏎]"}</text>}
      </box>
      {(extra ?? []).map((line, i) => (
        <text key={i} fg={line.kind === "warn" ? theme.yellow : theme.dim}>
          {`     ${line.text.trim()}`}
        </text>
      ))}
    </box>
  )
}
