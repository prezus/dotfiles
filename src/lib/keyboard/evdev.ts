// Reading key events straight off a Linux input device.
//
// This is the source that sees what the DOM cannot. Hyprland grabs every chord
// it has a binding for — SUPER+C among them — and the browser is simply never
// told those keys were pressed. evdev sits below the compositor, so it observes
// the press regardless of who consumes it afterwards. That makes it the only
// way to verify a compositor-level remap actually fired.
//
// It needs no root: the `input` group owns /dev/input/event*, and Omarchy puts
// the desktop user in it. `/dev/hidraw*` is a different matter (0600 root:root
// until a vendor's udev rules land) but nothing here needs hidraw.
import { createReadStream } from "node:fs"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { Result, TaggedError } from "better-result"
import { INPUT_BY_ID_DIR } from "../env.ts"
import { ModifierState, type KeyPhase, type KeyPress } from "./key-event.ts"
import { codeForKeycode } from "./keycodes.ts"

/**
 * Size of `struct input_event` on 64-bit Linux.
 *
 * `{ struct timeval time; __u16 type; __u16 code; __s32 value; }` where
 * `timeval` is two 64-bit longs — 16 + 2 + 2 + 4 = 24, no tail padding.
 */
const EVENT_SIZE = 24

/** `EV_KEY`, the only event type this reader cares about. */
const EV_KEY = 1

/** The device could not be opened or read. */
export class DeviceUnavailable extends TaggedError("DeviceUnavailable")<{
  device: string
  message: string
}>() {}

/** A keyboard input device, named the way the user would recognize it. */
export type InputDevice = {
  /** Stable path under /dev/input/by-id. */
  readonly path: string
  /** Human-readable name, derived from the by-id symlink. */
  readonly name: string
}

/**
 * One decoded `input_event` record.
 *
 * `type`/`code`/`value` are the kernel's own field names, kept rather than
 * renamed so this is checkable against input-event-codes.h at a glance.
 */
export type InputEvent = {
  readonly type: number
  readonly code: number
  readonly value: number
}

/**
 * Decode one `struct input_event` out of a buffer.
 *
 * Uses `DataView` rather than a typed-array cast: the record is not 8-byte
 * aligned at every offset a stream hands you, and a cast would additionally
 * inherit the platform's endianness rather than stating it.
 *
 * @param view - A view over at least `offset + 24` bytes.
 * @param offset - Byte offset of the record's first byte.
 * @returns The decoded event.
 */
export function decodeInputEvent(view: DataView, offset: number): InputEvent {
  return {
    type: view.getUint16(offset + 16, true),
    code: view.getUint16(offset + 18, true),
    value: view.getInt32(offset + 20, true),
  }
}

/**
 * Interpret an `EV_KEY` value as a phase.
 *
 * @param value - The event's `value` field: 0 release, 1 press, 2 auto-repeat.
 * @returns The phase, or null when the value is not one the kernel documents.
 */
export function phaseForValue(value: number): KeyPhase | null {
  if (value === 0) return "release"
  if (value === 1) return "press"
  if (value === 2) return "repeat"
  return null
}

/**
 * Turn a by-id filename into something a person recognizes.
 *
 * The raw entry is `usb-Wooting_Wooting_60HE+_A02B2438W05T01100S01H35486-if01-event-kbd`:
 * vendor doubled, a serial nobody asked for, and the USB interface number. All
 * three are dropped, and the doubled vendor collapsed, because the only job
 * here is letting someone pick the right row out of a list of three.
 */
function friendlyName(entry: string): string {
  const stripped = entry
    .replace(/^usb-/, "")
    .replace(/-event-kbd$/, "")
    .replace(/-if\d+$/, "")
    .replace(/_/g, " ")
    // A serial is a long unbroken run of digits and capitals; a product name is not.
    .replace(/\s+[A-Z0-9]{12,}$/, "")
    .trim()

  // "Wooting Wooting 60HE+", "Endgame Gear Endgame Gear OP1" — udev concatenates
  // the manufacturer and product strings, and most vendors put their own name in
  // both. The repeated run can be several words, so drop the longest prefix that
  // immediately repeats itself.
  const words = stripped.split(" ")
  for (let k = Math.floor(words.length / 2); k >= 1; k--) {
    const head = words.slice(0, k).join(" ")
    const next = words.slice(k, k * 2).join(" ")
    if (head === next) return words.slice(k).join(" ")
  }
  return stripped
}

/**
 * A mouse's keyboard endpoint is almost never the one someone means.
 *
 * Gaming mice present an `-event-kbd` node for their macro keys, and it sorts
 * ahead of the real keyboard alphabetically often enough to matter. This is a
 * ranking, not a filter: the endpoint stays listed and stays selectable, it
 * just stops being the default.
 */
function looksLikePeripheral(name: string): boolean {
  return /mouse|trackball|touchpad|consumer|system control/i.test(name)
}

/**
 * List the keyboard devices on this machine, likeliest first.
 *
 * Reads `/dev/input/by-id`, which carries vendor and product in the filename,
 * rather than `/dev/input/event*`, whose numbering shifts between boots. Only
 * `-event-kbd` entries are returned: a modern keyboard also presents mouse and
 * consumer-control endpoints that never carry the keys being looked for.
 *
 * @returns The keyboard devices, or an empty array when the directory is absent.
 */
export async function listKeyboards(): Promise<readonly InputDevice[]> {
  const entries = await readdir(INPUT_BY_ID_DIR).catch(() => [])
  return entries
    .filter((entry) => entry.endsWith("-event-kbd"))
    .map((entry) => ({ path: join(INPUT_BY_ID_DIR, entry), name: friendlyName(entry) }))
    .sort((a, b) => {
      const rank = Number(looksLikePeripheral(a.name)) - Number(looksLikePeripheral(b.name))
      return rank !== 0 ? rank : a.name.localeCompare(b.name)
    })
}

/**
 * Stream key presses from one input device until the signal aborts.
 *
 * Records are buffered rather than assumed: a read on a character device may
 * return any number of bytes, including a partial record, and splitting one
 * across two reads would silently corrupt every event after it.
 *
 * @param device - Path to the device, from {@link listKeyboards}.
 * @param signal - Aborting it closes the device and ends the iteration.
 * @yields Each key transition, with modifier state already resolved.
 * @throws DeviceUnavailable - When the device cannot be opened or read. This is
 *   a stream, so the failure cannot be a return value; callers wrap the loop.
 */
export type DrainResult = {
  /** Every complete key transition the chunk contained, in order. */
  readonly presses: readonly KeyPress[]
  /** Bytes of a record that was cut short, to prepend to the next chunk. */
  readonly rest: Uint8Array
}

/**
 * Decode every whole record in `pending ++ chunk`, keeping the remainder.
 *
 * A read on a character device returns whatever was available, which is under
 * no obligation to be a multiple of 24 bytes. Discarding a trailing partial
 * record would desynchronize the stream permanently — every subsequent event
 * would be decoded from the wrong offset and produce plausible nonsense rather
 * than an error. Hence the carry.
 *
 * Pure, and separated from the device read for exactly that reason: this is the
 * part that is subtly wrong or subtly right, and it is worth testing directly.
 *
 * @param pending - Leftover bytes from the previous chunk.
 * @param chunk - Bytes just read from the device.
 * @param modifiers - Held-modifier state, advanced as transitions are decoded.
 * @returns The decoded presses and any trailing partial record.
 */
export function drainEvents(
  pending: Uint8Array,
  chunk: Uint8Array,
  modifiers: ModifierState,
): DrainResult {
  const merged = new Uint8Array(pending.length + chunk.length)
  merged.set(pending)
  merged.set(chunk, pending.length)

  const whole = Math.floor(merged.length / EVENT_SIZE) * EVENT_SIZE
  const view = new DataView(merged.buffer, merged.byteOffset, merged.byteLength)
  const presses: KeyPress[] = []

  for (let offset = 0; offset < whole; offset += EVENT_SIZE) {
    const event = decodeInputEvent(view, offset)
    if (event.type !== EV_KEY) continue
    const phase = phaseForValue(event.value)
    if (phase === null) continue

    const code = codeForKeycode(event.code)
    presses.push({ code, phase, chord: modifiers.apply(code, phase), source: "evdev" })
  }

  return { presses, rest: merged.slice(whole) }
}

export async function* readKeyPresses(
  device: string,
  signal: AbortSignal,
): AsyncGenerator<KeyPress> {
  const modifiers = new ModifierState()
  const stream = createReadStream(device, { signal })

  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(0)
      const drained = drainEvents(pending, bytes, modifiers)
      for (const press of drained.presses) yield press
      pending = drained.rest
    }
  } catch (cause) {
    if (signal.aborted) return
    throw new DeviceUnavailable({ device, message: String(cause) })
  }
}

/**
 * Read a device, handing each press to a callback, until the signal aborts.
 *
 * The generator above throws, because a stream cannot return a failure value
 * mid-iteration. This is the boundary that turns that back into one, so callers
 * never have to reason about an exception escaping an async iterator.
 *
 * @param device - Path to the device, from {@link listKeyboards}.
 * @param signal - Aborting it closes the device and completes normally.
 * @param onPress - Called for each transition, in order.
 * @returns Ok once the stream ends, or the failure that stopped it.
 */
export async function streamKeyPresses(
  device: string,
  signal: AbortSignal,
  onPress: (press: KeyPress) => void,
): Promise<Result<void, DeviceUnavailable>> {
  try {
    for await (const press of readKeyPresses(device, signal)) onPress(press)
    return Result.ok(undefined)
  } catch (cause) {
    if (cause instanceof DeviceUnavailable) return Result.err(cause)
    return Result.err(new DeviceUnavailable({ device, message: String(cause) }))
  }
}
