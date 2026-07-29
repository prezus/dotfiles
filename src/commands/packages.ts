// `dotfiles check-packages` and `dotfiles retry-failed`.
//
// Homebrew Bundle is the authority for this manifest. It understands every
// directive we track (brew/cask/tap/go/cargo) and preserves options such as
// `link: false`; a hand-written per-entry installer cannot safely reproduce
// those semantics.
import { join } from "node:path"
import { readBundle } from "../lib/brew.ts"
import { PACKAGES_DIR } from "../lib/env.ts"
import { commandExists, runInteractiveCode } from "../lib/exec.ts"
import type { StepOutcome } from "../lib/steps.ts"
import { printError, printInfo, printSuccess, printWarning } from "../lib/ui.ts"

export type PackageRuntime = {
  commandExists: (bin: string) => Promise<boolean>
  runInteractiveCode: (command: string[]) => Promise<number>
}

const defaultRuntime: PackageRuntime = { commandExists, runInteractiveCode }

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
  else printWarning("Some Brewfile dependencies are missing (install with: dotfiles init)")
  return code
}

/**
 * Install the complete Brewfile when its dependency check is unsatisfied.
 *
 * The check keeps an already-configured machine fast and read-only. The install
 * deliberately remains one Bundle operation: that is what installs Go/Cargo
 * entries and honors directive options rather than silently dropping them.
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

  const install = await runtime.runInteractiveCode(bundleCommand("install", bundlePath))
  if (install === 0) return { ok: true, detail: `installed ${entries.length} package entries` }

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
