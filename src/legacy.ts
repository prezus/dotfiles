// Strangler bridge.
//
// Every command starts life delegating to the original bash, and moves to
// TypeScript one phase at a time. When `legacy/dotfiles.bash` has no callers
// left it is deleted (Phase 6) along with this file.
//
// DOTFILES_DIR is passed explicitly: the bash script derives it from its own
// location, which now resolves to `<repo>/legacy` rather than the repo root.
import { DOTFILES_DIR, LEGACY_SCRIPT } from "./lib/env.ts"
import { runInteractive } from "./lib/exec.ts"

/**
 * Hand a subcommand to the bash implementation, inheriting the terminal so
 * `confirm()` prompts, sudo and brew output all behave exactly as before.
 * Returns the child's exit code.
 */
export async function runLegacy(command: string, args: string[] = []): Promise<number> {
  return await runInteractive(["bash", LEGACY_SCRIPT, command, ...args], {
    extraEnv: { DOTFILES_DIR },
  })
}
