import { describe, expect, it } from "bun:test"
import type { CliRenderer } from "@opentui/core"
import { withTerminal } from "../lib/terminal.ts"
import { clearRenderer, setRenderer } from "./renderer.ts"

describe("renderer lifecycle", () => {
  it("does not suspend a renderer after that renderer has been cleared", async () => {
    const calls: string[] = []
    const renderer = {
      suspend: () => calls.push("suspend"),
      resume: () => calls.push("resume"),
    } as unknown as CliRenderer

    setRenderer(renderer)
    clearRenderer(renderer)
    await withTerminal(async () => calls.push("child"))

    expect(calls).toEqual(["child"])
  })
})
