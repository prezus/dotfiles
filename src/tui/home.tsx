// The dashboard — what bare `dotfiles` opens.
//
// Running `dotfiles` used to print a help page, which is what the bash did
// because it had no alternative. A TUI you have to remember a subcommand to
// reach isn't much of a TUI, so this is the front door: machine status at a
// glance, and every command one keypress away.
//
// Non-interactive callers still get the help text — see src/cli.ts. Scripts and
// pipes must never land in a full-screen app.
import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useCallback, useEffect, useState } from "react"
import { DoctorView } from "../commands/doctor/view.tsx"
import { countCriticalIssues, runChecks, type CompletedCheck } from "../commands/doctor/checks.ts"
import { VERSION } from "../lib/env.ts"
import { planStow, type StowPlan } from "../lib/stow.ts"
import { initialHomeState, reduceHomeKey } from "./interaction.ts"
import { setRenderer } from "./renderer.ts"
import { withSuspendedUI } from "./renderer.ts"
import { BOLD, theme } from "./theme.ts"

export type HomeCommand = {
  name: string
  description: string
  /** Runs line-oriented output; needs the terminal handed over. */
  run: () => Promise<number>
}

type Summary = {
  checks: CompletedCheck[] | null
  stow: StowPlan | null
}

export async function runHomeTui(commands: HomeCommand[]): Promise<number> {
  const renderer = await createCliRenderer()
  setRenderer(renderer)

  return await new Promise<number>((resolve) => {
    createRoot(renderer).render(
      <Home
        commands={commands}
        onExit={(code) => {
          renderer.destroy()
          resolve(code)
        }}
      />,
    )
  })
}

function Home({
  commands,
  onExit,
}: {
  commands: HomeCommand[]
  onExit: (code: number) => void
}) {
  const [state, setState] = useState(initialHomeState)
  const [summary, setSummary] = useState<Summary>({ checks: null, stow: null })
  const [status, setStatus] = useState("gathering status…")
  const [busy, setBusy] = useState(false)
  // Doctor is itself a full-screen view, so it swaps in place rather than being
  // launched as a child process — same renderer, no flicker.
  const [showDoctor, setShowDoctor] = useState(false)

  const names = commands.map((c) => c.name)

  const refresh = useCallback(() => {
    setSummary({ checks: null, stow: null })
    setStatus("gathering status…")
    void (async () => {
      const [checks, stow] = await Promise.all([runChecks(), planStow()])
      setSummary({ checks, stow })
      setStatus("")
    })()
  }, [])

  useEffect(refresh, [refresh])

  const runCommand = useCallback(
    async (name: string) => {
      if (busy) return
      if (name === "doctor") {
        setShowDoctor(true)
        return
      }
      const command = commands.find((c) => c.name === name)
      if (!command) return

      setBusy(true)
      setStatus(`running ${name}…`)
      try {
        // Hand the terminal over: these print line output, and some prompt.
        const code = await withSuspendedUI(async () => {
          const result = await command.run()
          // Give the output a beat to be read before the panel repaints over it.
          process.stdout.write("\n  ── press enter to return to dotfiles ──")
          for await (const _ of Bun.stdin.stream()) break
          return result
        })
        setStatus(`${name} exited ${code}`)
      } catch (error) {
        setStatus(`${name} failed: ${String(error)}`)
      } finally {
        setBusy(false)
        refresh()
      }
    },
    [busy, commands, refresh],
  )

  useKeyboard((key) => {
    if (busy || showDoctor) return
    const { state: next, intent } = reduceHomeKey(state, key, names)
    setState(next)
    if (intent.kind === "quit") onExit(0)
    else if (intent.kind === "refresh") refresh()
    else if (intent.kind === "run") void runCommand(intent.command)
  })

  if (showDoctor) {
    return (
      <DoctorView
        onExit={() => {
          setShowDoctor(false)
          refresh()
        }}
      />
    )
  }

  const { checks, stow } = summary
  const warnings = checks?.filter((c) => c.result.status === "warn").length ?? 0
  const failures = checks ? countCriticalIssues(checks) : 0

  const headline = !checks
    ? "checking…"
    : failures > 0
      ? `${failures} critical`
      : warnings > 0
        ? `${warnings} to review`
        : "all clear"

  const stat = (label: string, value: string, tone: string) => (
    <box flexDirection="row">
      <text fg={theme.fgMuted}>{`  ${label.padEnd(12)}`}</text>
      <text fg={tone}>{value}</text>
    </box>
  )

  return (
    <box flexDirection="column" padding={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.blue} attributes={BOLD}>
          {`dotfiles ${VERSION}`}
        </text>
        <text fg={failures > 0 ? theme.red : warnings > 0 ? theme.yellow : theme.green}>
          {headline}
        </text>
      </box>

      <box flexDirection="column" marginTop={1}>
        {stat(
          "health",
          checks ? `${checks.length} checks · ${warnings} warning(s)` : "…",
          warnings > 0 ? theme.yellow : theme.green,
        )}
        {stat(
          "stow",
          stow ? `${stow.ok.length} linked · ${stow.conflicts.length} conflict(s)` : "…",
          stow && stow.conflicts.length > 0 ? theme.red : theme.green,
        )}
        {stat(
          "reclaim",
          stow ? `${stow.reclaim.length} to take over` : "…",
          stow && stow.reclaim.length > 0 ? theme.yellow : theme.dim,
        )}
      </box>

      <box flexDirection="column" marginTop={1}>
        <text fg={theme.fg} attributes={BOLD}>
          commands
        </text>
        {commands.map((command, index) => {
          const active = index === Math.min(state.cursor, commands.length - 1)
          return (
            <box key={command.name} flexDirection="row">
              <text fg={active ? theme.orange : theme.bgSoft}>{active ? " ❯ " : "   "}</text>
              <text fg={active ? theme.fg : theme.fgMuted}>{command.name.padEnd(16)}</text>
              <text fg={theme.dim}>{command.description}</text>
            </box>
          )
        })}
      </box>

      <box marginTop={1} flexDirection="column">
        <text fg={theme.dim}>{"─".repeat(62)}</text>
        {status !== "" && <text fg={busy ? theme.orange : theme.gray}>{status}</text>}
        <text fg={theme.bgHard}>↑↓ nav · a-z jump · ⏎ run · r refresh · q quit</text>
      </box>
    </box>
  )
}
