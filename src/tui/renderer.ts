// Renderer lifecycle + the terminal hand-off.
//
// Several things this CLI drives take over the terminal and would deadlock
// inside a raw-mode render: `sudo tee -a /etc/shells`, `chsh`, `brew bundle`
// (casks prompt for admin), and the third-party `curl | bash` installers.
//
// OpenTUI exposes suspend()/resume() as first-class CliRenderer API, with an
// EXPLICIT_SUSPENDED state and terminal restore handling, so the hand-off is a
// wrapper rather than an unmount/remount dance.
import type { CliRenderer } from "@opentui/core"
import { setSuspendHandler } from "../lib/terminal.ts"

let current: CliRenderer | null = null

export function setRenderer(renderer: CliRenderer): void {
  current = renderer
  // exec.ts suspends around any child that needs the keyboard; this is how it
  // reaches the renderer without lib/ importing the TUI.
  setSuspendHandler(withSuspendedUI)
}

export function getRenderer(): CliRenderer | null {
  return current
}

/**
 * Hand the terminal to an interactive child, then reclaim it. Safe to call
 * when no renderer is mounted (plain mode), where it just runs `fn`.
 */
export async function withSuspendedUI<T>(fn: () => Promise<T>): Promise<T> {
  if (!current) return await fn()
  current.suspend()
  try {
    return await fn()
  } finally {
    current.resume()
  }
}
