import { describe, expect, it } from "bun:test"
import { withTerminal } from "../lib/terminal.ts"
import { clearRenderer, setRenderer, type SuspendableRenderer } from "./renderer.ts"

describe("renderer lifecycle", () => {
  it("does not suspend a renderer after that renderer has been cleared", async () => {
    const calls: string[] = []
    // No assertion needed: setRenderer asks for the two methods it calls, and
    // this object has them.
    const renderer: SuspendableRenderer = {
      suspend: () => void calls.push("suspend"),
      resume: () => void calls.push("resume"),
    }

    setRenderer(renderer)
    clearRenderer(renderer)
    await withTerminal(async () => calls.push("child"))

    expect(calls).toEqual(["child"])
  })
})
