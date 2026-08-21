import { expect, test } from "bun:test"
import { isRenderable } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { Picker } from "./update-picker.tsx"

test("the picker fills the terminal and anchors its footer to the bottom", async () => {
  const setup = await testRender(
    <Picker
      tasks={[{ id: "repos", title: "Repos", description: "pull repositories", default: true }]}
      onDone={() => {}}
    />,
    { width: 100, height: 40 },
  )

  try {
    await setup.flush()
    const screen = setup.renderer.root.getChildren()[0]
    expect(isRenderable(screen)).toBeTrue()
    if (!isRenderable(screen)) return

    expect(screen.width).toBe(100)
    expect(screen.height).toBe(40)

    const children = screen.getChildren()
    const footer = children[children.length - 1]
    expect(isRenderable(footer)).toBeTrue()
    if (!isRenderable(footer)) return

    // The remaining row is the root box's bottom padding.
    expect(footer.y + footer.height).toBe(39)
  } finally {
    await act(async () => setup.renderer.destroy())
  }
})
