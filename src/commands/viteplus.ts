// `dotfiles viteplus` — Vite+ (https://vite.plus), which OWNS Node here.
//
// Vite+ also owns its own shell integration: it writes conf.d/vite-plus.fish and
// appends to .zshrc/.profile. Because those are stowed, its writes land in the
// repo — don't hand-edit or strip them (AGENTS.md → KEY DECISIONS).
import { join } from "node:path"
import { env, extract, run, runInteractive } from "../lib/exec.ts"
import { pathExists } from "../lib/fs.ts"
import { printInfo, printSuccess, printWarning } from "../lib/ui.ts"
import { withSuspendedUI } from "../tui/renderer.ts"

const VITE_PLUS_DIR = () => join(env.get("HOME") ?? "", ".vite-plus")
const VP = () => join(VITE_PLUS_DIR(), "bin", "vp")

/**
 * Out of the box Vite+ serves the latest LTS; we want the latest release. That
 * choice lives in the machine-local ~/.vite-plus/config.json, which is NOT
 * stowed — so it is set here to keep a fresh `init` reproducible. `latest` is a
 * moving alias: it re-resolves on each install rather than freezing a version.
 * Per-project overrides still win (`vp env pin <v>` → a .node-version file).
 */
export async function setDefaultNodeLatest(): Promise<void> {
  const vp = VP()
  if (!(await pathExists(vp))) return

  // Capture in full before matching — piping vp into an early-exiting reader
  // (grep -q, awk exit, head) SIGPIPEs it into an "Abort trap: 6". run()
  // always drains, so this hazard is structurally gone.
  const current = await run([vp, "env", "current"])
  const version = extract(current.stdout, /Version\s+(\S+)/)

  const currentDefault = await run([vp, "env", "default"])
  if (currentDefault.stdout.includes("version: latest")) {
    printSuccess(`Vite+ Node default — latest (${version ?? "?"})`)
    return
  }

  printInfo("Setting Vite+ default Node to latest...")
  const res = await run([vp, "env", "default", "latest"])
  if (!res.ok) printWarning("could not set Vite+ default Node version")
}

export async function viteplus(): Promise<number> {
  const vp = VP()

  if (await pathExists(vp)) {
    const version = (await run([vp, "--version"])).stdout.split("\n")[0]?.trim()
    printSuccess(`Vite+ already installed (${version})`)
  } else {
    printInfo("Installing Vite+ (curl https://vite.plus | bash)...")
    // VP_NODE_MANAGER=yes → Vite+ manages Node versions, non-interactively.
    const code = await withSuspendedUI(() =>
      runInteractive(["/bin/bash", "-c", "curl -fsSL https://vite.plus | bash"], {
        extraEnv: { VP_NODE_MANAGER: "yes" },
      }),
    )
    if (code !== 0) {
      printWarning("Vite+ install failed")
      return 1
    }
    printSuccess("Vite+ installed")
  }

  // Vite+'s shims must outrank Homebrew's node for the rest of this process,
  // mirroring the PATH order conf.d/paths.fish sets for interactive shells.
  env.prepend("PATH", join(VITE_PLUS_DIR(), "bin"))

  await setDefaultNodeLatest()
  return 0
}
