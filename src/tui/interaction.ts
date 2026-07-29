// Keyboard interaction as pure state transitions.
//
// This logic used to live inside the React components, where it could only run
// under a mounted renderer attached to a real terminal — which made it look
// untestable and left the whole interactive surface unverified. It is not
// terminal-dependent at all: it is (state, keypress) -> (state, intent).
//
// Splitting it out leaves exactly two things that genuinely need a terminal,
// and both belong to OpenTUI rather than to us: drawing pixels, and restoring
// cooked mode in suspend(). Everything we wrote is covered by unit tests.

/** The subset of OpenTUI's key event this logic cares about. */
export type KeyEvent = {
  name?: string
  ctrl?: boolean
}

const isQuit = (key: KeyEvent): boolean =>
  key.name === "q" || key.name === "escape" || (key.ctrl === true && key.name === "c")

const isDown = (key: KeyEvent): boolean => key.name === "down" || key.name === "j"
const isUp = (key: KeyEvent): boolean => key.name === "up" || key.name === "k"

const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max))

// ─── doctor ─────────────────────────────────────────────────────────

export type DoctorRow = { id: string; section: string }

export type DoctorNav = {
  cursor: number
  collapsed: ReadonlySet<string>
}

export type DoctorIntent =
  | { kind: "none" }
  | { kind: "quit" }
  /** Apply the fix for the row under the cursor. */
  | { kind: "fix"; id: string }
  | { kind: "rerun" }

export const initialDoctorNav = (): DoctorNav => ({ cursor: 0, collapsed: new Set() })

/**
 * `visible` is the currently-rendered rows, in order — collapsed sections have
 * already been filtered out, so the cursor indexes what the user can actually
 * see rather than the full check list.
 */
export function reduceDoctorKey(
  nav: DoctorNav,
  key: KeyEvent,
  visible: readonly DoctorRow[],
): { nav: DoctorNav; intent: DoctorIntent } {
  const last = Math.max(0, visible.length - 1)
  const cursor = clamp(nav.cursor, last)
  const selected = visible[cursor]

  if (isQuit(key)) return { nav, intent: { kind: "quit" } }
  if (isDown(key)) return { nav: { ...nav, cursor: clamp(cursor + 1, last) }, intent: { kind: "none" } }
  if (isUp(key)) return { nav: { ...nav, cursor: clamp(cursor - 1, last) }, intent: { kind: "none" } }
  if (key.name === "r") return { nav, intent: { kind: "rerun" } }

  if (key.name === "return") {
    if (!selected) return { nav, intent: { kind: "none" } }
    return { nav, intent: { kind: "fix", id: selected.id } }
  }

  if (key.name === "space") {
    if (!selected) return { nav, intent: { kind: "none" } }
    const collapsed = new Set(nav.collapsed)
    if (collapsed.has(selected.section)) collapsed.delete(selected.section)
    else collapsed.add(selected.section)
    // Folding shortens the list, so the cursor may now be past the end. It is
    // re-clamped on the next render against the new `visible`.
    return { nav: { cursor, collapsed }, intent: { kind: "none" } }
  }

  return { nav, intent: { kind: "none" } }
}

// ─── update picker ──────────────────────────────────────────────────

export type PickerState = {
  cursor: number
  selected: ReadonlySet<string>
}

export type PickerIntent =
  | { kind: "none" }
  | { kind: "cancel" }
  | { kind: "confirm"; selected: ReadonlySet<string> }

export const initialPickerState = (defaults: readonly string[]): PickerState => ({
  cursor: 0,
  selected: new Set(defaults),
})

export function reducePickerKey(
  state: PickerState,
  key: KeyEvent,
  ids: readonly string[],
): { state: PickerState; intent: PickerIntent } {
  const last = Math.max(0, ids.length - 1)
  const cursor = clamp(state.cursor, last)

  if (isQuit(key)) return { state, intent: { kind: "cancel" } }
  if (isDown(key)) return { state: { ...state, cursor: clamp(cursor + 1, last) }, intent: { kind: "none" } }
  if (isUp(key)) return { state: { ...state, cursor: clamp(cursor - 1, last) }, intent: { kind: "none" } }
  if (key.name === "return") return { state, intent: { kind: "confirm", selected: state.selected } }

  if (key.name === "a") {
    // All-or-none, based on whether everything is already selected.
    const all = ids.length > 0 && ids.every((id) => state.selected.has(id))
    return { state: { ...state, selected: new Set(all ? [] : ids) }, intent: { kind: "none" } }
  }

  if (key.name === "space") {
    const id = ids[cursor]
    if (id === undefined) return { state, intent: { kind: "none" } }
    const selected = new Set(state.selected)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    return { state: { cursor, selected }, intent: { kind: "none" } }
  }

  return { state, intent: { kind: "none" } }
}
