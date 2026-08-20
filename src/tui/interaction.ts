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
  /**
   * OpenTUI's ParsedKey reports the modifier separately, so an uppercase letter
   * arrives as `{ name: "g", shift: true }` and NOT as `{ name: "G" }`.
   * Matching on a capital letter therefore never fires — which is how `G` for
   * "jump to the bottom" would have silently done nothing.
   */
  shift?: boolean
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

/** What a keypress does to doctor: where the cursor lands, and what to perform. */
export type DoctorKeyResult = { nav: DoctorNav; intent: DoctorIntent }

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
): DoctorKeyResult {
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

// ─── home dashboard ─────────────────────────────────────────────────

export type HomeState = { cursor: number }

export type HomeIntent =
  | { kind: "none" }
  | { kind: "quit" }
  /** Run the command under the cursor. */
  | { kind: "run"; command: string }
  | { kind: "refresh" }

/** What a keypress does to the dashboard: where the cursor lands, and what to perform. */
export type HomeKeyResult = { state: HomeState; intent: HomeIntent }

export const initialHomeState = (): HomeState => ({ cursor: 0 })

export function reduceHomeKey(
  state: HomeState,
  key: KeyEvent,
  commands: readonly string[],
): HomeKeyResult {
  const last = Math.max(0, commands.length - 1)
  const cursor = clamp(state.cursor, last)

  if (isQuit(key)) return { state, intent: { kind: "quit" } }
  if (isDown(key)) return { state: { cursor: clamp(cursor + 1, last) }, intent: { kind: "none" } }
  if (isUp(key)) return { state: { cursor: clamp(cursor - 1, last) }, intent: { kind: "none" } }
  if (key.name === "r") return { state, intent: { kind: "refresh" } }

  if (key.name === "return") {
    const command = commands[cursor]
    if (command === undefined) return { state, intent: { kind: "none" } }
    return { state, intent: { kind: "run", command } }
  }

  // First-letter jump: `d` for doctor, `u` for update, and so on. Ambiguous
  // letters cycle through the matches rather than always landing on the first.
  if (key.name && key.name.length === 1 && /[a-z]/.test(key.name)) {
    const matches = commands
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.startsWith(key.name as string))
    if (matches.length > 0) {
      const next = matches.find(({ i }) => i > cursor) ?? matches[0]
      if (next) return { state: { cursor: next.i }, intent: { kind: "none" } }
    }
  }

  return { state, intent: { kind: "none" } }
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

/** What a keypress does to the update picker: new selection state, and what to perform. */
export type PickerKeyResult = { state: PickerState; intent: PickerIntent }

export const initialPickerState = (defaults: readonly string[]): PickerState => ({
  cursor: 0,
  selected: new Set(defaults),
})

export function reducePickerKey(
  state: PickerState,
  key: KeyEvent,
  ids: readonly string[],
): PickerKeyResult {
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

// ─── reconcile picker ───────────────────────────────────────────────

/**
 * One drifted package and the dispositions available to it. Both directions of
 * drift are modelled as the same shape — an ordered choice list — because the
 * only thing that differs between them is the words:
 *
 *   installed, not declared  -> remove | keep | ignore
 *   declared, not installed  -> install | undeclare
 *
 * A checkbox cannot express three answers, which is why this is a cycle rather
 * than a reuse of PickerState.
 */
export type ReconcileItem = {
  /** Bundle directive, e.g. `brew "broot"` — unique, and what gets written. */
  id: string
  choices: readonly string[]
}

export type ReconcileState = {
  cursor: number
  /** id -> chosen disposition. Every item is present from the start. */
  choice: ReadonlyMap<string, string>
}

export type ReconcileIntent =
  | { kind: "none" }
  | { kind: "cancel" }
  | { kind: "confirm"; choice: ReadonlyMap<string, string> }

/** What a keypress does to the reconcile picker: new dispositions, and what to perform. */
export type ReconcileKeyResult = { state: ReconcileState; intent: ReconcileIntent }

/** Each item starts on its first choice, which callers order as the safe default. */
export const initialReconcileState = (items: readonly ReconcileItem[]): ReconcileState => ({
  cursor: 0,
  choice: new Map(items.map((i) => [i.id, i.choices[0] ?? ""])),
})

const cycle = (
  state: ReconcileState,
  items: readonly ReconcileItem[],
  cursor: number,
  step: number,
): ReconcileState => {
  const item = items[cursor]
  if (!item || item.choices.length === 0) return { ...state, cursor }
  const current = state.choice.get(item.id) ?? item.choices[0]
  const at = item.choices.indexOf(current as string)
  // Modulo twice: JS `%` keeps the sign, so a left-cycle off index 0 would
  // otherwise land on a negative index and read as undefined.
  const next = item.choices[(((at + step) % item.choices.length) + item.choices.length) % item.choices.length]
  const choice = new Map(state.choice)
  choice.set(item.id, next as string)
  return { cursor, choice }
}

export function reduceReconcileKey(
  state: ReconcileState,
  key: KeyEvent,
  items: readonly ReconcileItem[],
): ReconcileKeyResult {
  const last = Math.max(0, items.length - 1)
  const cursor = clamp(state.cursor, last)

  if (isQuit(key)) return { state, intent: { kind: "cancel" } }
  if (isDown(key)) return { state: { ...state, cursor: clamp(cursor + 1, last) }, intent: { kind: "none" } }
  if (isUp(key)) return { state: { ...state, cursor: clamp(cursor - 1, last) }, intent: { kind: "none" } }
  if (key.name === "return") return { state, intent: { kind: "confirm", choice: state.choice } }

  if (key.name === "space" || key.name === "right" || key.name === "l")
    return { state: cycle(state, items, cursor, 1), intent: { kind: "none" } }
  if (key.name === "left" || key.name === "h")
    return { state: cycle(state, items, cursor, -1), intent: { kind: "none" } }

  return { state, intent: { kind: "none" } }
}

// ─── output pane ────────────────────────────────────────────────────

/**
 * Scroll position of the output pane, as distance from the tail.
 *
 * Zero means following: new lines push the view along, which is what you want
 * while a command is running. Anything else pins the window to the lines you
 * scrolled back to, and output keeps arriving above without yanking the screen
 * out from under you — the behaviour every pager and terminal already has, and
 * the reason the pane kept 500 lines of history it gave you no way to reach.
 */
export type OutputState = { offset: number }

export type OutputIntent =
  | { kind: "none" }
  /** Close the pane and go back to the dashboard. */
  | { kind: "dismiss" }

export type OutputKeyResult = { state: OutputState; intent: OutputIntent }

export const initialOutputState = (): OutputState => ({ offset: 0 })

/**
 * What a keypress does to the output pane.
 *
 * `busy` gates dismissal only. Scrolling stays live while a command runs, which
 * is precisely when the history is worth reading — watching a `brew upgrade`
 * scroll past is the case that motivated this.
 *
 * `maxOffset` comes from the caller because it depends on the rendered viewport
 * height, which is a drawing concern; the reducer just refuses to leave the
 * range it is handed.
 */
export function reduceOutputKey(
  state: OutputState,
  key: KeyEvent,
  view: { maxOffset: number; page: number; busy: boolean },
): OutputKeyResult {
  const limit = Math.max(0, view.maxOffset)
  const page = Math.max(1, view.page)
  const to = (offset: number): OutputKeyResult => ({
    state: { offset: clamp(offset, limit) },
    intent: { kind: "none" },
  })

  // Scrolling up means moving AWAY from the tail, so the offset grows.
  if (isUp(key)) return to(state.offset + 1)
  if (isDown(key)) return to(state.offset - 1)
  if (key.name === "pageup") return to(state.offset + page)
  if (key.name === "pagedown") return to(state.offset - page)
  // `g`/`home` to the oldest line retained, `G`/`end` back to following.
  if (key.name === "end" || (key.name === "g" && key.shift === true)) return to(0)
  if (key.name === "g" || key.name === "home") return to(limit)

  // Dismissal is last: `q` and Escape only mean "close" once nothing is
  // running, and while busy they should not silently do nothing else either.
  if (!view.busy && (isQuit(key) || key.name === "return"))
    return { state, intent: { kind: "dismiss" } }

  return { state, intent: { kind: "none" } }
}
