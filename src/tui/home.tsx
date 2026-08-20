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
import { useCallback, useEffect, useRef, useState } from "react"
import { DoctorView } from "../commands/doctor/view.tsx"
import { countCriticalIssues, runChecks, type CompletedCheck } from "../commands/doctor/checks.ts"
import { UPDATE_TASKS, update } from "../commands/update.ts"
import { VERSION } from "../lib/env.ts"
import { setLogSink, setStepSink, type StepEvent } from "../lib/ui.ts"
import { planStow, type StowPlan } from "../lib/stow.ts"
import {
  initialHomeState,
  initialOutputState,
  reduceHomeKey,
  reduceOutputKey,
} from "./interaction.ts"
import { hiddenCounts, maxOffset, tailWindow } from "./scroll.ts"
import { useTerminalSize } from "./use-terminal-size.ts"
import {
  currentActivity,
  emptyPane,
  FLUSH_MS,
  mergeBatch,
  paneRows,
  pinnedSection,
  statusBar,
  styleFor,
  type LogEntry,
  type PaneState,
} from "./output-pane.ts"
import { clearRenderer, setRenderer } from "./renderer.ts"
import { BOLD, theme } from "./theme.ts"
import { Picker } from "./update-picker.tsx"
import { ReconcilePicker, type ReconcileRow } from "./reconcile-picker.tsx"
import { applyReconcile, collectReconcileRows } from "../commands/reconcile.ts"

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
  // Re-renders the whole dashboard when the window changes size, which is what
  // makes paneRows/truncate recompute — they always read the terminal, but
  // nothing used to tell React that the answer had changed.
  const size = useTerminalSize()
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
  const [view, setView] = useState<"home" | "doctor" | "update" | "reconcile" | "output">("home")
  // Gathered BEFORE the picker mounts, because computing drift shells out to
  // `brew bundle dump` and a picker cannot render rows it does not have yet.
  const [reconcileRows, setReconcileRows] = useState<ReconcileRow[]>([])
  const [output, setOutput] = useState<PaneState>(emptyPane)
  // Distance from the tail. Zero follows new output; anything else pins the
  // window while the command keeps writing above it.
  const [outputScroll, setOutputScroll] = useState(initialOutputState)

  // The status bar's clock. Bumped on every flush — including empty ones — so
  // the spinner and elapsed time keep moving while brew compiles in silence.
  // Without it the pane only redrew when the child produced bytes, and a quiet
  // 30-second pour looked exactly like a hang.
  const [tick, setTick] = useState(0)
  const [step, setStep] = useState<StepEvent | null>(null)
  const [label, setLabel] = useState("")
  const startedAt = useRef(0)
  const stepRef = useRef<StepEvent | null>(null)

  // Output is buffered here and drained on a timer. Writing straight to state
  // meant one React reconcile per line of child output, which at brew's output
  // rate strobed the pane instead of filling it.
  const pending = useRef<LogEntry[]>([])
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const flushPending = useCallback(() => {
    setTick((t) => t + 1)
    if (stepRef.current !== null) {
      setStep(stepRef.current)
      stepRef.current = null
    }
    if (pending.current.length === 0) return
    const batch = pending.current
    pending.current = []
    setOutput((prev) => mergeBatch(prev, batch))
  }, [])

  const stopFlushing = useCallback(() => {
    if (flushTimer.current !== null) clearInterval(flushTimer.current)
    flushTimer.current = null
  }, [])

  // A command still running when the app exits must not leave a timer behind.
  useEffect(() => stopFlushing, [stopFlushing])

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
  // Horizontal rules used to be `"─".repeat(62)`, which is a rule for exactly
  // one terminal width: short of the edge on a wide window, wrapped onto a
  // second row on a narrow one — and a wrapped rule pushes the footer off the
  // bottom of the screen.
  const rule = "─".repeat(Math.max(10, size.columns - 4))

  const runInPane = useCallback(
    async (label: string, run: () => Promise<number>) => {
      setBusy(true)
      pending.current = []
      stepRef.current = null
      startedAt.current = Date.now()
      setOutput(emptyPane)
      setOutputScroll(initialOutputState())
      setTick(0)
      setStep(null)
      setLabel(label)
      setView("output")
      setStatus(`running ${label}…`)
      setLogSink((level, message, opts) => {
        pending.current.push({ level, message, transient: opts?.transient === true })
      })
      setStepSink((event) => {
        stepRef.current = event
      })
      flushTimer.current = setInterval(flushPending, FLUSH_MS)
      try {
        const code = await run()
        setStatus(`${label} exited ${code}`)
      } catch (error) {
        setStatus(`${label} failed: ${String(error)}`)
      } finally {
        setLogSink(null)
        setStepSink(null)
        stopFlushing()
        flushPending() // whatever arrived inside the last window
        setBusy(false)
      }
    },
    [flushPending, stopFlushing],
  )

  const runCommand = useCallback(
    async (name: string) => {
      if (busy) return
      // These are themselves full-screen; render them on this renderer.
      if (name === "doctor" || name === "update") {
        setView(name)
        return
      }
      // Same, but its rows have to be computed first — and if there is no drift
      // there is nothing to pick, so say so rather than opening an empty picker.
      if (name === "reconcile") {
        setBusy(true)
        setStatus("reading installed packages…")
        try {
          const rows = await collectReconcileRows()
          if (rows === null) {
            setStatus("reconcile: could not read brew state")
            return
          }
          if (rows.length === 0) {
            setStatus("no drift — machine matches packages/bundle")
            return
          }
          setReconcileRows(rows)
          setView("reconcile")
        } finally {
          setBusy(false)
        }
        return
      }
      const command = commands.find((c) => c.name === name)
      if (!command) return
      await runInPane(name, () => command.run())
    },
    [busy, commands, runInPane],
  )

  useKeyboard((key) => {
    // The output pane scrolls, so its bindings live in a reducer like every
    // other screen's rather than as an inline `if` that could only dismiss.
    if (view === "output") {
      const rows = paneRows(size.rows)
      const { state: next, intent } = reduceOutputKey(outputScroll, key, {
        maxOffset: maxOffset(output.lines.length, rows),
        page: rows,
        busy,
      })
      setOutputScroll(next)
      if (intent.kind === "dismiss") {
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

  // The root boxes of the output and home views carry explicit keys. Both are
  // plain <box> elements in the same tree position, so without keys React
  // reconciles one INTO the other on a view switch instead of remounting — and
  // OpenTUI keeps stale layout from the old subtree: the pane's fixed-height
  // box lived on as a phantom gap and the footer rows collapsed onto the rule.
  // The keys force a real unmount/mount, which is also what the doctor and
  // update views get for free by being different component types.

  if (view === "output") {
    // Keep the tail visible rather than the head — the interesting part of a
    // command's output is almost always the end. Fixed count, not a slice that
    // grows: a pane that changes height as output arrives drags the footer down
    // the screen on every line, which reads as flicker.
    const rows = paneRows(size.rows)
    const pinned = pinnedSection(output.lines, rows - 1)
    // The pin costs a row, so the viewport shrinks by one when it is showing.
    const viewport = pinned === null ? rows : rows - 1
    const paneWindow = tailWindow(output.lines.length, outputScroll.offset, viewport)
    const shown = output.lines.slice(paneWindow.start, paneWindow.end)
    const { above, below } = hiddenCounts(paneWindow, output.lines.length, output.dropped)
    const following = below === 0

    return (
      <box key="output" flexDirection="column" padding={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.blue} attributes={BOLD}>
            {status}
          </text>
          <text fg={theme.dim}>{above > 0 ? `↑ ${above} more` : ""}</text>
        </box>

        {/* Fixed height, not a box that grows with the output: a pane that
            changes size drags the rule and footer down the screen on every
            batch, which is most of what read as jumping. */}
        <box flexDirection="column" marginTop={1} height={rows}>
          {pinned !== null && (
            <box flexDirection="row">
              <text fg={theme.dim}>{" ▸ "}</text>
              <text fg={theme.dim}>{pinned}</text>
            </box>
          )}
          {shown.map((line, index) => {
            const { glyph, fg, text } = styleFor(line, size.columns)
            return (
              <box key={index} flexDirection="row">
                <text fg={fg}>{` ${glyph} `}</text>
                <text fg={fg}>{text}</text>
              </box>
            )
          })}
        </box>

        <box marginTop={1} flexDirection="column">
          <text fg={theme.dim}>{rule}</text>
          <text fg={busy ? theme.orange : theme.bgHard}>
            {busy
              ? statusBar({
                  label,
                  tick,
                  elapsedMs: Date.now() - startedAt.current,
                  step,
                  activity: currentActivity(output.lines),
                  columns: size.columns,
                })
              : "⏎ / q — back to dotfiles"}
          </text>
          {/* Only worth a row once there is something below to go back to.
              While following, the pane behaves exactly as it always did. */}
          <text fg={following ? theme.bgHard : theme.yellow}>
            {following
              ? "↑↓ scroll · PgUp/PgDn page · g top"
              : `↓ ${below} more · G / End to follow again`}
          </text>
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

  if (view === "reconcile") {
    return (
      <ReconcilePicker
        rows={reconcileRows}
        onDone={(chosen) => {
          setView("home")
          if (chosen === null) {
            setStatus("reconcile cancelled")
            return
          }
          // The picker has unmounted, so this renderer is free again and the
          // uninstalls' sudo prompts can suspend it properly. applyReconcile
          // must not open a picker of its own — same contract as update().
          void runInPane("reconcile", () => applyReconcile(reconcileRows, chosen))
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
    <box key="home" flexDirection="column" padding={1}>
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
        <text fg={theme.dim}>{rule}</text>
        {status !== "" && <text fg={busy ? theme.orange : theme.gray}>{status}</text>}
        <text fg={theme.bgHard}>↑↓ nav · a-z jump · ⏎ run · r refresh · q quit</text>
      </box>
    </box>
  )
}
