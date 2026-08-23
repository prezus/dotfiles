// Homebrew as a PackageBackend. The install/check logic still lives in
// commands/packages.ts because Bundle stays the authority for the Brewfile;
// this only exposes it through the shared shape.
import { join } from "node:path"
import { PACKAGES_DIR } from "./env.ts"
import { probe } from "./exec.ts"
import type { PackageBackend } from "./pkgbackend.ts"

export const BUNDLE = join(PACKAGES_DIR, "bundle")
export const BUNDLE_IGNORE = join(PACKAGES_DIR, "bundle.ignore")

const DIRECTIVE = /^(brew|cask|tap|go|cargo)\s+"([^"]+)"/

/** Drop trailing options (`, trusted: true`) so flag churn isn't reported as drift. */
export function normalizeBundle(text: string): Set<string> {
  const keep = /^(brew|cask|tap|go|cargo) /
  return new Set(
    text
      .split("\n")
      .filter((l) => keep.test(l))
      .map((l) => l.replace(/,.*$/, ""))
      .sort(),
  )
}

const splitDirective = (line: string): { kind: string; name: string } | null => {
  const m = DIRECTIVE.exec(line)
  return m?.[1] && m[2] ? { kind: m[1], name: m[2] } : null
}

async function declared(): Promise<Set<string>> {
  const file = Bun.file(BUNDLE)
  if (!(await file.exists())) return new Set()
  return normalizeBundle(await file.text())
}

/** Dumps to a TEMP file — never over packages/bundle, which carries hand edits. */
async function installed(): Promise<Set<string>> {
  const tmp = join(process.env.TMPDIR ?? "/tmp", `dotfiles-bundle-dump.${process.pid}`)
  try {
    const dump = await probe(["brew", "bundle", "dump", `--file=${tmp}`, "--force"])
    if (!dump.ok) return new Set()
    return normalizeBundle(await Bun.file(tmp).text())
  } finally {
    await Bun.file(tmp)
      .unlink()
      .catch(() => {})
  }
}

const appendLines = async (path: string, lines: readonly string[]): Promise<void> => {
  if (lines.length === 0) return
  const file = Bun.file(path)
  const current = (await file.exists()) ? await file.text() : ""
  const sep = current === "" || current.endsWith("\n") ? "" : "\n"
  await Bun.write(path, `${current}${sep}${lines.join("\n")}\n`)
}

const removeLines = async (path: string, lines: readonly string[]): Promise<void> => {
  if (lines.length === 0) return
  const file = Bun.file(path)
  if (!(await file.exists())) return
  const drop = new Set(lines.map((l) => l.trim()))
  const kept = (await file.text())
    .split("\n")
    .filter((l) => !drop.has(l.trim().replace(/,.*$/, "")))
    .join("\n")
  await Bun.write(path, kept)
}

export const brewBackend: PackageBackend = {
  id: "brew",
  label: "Homebrew",
  manifests: [BUNDLE],
  ignoreFile: BUNDLE_IGNORE,
  declared,
  installed,
  // Empty, and not an oversight: Homebrew cannot see or manage macOS's base
  // system, so a dump is already "only what I added".
  baseline: () => Promise.resolve(new Set<string>()),
  parseManifestLine: (line) => {
    const m = DIRECTIVE.exec(line)
    return m ? line.replace(/,.*$/, "").trim() : null
  },
  // Bundle owns both passes; commands/packages.ts wires them (it needs the
  // cask/sudo handling, which is Homebrew-specific).
  check: async (runtime) => (await import("../commands/packages.ts")).checkPackages({ runtime }),
  install: async (runtime) => (await import("../commands/packages.ts")).installPackages({ runtime }),
  declare: (lines) => appendLines(BUNDLE, lines),
  undeclare: (lines) => removeLines(BUNDLE, lines),
  installCommand: (line) => {
    const d = splitDirective(line)
    if (!d) return null
    return d.kind === "tap"
      ? ["brew", "tap", d.name]
      : ["brew", "install", ...(d.kind === "cask" ? ["--cask"] : []), d.name]
  },
  uninstallCommand: (line) => {
    const d = splitDirective(line)
    if (!d) return null
    return d.kind === "tap"
      ? ["brew", "untap", d.name]
      : ["brew", "uninstall", ...(d.kind === "cask" ? ["--cask"] : []), d.name]
  },
  installHint: (tool) => `brew install ${tool}`,
}
