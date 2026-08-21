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
import { fitWindow, hiddenCounts } from "../../tui/scroll.ts"
import { useTerminalSize } from "../../tui/use-terminal-size.ts"
import {
  CHECKS,
  SECTIONS,
  doctorExitCode,
  isApplicable,
  type CompletedCheck,
  type Section,
} from "./checks.ts"
import { fixFor } from "./fixes.ts"

type Row = CompletedCheck | { pending: true; id: string; section: Section; label: string }

const isPending = (r: Row): r is Extract<Row, { pending: true }> => "pending" in r

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

/**
 * How many rows a check draws: its own line, plus one per `extra` detail line.
 * Windowing on item COUNT would be wrong here — a panel of failing checks with
 * detail is several times taller than the same panel when everything is green.
 */
const rowHeight = (row: Row): number => (isPending(row) ? 1 : 1 + (row.result.extra?.length ?? 0))

export function DoctorView({ onExit }: { onExit: (code: number) => void }) {
  const size = useTerminalSize()
  // Seed with every check as pending, then replace each as it resolves — the
  // panel fills in progressively instead of blocking on the slowest probe.
  const [rows, setRows] = useState<Row[]>(() =>
    CHECKS.map((c) => ({ pending: true, id: c.id, section: c.section, label: c.label })),
  )
  const [nav, setNav] = useState(initialDoctorNav)
  const cursor = nav.cursor
  const collapsed = nav.collapsed
  const [status, setStatus] = useState("running checks…")
  const [busy, setBusy] = useState(false)

  const runAll = useCallback(() => {
    const started = performance.now()
    let done = 0
    for (const check of CHECKS) {
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
        if (++done === CHECKS.length) {
          setStatus(`${CHECKS.length} checks in ${Math.round(performance.now() - started)}ms`)
        }
      })()
    }
  }, [])

  useEffect(runAll, [runAll])

  // Applicable, non-pending-aware view of the rows, in section order.
  const visible = useMemo(() => {
    const applicable = rows.filter((r) => isPending(r) || isApplicable(r))
    return SECTIONS.flatMap((section) =>
      collapsed.has(section) ? [] : applicable.filter((r) => r.section === section),
    )
  }, [rows, collapsed])

  const selected = visible[Math.min(cursor, visible.length - 1)]

  // Sections still draw in full — they are headings, not content — so their
  // rows come out of the budget before the checks get to use it.
  const sectionsShown = new Set(
    rows.filter((r) => isPending(r) || isApplicable(r)).map((r) => r.section),
  ).size
  const startRef = useRef(0)
  const viewport = Math.max(3, size.rows - 6 - sectionsShown * 2)
  const rowWindow = fitWindow(
    visible.map(rowHeight),
    Math.min(cursor, Math.max(0, visible.length - 1)),
    viewport,
    startRef.current,
  )
  startRef.current = rowWindow.start
  const onScreen = new Set(visible.slice(rowWindow.start, rowWindow.end).map((r) => r.id))
  const { above, below } = hiddenCounts(rowWindow, visible.length)

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
        const check = CHECKS.find((c) => c.id === row.id)
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
    [busy],
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
          (row) => isPending(row) && CHECKS.some((check) => check.id === row.id && check.critical),
        )
        onExit(doctorExitCode(done, pendingCritical))
        break
      }
      case "fix":
        void applyFix(visible.find((r) => r.id === intent.id))
        break
      case "rerun":
        setRows(CHECKS.map((c) => ({ pending: true, id: c.id, section: c.section, label: c.label })))
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
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.blue} attributes={BOLD}>
          dotfiles doctor
        </text>
        <text fg={failures > 0 ? theme.red : warnings > 0 ? theme.yellow : theme.green}>
          {headline}
        </text>
      </box>

      {SECTIONS.map((section) => {
        const sectionRows = rows.filter((r) => r.section === section && (isPending(r) || isApplicable(r)))
        if (sectionRows.length === 0) return null
        const folded = collapsed.has(section)
        const sectionIssues = sectionRows.filter(
          (r) => !isPending(r) && (r.result.status === "warn" || r.result.status === "fail"),
        ).length

        return (
          <box key={section} flexDirection="column" marginTop={1}>
            <box flexDirection="row">
              <text fg={theme.fg} attributes={BOLD}>
                {folded ? "▸" : "▾"} {section}
              </text>
              {folded && sectionIssues > 0 && (
                <text fg={theme.yellow}>{`  ${sectionIssues} to review`}</text>
              )}
            </box>

            {!folded &&
              sectionRows.filter((row) => onScreen.has(row.id)).map((row) => {
                const active = selected?.id === row.id
                const marker = active ? " ❯ " : "   "

                if (isPending(row)) {
                  return (
                    <box key={row.id} flexDirection="row">
                      <text fg={theme.orange}>{marker}</text>
                      <text fg={theme.dim}>○ {row.label}</text>
                    </box>
                  )
                }

                const { status: s, message, extra } = row.result
                const fixable = fixFor(row.id) !== undefined
                return (
                  <box key={row.id} flexDirection="column">
                    <box flexDirection="row">
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
              })}
          </box>
        )
      })}

      <box marginTop="auto" flexDirection="column">
        <text fg={theme.dim}>{"─".repeat(Math.max(10, size.columns - 4))}</text>
        {(above > 0 || below > 0) && (
          <text fg={theme.dim}>
            {[above > 0 ? `↑ ${above} above` : null, below > 0 ? `↓ ${below} below` : null]
              .filter((line) => line !== null)
              .join(" · ")}
          </text>
        )}
        <text fg={busy ? theme.orange : theme.gray}>{status}</text>
        <text fg={theme.bgHard}>↑↓ nav · ⏎ fix · space fold · r re-run · q quit</text>
      </box>
    </box>
  )
}
