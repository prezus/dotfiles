import { TextAttributes } from "@opentui/core"
import {
  RenderState,
  Terminal,
  type CellStyle,
  type PaletteIndex,
  type RGB,
  type TerminalColors,
} from "libghostty-vt"

/** A contiguous piece of terminal text with one visual style. */
export type TerminalRun = {
  readonly text: string
  readonly foreground?: string
  readonly background?: string
  readonly attributes?: number
  readonly hyperlink?: string
}

/** One row from the terminal's current viewport. */
export type TerminalRow = {
  readonly runs: ReadonlyArray<TerminalRun>
}

/** Immutable viewport data suitable for rendering with OpenTUI. */
export type TerminalFrame = {
  readonly rows: ReadonlyArray<TerminalRow>
  readonly scrollbackRows: number
}

/** Construction options for an embedded terminal session. */
export type TerminalSessionOptions = {
  readonly columns: number
  readonly rows: number
  readonly maxScrollback?: number
}

type RunStyle = Omit<TerminalRun, "text">

const toHex = (color: RGB): string =>
  `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`

const isPaletteIndex = (color: RGB | PaletteIndex): color is PaletteIndex => "palette" in color

const resolveColor = (
  color: RGB | PaletteIndex | undefined,
  palette: ReadonlyArray<RGB>,
): string | undefined => {
  if (color === undefined) return undefined
  if (!isPaletteIndex(color)) return toHex(color)
  const rgb = palette[color.palette]
  return rgb ? toHex(rgb) : undefined
}

const textAttributes = (style: CellStyle | undefined): number | undefined => {
  if (!style) return undefined
  let attributes = TextAttributes.NONE
  if (style.bold) attributes |= TextAttributes.BOLD
  if (style.faint) attributes |= TextAttributes.DIM
  if (style.italic) attributes |= TextAttributes.ITALIC
  if (style.underline !== "none") attributes |= TextAttributes.UNDERLINE
  if (style.blink) attributes |= TextAttributes.BLINK
  if (style.inverse) attributes |= TextAttributes.INVERSE
  if (style.invisible) attributes |= TextAttributes.HIDDEN
  if (style.strikethrough) attributes |= TextAttributes.STRIKETHROUGH
  return attributes === TextAttributes.NONE ? undefined : attributes
}

const runStyle = (
  style: CellStyle | undefined,
  colors: TerminalColors,
  hyperlink: string | undefined,
): RunStyle => {
  return {
    foreground: resolveColor(style?.fg, colors.palette),
    background: resolveColor(style?.bg, colors.palette),
    attributes: textAttributes(style),
    hyperlink,
  }
}

const sameStyle = (left: RunStyle, right: RunStyle): boolean =>
  left.foreground === right.foreground &&
  left.background === right.background &&
  left.attributes === right.attributes &&
  left.hyperlink === right.hyperlink

/**
 * Interprets a child PTY's VT stream and exposes its current cell grid.
 *
 * libghostty owns escape parsing, cursor movement, Unicode width and
 * scrollback. Callers only write bytes and render immutable snapshots.
 */
export class TerminalSession implements Disposable {
  private readonly terminal: Terminal
  private readonly renderState = new RenderState()
  private ptyWriter: ((bytes: Uint8Array) => void) | undefined
  private scrollOffset = 0

  constructor(options: TerminalSessionOptions) {
    this.terminal = new Terminal({
      cols: options.columns,
      rows: options.rows,
      maxScrollback: options.maxScrollback,
      onWritePty: (bytes) => this.ptyWriter?.(bytes),
    })
  }

  /** Feed bytes read from the child PTY into the terminal. */
  write(bytes: Uint8Array): void {
    this.terminal.vtWrite(bytes)
  }

  /** Connect terminal query responses to the currently running child PTY. */
  connectPty(writer: ((bytes: Uint8Array) => void) | undefined): void {
    this.ptyWriter = writer
  }

  /** Copy the current viewport into immutable rows for React. */
  snapshot(): TerminalFrame {
    this.renderState.update(this.terminal)
    const colors = this.renderState.colors()
    const rows: TerminalRow[] = []
    for (const row of this.renderState.rows()) {
      const runs: TerminalRun[] = []
      for (const cell of row.cells()) {
        if (cell.isWideContinuation) continue
        const style = runStyle(cell.style, colors, cell.hyperlinkUri)
        const previous = runs[runs.length - 1]
        if (previous && sameStyle(previous, style)) {
          runs[runs.length - 1] = { ...previous, text: previous.text + cell.text }
        } else {
          runs.push({ text: cell.text, ...style })
        }
      }
      rows.push({ runs })
    }
    this.renderState.markClean()
    return { rows, scrollbackRows: this.terminal.snapshot().scrollbackRows }
  }

  /** Move the viewport to a distance from the live tail. Zero follows output. */
  scrollToOffset(offset: number): void {
    const next = Math.max(0, Math.trunc(offset))
    if (next === 0) this.terminal.scrollViewport("bottom")
    else this.terminal.scrollViewport(this.scrollOffset - next)
    this.scrollOffset = next
  }

  /** Resize the VT grid. The caller must resize the child PTY to match. */
  resize(columns: number, rows: number): void {
    this.terminal.resize(columns, rows)
  }

  /** Release libghostty's native terminal and render-state handles. */
  close(): void {
    this.renderState.close()
    this.terminal.close()
  }

  /** Release native resources at the end of a `using` scope. */
  [Symbol.dispose](): void {
    this.close()
  }
}
