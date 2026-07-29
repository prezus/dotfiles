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
import { UPDATE_TASKS, update } from "../commands/update.ts"
import { VERSION } from "../lib/env.ts"
import { setLogSink, type LogLevel } from "../lib/ui.ts"
import { planStow, type StowPlan } from "../lib/stow.ts"
import { initialHomeState, reduceHomeKey } from "./interaction.ts"
import { clearRenderer, setRenderer } from "./renderer.ts"
import { BOLD, theme } from "./theme.ts"
import { Picker } from "./update-picker.tsx"

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
          clearRenderer(renderer)
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

  // Commands that are themselves full-screen swap in ON THIS RENDERER rather
  // than standing up their own. Letting them create a second CliRenderer meant
  // four alternate-screen transitions per invocation — suspend, new renderer
  // enters, destroy, resume — which reads as a flash. Worse, the second
  // renderer overwrote the global in setRenderer(), so afterwards
  // withSuspendedUI pointed at a destroyed renderer.
  const [view, setView] = useState<"home" | "doctor" | "update" | "output">("home")
  const [logs, setLogs] = useState<{ level: LogLevel; message: string }[]>([])

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

  /**
   * EVERY command runs here, in the pane. There is deliberately no list of
   * "commands that take the screen" any more — that was the wrong granularity.
   * `init` runs ten steps and only the Homebrew installer wants a password, so
   * classifying the whole command meant dropping out of the app for the other
   * nine. exec.ts now suspends around the individual CHILD that needs stdin
   * (see lib/terminal.ts), so the screen changes hands for a password prompt
   * and comes straight back.
   */
  const runInPane = useCallback(
    async (label: string, run: () => Promise<number>) => {
      setBusy(true)
      setLogs([])
      setView("output")
      setStatus(`running ${label}…`)
      setLogSink((level, message) => setLogs((prev) => [...prev, { level, message }]))
      try {
        const code = await run()
        setStatus(`${label} exited ${code}`)
      } catch (error) {
        setStatus(`${label} failed: ${String(error)}`)
      } finally {
        setLogSink(null)
        setBusy(false)
      }
    },
    [],
  )

  const runCommand = useCallback(
    async (name: string) => {
      if (busy) return
      // These two are themselves full-screen; render them on this renderer.
      if (name === "doctor" || name === "update") {
        setView(name)
        return
      }
      const command = commands.find((c) => c.name === name)
      if (!command) return
      await runInPane(name, () => command.run())
    },
    [busy, commands, runInPane],
  )

  useKeyboard((key) => {
    // The output pane has its own tiny binding: anything dismisses it once the
    // command has finished.
    if (view === "output") {
      if (!busy && (key.name === "q" || key.name === "escape" || key.name === "return")) {
        setView("home")
        refresh()
      }
      return
    }
    // While a sub-view is mounted it owns the keyboard; ours must stay quiet or
    // both handlers fire on the same keypress.
    if (busy || view !== "home") return
    const { state: next, intent } = reduceHomeKey(state, key, names)
    setState(next)
    if (intent.kind === "quit") onExit(0)
    else if (intent.kind === "refresh") refresh()
    else if (intent.kind === "run") void runCommand(intent.command)
  })

  if (view === "doctor") {
    return (
      <DoctorView
        onExit={() => {
          setView("home")
          refresh()
        }}
      />
    )
  }

  if (view === "output") {
    const tone: Record<LogLevel, string> = {
      header: theme.blue,
      ok: theme.green,
      warn: theme.yellow,
      error: theme.red,
      info: theme.aqua,
      raw: theme.fgMuted,
    }
    const glyph: Record<LogLevel, string> = {
      header: "▸",
      ok: "✓",
      warn: "⚠",
      error: "✗",
      info: "ℹ",
      raw: " ",
    }
    // Keep the tail visible rather than the head — the interesting part of a
    // command's output is almost always the end.
    const shown = logs.slice(-24)

    return (
      <box flexDirection="column" padding={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.blue} attributes={BOLD}>
            {status}
          </text>
          <text fg={theme.dim}>{logs.length > shown.length ? `+${logs.length - shown.length} above` : ""}</text>
        </box>

        <box flexDirection="column" marginTop={1}>
          {shown.map((line, index) => (
            <box key={index} flexDirection="row">
              <text fg={tone[line.level]}>{` ${glyph[line.level]} `}</text>
              <text fg={line.level === "header" ? theme.fg : theme.fgMuted}>{line.message}</text>
            </box>
          ))}
        </box>

        <box marginTop={1} flexDirection="column">
          <text fg={theme.dim}>{"─".repeat(62)}</text>
          <text fg={theme.bgHard}>{busy ? "running…" : "⏎ / q — back to dotfiles"}</text>
        </box>
      </box>
    )
  }

  if (view === "update") {
    return (
      <Picker
        tasks={UPDATE_TASKS}
        onDone={(picked) => {
          setView("home")
          if (picked === null) {
            setStatus("update cancelled")
            return
          }
          if (picked.size === 0) {
            setStatus("nothing selected")
            return
          }
          // The selection is already made, so pass it through explicitly —
          // update() must not open a picker of its own.
          void runInPane("update", () => update([`--only=${[...picked].join(",")}`]))
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
