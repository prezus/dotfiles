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

/**
 * The only part of a CliRenderer this module touches.
 *
 * Narrower than CliRenderer on purpose. OpenTUI is pre-1.0 and pinned exactly,
 * so the less of its surface we name, the less a breaking bump can reach — and
 * a test can stand in a plain object with two functions instead of asserting
 * one through `unknown` into a type it does not implement.
 */
export type SuspendableRenderer = Pick<CliRenderer, "suspend" | "resume">

let current: SuspendableRenderer | null = null

export function setRenderer(renderer: SuspendableRenderer): void {
  current = renderer
  // exec.ts suspends around any child that needs the keyboard; this is how it
  // reaches the renderer without lib/ importing the TUI.
  setSuspendHandler(withSuspendedUI)
}

/** Stop routing terminal hand-offs to a renderer that is about to be destroyed. */
export function clearRenderer(renderer: SuspendableRenderer): void {
  // A stale view must not clear a newer renderer that replaced it.
  if (current !== renderer) return
  current = null
  setSuspendHandler(null)
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
