// A chord: one key press plus the modifiers held with it, in a canonical form
// that means the same thing on macOS and on Linux.
//
// This module exists because comparing two machines' keymaps is a normalization
// problem before it is anything else. The same press arrives as `KEY_T` + a
// modifier bitmask from evdev, and as `code: "KeyT"` + four booleans from the
// DOM; macOS calls the thumb modifier Command and reports `metaKey`, Linux
// calls it Super and also reports `metaKey`. Every one of those has to collapse
// to a single string before a diff can say anything useful.
//
// The canonical order is Ctrl, Alt, Shift, Meta — fixed, so that two chords are
// equal exactly when their canonical strings are equal, and a profile written
// on one machine sorts identically to one written on the other.
import { Result, TaggedError } from "better-result"
import type { KeyCode } from "./keycodes.ts"

/**
 * A modifier key, named as the DOM names it.
 *
 * `Meta` is Command on macOS and Super on Linux. Keeping one name for both is
 * the entire point: the physical thumb key plays the same role on each
 * platform, and a diff that reported `Cmd+KeyT` against `Super+KeyT` would be
 * reporting a spelling difference as though it were a keymap difference.
 */
export type Modifier = "Ctrl" | "Alt" | "Shift" | "Meta"

/** Canonical modifier order. Two chords are equal iff their strings are equal. */
const MODIFIER_ORDER: readonly Modifier[] = ["Ctrl", "Alt", "Shift", "Meta"]

/** Which modifier a physical key IS, for keys that are themselves modifiers. */
const CODE_TO_MODIFIER: ReadonlyMap<KeyCode, Modifier> = new Map([
  ["ControlLeft", "Ctrl"],
  ["ControlRight", "Ctrl"],
  ["AltLeft", "Alt"],
  ["AltRight", "Alt"],
  ["ShiftLeft", "Shift"],
  ["ShiftRight", "Shift"],
  ["MetaLeft", "Meta"],
  ["MetaRight", "Meta"],
])

declare const ChordBrand: unique symbol

/**
 * A normalized chord, such as `Meta+KeyT` or `Ctrl+Shift+KeyA`.
 *
 * Construct with {@link fromParts} or {@link parse}; the brand exists so a raw
 * string cannot be passed where a canonically-ordered one is required.
 */
export type Chord = string & { readonly [ChordBrand]: true }

/** The input string was not a chord this module can parse. */
export class InvalidChord extends TaggedError("InvalidChord")<{
  input: string
  message: string
}>() {}

/**
 * Whether a physical key is itself a modifier.
 *
 * @param code - The `KeyboardEvent.code` to test.
 * @returns True for the eight modifier keys, false for every other key.
 */
export function isModifierCode(code: KeyCode): boolean {
  return CODE_TO_MODIFIER.has(code)
}

/**
 * The modifier a physical key represents, when it is one.
 *
 * @param code - The `KeyboardEvent.code` to look up.
 * @returns The modifier, or null when the key is not a modifier.
 */
export function modifierForCode(code: KeyCode): Modifier | null {
  return CODE_TO_MODIFIER.get(code) ?? null
}

/**
 * Build a canonical chord from a base key and the modifiers held with it.
 *
 * A modifier pressed on its own is a legal chord (`Meta`), which matters while
 * someone is checking whether a key swap took effect — pressing the thumb key
 * alone is the most direct way to ask what it now reports. In that case the
 * base key is dropped from the output so `Meta` does not become `Meta+MetaLeft`.
 *
 * @param code - The physical key, as a `KeyboardEvent.code`.
 * @param modifiers - Modifiers held at the time of the press, in any order.
 * @returns The canonical chord.
 */
export function fromParts(code: KeyCode, modifiers: Iterable<Modifier>): Chord {
  const held = new Set(modifiers)
  const self = modifierForCode(code)
  if (self !== null) held.add(self)

  const ordered = MODIFIER_ORDER.filter((m) => held.has(m))
  const parts = self !== null ? ordered : [...ordered, code]

  // SAFETY: TypeScript cannot express the brand. Every part comes from
  // MODIFIER_ORDER or from a KeyCode, joined in canonical order, which is the
  // definition of a Chord. This function is the only unguarded constructor.
  return parts.join("+") as Chord
}

/**
 * Parse a chord from text, such as a hand-edited profile.
 *
 * Accepts any modifier order and re-canonicalizes, so `Shift+Meta+KeyA` and
 * `Meta+Shift+KeyA` both parse to the same chord.
 *
 * @param input - The text to parse.
 * @returns The canonical chord, or `InvalidChord` when the input is empty, has
 *   no base key, or names something that is not a modifier before the last part.
 */
export function parse(input: string): Result<Chord, InvalidChord> {
  const parts = input
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  const last = parts.at(-1)
  if (last === undefined) {
    return Result.err(new InvalidChord({ input, message: "empty chord" }))
  }

  const modifiers: Modifier[] = []
  for (const part of parts.slice(0, -1)) {
    const known = MODIFIER_ORDER.find((m) => m === part)
    if (known === undefined) {
      return Result.err(
        new InvalidChord({ input, message: `'${part}' is not a modifier (expected one of ${MODIFIER_ORDER.join(", ")})` }),
      )
    }
    modifiers.push(known)
  }

  // A trailing modifier name is the modifier-alone case: `Ctrl+Meta` means both
  // held with no other key, not Meta pressed while Ctrl is down.
  const trailing = MODIFIER_ORDER.find((m) => m === last)
  if (trailing !== undefined) {
    modifiers.push(trailing)
    const ordered = MODIFIER_ORDER.filter((m) => modifiers.includes(m))
    // SAFETY: as above — every part is drawn from MODIFIER_ORDER and joined in
    // canonical order.
    return Result.ok(ordered.join("+") as Chord)
  }

  return Result.ok(fromParts(last, modifiers))
}

/** Glyphs macOS uses on its own menus, so a recorded Mac chord reads like one. */
const MAC_GLYPHS: ReadonlyMap<Modifier, string> = new Map([
  ["Ctrl", "⌃"],
  ["Alt", "⌥"],
  ["Shift", "⇧"],
  ["Meta", "⌘"],
])

/** What Linux desktops call the same four keys. */
const LINUX_NAMES: ReadonlyMap<Modifier, string> = new Map([
  ["Ctrl", "Ctrl"],
  ["Alt", "Alt"],
  ["Shift", "Shift"],
  ["Meta", "Super"],
])

/** Strip the DOM's prefixes so `KeyT` reads as `T` and `Digit1` as `1`. */
function baseKeyLabel(code: KeyCode): string {
  if (code.startsWith("Key")) return code.slice(3)
  if (code.startsWith("Digit")) return code.slice(5)
  if (code.startsWith("Arrow")) return code.slice(5)
  return code
}

/**
 * Render a chord the way the named platform's own menus would.
 *
 * @param chord - The chord to render.
 * @param platform - Which platform's conventions to use.
 * @returns A display string, such as `⌘T` on darwin or `Super+T` on linux.
 */
export function describe(chord: Chord, platform: "darwin" | "linux"): string {
  const parts = chord.split("+")
  const last = parts.at(-1)
  if (last === undefined) return chord

  const isBareModifier = MODIFIER_ORDER.some((m) => m === last)
  const modifierParts = isBareModifier ? parts : parts.slice(0, -1)
  const names = modifierParts.flatMap((part) => {
    const known = MODIFIER_ORDER.find((m) => m === part)
    if (known === undefined) return []
    const label = platform === "darwin" ? MAC_GLYPHS.get(known) : LINUX_NAMES.get(known)
    return label === undefined ? [] : [label]
  })

  if (isBareModifier) return platform === "darwin" ? names.join("") : names.join("+")

  const base = baseKeyLabel(last)
  return platform === "darwin" ? `${names.join("")}${base}` : [...names, base].join("+")
}
