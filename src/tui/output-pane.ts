// How a command's output is turned into pane rows.
//
// Kept out of home.tsx for the same reason interaction.ts is: this is the part
// with rules worth testing, and a test should not have to stand up a renderer
// to reach it.
import type { LogLevel, StepEvent } from "../lib/ui.ts"
import { theme } from "./theme.ts"

export type LogEntry = { level: LogLevel; message: string; transient?: boolean }

/**
 * How often the pane is allowed to redraw, in ms.
 *
 * `brew upgrade` emits hundreds of lines a second. Rendering each one meant a
 * full React reconcile per line, which strobed and made the text unreadable.
 * Coalescing into ~11 frames a second costs nothing in fidelity — no one can
 * read faster than that — and is the difference between a flicker and a list.
 */
export const FLUSH_MS = 90

/**
 * Lines retained for scrollback. Only `paneRows()` are ever drawn, but the
 * count feeds the "+N above" indicator. Bounded because `appendLog` copies the
 * array, so an unbounded history turns a long upgrade into O(n²) copying —
 * which is itself a source of jank.
 */
export const MAX_HISTORY = 500

const SECTION = "==> "

/** Homebrew, git and rustup all mark a new phase of work with `==>`. */
export const isSection = (line: LogEntry): boolean =>
  line.level === "raw" && line.message.startsWith(SECTION)

/**
 * The section heading to pin above the visible rows, or null if one is already
 * on screen. Without this a fast scroll shows detail with no clue which package
 * it belongs to — the header scrolled off seconds ago.
 */
export function pinnedSection(lines: LogEntry[], visibleCount: number): string | null {
  const firstVisible = Math.max(0, lines.length - visibleCount)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line || !isSection(line)) continue
    return i >= firstVisible ? null : line.message.slice(SECTION.length)
  }
  return null
}

/** Output rows kept on screen, leaving room for the header, rule and footer. */
export const paneRows = (rows = process.stdout.rows): number =>
  Math.max(8, Math.min(24, (rows ?? 30) - 8))

/** One entry must occupy exactly one row — a wrapped line breaks the column. */
export const truncate = (text: string, columns = process.stdout.columns): string => {
  const width = Math.max(20, (columns ?? 80) - 6)
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

const STATUS_STYLE = {
  header: { glyph: "▸", fg: theme.blue },
  ok: { glyph: "✓", fg: theme.green },
  warn: { glyph: "⚠", fg: theme.yellow },
  error: { glyph: "✗", fg: theme.red },
  info: { glyph: "ℹ", fg: theme.aqua },
  raw: { glyph: " ", fg: theme.fgMuted },
} as const

/**
 * Add a line, collapsing a redraw onto the row it supersedes.
 *
 * A child redrawing one line with carriage returns — every download bar — must
 * occupy ONE row, not one per frame, or a single `brew upgrade` pushes all its
 * real output off the top. The committed line then replaces the frames that
 * were drawing it, so the finished value is what remains.
 *
 * Only the child's own output (`raw`) may replace the live frame — it comes
 * from the same single cursor, so it IS that line finishing. One of our status
 * messages landing mid-download is unrelated; it slots in above so the bar
 * doesn't vanish for a frame and reappear.
 */
export function appendLog(previous: LogEntry[], entry: LogEntry): LogEntry[] {
  const last = previous[previous.length - 1]
  if (!last?.transient) return [...previous, entry]
  if (entry.transient === true || entry.level === "raw") return [...previous.slice(0, -1), entry]
  return [...previous.slice(0, -1), entry, last]
}

export type PaneState = { lines: LogEntry[]; dropped: number }

export const emptyPane: PaneState = { lines: [], dropped: 0 }

/**
 * Fold one buffered batch into the pane, bounding the retained history.
 *
 * `dropped` is carried so the "+N above" indicator stays honest once lines have
 * been discarded — a pane that quietly forgets output reads as one that never
 * received it.
 */
export function mergeBatch(state: PaneState, batch: LogEntry[]): PaneState {
  let lines = batch.reduce(appendLog, state.lines)
  let dropped = state.dropped
  if (lines.length > MAX_HISTORY) {
    dropped += lines.length - MAX_HISTORY
    lines = lines.slice(-MAX_HISTORY)
  }
  return { lines, dropped }
}

/**
 * How one line is drawn.
 *
 * Our own status messages (printSuccess and friends) keep their glyph. A child's
 * output arrives as `raw` and is classified here instead, because brew, git and
 * rustup all mark sections with `==>` and prefix problems with `Warning:` or
 * `Error:` — honouring those conventions preserves the structure the tool
 * intended. Tagging child output `info` (what this used to do) stamped a bullet
 * on every line and flattened brew's aligned tables into identical rows.
 */
/** How one pane line is drawn: its marker, its colour, and the text after truncation. */
export type LineStyle = { glyph: string; fg: string; text: string }

export function styleFor(line: LogEntry, columns?: number): LineStyle {
  const text = truncate(line.message, columns)
  if (line.level !== "raw") return { ...STATUS_STYLE[line.level], text }
  // Homebrew's own section marker becomes the pane's.
  if (text.startsWith("==> ")) return { glyph: "▸", fg: theme.fg, text: text.slice(4) }
  if (/^warning:/i.test(text)) return { glyph: "⚠", fg: theme.yellow, text }
  if (/^error:/i.test(text)) return { glyph: "✗", fg: theme.red, text }
  // Still being redrawn: dimmed, because it is progress rather than a result.
  return { glyph: " ", fg: line.transient ? theme.dim : theme.fgMuted, text }
}

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

export const spinnerFrame = (tick: number): string =>
  SPINNER_FRAMES[tick % SPINNER_FRAMES.length] as string

/** "0:07", "1:23", "1:01:07" — seconds resolution, so the bar doesn't jitter. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const mmss = `${minutes}:${String(seconds).padStart(2, "0")}`
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : mmss
}

/**
 * What the child is doing right now: the line it is still redrawing, else the
 * most recent section heading, else nothing. This is what makes the status bar
 * say "Downloading node-…" during the long quiet stretches.
 */
export function currentActivity(lines: LogEntry[]): string | null {
  const last = lines[lines.length - 1]
  if (last?.transient) return last.message
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line && isSection(line)) return line.message.slice(SECTION.length)
  }
  return null
}

/**
 * The footer while a command runs:
 *
 *   ⠹ update · 1:23 · [2/5] Homebrew packages · Downloading node-26.5.1…
 *
 * Every segment is optional except the spinner and label; the step shows only
 * while it is actually running. One row, truncated like every other pane line.
 */
export function statusBar(args: {
  label: string
  tick: number
  elapsedMs: number
  step: StepEvent | null
  activity: string | null
  columns?: number
}): string {
  const segments = [
    `${spinnerFrame(args.tick)} ${args.label}`,
    formatElapsed(args.elapsedMs),
    args.step && args.step.state === "running"
      ? `[${args.step.index + 1}/${args.step.total}] ${args.step.title}`
      : null,
    args.activity,
  ]
  return truncate(segments.filter((s): s is string => s !== null).join(" · "), args.columns)
}
