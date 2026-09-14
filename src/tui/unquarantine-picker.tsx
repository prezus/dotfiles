import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useRef, useState } from "react"
import { initialHomeState, reduceHomeKey } from "./interaction.ts"
import { clearRenderer, setRenderer } from "./renderer.ts"
import { windowFor } from "./scroll.ts"
import { useTerminalSize } from "./use-terminal-size.ts"
import { BOLD, theme } from "./theme.ts"

const ACTIONS = [
  { name: "status", description: "Inspect config, read access, and quarantined files" },
  { name: "install", description: "Enable automatic quarantine removal" },
  { name: "uninstall", description: "Disable the agent; preserve config and logs" },
] as const

/** Explicit, mutually exclusive quarantine-agent operations. */
export type UnquarantineAction = (typeof ACTIONS)[number]["name"]

/** Render on the dashboard's existing renderer; never nest terminal renderers. */
export function UnquarantinePicker({ onDone }: {
  onDone: (action: UnquarantineAction | null) => void
}) {
  const size = useTerminalSize()
  const [state, setState] = useState(initialHomeState)
  const start = useRef(0)
  const visible = windowFor(start.current, ACTIONS.length, state.cursor, Math.max(1, size.rows - 8))
  start.current = visible.start

  useKeyboard((key) => {
    const result = reduceHomeKey(state, key, ACTIONS.map((action) => action.name))
    setState(result.state)
    if (result.intent.kind === "quit") onDone(null)
    if (result.intent.kind === "run") {
      const name = result.intent.command
      const action = ACTIONS.find((entry) => entry.name === name)
      if (action) onDone(action.name)
    }
  })

  return (
    <box flexDirection="column" padding={1} flexGrow={1}>
      <text fg={theme.blue} attributes={BOLD}>dotfiles unquarantine</text>
      <text fg={theme.yellow}>Opt-in: removing quarantine bypasses a macOS download safety check.</text>
      <box flexDirection="column" marginTop={1}>
        {ACTIONS.slice(visible.start, visible.end).map((action, offset) => (
          <text key={action.name} fg={state.cursor === visible.start + offset ? theme.orange : theme.fgMuted}>
            {`${state.cursor === visible.start + offset ? " ❯ " : "   "}${action.name.padEnd(12)}${action.description}`}
          </text>
        ))}
      </box>
      <box marginTop="auto"><text fg={theme.gray}>↑↓ move · ⏎ select · q / Esc cancel</text></box>
    </box>
  )
}

/** Open the standalone command's action picker. */
export async function pickUnquarantineAction(): Promise<UnquarantineAction | null> {
  const renderer = await createCliRenderer()
  setRenderer(renderer)
  return new Promise((resolve) => {
    createRoot(renderer).render(<UnquarantinePicker onDone={(action) => {
      clearRenderer(renderer)
      renderer.destroy()
      resolve(action)
    }} />)
  })
}
