/** Modifier state needed to recognize a copy shortcut. */
export type CopyKey = {
  readonly name?: string
  readonly ctrl?: boolean
  readonly meta?: boolean
  readonly shift?: boolean
  readonly super?: boolean
}

/** Selection text supplied by OpenTUI. */
export type ClipboardSelection = {
  readonly getSelectedText: () => string
}

/** Renderer capability used to write the host clipboard through OSC52. */
export type Osc52Clipboard = {
  readonly copyToClipboardOSC52: (text: string) => boolean
}

/** Result of attempting to copy the current OpenTUI selection. */
export type CopySelectionResult = "copied" | "empty" | "unsupported"

/** Recognize copy shortcuts that terminal emulators may forward to a TUI. */
export function isCopyKey(key: CopyKey): boolean {
  if (key.name !== "c") return false
  return key.super === true || key.meta === true || (key.ctrl === true && key.shift === true)
}

/** Copy a non-empty OpenTUI selection to the host clipboard through OSC52. */
export function copySelection(
  selection: ClipboardSelection,
  clipboard: Osc52Clipboard,
): CopySelectionResult {
  const text = selection.getSelectedText()
  if (text === "") return "empty"
  return clipboard.copyToClipboardOSC52(text) ? "copied" : "unsupported"
}
