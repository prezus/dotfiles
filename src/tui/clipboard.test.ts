import { describe, expect, it } from "bun:test"
import { copySelection, isCopyKey } from "./clipboard.ts"

describe("terminal copy", () => {
  it("copies a non-empty selection only for an explicit terminal copy shortcut", () => {
    expect(isCopyKey({ name: "c", super: true })).toBe(true)
    expect(isCopyKey({ name: "c", ctrl: true, shift: true })).toBe(true)
    expect(isCopyKey({ name: "c", ctrl: true })).toBe(false)

    const copied: string[] = []
    expect(
      copySelection(
        { getSelectedText: () => "brew output" },
        { copyToClipboardOSC52: (text) => (copied.push(text), true) },
      ),
    ).toBe("copied")
    expect(copied).toEqual(["brew output"])
    expect(copySelection({ getSelectedText: () => "" }, { copyToClipboardOSC52: () => true })).toBe("empty")
  })
})
