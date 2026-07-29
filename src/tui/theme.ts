// Gruvbox dark (medium) — the same palette the shell uses, so the TUI doesn't
// look foreign inside a Ghostty session themed by conf.d/gruvbox_theme.fish.
export const theme = {
  bg: "#282828",
  bgSoft: "#3c3836",
  bgHard: "#504945",
  dim: "#665c54",
  gray: "#928374",

  fg: "#fbf1c7",
  fgMuted: "#a89984",

  red: "#fb4934",
  green: "#b8bb26",
  yellow: "#fabd2f",
  blue: "#83a598",
  purple: "#d3869b",
  aqua: "#8ec07c",
  orange: "#fe8019",
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
