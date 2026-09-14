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
import { createRoot, useKeyboard, useRenderer, useSelectionHandler } from "@opentui/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { DoctorView } from "../commands/doctor/view.tsx"
import { countCriticalIssues, runChecks, type CompletedCheck } from "../commands/doctor/checks.ts"
import { UPDATE_TASKS, update } from "../commands/update.ts"
import { VERSION } from "../lib/env.ts"
import { setLogSink, setStepSink, setTerminalSink, type LogLevel, type StepEvent } from "../lib/ui.ts"
import { planStow, type StowPlan } from "../lib/stow.ts"
import {
  initialHomeState,
  initialOutputState,
  reduceHomeKey,
  reduceOutputKey,
} from "./interaction.ts"
import { copySelection, isCopyKey } from "./clipboard.ts"
import { hiddenCounts, windowFor, wrappedRows } from "./scroll.ts"
import { useTerminalSize } from "./use-terminal-size.ts"
import { FLUSH_MS, paneRows, statusBar } from "./output-pane.ts"
import { TerminalSession, type TerminalFrame, type TerminalRun } from "./terminal-session.ts"
import { clearRenderer, setRenderer } from "./renderer.ts"
import { BOLD, theme } from "./theme.ts"
import { Picker } from "./update-picker.tsx"
import { UnquarantinePicker } from "./unquarantine-picker.tsx"
import { unquarantine } from "../commands/unquarantine.ts"
import { ReconcilePicker, type ReconcileRow } from "./reconcile-picker.tsx"
import { applyReconcile, collectReconcileRows } from "../commands/reconcile.ts"

export type HomeCommand = {
  name: string
  description: string
  /** Runs with tool output rendered in the embedded terminal pane. */
  run: () => Promise<number>
}

type Summary = {
  checks: CompletedCheck[] | null
  stow: StowPlan | null
}

const EMPTY_TERMINAL_FRAME: TerminalFrame = { rows: [], scrollbackRows: 0 }
const terminalEncoder = new TextEncoder()

const LOG_STYLE = {
  header: { glyph: "▸", color: theme.blue },
  ok: { glyph: "✓", color: theme.green },
  warn: { glyph: "⚠", color: theme.yellow },
  error: { glyph: "✗", color: theme.red },
  info: { glyph: "ℹ", color: theme.aqua },
  raw: { glyph: "", color: theme.fgMuted },
} satisfies Record<LogLevel, { glyph: string; color: string }>

const ansiForeground = (hex: string): string => {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return `\x1b[38;2;${red};${green};${blue}m`
}

const writeLog = (session: TerminalSession, level: LogLevel, message: string): void => {
  const style = LOG_STYLE[level]
  const prefix = style.glyph === "" ? "" : `${style.glyph} `
  session.write(terminalEncoder.encode(`${ansiForeground(style.color)}${prefix}${message}\x1b[0m\r\n`))
}

function TerminalRunView({ run }: { run: TerminalRun }) {
  const foreground = run.foreground ?? theme.fgMuted
  const background = run.background ?? theme.bg
  const attributes = run.attributes ?? 0
  return run.hyperlink ? (
    <a href={run.hyperlink} fg={foreground} bg={background} attributes={attributes}>
      {run.text}
    </a>
  ) : (
    <span fg={foreground} bg={background} attributes={attributes}>
      {run.text}
    </span>
  )
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
  // Re-render and resize the embedded terminal when the window changes.
  const size = useTerminalSize()
  // Scroll anchor for the command list. A ref, not state: windowFor derives the
  // next start from the previous one, and storing it in state would re-render.
  const commandStartRef = useRef(0)
  const renderer = useRenderer()
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
  const [view, setView] = useState<"home" | "doctor" | "update" | "unquarantine" | "reconcile" | "output">("home")
  // Gathered BEFORE the picker mounts, because computing drift shells out to
  // `brew bundle dump` and a picker cannot render rows it does not have yet.
  const [reconcileRows, setReconcileRows] = useState<ReconcileRow[]>([])
  const [terminalFrame, setTerminalFrame] = useState<TerminalFrame>(EMPTY_TERMINAL_FRAME)
  const terminalRef = useRef<TerminalSession | null>(null)
  // Distance from the tail. Zero follows new output; anything else pins the
  // libghostty viewport while the command keeps writing.
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

  // The PTY feeds libghostty immediately, while React receives an immutable
  // cell snapshot at a bounded frame rate. This keeps query responses timely
  // without reconciling once per chunk during a noisy brew upgrade.
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const flushPending = useCallback(() => {
    setTick((t) => t + 1)
    if (stepRef.current !== null) {
      setStep(stepRef.current)
      stepRef.current = null
    }
    const session = terminalRef.current
    if (session) setTerminalFrame(session.snapshot())
  }, [])

  const stopFlushing = useCallback(() => {
    if (flushTimer.current !== null) clearInterval(flushTimer.current)
    flushTimer.current = null
  }, [])

  // A command still running when the app exits must release its native VT.
  useEffect(
    () => () => {
      stopFlushing()
      setTerminalSink(null)
      setLogSink(null)
      setStepSink(null)
      terminalRef.current?.close()
      terminalRef.current = null
    },
    [stopFlushing],
  )

  useEffect(() => {
    const session = terminalRef.current
    if (!session) return
    session.resize(Math.max(20, size.columns - 6), paneRows(size.rows))
    setTerminalFrame(session.snapshot())
  }, [size.columns, size.rows])

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

  // Ghostty's native selection is unavailable while OpenTUI owns the mouse.
  // Copy as soon as OpenTUI finishes a drag, then also support copy shortcuts
  // in terminals that forward them to the application.
  useSelectionHandler((selection) => {
    copySelection(selection, renderer)
  })

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
      stepRef.current = null
      startedAt.current = Date.now()
      terminalRef.current?.close()
      const session = new TerminalSession({
        columns: Math.max(20, size.columns - 6),
        rows: paneRows(size.rows),
        maxScrollback: 500,
      })
      terminalRef.current = session
      setTerminalFrame(session.snapshot())
      setOutputScroll(initialOutputState())
      setTick(0)
      setStep(null)
      setLabel(label)
      setView("output")
      setStatus(`running ${label}…`)
      setTerminalSink(session)
      setLogSink((level, message) => writeLog(session, level, message))
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
        setTerminalSink(null)
        setLogSink(null)
        setStepSink(null)
        stopFlushing()
        flushPending()
        setBusy(false)
      }
    },
    [flushPending, size.columns, size.rows, stopFlushing],
  )

  const runCommand = useCallback(
    async (name: string) => {
      if (busy) return
      // These are themselves full-screen; render them on this renderer.
      if (name === "doctor" || name === "update" || name === "unquarantine") {
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
    if (isCopyKey(key)) {
      const selection = renderer.getSelection()
      if (selection) copySelection(selection, renderer)
      return
    }

    // The output pane scrolls, so its bindings live in a reducer like every
    // other screen's rather than as an inline `if` that could only dismiss.
    if (view === "output") {
      const rows = paneRows(size.rows)
      const { state: next, intent } = reduceOutputKey(outputScroll, key, {
        maxOffset: terminalFrame.scrollbackRows,
        page: rows,
        busy,
      })
      setOutputScroll(next)
      if (next.offset !== outputScroll.offset) {
        terminalRef.current?.scrollToOffset(next.offset)
        const session = terminalRef.current
        if (session) setTerminalFrame(session.snapshot())
      }
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
    const rows = paneRows(size.rows)
    const above = Math.max(0, terminalFrame.scrollbackRows - outputScroll.offset)
    const below = outputScroll.offset
    const following = below === 0

    return (
      <box key="output" flexDirection="column" padding={1} flexGrow={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.blue} attributes={BOLD}>
            {status}
          </text>
          <text fg={theme.dim}>{above > 0 ? `↑ ${above} more` : ""}</text>
        </box>

        {/* libghostty supplies an exact cell grid, so cursor movement, colour,
            wide characters and redraws remain inside this fixed-height pane. */}
        <box flexDirection="column" marginTop={1} height={rows}>
          {terminalFrame.rows.map((row, rowIndex) => (
            <text key={rowIndex} selectable>
              {row.runs.map((run, runIndex) => (
                <TerminalRunView key={runIndex} run={run} />
              ))}
            </text>
          ))}
        </box>

        <box marginTop="auto" flexDirection="column">
          <text fg={theme.dim}>{rule}</text>
          <text fg={busy ? theme.orange : theme.bgHard}>
            {busy
              ? statusBar({
                  label,
                  tick,
                  elapsedMs: Date.now() - startedAt.current,
                  step,
                  columns: size.columns,
                })
              : "⏎ / q — back to dotfiles"}
          </text>
          <text fg={following ? theme.bgHard : theme.yellow}>
            {following
              ? "↑↓ scroll · PgUp/PgDn page · g top · drag copies"
              : `↓ ${below} more · G / End to follow again · drag copies`}
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

  if (view === "unquarantine") {
    return (
      <UnquarantinePicker onDone={(action) => {
        setView("home")
        if (action === null) {
          setStatus("unquarantine cancelled")
          return
        }
        void runInPane(`unquarantine ${action}`, () => unquarantine([action]))
      }} />
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

  // Chrome around the command list, counted at its WORST case: padding 2,
  // title 1, stats 4, "commands" header 2, and a footer of rule + scroll
  // indicator + status + hints = 4. Budgeting the common case instead would
  // overflow by a row exactly when a command is running (status shown) on a
  // list long enough to scroll — i.e. only under load.
  const viewport = Math.max(3, size.rows - 13)
  const cursor = Math.min(state.cursor, commands.length - 1)
  // A command row is `❯ name<pad to 16> description`, and a long description
  // wraps on a narrow terminal — windowFor budgets one row each, so cap the
  // count by the widest row's real height rather than letting it overflow.
  const widest = commands.reduce(
    (n, c) => Math.max(n, wrappedRows(`${c.name.padEnd(16)}${c.description}`, size.columns - 4, 3)),
    1,
  )
  const rowWindow = windowFor(
    commandStartRef.current,
    commands.length,
    cursor,
    Math.max(3, Math.floor(viewport / widest)),
  )
  commandStartRef.current = rowWindow.start
  const { above, below } = hiddenCounts(rowWindow, commands.length)

  return (
    <box key="home" flexDirection="column" padding={1} flexGrow={1}>
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
        {commands.slice(rowWindow.start, rowWindow.end).map((command, offset) => {
          const active = rowWindow.start + offset === cursor
          return (
            <box key={command.name} flexDirection="row">
              <text fg={active ? theme.orange : theme.bgSoft}>{active ? " ❯ " : "   "}</text>
              <text fg={active ? theme.fg : theme.fgMuted}>{command.name.padEnd(16)}</text>
              <text fg={theme.dim}>{command.description}</text>
            </box>
          )
        })}
      </box>

      <box marginTop="auto" flexDirection="column">
        <text fg={theme.dim}>{rule}</text>
        {(above > 0 || below > 0) && (
          <text fg={theme.dim}>
            {[above > 0 ? `↑ ${above} above` : null, below > 0 ? `↓ ${below} below` : null]
              .filter((s) => s !== null)
              .join(" · ")}
          </text>
        )}
        {status !== "" && <text fg={busy ? theme.orange : theme.gray}>{status}</text>}
        <text fg={theme.bgHard}>↑↓ nav · a-z jump · ⏎ run · r refresh · q quit</text>
      </box>
    </box>
  )
}
