// `dotfiles plannotator` — install the Plannotator CLI outside Homebrew.
//
// Agent integrations and configuration are stowed separately. The official
// installer's minimal mode keeps this step focused on the untracked binary and
// avoids rewriting those managed files.
import { join } from "node:path"
import { env, probe, runInteractiveCode } from "../lib/exec.ts"
import { pathExists } from "../lib/fs.ts"
import { printInfo, printSuccess, printWarning } from "../lib/ui.ts"

const INSTALL_COMMAND =
  "curl -fsSL https://plannotator.ai/install.sh | bash -s -- --minimal --non-interactive"

type PlannotatorRuntime = {
  pathExists: (path: string) => Promise<boolean>
  version: (path: string) => Promise<string>
  install: () => Promise<number>
}

const defaultRuntime: PlannotatorRuntime = {
  pathExists,
  version: async (path) => (await probe([path, "--version"])).stdout.split("\n")[0]?.trim() ?? "",
  install: () => runInteractiveCode(["/bin/bash", "-c", INSTALL_COMMAND]),
}

export async function plannotator(runtime: PlannotatorRuntime = defaultRuntime): Promise<number> {
  const binDir = join(env.get("HOME") ?? "", ".local", "bin")
  const binary = join(binDir, "plannotator")

  if (await runtime.pathExists(binary)) {
    const version = await runtime.version(binary)
    printSuccess(`Plannotator already installed (${version || "version unknown"})`)
    env.prepend("PATH", binDir)
    return 0
  }

  printInfo("Installing Plannotator CLI...")
  const code = await runtime.install()
  if (code !== 0 || !(await runtime.pathExists(binary))) {
    printWarning("Plannotator install failed")
    return code || 1
  }

  env.prepend("PATH", binDir)
  printSuccess("Plannotator installed")
  return 0
}
