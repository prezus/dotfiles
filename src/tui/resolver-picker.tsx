import { useEffect, useState } from "react"
import { RESOLVER_INSTALLER } from "../lib/env.ts"
import { probe } from "../lib/exec.ts"
import { ActionPicker, pickAction } from "./action-picker.tsx"

const TITLE = "dotfiles resolver"
const NOTE = "Opt-in: writes /etc/resolver (sudo) and turns Tailscale DNS off so Twingate keeps the default resolver."
const ACTIONS = [
  { name: "install", description: "Homelab domains → CoreDNS, tailnet → MagicDNS; Tailscale DNS off" },
  { name: "uninstall", description: "Remove the managed files; Tailscale DNS on again" },
] as const

export type ResolverAction = (typeof ACTIONS)[number]["name"]

/** The status is read-only (no sudo), so the menu opens on it instead of offering it. */
async function readStatus(): Promise<string[]> {
  const result = await probe(["/bin/bash", RESOLVER_INSTALLER, "status"])
  const lines = result.stdout.trimEnd().split("\n").filter((line) => line !== "")
  return lines.length > 0 ? lines : ["status unavailable"]
}

export function ResolverPicker({ onDone }: { onDone: (action: ResolverAction | null) => void }) {
  const [status, setStatus] = useState<string[]>(["reading status…"])
  useEffect(() => {
    void readStatus().then(setStatus)
  }, [])
  return <ActionPicker title={TITLE} note={NOTE} detail={status} actions={ACTIONS} onDone={onDone} />
}

export async function pickResolverAction(): Promise<ResolverAction | null> {
  return pickAction(TITLE, NOTE, ACTIONS, await readStatus())
}
