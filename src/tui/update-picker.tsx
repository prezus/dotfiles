// Multi-select for `dotfiles update`.
//
// Replaces four sequential y/N prompts, where you answered each one blind to the
// others and could not go back. OpenTUI's <select> is single-choice, so this is
// a small checkbox list: space toggles, enter runs, q cancels.
import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useState } from "react"
import type { UpdateTask } from "../commands/update.ts"
import { setRenderer } from "./renderer.ts"
import { BOLD, theme } from "./theme.ts"

/** Resolves to the chosen ids, or null if the user cancelled. */
export async function pickUpdateTasks(tasks: UpdateTask[]): Promise<Set<string> | null> {
  const renderer = await createCliRenderer()
  setRenderer(renderer)

  return await new Promise<Set<string> | null>((resolve) => {
    createRoot(renderer).render(
      <Picker
        tasks={tasks}
        onDone={(chosen) => {
          renderer.destroy()
          resolve(chosen)
        }}
      />,
    )
  })
}

function Picker({
  tasks,
  onDone,
}: {
  tasks: UpdateTask[]
  onDone: (chosen: Set<string> | null) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(tasks.filter((t) => t.default).map((t) => t.id)),
  )
  const [cursor, setCursor] = useState(0)

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
      onDone(null)
      return
    }
    if (key.name === "down" || key.name === "j") setCursor((i) => Math.min(i + 1, tasks.length - 1))
    if (key.name === "up" || key.name === "k") setCursor((i) => Math.max(i - 1, 0))
    if (key.name === "a") {
      setSelected((prev) =>
        prev.size === tasks.length ? new Set() : new Set(tasks.map((t) => t.id)),
      )
    }
    if (key.name === "space") {
      const task = tasks[cursor]
      if (!task) return
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(task.id)) next.delete(task.id)
        else next.add(task.id)
        return next
      })
    }
    if (key.name === "return") onDone(selected)
  })

  return (
    <box flexDirection="column" padding={1}>
      <text fg={theme.blue} attributes={BOLD}>
        dotfiles update
      </text>
      <text fg={theme.gray}>choose what to update</text>

      <box flexDirection="column" marginTop={1}>
        {tasks.map((task, index) => {
          const active = index === cursor
          const on = selected.has(task.id)
          return (
            <box key={task.id} flexDirection="row">
              <text fg={active ? theme.orange : theme.bgSoft}>{active ? " ❯ " : "   "}</text>
              <text fg={on ? theme.green : theme.dim}>{on ? "[✓] " : "[ ] "}</text>
              <text fg={active ? theme.fg : theme.fgMuted}>{task.title.padEnd(16)}</text>
              <text fg={theme.dim}>{task.description}</text>
            </box>
          )
        })}
      </box>

      <box marginTop={1} flexDirection="column">
        <text fg={theme.dim}>{"─".repeat(56)}</text>
        <text fg={theme.gray}>
          {selected.size} of {tasks.length} selected
        </text>
        <text fg={theme.bgHard}>↑↓ move · space toggle · a all/none · ⏎ run · q cancel</text>
      </box>
    </box>
  )
}
