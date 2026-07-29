// Handing the real terminal to a child, without lib/ knowing about the TUI.
//
// The first design classified whole COMMANDS as "takes the screen", which was
// wrong: `init` runs ten steps and only the Homebrew installer wants a password
// — and on a machine that already has Homebrew, it never even runs. Classifying
// at the command level meant dropping out of the app for the other nine steps
// for no reason.
//
// The right granularity is the CHILD PROCESS. exec.ts already knows which ones
// need stdin, so it asks for the terminal for exactly that child and gives it
// straight back. The renderer registers the handler at startup; when no UI is
// mounted this is a no-op passthrough.
export type SuspendHandler = <T>(fn: () => Promise<T>) => Promise<T>

let handler: SuspendHandler | null = null

export const setSuspendHandler = (next: SuspendHandler | null): void => {
  handler = next
}

/** Run `fn` with the real terminal, suspending any mounted UI for its duration. */
export async function withTerminal<T>(fn: () => Promise<T>): Promise<T> {
  return handler ? await handler(fn) : await fn()
}
