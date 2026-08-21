// Brewfile parsing shared by package summaries and language-tool updates.
// Installation and satisfaction checks deliberately remain Homebrew Bundle's
// responsibility because only Bundle preserves every directive's semantics.
import { join } from "node:path"
import { PACKAGES_DIR } from "./env.ts"

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

const parseEntryKind = (value: string): EntryKind | undefined => {
  switch (value) {
    case "brew":
    case "cask":
    case "tap":
    case "go":
    case "cargo":
    case "vscode":
    case "mas":
      return value
    default:
      return undefined
  }
}

export function parseBrewfile(text: string): BrewEntry[] {
  const entries: BrewEntry[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue
    const m = DIRECTIVE.exec(line)
    if (!m) continue
    const [, rawKind, name, options] = m
    if (!rawKind || !name) continue
    const kind = parseEntryKind(rawKind)
    if (!kind) continue
    entries.push({ kind, name, options, line })
  }
  return entries
}

export async function readBundle(path = join(PACKAGES_DIR, "bundle")): Promise<BrewEntry[]> {
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  return parseBrewfile(await file.text())
}
