// The named actions worth comparing between two machines, and the shape of a
// recorded capture.
//
// A raw key log answers "what did that key send". It does not answer the
// question that actually hurts, which is "why does the same intention need
// different fingers on my two machines". That needs the capture to be indexed
// by INTENTION — copy, new tab, jump to end of line — so two machines can be
// laid side by side and asked where they disagree. Hence a fixed action list
// rather than a free-form log.
import { Schema } from "effect"
import type { Chord } from "./chord.ts"

/** Which part of the keyboard experience an action belongs to. */
export type ActionGroup = "edit" | "text" | "tab" | "window" | "system"

/** One intention a person has, independent of which keys express it. */
export type KeymapAction = {
  /** Stable identifier, used as the key when diffing two profiles. */
  readonly id: string
  /** Which group, so a capture can be run a section at a time. */
  readonly group: ActionGroup
  /** What to ask the person to press. */
  readonly prompt: string
}

/**
 * The actions a capture walks through.
 *
 * Ordered by group so a partial capture still produces something coherent, and
 * within a group by how often the action comes up — a capture abandoned halfway
 * should still have collected the chords that matter most.
 */
export const ACTIONS: readonly KeymapAction[] = [
  { id: "copy", group: "edit", prompt: "Copy" },
  { id: "paste", group: "edit", prompt: "Paste" },
  { id: "cut", group: "edit", prompt: "Cut" },
  { id: "select-all", group: "edit", prompt: "Select all" },
  { id: "undo", group: "edit", prompt: "Undo" },
  { id: "redo", group: "edit", prompt: "Redo" },
  { id: "save", group: "edit", prompt: "Save" },
  { id: "find", group: "edit", prompt: "Find" },
  { id: "find-next", group: "edit", prompt: "Find next" },

  { id: "line-start", group: "text", prompt: "Jump to start of line" },
  { id: "line-end", group: "text", prompt: "Jump to end of line" },
  { id: "doc-start", group: "text", prompt: "Jump to start of document" },
  { id: "doc-end", group: "text", prompt: "Jump to end of document" },
  { id: "word-left", group: "text", prompt: "Move one word left" },
  { id: "word-right", group: "text", prompt: "Move one word right" },
  { id: "select-line-start", group: "text", prompt: "Select to start of line" },
  { id: "select-line-end", group: "text", prompt: "Select to end of line" },
  { id: "delete-word-left", group: "text", prompt: "Delete the word to the left" },
  { id: "delete-to-line-start", group: "text", prompt: "Delete to start of line" },

  { id: "new-tab", group: "tab", prompt: "New tab" },
  { id: "close-tab", group: "tab", prompt: "Close tab" },
  { id: "reopen-tab", group: "tab", prompt: "Reopen the last closed tab" },
  { id: "next-tab", group: "tab", prompt: "Next tab" },
  { id: "prev-tab", group: "tab", prompt: "Previous tab" },
  { id: "first-tab", group: "tab", prompt: "Jump to the first tab" },

  { id: "new-window", group: "window", prompt: "New window" },
  { id: "close-window", group: "window", prompt: "Close window" },
  { id: "quit-app", group: "window", prompt: "Quit the application" },
  { id: "app-switcher", group: "window", prompt: "Switch between windows" },
  { id: "fullscreen", group: "window", prompt: "Toggle fullscreen" },

  { id: "launcher", group: "system", prompt: "Open the launcher (Spotlight / Omarchy menu)" },
  { id: "reload", group: "system", prompt: "Reload the page" },
  { id: "address-bar", group: "system", prompt: "Focus the address bar" },
  { id: "command-palette", group: "system", prompt: "Open the command palette" },
  { id: "preferences", group: "system", prompt: "Open preferences" },
  { id: "screenshot", group: "system", prompt: "Take a screenshot of a region" },
  { id: "lock", group: "system", prompt: "Lock the screen" },
]

/** JSON as written to disk. Chords are plain strings on the wire. */
const ProfileEntryJson = Schema.Struct({
  action: Schema.String,
  chord: Schema.NullOr(Schema.String),
})

/** Parser for the file `dotfiles keys record` writes. */
export const ProfileJson = Schema.parseJson(
  Schema.Struct({
    machine: Schema.String,
    platform: Schema.Literal("darwin", "linux"),
    capturedAt: Schema.String,
    entries: Schema.Array(ProfileEntryJson),
  }),
)

/** One captured action, or a deliberate skip. */
export type ProfileEntry = {
  /** The {@link KeymapAction} id this records. */
  readonly action: string
  /** What was pressed, or null when the action was skipped. */
  readonly chord: Chord | null
}

/** Everything one machine reported. */
export type Profile = {
  /** What the person called this machine, e.g. "mac" or "linux". */
  readonly machine: string
  /** Which platform recorded it, so chords render in native conventions. */
  readonly platform: "darwin" | "linux"
  /** ISO-8601 capture time, supplied by the caller rather than read here. */
  readonly capturedAt: string
  /** One entry per action the capture covered. */
  readonly entries: readonly ProfileEntry[]
}

/** How two machines compare on one action. */
export type DiffVerdict = "same" | "differs" | "only-left" | "only-right" | "neither"

/** One row of a two-machine comparison. */
export type DiffRow = {
  /** The action being compared. */
  readonly action: string
  /** Its human-readable prompt, when the action is still in {@link ACTIONS}. */
  readonly prompt: string
  /** What the left profile recorded. */
  readonly left: Chord | null
  /** What the right profile recorded. */
  readonly right: Chord | null
  /** The comparison outcome. */
  readonly verdict: DiffVerdict
}

/** Decide how one action's two recordings compare. */
function verdictFor(left: Chord | null, right: Chord | null): DiffVerdict {
  if (left === null && right === null) return "neither"
  if (left === null) return "only-right"
  if (right === null) return "only-left"
  return left === right ? "same" : "differs"
}

/**
 * Compare two captures action by action.
 *
 * The union of both profiles' actions is walked, not just {@link ACTIONS}, so a
 * profile recorded before an action was added or removed still diffs cleanly
 * rather than silently dropping rows.
 *
 * @param left - The first profile.
 * @param right - The second profile.
 * @returns One row per action, in {@link ACTIONS} order with unknown actions last.
 */
export function diff(left: Profile, right: Profile): readonly DiffRow[] {
  const leftByAction = new Map(left.entries.map((e) => [e.action, e.chord]))
  const rightByAction = new Map(right.entries.map((e) => [e.action, e.chord]))

  const known = ACTIONS.map((a) => a.id)
  const extra = [...leftByAction.keys(), ...rightByAction.keys()].filter(
    (id) => !known.includes(id),
  )
  const ordered = [...known, ...new Set(extra)]

  return ordered.flatMap((id) => {
    const inLeft = leftByAction.has(id)
    const inRight = rightByAction.has(id)
    if (!inLeft && !inRight) return []

    const l = leftByAction.get(id) ?? null
    const r = rightByAction.get(id) ?? null
    return [
      {
        action: id,
        prompt: ACTIONS.find((a) => a.id === id)?.prompt ?? id,
        left: l,
        right: r,
        verdict: verdictFor(l, r),
      },
    ]
  })
}
