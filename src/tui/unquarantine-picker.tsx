import { ActionPicker, pickAction } from "./action-picker.tsx"

const TITLE = "dotfiles unquarantine"
const NOTE = "Opt-in: removing quarantine bypasses a macOS download safety check."
const ACTIONS = [
  { name: "status", description: "Inspect config, read access, and quarantined files" },
  { name: "install", description: "Enable automatic quarantine removal" },
  { name: "uninstall", description: "Disable the agent; preserve config and logs" },
] as const

/** Explicit, mutually exclusive quarantine-agent operations. */
export type UnquarantineAction = (typeof ACTIONS)[number]["name"]

export function UnquarantinePicker({ onDone }: {
  onDone: (action: UnquarantineAction | null) => void
}) {
  return <ActionPicker title={TITLE} note={NOTE} actions={ACTIONS} onDone={onDone} />
}

/** Open the standalone command's action picker. */
export function pickUnquarantineAction(): Promise<UnquarantineAction | null> {
  return pickAction(TITLE, NOTE, ACTIONS)
}
