// `dotfiles edit` — open the repo in $EDITOR.
//
// Bash used `exec` to replace the process. A spawned child with inherited stdio
// is equivalent from the editor's point of view (it owns the same tty); we just
// propagate its exit code instead of never returning.
import { DOTFILES_DIR } from "../lib/env.ts"
import { commandExists, runInteractive } from "../lib/exec.ts"
import { printError } from "../lib/ui.ts"

export async function edit(): Promise<number> {
  const editor = process.env.EDITOR ?? "nvim"
  if (!(await commandExists(editor))) {
    printError(`editor '${editor}' not found`)
    return 1
  }
  return await runInteractive([editor, DOTFILES_DIR])
}
