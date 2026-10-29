import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useRef, useState } from "react"
import { initialMenuState, reduceMenuKey } from "./interaction.ts"
import { clearRenderer, setRenderer } from "./renderer.ts"
import { windowFor } from "./scroll.ts"
import { useTerminalSize } from "./use-terminal-size.ts"
import { BOLD, theme } from "./theme.ts"

export type Action<Name extends string> = { readonly name: Name; readonly description: string }

/** Pick one of a command's mutually exclusive actions (install / status / uninstall).
 *  Render on the dashboard's existing renderer; never nest terminal renderers. */
export function ActionPicker<Name extends string>({ title, note, detail = [], actions, onDone }: {
  title: string
  note: string
  /** Shown above the actions, e.g. the command's current status. */
  detail?: readonly string[]
  actions: readonly Action<Name>[]
  onDone: (action: Name | null) => void
}) {
  const size = useTerminalSize()
  const [state, setState] = useState(initialMenuState)
  const start = useRef(0)
  const visible = windowFor(start.current, actions.length, state.cursor, Math.max(1, size.rows - 8 - detail.length))
  start.current = visible.start

  useKeyboard((key) => {
    const result = reduceMenuKey(state, key, actions.map((action) => action.name))
    setState(result.state)
    if (result.intent.kind === "quit") onDone(null)
    if (result.intent.kind === "run") {
      const name = result.intent.command
      const action = actions.find((entry) => entry.name === name)
      if (action) onDone(action.name)
    }
  })

  return (
    <box flexDirection="column" padding={1} flexGrow={1}>
      <text fg={theme.blue} attributes={BOLD}>{title}</text>
      <text fg={theme.yellow}>{note}</text>
      {detail.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          {detail.map((line, index) => <text key={index} fg={theme.fg}>{line}</text>)}
        </box>
      )}
      <box flexDirection="column" marginTop={1}>
        {actions.slice(visible.start, visible.end).map((action, offset) => (
          <text key={action.name} fg={state.cursor === visible.start + offset ? theme.orange : theme.fgMuted}>
            {`${state.cursor === visible.start + offset ? " ❯ " : "   "}${action.name.padEnd(12)}${action.description}`}
          </text>
        ))}
      </box>
      <box marginTop="auto"><text fg={theme.gray}>↑↓ move · ⏎ select · q / Esc cancel</text></box>
    </box>
  )
}

/** Open a standalone command's action picker on its own renderer. */
export async function pickAction<Name extends string>(
  title: string,
  note: string,
  actions: readonly Action<Name>[],
  detail: readonly string[] = [],
): Promise<Name | null> {
  const renderer = await createCliRenderer()
  setRenderer(renderer)
  return new Promise((resolve) => {
    createRoot(renderer).render(<ActionPicker title={title} note={note} detail={detail} actions={actions} onDone={(action) => {
      clearRenderer(renderer)
      renderer.destroy()
      resolve(action)
    }} />)
  })
}
