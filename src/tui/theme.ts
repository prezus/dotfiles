// Catppuccin Macchiato — the palette the terminal (Ghostty/Rex), starship and
// fish use, so the TUI doesn't look foreign inside them.
export const theme = {
  bg: "#24273a",
  bgSoft: "#363a4f",
  bgHard: "#494d64",
  dim: "#5b6078",
  gray: "#8087a2",

  fg: "#cad3f5",
  fgMuted: "#a5adcb",

  red: "#ed8796",
  green: "#a6da95",
  yellow: "#eed49f",
  blue: "#8aadf4",
  purple: "#c6a0f6",
  aqua: "#8bd5ca",
  orange: "#f5a97f",
} as const

/** OpenTUI text attribute bitmask — 1 is bold. */
export const BOLD = 1

export const STATUS_GLYPH = { ok: "✓", warn: "⚠", fail: "✗", info: "ℹ" } as const
export const STATUS_COLOR = {
  ok: theme.green,
  warn: theme.yellow,
  fail: theme.red,
  info: theme.aqua,
} as const
