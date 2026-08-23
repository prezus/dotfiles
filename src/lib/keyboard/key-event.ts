// One observed key transition, and the state needed to turn a stream of them
// into chords.
//
// The two sources differ in what they hand you. The DOM reports the modifier
// state alongside every event (`ctrlKey`, `altKey`, `shiftKey`, `metaKey`), so
// a chord falls out of a single event. evdev reports only transitions — Meta
// down, T down, T up, Meta up — and whoever is reading has to remember what is
// still held. `ModifierState` is that memory, kept here rather than in the
// evdev adapter because it is pure, it is the part worth testing, and it is
// where an off-by-one in press/release bookkeeping would hide.
import { type Chord, fromParts, type Modifier, modifierForCode } from "./chord.ts"
import type { KeyCode } from "./keycodes.ts"

/**
 * What a key did.
 *
 * `repeat` is the kernel's auto-repeat, reported distinctly so a held key does
 * not read as a flurry of separate presses.
 */
export type KeyPhase = "press" | "release" | "repeat"

/** One observed key transition, with the modifiers held at the time. */
export type KeyPress = {
  /** The physical key, as a `KeyboardEvent.code`. */
  readonly code: KeyCode
  /** What the key did. */
  readonly phase: KeyPhase
  /** The canonical chord this transition completes. */
  readonly chord: Chord
  /** Which source observed it, so the UI can say why a chord is missing. */
  readonly source: "evdev" | "dom"
}

/**
 * The set of modifiers currently held, derived from a transition stream.
 *
 * Mutable by design: it is the imperative bookkeeping behind an inherently
 * stateful device, kept behind an interface small enough to test exhaustively.
 */
export class ModifierState {
  readonly #held = new Set<Modifier>()

  /**
   * Record a transition and return the chord it completes.
   *
   * A modifier's own press is folded into the returned chord, so pressing the
   * thumb key alone yields `Meta` rather than nothing — which is exactly the
   * question someone asks when checking whether a key swap took effect.
   *
   * @param code - The physical key that moved.
   * @param phase - What it did.
   * @returns The canonical chord for this transition.
   */
  apply(code: KeyCode, phase: KeyPhase): Chord {
    const modifier = modifierForCode(code)
    if (modifier !== null) {
      if (phase === "release") this.#held.delete(modifier)
      else this.#held.add(modifier)
    }
    return fromParts(code, this.#held)
  }

  /**
   * The modifiers currently held.
   *
   * @returns A snapshot; mutating it does not affect this state.
   */
  held(): ReadonlySet<Modifier> {
    return new Set(this.#held)
  }

  /**
   * Forget everything held.
   *
   * Needed after a device read gap: keys released while nobody was listening
   * would otherwise stay held forever and poison every later chord.
   */
  clear(): void {
    this.#held.clear()
  }
}
