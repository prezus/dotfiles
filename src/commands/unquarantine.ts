// Opt-in only: init/stow never activate this security-policy change.
import { UNQUARANTINE_INSTALLER } from "../lib/env.ts"
import { runInteractiveCode } from "../lib/exec.ts"
import { IS_DARWIN } from "../lib/platform.ts"
import { isInteractive, printError } from "../lib/ui.ts"

export async function unquarantine(args: string[]): Promise<number> {
  if (!IS_DARWIN) {
    printError("unquarantine requires macOS 13+")
    return 1
  }
  if (args.length === 0 && isInteractive()) {
    const { pickUnquarantineAction } = await import("../tui/unquarantine-picker.tsx")
    const action = await pickUnquarantineAction()
    if (action === null) return 0
    return runInteractiveCode(["/bin/bash", UNQUARANTINE_INSTALLER, action])
  }
  const [action, ...rest] = args
  if (rest.length !== 0 || (action !== "install" && action !== "uninstall" && action !== "status")) {
    printError("Usage: dotfiles unquarantine install | uninstall | status")
    return 2
  }
  return runInteractiveCode(["/bin/bash", UNQUARANTINE_INSTALLER, action])
}
