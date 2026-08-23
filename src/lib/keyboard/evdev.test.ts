// The evdev decoder parses a kernel ABI, so it is worth pinning: a wrong offset
// or the wrong endianness produces plausible-looking garbage rather than an
// error, and every chord downstream would be quietly wrong.
import { describe, expect, it } from "bun:test"
import { ModifierState } from "./key-event.ts"
import { decodeInputEvent, drainEvents, phaseForValue } from "./evdev.ts"
import { codeForKeycode } from "./keycodes.ts"

/** Build one `struct input_event` the way the kernel lays it out on x86-64. */
function inputEvent(type: number, code: number, value: number): Uint8Array {
  const bytes = new Uint8Array(24)
  const view = new DataView(bytes.buffer)
  view.setBigInt64(0, 1_700_000_000n, true) // tv_sec
  view.setBigInt64(8, 123_456n, true) // tv_usec
  view.setUint16(16, type, true)
  view.setUint16(18, code, true)
  view.setInt32(20, value, true)
  return bytes
}

describe("decodeInputEvent", () => {
  it("reads type, code and value from their documented offsets", () => {
    const bytes = inputEvent(1, 125, 1)
    const view = new DataView(bytes.buffer)
    expect(decodeInputEvent(view, 0)).toEqual({ type: 1, code: 125, value: 1 })
  })

  it("decodes a record that is not the first in the buffer", () => {
    const merged = new Uint8Array(48)
    merged.set(inputEvent(1, 30, 1), 0)
    merged.set(inputEvent(1, 46, 0), 24)
    const view = new DataView(merged.buffer)
    expect(decodeInputEvent(view, 24)).toEqual({ type: 1, code: 46, value: 0 })
  })

  it("reads a release as a signed zero rather than wrapping", () => {
    const bytes = inputEvent(1, 57, 0)
    expect(decodeInputEvent(new DataView(bytes.buffer), 0).value).toBe(0)
  })
})

describe("phaseForValue", () => {
  it("maps the three documented values", () => {
    expect(phaseForValue(0)).toBe("release")
    expect(phaseForValue(1)).toBe("press")
    expect(phaseForValue(2)).toBe("repeat")
  })

  it("rejects anything else rather than guessing", () => {
    expect(phaseForValue(3)).toBeNull()
    expect(phaseForValue(-1)).toBeNull()
  })
})

describe("evdev to chord", () => {
  it("turns a Super+C sequence into one chord, the way Hyprland sees it", () => {
    const state = new ModifierState()
    // 125 = KEY_LEFTMETA, 46 = KEY_C
    expect(String(state.apply(codeForKeycode(125), "press"))).toBe("Meta")
    expect(String(state.apply(codeForKeycode(46), "press"))).toBe("Meta+KeyC")
    expect(String(state.apply(codeForKeycode(46), "release"))).toBe("Meta+KeyC")
    expect(String(state.apply(codeForKeycode(125), "release"))).toBe("Meta")
    expect(String(state.apply(codeForKeycode(46), "press"))).toBe("KeyC")
  })

  it("does not leave a modifier held after its release", () => {
    const state = new ModifierState()
    state.apply("ShiftLeft", "press")
    state.apply("ShiftLeft", "release")
    expect(state.held().size).toBe(0)
  })
})

describe("drainEvents", () => {
  it("carries a record split across two chunks instead of dropping it", () => {
    const state = new ModifierState()
    const whole = inputEvent(1, 30, 1) // KEY_A press

    // The kernel is under no obligation to hand back 24-byte multiples.
    const first = drainEvents(new Uint8Array(0), whole.slice(0, 10), state)
    expect(first.presses).toHaveLength(0)
    expect(first.rest).toHaveLength(10)

    const second = drainEvents(first.rest, whole.slice(10), state)
    expect(second.presses).toHaveLength(1)
    expect(second.presses[0]?.code).toBe("KeyA")
    expect(second.rest).toHaveLength(0)
  })

  it("decodes several records from one chunk, in order", () => {
    const state = new ModifierState()
    const chunk = new Uint8Array(72)
    chunk.set(inputEvent(1, 125, 1), 0) // Meta down
    chunk.set(inputEvent(1, 20, 1), 24) // T down
    chunk.set(inputEvent(1, 20, 0), 48) // T up

    const drained = drainEvents(new Uint8Array(0), chunk, state)
    expect(drained.presses.map((p) => String(p.chord))).toEqual([
      "Meta",
      "Meta+KeyT",
      "Meta+KeyT",
    ])
  })

  it("ignores the EV_SYN separators the kernel interleaves", () => {
    const state = new ModifierState()
    const chunk = new Uint8Array(48)
    chunk.set(inputEvent(1, 30, 1), 0) // EV_KEY
    chunk.set(inputEvent(0, 0, 0), 24) // EV_SYN / SYN_REPORT
    expect(drainEvents(new Uint8Array(0), chunk, state).presses).toHaveLength(1)
  })
})
