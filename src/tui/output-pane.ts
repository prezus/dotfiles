import type { StepEvent } from "../lib/ui.ts"

/** Maximum React redraw rate while a child PTY is noisy. */
export const FLUSH_MS = 90

/** Rows available to the embedded terminal after dashboard chrome. */
export const paneRows = (rows = process.stdout.rows): number =>
  Math.max(3, (rows ?? 30) - 8)

/** Keep dashboard status text on one terminal row. */
export const truncate = (text: string, columns = process.stdout.columns): string => {
  const width = Math.max(20, (columns ?? 80) - 6)
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

/** Spinner frames used by the command status bar. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

/** Return the spinner glyph for a monotonically increasing tick. */
export const spinnerFrame = (tick: number): string =>
  SPINNER_FRAMES[tick % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0]

/** Format elapsed milliseconds as `m:ss` or `h:mm:ss`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const mmss = `${minutes}:${String(seconds).padStart(2, "0")}`
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : mmss
}

/** Compose the one-row status shown below the embedded terminal. */
export function statusBar(args: {
  label: string
  tick: number
  elapsedMs: number
  step: StepEvent | null
  columns?: number
}): string {
  const segments = [
    `${spinnerFrame(args.tick)} ${args.label}`,
    formatElapsed(args.elapsedMs),
    args.step && args.step.state === "running"
      ? `[${args.step.index + 1}/${args.step.total}] ${args.step.title}`
      : null,
  ]
  return truncate(segments.filter((segment): segment is string => segment !== null).join(" · "), args.columns)
}
