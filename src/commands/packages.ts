// `dotfiles check-packages` and `dotfiles retry-failed`.
import { readdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { bundleStatus, installCommand, readBundle, type BrewEntry } from "../lib/brew.ts"
import { PACKAGES_DIR } from "../lib/env.ts"
import { commandExists, runInteractive } from "../lib/exec.ts"
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
    const code = await runInteractive(installCommand(entry))
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
