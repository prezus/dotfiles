// Opt-in only: init/stow never write outside $HOME. See bin/resolver-install for why.
import { RESOLVER_INSTALLER } from "../lib/env.ts"
import { runInteractiveCode } from "../lib/exec.ts"
import { IS_DARWIN } from "../lib/platform.ts"
import { isInteractive, printError } from "../lib/ui.ts"

export async function resolver(args: string[]): Promise<number> {
  if (!IS_DARWIN) {
    printError("resolver requires macOS")
    return 1
  }
  if (args.length === 0 && isInteractive()) {
    const { pickResolverAction } = await import("../tui/resolver-picker.tsx")
    const action = await pickResolverAction()
    if (action === null) return 0
    return runResolver(action)
  }
  const [action, ...rest] = args
  if (rest.length !== 0 || (action !== "install" && action !== "uninstall" && action !== "status")) {
    printError("Usage: dotfiles resolver install | uninstall | status")
    return 2
  }
  return runResolver(action)
}

// install/uninstall run sudo, which must read the password from the real terminal.
function runResolver(action: "install" | "uninstall" | "status"): Promise<number> {
  return runInteractiveCode(["/bin/bash", RESOLVER_INSTALLER, action], { needsStdin: action !== "status" })
}
