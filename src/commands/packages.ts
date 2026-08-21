// `dotfiles check-packages` and `dotfiles retry-failed`.
//
// Homebrew Bundle is the authority for this manifest. It understands every
// directive we track (brew/cask/tap/go/cargo) and preserves options such as
// `link: false`; a hand-written per-entry installer cannot safely reproduce
// those semantics.
import { join } from "node:path"
import { readBundle } from "../lib/brew.ts"
import { PACKAGES_DIR } from "../lib/env.ts"
import { commandExists, probe, runInteractiveCode, type RunOptions, type RunResult } from "../lib/exec.ts"
import type { StepOutcome } from "../lib/steps.ts"
import { warmSudo, type SudoSession } from "../lib/sudo.ts"
import { printError, printInfo, printSuccess, printWarning } from "../lib/ui.ts"

export type PackageRuntime = {
  commandExists: (bin: string) => Promise<boolean>
  runInteractiveCode: (command: string[], opts?: RunOptions) => Promise<number>
  probe: (command: string[]) => Promise<RunResult>
  warmSudo: (reason: string) => Promise<SudoSession>
}

const defaultRuntime: PackageRuntime = {
  commandExists,
  runInteractiveCode,
  probe,
  warmSudo: (reason) => warmSudo(reason),
}

export type PackageOptions = {
  bundlePath?: string
  runtime?: PackageRuntime
}

const bundlePathFor = (options: PackageOptions): string =>
  options.bundlePath ?? join(PACKAGES_DIR, "bundle")

const bundleCommand = (action: "check" | "install", bundlePath: string): string[] => [
  "brew",
  "bundle",
  action,
  ...(action === "check" ? ["--verbose"] : []),
  `--file=${bundlePath}`,
]

const casksNeedingInstall = (bundleCheckOutput: string): string[] => {
  const casks: string[] = []
  const pattern = /^→ Cask (.+?) needs to be installed or updated\.$/gm
  for (const match of bundleCheckOutput.matchAll(pattern)) {
    const name = match[1]
    if (name) casks.push(name)
  }
  return casks
}

export async function checkPackages(options: PackageOptions = {}): Promise<number> {
  const bundlePath = bundlePathFor(options)
  const runtime = options.runtime ?? defaultRuntime
  const entries = await readBundle(bundlePath)
  if (entries.length === 0) {
    printError("No packages/bundle")
    return 1
  }
  if (!(await runtime.commandExists("brew"))) {
    printError("Homebrew not installed")
    return 1
  }

  printInfo(`Checking packages/bundle — ${entries.length} entries`)
  const code = await runtime.runInteractiveCode(bundleCommand("check", bundlePath))
  if (code === 0) printSuccess("The Brewfile's dependencies are satisfied.")
  else printWarning("Some Brewfile dependencies are missing (install with: dotfiles brew)")
  return code
}

/**
 * Install the complete Brewfile when its dependency check is unsatisfied.
 *
 * The check keeps an already-configured machine fast and read-only. The install
 * deliberately remains one Bundle operation: that is what installs Go/Cargo
 * entries and honors directive options rather than silently dropping them.
 *
 * The two passes are NOT run the same way, and the difference is the whole
 * point of this function:
 *
 *   check   — reads only, never escalates, so it streams into the pane.
 *   install — pours casks, and a cask with a `pkg` payload calls `sudo`. sudo
 *             reads the password from the controlling terminal, so under
 *             capture the prompt landed in the pane's PTY where it was both
 *             invisible and unanswerable, and the install hung until sudo timed
 *             out. `needsStdin` gives this pass the REAL terminal (suspending
 *             any UI for its duration), which is the only arrangement where the
 *             password can be typed at all.
 *
 * Losing the pane for the install pass is the cost, and it is the right trade:
 * brew's own output goes straight to the screen instead, and a fresh machine
 * finishes unattended rather than stalling on a prompt nobody could see.
 */
export async function installPackages(options: PackageOptions = {}): Promise<StepOutcome> {
  const bundlePath = bundlePathFor(options)
  const runtime = options.runtime ?? defaultRuntime
  const entries = await readBundle(bundlePath)
  if (entries.length === 0) return { ok: false, detail: "no packages/bundle" }

  const check = await runtime.runInteractiveCode(bundleCommand("check", bundlePath))
  if (check === 0) {
    return { ok: true, detail: `${entries.length} package entries already satisfied` }
  }

  // Bundle's verbose result is the plan, unlike counting every cask declared in
  // the Brewfile. One outdated formula must not claim that all 47 casks are
  // about to be installed or ask for an unrelated administrator password.
  const detail = await runtime.probe(bundleCommand("check", bundlePath))
  const casks = casksNeedingInstall(`${detail.stdout}\n${detail.stderr}`)
  const sudo =
    casks.length > 0
      ? await runtime.warmSudo(
          `Homebrew is about to install or update ${casks.length} cask(s): ${casks.join(
            ", ",
          )}. Some need administrator rights.`,
        )
      : null

  printInfo(
    casks.length > 0
      ? "Running brew bundle install on the terminal (pending casks may ask for your password)"
      : "Running brew bundle install on the terminal",
  )
  try {
    const install = await runtime.runInteractiveCode(bundleCommand("install", bundlePath), {
      needsStdin: true,
    })
    if (install === 0) return { ok: true, detail: `installed ${entries.length} package entries` }
  } finally {
    sudo?.release()
  }

  printWarning("Homebrew Bundle reported incomplete installs — retry with: dotfiles retry-failed")
  return { ok: false, detail: "brew bundle install failed" }
}

/** Retry the authoritative Bundle operation rather than an incomplete ledger. */
export async function retryFailed(options: PackageOptions = {}): Promise<number> {
  printInfo("Retrying packages/bundle")
  const outcome = await installPackages(options)
  if (outcome.ok) {
    printSuccess(outcome.detail ?? "packages installed")
    return 0
  }
  printWarning(outcome.detail ?? "package installation failed")
  return 1
}
