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
import { useEffect, useState } from "react"

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

const sameSize = (a: TerminalSize, b: TerminalSize): boolean =>
  a.columns === b.columns && a.rows === b.rows

/** The live terminal size, re-rendering the caller whenever it changes. */
export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(currentSize)

  useEffect(() => {
    // Bail out when the size is unchanged. A resize drag fires this many times
    // a second and most events carry the same dimensions as the last; returning
    // the previous object keeps React from reconciling the whole tree for a
    // no-op, which is the same reason the output pane coalesces its batches.
    const onResize = (): void => {
      setSize((previous) => {
        const next = currentSize()
        return sameSize(previous, next) ? previous : next
      })
    }
    process.stdout.on("resize", onResize)
    return () => {
      process.stdout.off("resize", onResize)
    }
  }, [])

  return size
}
