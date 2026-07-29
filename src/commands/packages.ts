// `dotfiles check-packages` and `dotfiles retry-failed`.
import { readdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { bundleStatus, installCommand, readBundle, type BrewEntry } from "../lib/brew.ts"
import { PACKAGES_DIR } from "../lib/env.ts"
import { commandExists, runInteractiveCode } from "../lib/exec.ts"
import { timestamp } from "../lib/fs.ts"
import type { StepOutcome } from "../lib/steps.ts"
import { printError, printInfo, printSuccess, printWarning } from "../lib/ui.ts"

export async function checkPackages(): Promise<number> {
  const entries = await readBundle()
  if (entries.length === 0) {
    printError("No packages/bundle")
    return 1
  }
  if (!(await commandExists("brew"))) {
    printError("Homebrew not installed")
    return 1
  }

  const { installed, missing, unchecked } = await bundleStatus(entries)
  printInfo(
    `packages/bundle — ${entries.length} entries · ${installed.length} installed · ${missing.length} missing`,
  )

  if (missing.length === 0) {
    printSuccess("The Brewfile's dependencies are satisfied.")
  } else {
    for (const entry of missing) printWarning(`${entry.kind} ${entry.name} — not installed`)
    printInfo("Install with: dotfiles init  (or: brew bundle --file=packages/bundle)")
  }

  if (unchecked.length > 0) {
    // go/cargo/vscode entries can't be answered by `brew list`; say so rather
    // than implying they were verified.
    printInfo(`${unchecked.length} entry(s) not verifiable via brew list (go/cargo/vscode)`)
  }

  return missing.length === 0 ? 0 : 1
}

export type InstallProgress = {
  entry: BrewEntry
  index: number
  total: number
}

/**
 * Install everything in packages/bundle that isn't already present.
 *
 * Checks first, then installs the missing set one at a time. Bash ran
 * `brew bundle` as a single opaque batch over all 239 directives and only fell
 * back to per-package installs after the batch had already failed — so on a
 * healthy machine you saw brew's firehose, and on a broken one you found out
 * what failed at the very end. Checking first makes the common case ("nothing
 * missing") a fast read-only pass, and makes progress real.
 */
export async function installPackages(
  onProgress?: (progress: InstallProgress) => void,
): Promise<StepOutcome> {
  const entries = await readBundle()
  if (entries.length === 0) return { ok: false, detail: "no packages/bundle" }

  const { installed, missing } = await bundleStatus(entries)
  if (missing.length === 0) {
    return { ok: true, detail: `${installed.length} packages already installed` }
  }

  const failed: BrewEntry[] = []
  for (const [index, entry] of missing.entries()) {
    onProgress?.({ entry, index, total: missing.length })
    const code = await runInteractiveCode(installCommand(entry))
    if (code !== 0) failed.push(entry)
  }

  if (failed.length === 0) {
    return { ok: true, detail: `installed ${missing.length}` }
  }

  // Same ledger format bash wrote, so `retry-failed` reads either one.
  const ledger = join(PACKAGES_DIR, `failed_packages_${timestamp()}.txt`)
  await Bun.write(ledger, failed.map((e) => `${e.kind}:${e.name}`).join("\n") + "\n")
  printWarning(`Failed: ${failed.length} (saved to ${ledger}) — retry with: dotfiles retry-failed`)

  return {
    ok: false,
    detail: `${missing.length - failed.length} installed, ${failed.length} failed`,
  }
}

/** `packages/failed_packages_<ts>.txt`, newest first. */
async function failedLedgers(): Promise<string[]> {
  try {
    const files = (await readdir(PACKAGES_DIR)).filter(
      (f) => f.startsWith("failed_packages_") && f.endsWith(".txt"),
    )
    // The timestamp is lexicographically sortable (YYYYmmdd_HHMMSS).
    return files.sort().reverse().map((f) => join(PACKAGES_DIR, f))
  } catch {
    return []
  }
}

export async function retryFailed(): Promise<number> {
  const [latest] = await failedLedgers()
  if (!latest) {
    printInfo("No failed-package files found")
    return 0
  }

  printInfo(`Retrying from ${latest}`)
  const lines = (await Bun.file(latest).text())
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

  let reinstalled = 0
  const stillFailing: string[] = []

  for (const line of lines) {
    const [kind, ...rest] = line.split(":")
    const name = rest.join(":")
    if (!name) continue
    const entry = { kind: kind === "cask" ? "cask" : "brew", name } as BrewEntry
    const code = await runInteractiveCode(installCommand(entry))
    if (code === 0) reinstalled++
    else stillFailing.push(`${entry.kind}:${name}`)
  }

  printSuccess(`Reinstalled ${reinstalled}`)
  if (stillFailing.length > 0) {
    printWarning(`Still failing: ${stillFailing.join(" ")}`)
    await Bun.write(latest, stillFailing.join("\n") + "\n")
    return 1
  }

  await unlink(latest).catch(() => {})
  return 0
}
