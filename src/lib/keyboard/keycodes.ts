// Linux evdev keycodes, translated into the DOM's `KeyboardEvent.code` names.
//
// The two event sources this package supports speak different vocabularies for
// the same physical key: evdev calls it `KEY_LEFTMETA` (125), the DOM calls it
// `MetaLeft`. Nothing can be compared across a Mac and a Linux box until both
// sides agree, so evdev is translated INTO the DOM's names rather than the
// other way around — the DOM is the vocabulary that exists on both platforms,
// and `code` is already defined to be physical and layout-independent, which is
// exactly the property a keymap comparison needs.
//
// Numbering is from linux/input-event-codes.h. The gaps are real: 84, 85, 86
// and 101 are unused on a PC keyboard.

/**
 * A `KeyboardEvent.code` value — the physical key, independent of layout.
 *
 * Deliberately a plain string rather than a union of every known code. The
 * table below is not exhaustive (a keyboard may emit vendor keys nobody has
 * enumerated), and a union would force every unknown key to be dropped rather
 * than shown to the person trying to find out what their keyboard just sent.
 */
export type KeyCode = string

/** evdev `EV_KEY` code → `KeyboardEvent.code`. */
const EVDEV_TO_CODE: ReadonlyMap<number, KeyCode> = new Map([
  [1, "Escape"],
  [2, "Digit1"],
  [3, "Digit2"],
  [4, "Digit3"],
  [5, "Digit4"],
  [6, "Digit5"],
  [7, "Digit6"],
  [8, "Digit7"],
  [9, "Digit8"],
  [10, "Digit9"],
  [11, "Digit0"],
  [12, "Minus"],
  [13, "Equal"],
  [14, "Backspace"],
  [15, "Tab"],
  [16, "KeyQ"],
  [17, "KeyW"],
  [18, "KeyE"],
  [19, "KeyR"],
  [20, "KeyT"],
  [21, "KeyY"],
  [22, "KeyU"],
  [23, "KeyI"],
  [24, "KeyO"],
  [25, "KeyP"],
  [26, "BracketLeft"],
  [27, "BracketRight"],
  [28, "Enter"],
  [29, "ControlLeft"],
  [30, "KeyA"],
  [31, "KeyS"],
  [32, "KeyD"],
  [33, "KeyF"],
  [34, "KeyG"],
  [35, "KeyH"],
  [36, "KeyJ"],
  [37, "KeyK"],
  [38, "KeyL"],
  [39, "Semicolon"],
  [40, "Quote"],
  [41, "Backquote"],
  [42, "ShiftLeft"],
  [43, "Backslash"],
  [44, "KeyZ"],
  [45, "KeyX"],
  [46, "KeyC"],
  [47, "KeyV"],
  [48, "KeyB"],
  [49, "KeyN"],
  [50, "KeyM"],
  [51, "Comma"],
  [52, "Period"],
  [53, "Slash"],
  [54, "ShiftRight"],
  [55, "NumpadMultiply"],
  [56, "AltLeft"],
  [57, "Space"],
  [58, "CapsLock"],
  [59, "F1"],
  [60, "F2"],
  [61, "F3"],
  [62, "F4"],
  [63, "F5"],
  [64, "F6"],
  [65, "F7"],
  [66, "F8"],
  [67, "F9"],
  [68, "F10"],
  [69, "NumLock"],
  [70, "ScrollLock"],
  [71, "Numpad7"],
  [72, "Numpad8"],
  [73, "Numpad9"],
  [74, "NumpadSubtract"],
  [75, "Numpad4"],
  [76, "Numpad5"],
  [77, "Numpad6"],
  [78, "NumpadAdd"],
  [79, "Numpad1"],
  [80, "Numpad2"],
  [81, "Numpad3"],
  [82, "Numpad0"],
  [83, "NumpadDecimal"],
  [87, "F11"],
  [88, "F12"],
  [96, "NumpadEnter"],
  [97, "ControlRight"],
  [98, "NumpadDivide"],
  [99, "PrintScreen"],
  [100, "AltRight"],
  [102, "Home"],
  [103, "ArrowUp"],
  [104, "PageUp"],
  [105, "ArrowLeft"],
  [106, "ArrowRight"],
  [107, "End"],
  [108, "ArrowDown"],
  [109, "PageDown"],
  [110, "Insert"],
  [111, "Delete"],
  [113, "AudioVolumeMute"],
  [114, "AudioVolumeDown"],
  [115, "AudioVolumeUp"],
  [119, "Pause"],
  [125, "MetaLeft"],
  [126, "MetaRight"],
  // Omarchy's default kb_options is `compose:caps`, so on this machine the key
  // in the Caps Lock position reports 127 rather than 58.
  [127, "ContextMenu"],
  [139, "ContextMenu"],
  [163, "MediaTrackNext"],
  [164, "MediaPlayPause"],
  [165, "MediaTrackPrevious"],
])

/**
 * Translate an evdev keycode into its `KeyboardEvent.code` name.
 *
 * @param keycode - The `EV_KEY` code from an evdev event.
 * @returns The DOM code name, or `Unknown(<keycode>)` when the key is absent
 *   from the table. Unknown keys are surfaced rather than dropped: someone
 *   running this is trying to discover what a key sends, and a silent omission
 *   is the one answer that helps nobody.
 */
export function codeForKeycode(keycode: number): KeyCode {
  return EVDEV_TO_CODE.get(keycode) ?? `Unknown(${keycode})`
}
