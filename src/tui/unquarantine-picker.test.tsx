import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { UnquarantinePicker, type UnquarantineAction } from "./unquarantine-picker.tsx"

test("quarantine picker offers explicit actions and cancels without installing", async () => {
  const chosen: Array<UnquarantineAction | null> = []
  const setup = await testRender(<UnquarantinePicker onDone={(action) => chosen.push(action)} />, {
    width: 100, height: 20,
  })
  try {
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("status")
    expect(setup.captureCharFrame()).toContain("install")
    expect(setup.captureCharFrame()).toContain("uninstall")
    expect(chosen).toEqual([])
    await act(async () => { setup.mockInput.pressKey("\r") })
    expect(chosen).toEqual(["status"])
    await act(async () => { setup.mockInput.pressKey("j") })
    await act(async () => { setup.mockInput.pressKey("\r") })
    expect(chosen).toEqual(["status", "install"])
    await act(async () => { setup.mockInput.pressKey("j") })
    await act(async () => { setup.mockInput.pressKey("\r") })
    expect(chosen).toEqual(["status", "install", "uninstall"])
    await act(async () => { setup.mockInput.pressKey("q") })
    expect(chosen).toEqual(["status", "install", "uninstall", null])
  } finally {
    await act(async () => setup.renderer.destroy())
  }
})
