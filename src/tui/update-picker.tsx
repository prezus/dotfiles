// Multi-select for `dotfiles update`.
//
// Replaces four sequential y/N prompts, where you answered each one blind to the
// others and could not go back. OpenTUI's <select> is single-choice, so this is
// a small checkbox list: space toggles, enter runs, q cancels.
import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useState } from "react"
import type { UpdateTask } from "../commands/update.ts"
import { initialPickerState, reducePickerKey, type PickerState } from "./interaction.ts"
import { clearRenderer, setRenderer } from "./renderer.ts"
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
          clearRenderer(renderer)
          renderer.destroy()
          resolve(chosen)
        }}
      />,
    )
  })
}

/** Exported so a host view (the dashboard) can swap it in on its OWN renderer
 *  rather than standing up a second one. See runHomeTui. */
export function Picker({
  tasks,
  onDone,
}: {
  tasks: UpdateTask[]
  onDone: (chosen: Set<string> | null) => void
}) {
  const ids = tasks.map((t) => t.id)
  const [state, setState] = useState<PickerState>(() =>
    initialPickerState(tasks.filter((t) => t.default).map((t) => t.id)),
  )
  const { cursor, selected } = state

  // All the behaviour lives in reducePickerKey, which is pure and unit-tested;
  // this component only renders the result and performs the intent.
  useKeyboard((key) => {
    const { state: next, intent } = reducePickerKey(state, key, ids)
    setState(next)
    if (intent.kind === "cancel") onDone(null)
    else if (intent.kind === "confirm") onDone(new Set(intent.selected))
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
