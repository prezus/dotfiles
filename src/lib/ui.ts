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

export const printHeader = (msg: string): void =>
  console.log(`\n${BOLD}${BLUE}==>${RESET} ${BOLD}${msg}${RESET}`)
export const printSuccess = (msg: string): void => console.log(`${GREEN}✓${RESET} ${msg}`)
export const printError = (msg: string): void => console.error(`${RED}✗${RESET} ${msg}`)
export const printWarning = (msg: string): void => console.log(`${YELLOW}⚠${RESET} ${msg}`)
export const printInfo = (msg: string): void => console.log(`${CYAN}ℹ${RESET} ${msg}`)

/**
 * Yes/no prompt — the port of bash `confirm()`. Non-interactive callers get the
 * default rather than a hang, which the bash version would not have survived.
 */
export async function confirm(prompt = "Continue?", defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n]: " : " [y/N]: "
  if (!process.stdin.isTTY) return defaultYes

  process.stdout.write(prompt + suffix)
  for await (const chunk of Bun.stdin.stream()) {
    const answer = new TextDecoder().decode(chunk).trim().toLowerCase()
    if (answer === "") return defaultYes
    return answer === "y" || answer === "yes"
  }
  return defaultYes
}
