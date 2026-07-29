// Brewfile parsing and the "what's missing" primitive.
//
// The bash version re-parsed packages/bundle with ad-hoc regexes in three
// separate places (_install_packages' retry loop, _update_extras' go loop,
// _bundle_norm). One parser now serves all of them.
//
// Missing entries are computed by DIFFING the Brewfile against `brew list`,
// not by parsing the prose of `brew bundle check --verbose`. That output is
// human-facing and can change between brew releases; a set difference cannot.
import { join } from "node:path"
import { PACKAGES_DIR } from "./env.ts"
import { run } from "./exec.ts"

export type EntryKind = "brew" | "cask" | "tap" | "go" | "cargo" | "vscode" | "mas"

export type BrewEntry = {
  kind: EntryKind
  /** As written in the Brewfile, e.g. "oven-sh/bun/bun". */
  name: string
  /** Trailing options, e.g. `trusted: true`. */
  options?: string
  line: string
}

const DIRECTIVE = /^(brew|cask|tap|go|cargo|vscode|mas)\s+"([^"]+)"(?:\s*,\s*(.*))?$/

export function parseBrewfile(text: string): BrewEntry[] {
  const entries: BrewEntry[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue
    const m = DIRECTIVE.exec(line)
    if (!m) continue
    const [, kind, name, options] = m
    if (!kind || !name) continue
    entries.push({ kind: kind as EntryKind, name, options, line })
  }
  return entries
}

/** `oven-sh/bun/bun` → `bun`. `brew list` reports the bare name. */
export const shortName = (name: string): string => name.split("/").pop() ?? name

export async function readBundle(path = join(PACKAGES_DIR, "bundle")): Promise<BrewEntry[]> {
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  return parseBrewfile(await file.text())
}

export type BundleStatus = {
  installed: BrewEntry[]
  missing: BrewEntry[]
  /** go/cargo/vscode/mas entries, which `brew list` can't answer for. */
  unchecked: BrewEntry[]
}

/**
 * Which Brewfile entries are not installed. Read-only and fast — the fast path
 * for `init` is "check, and if nothing is missing, do nothing".
 */
export async function bundleStatus(entries?: BrewEntry[]): Promise<BundleStatus> {
  const all = entries ?? (await readBundle())

  const [formulae, casks, taps] = await Promise.all([
    run(["brew", "list", "--formula", "-1"]),
    run(["brew", "list", "--cask", "-1"]),
    run(["brew", "tap"]),
  ])

  const toSet = (out: string) =>
    new Set(
      out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    )
  const haveFormulae = toSet(formulae.stdout)
  const haveCasks = toSet(casks.stdout)
  const haveTaps = toSet(taps.stdout)

  const installed: BrewEntry[] = []
  const missing: BrewEntry[] = []
  const unchecked: BrewEntry[] = []

  for (const entry of all) {
    switch (entry.kind) {
      case "brew":
        ;(haveFormulae.has(shortName(entry.name)) ? installed : missing).push(entry)
        break
      case "cask":
        ;(haveCasks.has(shortName(entry.name)) ? installed : missing).push(entry)
        break
      case "tap":
        ;(haveTaps.has(entry.name) ? installed : missing).push(entry)
        break
      default:
        unchecked.push(entry)
    }
  }

  return { installed, missing, unchecked }
}

/** The command that installs one entry — used by init and retry-failed. */
export function installCommand(entry: BrewEntry): string[] {
  switch (entry.kind) {
    case "cask":
      return ["brew", "install", "--cask", entry.name]
    case "tap":
      return ["brew", "tap", entry.name]
    default:
      return ["brew", "install", entry.name]
  }
}
