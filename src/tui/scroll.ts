// Windowing a list that is taller than the terminal.
//
// Every screen in this app rendered its rows unconditionally: the pickers with
// `rows.map`, doctor with 26 checks, the output pane with a fixed 24-row tail.
// On a 24-row terminal that means rows you have to act on are simply not on
// screen, with nothing to tell you they exist — the reconcile picker will
// happily hide the package you were trying to remove.
//
// Pure on purpose. The reducers own the cursor, the components own the drawing,
// and the arithmetic that decides which slice is visible lives here where a
// test can reach it without standing up a renderer.

/** The visible half-open range `[start, end)` of a list. */
export type Window = { start: number; end: number }

/** How many rows a window can actually occupy: never more than the list has. */
const windowSize = (total: number, viewport: number): number =>
  Math.max(1, Math.min(Math.floor(viewport), total))

/**
 * Where the window should start, given where it started last time.
 *
 * Minimal scrolling, NOT centring. Centring the cursor recomputes the window on
 * every keypress, so the whole list slides under a cursor that appears frozen —
 * on a long list you lose track of where you are entirely. This only moves the
 * window when the cursor would otherwise leave it, so arrowing through a list
 * that fits does not scroll at all, and arrowing off the bottom advances by one
 * row like a terminal does.
 *
 * `prev` is clamped rather than trusted: the list can shrink between renders
 * (doctor folds a section, reconcile drops a resolved row) and a stale start
 * would leave the window pointing past the end.
 */
export function nextStart(prev: number, total: number, focus: number, viewport: number): number {
  const size = windowSize(total, viewport)
  const maxStart = Math.max(0, total - size)
  let start = Math.max(0, Math.min(prev, maxStart))
  if (focus < start) start = focus
  else if (focus >= start + size) start = focus - size + 1
  return Math.max(0, Math.min(start, maxStart))
}

/** The slice to draw for a cursor-driven list. */
export function windowFor(prev: number, total: number, focus: number, viewport: number): Window {
  const start = nextStart(prev, total, focus, viewport)
  return { start, end: Math.min(total, start + windowSize(total, viewport)) }
}

/**
 * The slice to draw for the output pane, which scrolls from the BOTTOM.
 *
 * `offset` is distance from the tail, so 0 means "following", which is the
 * state a running command should stay in. Expressing it this way is what makes
 * the follow behaviour fall out for free: new lines arriving change `total`,
 * and at offset 0 the window slides with it. Scroll up and the offset pins you
 * to the same lines while output keeps arriving above.
 */
export function tailWindow(total: number, offset: number, viewport: number): Window {
  const size = windowSize(total, viewport)
  const clamped = clampOffset(offset, total, viewport)
  const end = total - clamped
  return { start: Math.max(0, end - size), end }
}

/** The furthest you can scroll back before the window would leave the list. */
export const maxOffset = (total: number, viewport: number): number =>
  Math.max(0, total - windowSize(total, viewport))

/** Keep an offset inside the scrollable range as the list grows and shrinks. */
export const clampOffset = (offset: number, total: number, viewport: number): number =>
  Math.max(0, Math.min(Math.floor(offset), maxOffset(total, viewport)))

/** Rows a window is not showing, on each side of it. */
export type Hidden = { above: number; below: number }

/**
 * The "12 more ↓" style counts for a window, so a screen never hides rows in
 * silence. `dropped` is history already discarded (see MAX_HISTORY) and counts
 * as hidden above — a pane that quietly forgets output reads as one that never
 * received it.
 */
export function hiddenCounts(window: Window, total: number, dropped = 0): Hidden {
  return { above: window.start + dropped, below: Math.max(0, total - window.end) }
}

/**
 * Window a list whose rows are NOT all one row tall.
 *
 * The doctor panel needs this: a check draws one row, but a check with `extra`
 * detail draws one row per extra line too. Budgeting one row per item there
 * either wastes most of the screen or overflows it, and which one you get
 * depends on how many checks happen to be failing — the worst kind of layout
 * bug, because it only shows up when something is already wrong.
 *
 * `heights` is the drawn height of each item, `viewport` the rows available.
 * At least one item is always returned even if it alone exceeds the budget: a
 * screen that renders nothing is worse than one that clips.
 */
export function fitWindow(
  heights: readonly number[],
  focus: number,
  viewport: number,
  prev = 0,
): Window {
  const total = heights.length
  if (total === 0) return { start: 0, end: 0 }

  const budget = Math.max(1, Math.floor(viewport))
  const target = Math.max(0, Math.min(Math.floor(focus), total - 1))

  /** How far the window reaches from `from` before it runs out of rows. */
  const endFrom = (from: number): number => {
    let used = 0
    let end = from
    while (end < total) {
      const height = Math.max(1, Math.floor(heights[end] ?? 1))
      if (used + height > budget && end > from) break
      used += height
      end++
    }
    return end
  }

  let start = Math.max(0, Math.min(Math.floor(prev), target))
  let end = endFrom(start)
  // Walk the window down until the focused item fits inside it. Bounded by
  // `start < target`, so a single over-tall item terminates instead of spinning.
  while (target >= end && start < target) {
    start++
    end = endFrom(start)
  }
  return { start, end }
}
