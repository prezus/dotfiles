// Making the app notice that the window changed size.
//
// `paneRows()` and `truncate()` have always read `process.stdout.rows/columns`,
// so every screen was ALREADY sized to the terminal — but only at the moment it
// happened to render. Nothing in the app listened for a resize, and React does
// not re-render without a state change, so dragging the window left the layout
// frozen at whatever size it had when the last keypress or output batch landed:
// text truncated to a width that no longer existed, and a pane sized for a
// terminal you had already resized away from.
//
// One subscription, one piece of state. Every screen that wants to be
// responsive reads this hook instead of reading `process.stdout` directly.
import { useTerminalDimensions } from "@opentui/react"

export type TerminalSize = { columns: number; rows: number }

/**
 * The defaults matter: `process.stdout.columns` is undefined whenever stdout is
 * not a terminal, which is every piped and redirected run. 80x30 is the same
 * fallback the pure helpers in output-pane.ts use.
 */
export const currentSize = (): TerminalSize => ({
  columns: process.stdout.columns ?? 80,
  rows: process.stdout.rows ?? 30,
})

/**
 * The live terminal size, re-rendering the caller whenever it changes.
 *
 * Delegates to OpenTUI rather than subscribing to `process.stdout` resize
 * events itself. The two agree in a real terminal, so this was invisible in
 * use — but the renderer is the thing that actually lays the frame out, and a
 * view that budgets rows against a DIFFERENT number than the renderer uses is
 * only accidentally correct. It also made the layout untestable: under
 * `testRender(…, { height: 24 })` the old hook reported the height of whatever
 * terminal `bun test` was attached to, so a panel asked to prove it fits in 24
 * rows was quietly laid out for 60.
 */
export function useTerminalSize(): TerminalSize {
  const { width, height } = useTerminalDimensions()
  // Guard the pre-first-measure case, where OpenTUI can report 0.
  const fallback = currentSize()
  return {
    columns: width > 0 ? width : fallback.columns,
    rows: height > 0 ? height : fallback.rows,
  }
}
