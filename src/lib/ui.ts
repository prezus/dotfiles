import { readSync } from "node:fs"
import type { StepState } from "./steps.ts"
import { withTerminal } from "./terminal.ts"

// Line-oriented output. Mirrors the bash print_* helpers byte-for-byte so the
// Phase 1 parity gate is meaningful, but adds what bash never had: the original
// emitted raw ANSI unconditionally, even when piped or redirected.

const FORCE = process.env.FORCE_COLOR === "1"
const PLAIN =
  FORCE
    ? false
    : process.env.NO_COLOR !== undefined ||
      process.env.TERM === "dumb" ||
      process.env.CI !== undefined ||
      process.argv.includes("--plain")

/** True when we may draw a full-screen TUI: a real tty and not explicitly plain. */
export const isInteractive = (): boolean => Boolean(process.stdout.isTTY) && !PLAIN

const sgr = (code: string) => (PLAIN || !process.stdout.isTTY ? "" : `\x1b[${code}m`)

export const RED = sgr("0;31")
export const GREEN = sgr("0;32")
export const YELLOW = sgr("0;33")
export const BLUE = sgr("0;34")
export const CYAN = sgr("0;36")
export const RESET = sgr("0")
export const BOLD = sgr("1")

export type LogLevel = "header" | "ok" | "warn" | "error" | "info" | "raw"

/**
 * Where print* output goes. Normally stdout; the TUI swaps in a sink so command
 * output can be rendered inside a pane instead of the CLI having to drop out of
 * the full-screen view to print a few lines.
 *
 * This is the same seam as checks-as-data: the commands emit values, and the
 * caller decides how they are shown. All 166 print* call sites are unaffected.
 */
export type LogSink = (level: LogLevel, message: string, opts?: LogOptions) => void

/**
 * `transient` marks a line the child is still redrawing — a download bar mid-
 * flight. It supersedes the previous transient rather than stacking below it,
 * so a two-minute `brew upgrade` leaves one live line instead of a thousand
 * dead frames. Consumers that don't care may ignore it and simply append.
 */
export type LogOptions = { transient?: boolean }

let sink: LogSink | null = null

export const setLogSink = (next: LogSink | null): void => {
  sink = next
}

/** Whether output is being captured for a UI rather than written to stdout. */
export const getLogSink = (): LogSink | null => sink

/**
 * Structured step progress for a status bar; latest event wins.
 *
 * A separate channel from LogSink on purpose: step state is not a log line, and
 * smuggling it through one would force the UI to parse back what the command
 * just serialized. Same seam, different shape.
 */
export type StepEvent = { index: number; total: number; title: string; state: StepState }

export type StepSink = (event: StepEvent) => void

let stepSink: StepSink | null = null

export const setStepSink = (next: StepSink | null): void => {
  stepSink = next
}

export const getStepSink = (): StepSink | null => stepSink

const emit = (level: LogLevel, message: string, formatted: string, opts?: LogOptions): void => {
  if (sink) {
    sink(level, message, opts)
    return
  }
  if (level === "error") console.error(formatted)
  else console.log(formatted)
}

export const printHeader = (msg: string): void =>
  emit("header", msg, `\n${BOLD}${BLUE}==>${RESET} ${BOLD}${msg}${RESET}`)
export const printSuccess = (msg: string): void => emit("ok", msg, `${GREEN}✓${RESET} ${msg}`)
export const printError = (msg: string): void => emit("error", msg, `${RED}✗${RESET} ${msg}`)
export const printWarning = (msg: string): void => emit("warn", msg, `${YELLOW}⚠${RESET} ${msg}`)
export const printInfo = (msg: string): void => emit("info", msg, `${CYAN}ℹ${RESET} ${msg}`)
/** Sink-aware output with no status glyph, for progress and indented detail lines. */
export const printRaw = (msg: string): void => emit("raw", msg, msg)

/**
 * What the user typed, resolved against the default. Pure, so the y/n/empty
 * grid is testable without a terminal.
 *
 * `null` means the read failed or hit EOF, which resolves to the default for
 * the same reason a non-interactive caller does — and every gate that uses this
 * defaults to "no", so a failed read can never widen a blast radius.
 */
export function interpretAnswer(raw: string | null, defaultYes: boolean): boolean {
  if (raw === null) return defaultYes
  const answer = raw.trim().toLowerCase()
  if (answer === "") return defaultYes
  return answer === "y" || answer === "yes"
}

/**
 * Read one line from fd 0, blocking.
 *
 * Deliberately NOT `Bun.stdin.stream()`. That is a single process-global
 * ReadableStream, and OpenTUI's CliRenderer acquires a reader on it for key
 * handling which `renderer.destroy()` does NOT release — it restores raw mode
 * and leaves the lock. Any second consumer in a process that has ever mounted a
 * TUI then dies on `Invalid state: ReadableStream is locked`.
 *
 * That is not hypothetical: it is what `dotfiles reconcile` did at its uninstall
 * gate. The picker closes, `clearRenderer` correctly unregisters the suspend
 * handler, `withTerminal` is a clean passthrough by then — and the confirm still
 * broke, one level below all of that, because the stream was still locked. The
 * prompt printed, the keypress went nowhere, and the untap never ran.
 *
 * A plain descriptor read shares no such state. Blocking is also the honest
 * semantics for a gate that has nothing else to do until it is answered.
 */
function readLineSync(): string | null {
  const buf = Buffer.alloc(64)
  try {
    return buf.subarray(0, readSync(0, buf, 0, buf.length, null)).toString()
  } catch {
    // EAGAIN if something left the descriptor non-blocking, or EOF mid-read.
    return null
  }
}

/**
 * Yes/no prompt — the port of bash `confirm()`. Non-interactive callers get the
 * default rather than a hang, which the bash version would not have survived.
 */
export async function confirm(prompt = "Continue?", defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n]: " : " [y/N]: "
  if (!process.stdin.isTTY) return defaultYes

  // Must go through withTerminal for the same reason a sudo child does: when a
  // TUI is mounted it owns stdin for its key handling, so a raw read here never
  // receives the keypress and the app hangs. Suspending hands stdin back for the
  // duration of the question.
  return await withTerminal(async () => {
    process.stdout.write(prompt + suffix)
    return interpretAnswer(readLineSync(), defaultYes)
  })
}
