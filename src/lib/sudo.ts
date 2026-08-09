// Administrator rights: acquired once, up front, and kept warm.
//
// The bug this exists for. `brew bundle install` shells out to `sudo` for any
// cask with a `pkg` payload, and sudo reads the password from /dev/tty — the
// CONTROLLING terminal, never stdin. Inside the output pane that terminal is
// the capture PTY exec.ts created, so the prompt was drawn into a buffer nobody
// reads and the install sat there until sudo's own timeout gave up. From the
// outside it looked exactly like "Homebrew failed", with no reason given.
//
// Two things follow from that, and both matter:
//
//  1. A child that may call sudo has to INHERIT the real terminal
//     (`needsStdin`), not a capture PTY. That is packages.ts's half of the fix,
//     and it is the part that makes the prompt reachable at all.
//  2. macOS sudo keys its timestamp to that terminal and expires it after five
//     minutes. A bundle install on a fresh machine runs far longer than five
//     minutes, so without a keepalive the prompt returns at some unpredictable
//     point in the middle — long after whoever started it walked away.
//
// Warming the ticket here, on the same terminal the install will inherit, turns
// "asked at a random moment, maybe invisibly" into "asked once, at the start,
// saying why".
import { probe, runInteractiveCode } from "./exec.ts"
import { printWarning } from "./ui.ts"

/** Re-stamp well inside macOS's five-minute `timestamp_timeout`. */
const KEEPALIVE_MS = 60_000

export type SudoSession = {
  /** Whether a usable ticket exists for this terminal. */
  granted: boolean
  /** Stop the keepalive. Always call it; safe to call more than once. */
  release: () => void
}

export type SudoRuntime = {
  /** `sudo -n -v` — validates AND refreshes, and never prompts. */
  hasTicket: () => Promise<boolean>
  /** Ask for the password on the real terminal. True when sudo accepted it. */
  prompt: (message: string) => Promise<boolean>
  /** False when there is no one at a keyboard to answer. */
  interactive: () => boolean
}

const defaultRuntime: SudoRuntime = {
  hasTicket: async () => (await probe(["/usr/bin/sudo", "-n", "-v"])).ok,
  // needsStdin, so exec.ts hands over the real terminal and suspends any UI —
  // the only screen the user can actually type at.
  prompt: async (message) =>
    (await runInteractiveCode(["/usr/bin/sudo", "-v", "-p", message], { needsStdin: true })) === 0,
  interactive: () => Boolean(process.stdin.isTTY),
}

const NO_SESSION: SudoSession = { granted: false, release: () => {} }

/**
 * Make sure a sudo ticket exists before running a child that will need one.
 *
 * Never fatal: a declined or unavailable password degrades to the old
 * behaviour — the child prompts for itself — rather than failing the step. That
 * is a real outcome on a machine whose user is not an admin, and it is the
 * child's business to report what it could not install.
 */
export async function warmSudo(
  reason: string,
  runtime: SudoRuntime = defaultRuntime,
): Promise<SudoSession> {
  if (await runtime.hasTicket()) return keepalive(runtime)
  if (!runtime.interactive()) return NO_SESSION

  // sudo renders this itself, on the terminal it is reading from, which is the
  // only place it can be seen. Printing a banner ourselves would send it to the
  // log sink — i.e. into the pane we are about to suspend.
  const granted = await runtime.prompt(`${reason}\nPassword for %p: `)
  if (!granted) {
    printWarning("No administrator rights — Homebrew will ask for your password itself")
    return NO_SESSION
  }
  return keepalive(runtime)
}

function keepalive(runtime: SudoRuntime): SudoSession {
  const timer = setInterval(() => void runtime.hasTicket(), KEEPALIVE_MS)
  // Never hold the process open on the refresher alone.
  timer.unref?.()
  return { granted: true, release: () => clearInterval(timer) }
}
