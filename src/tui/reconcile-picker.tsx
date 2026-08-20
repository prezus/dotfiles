// Per-item drift resolution for `dotfiles reconcile`.
//
// The predecessor (`prune`) wrapped `brew bundle cleanup`, which answers the
// whole question in one shot: everything undeclared is uninstalled. That is the
// wrong default when the honest answer for half the list is "actually I want to
// keep that, I just never wrote it down" — and Bundle cannot ask, so it never
// found out. This screen is the asking.
//
// Rendered as a cycle, not a checkbox: three answers do not fit two states.
import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useRef, useState } from "react"
import {
  initialReconcileState,
  reduceReconcileKey,
  type ReconcileItem,
  type ReconcileState,
} from "./interaction.ts"
import { clearRenderer, setRenderer } from "./renderer.ts"
import { hiddenCounts, windowFor } from "./scroll.ts"
import { useTerminalSize } from "./use-terminal-size.ts"
import { BOLD, theme } from "./theme.ts"

/** A drifted package plus the display context the picker needs. */
export type ReconcileRow = ReconcileItem & {
  /** Section heading this row sits under. */
  group: string
  /** Right-hand context, e.g. "332 MB" or "dep of ghidra". */
  note?: string
}

/** Resolves to id -> chosen disposition, or null if cancelled. */
export async function pickReconcile(
  rows: ReconcileRow[],
): Promise<ReadonlyMap<string, string> | null> {
  const renderer = await createCliRenderer()
  setRenderer(renderer)

  return await new Promise<ReadonlyMap<string, string> | null>((resolve) => {
    createRoot(renderer).render(
      <ReconcilePicker
        rows={rows}
        onDone={(chosen) => {
          clearRenderer(renderer)
          renderer.destroy()
          resolve(chosen)
        }}
      />,
    )
  })
}

export function ReconcilePicker({
  rows,
  onDone,
}: {
  rows: ReconcileRow[]
  onDone: (chosen: ReadonlyMap<string, string> | null) => void
}) {
  const [state, setState] = useState<ReconcileState>(() => initialReconcileState(rows))
  const { cursor, choice } = state

  // Behaviour lives in reduceReconcileKey; this only renders and performs.
  useKeyboard((key) => {
    const { state: next, intent } = reduceReconcileKey(state, key, rows)
    setState(next)
    if (intent.kind === "cancel") onDone(null)
    else if (intent.kind === "confirm") onDone(new Map(intent.choice))
  })

  const size = useTerminalSize()
  const removing = rows.filter((r) => choice.get(r.id) === "remove").length
  const width = Math.max(...rows.map((r) => r.id.length), 10)

  // Section headings are rendered inline rather than as their own rows so the
  // cursor index stays 1:1 with `rows` — the reducer navigates items, and a
  // heading the cursor could land on would break that correspondence.
  //
  // That 1:1 is also why the window is computed over ITEMS and the headings are
  // budgeted for rather than counted: reserving one row per group is at worst
  // slightly conservative, and never leaves the cursor drawn off the screen.
  const groups = new Set(rows.map((r) => r.group)).size
  const viewport = Math.max(3, size.rows - 9 - groups)
  const startRef = useRef(0)
  const rowWindow = windowFor(startRef.current, rows.length, cursor, viewport)
  startRef.current = rowWindow.start
  const visible = rows.slice(rowWindow.start, rowWindow.end)
  const { above, below } = hiddenCounts(rowWindow, rows.length)

  // Reset per render, and deliberately empty: the first visible row always
  // draws its heading, so a window that opens mid-group still says which one.
  let lastGroup = ""

  return (
    <box flexDirection="column" padding={1}>
      <text fg={theme.blue} attributes={BOLD}>
        dotfiles reconcile
      </text>
      <text fg={theme.gray}>
        {rows.length} mismatch{rows.length === 1 ? "" : "es"} between this machine and packages/bundle
      </text>

      <box flexDirection="column" marginTop={1}>
        {visible.map((row, offset) => {
          const index = rowWindow.start + offset
          const active = index === cursor
          const chosen = choice.get(row.id)
          const heading = row.group !== lastGroup ? row.group : null
          lastGroup = row.group
          return (
            <box key={row.id} flexDirection="column">
              {heading ? (
                <text fg={theme.orange} attributes={BOLD}>
                  {(offset === 0 ? "" : "\n") + heading}
                </text>
              ) : null}
              <box flexDirection="row">
                <text fg={active ? theme.orange : theme.bgSoft}>{active ? " ❯ " : "   "}</text>
                <text fg={active ? theme.fg : theme.fgMuted}>{row.id.padEnd(width + 2)}</text>
                {row.choices.map((c) => (
                  <text
                    key={c}
                    fg={c === chosen ? (c === "remove" ? theme.red : theme.green) : theme.dim}
                    attributes={c === chosen ? BOLD : undefined}
                  >
                    {c === chosen ? `[${c}] ` : ` ${c}  `}
                  </text>
                ))}
                {row.note ? <text fg={theme.dim}>{`  ${row.note}`}</text> : null}
              </box>
            </box>
          )
        })}
      </box>

      <box marginTop={1} flexDirection="column">
        <text fg={theme.dim}>{"─".repeat(Math.max(10, size.columns - 4))}</text>
        {(above > 0 || below > 0) && (
          <text fg={theme.dim}>
            {[above > 0 ? `↑ ${above} above` : null, below > 0 ? `↓ ${below} below` : null]
              .filter((s) => s !== null)
              .join(" · ")}
          </text>
        )}
        <text fg={removing > 0 ? theme.red : theme.gray}>
          {removing} to uninstall — you will be asked to confirm before anything is removed
        </text>
        <text fg={theme.bgHard}>↑↓ move · space/←→ change · ⏎ apply · q cancel</text>
      </box>
    </box>
  )
}
