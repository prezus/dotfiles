// pacman/yay backend. Sibling of brew.ts, same role for Arch-likes.
//
// Manifests are bare package names, one per line — the format every Arch user
// already has. The `pacman "x"` / `aur "x"` directive shape exists only at this
// boundary, so reconcile.ts and doctor keep working unchanged.
import { join } from "node:path"
import { OMARCHY_PACKAGE_LISTS, PACKAGES_DIR } from "./env.ts"
import { probe } from "./exec.ts"
import { IS_OMARCHY } from "./platform.ts"
import type { PackageBackend } from "./pkgbackend.ts"
import type { PackageRuntime } from "../commands/packages.ts"
import type { StepOutcome } from "./steps.ts"
import { printError, printInfo, printSuccess, printWarning } from "./ui.ts"

export const ARCH_MANIFEST = join(PACKAGES_DIR, "arch.txt")
export const AUR_MANIFEST = join(PACKAGES_DIR, "aur.txt")
export const ARCH_IGNORE = join(PACKAGES_DIR, "arch.ignore")

const DIRECTIVE = /^(pacman|aur) "([^"]+)"$/

/** Bare names -> directives. Blank lines and `#` comments are dropped. */
export function parseNameList(text: string, kind: "pacman" | "aur"): Set<string> {
  return new Set(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"))
      .map((name) => `${kind} "${name}"`)
      .sort(),
  )
}

const readNames = async (path: string, kind: "pacman" | "aur"): Promise<Set<string>> => {
  const file = Bun.file(path)
  if (!(await file.exists())) return new Set()
  return parseNameList(await file.text(), kind)
}

async function declared(): Promise<Set<string>> {
  const [native, foreign] = await Promise.all([
    readNames(ARCH_MANIFEST, "pacman"),
    readNames(AUR_MANIFEST, "aur"),
  ])
  return new Set([...native, ...foreign])
}

/**
 * What the distro put here, which arch.txt must not re-declare.
 *
 * On Omarchy this is exact: it ships its own install manifests, and a fresh
 * machine has all 206 before we touch it. Reading them rather than keeping a
 * hand-written denylist means an `omarchy update` that adds a package does not
 * suddenly show up as our drift.
 *
 * On plain Arch there is no such record, so fall back to the `base` and
 * `base-devel` groups — narrower, so arch.txt legitimately carries more there.
 */
async function baseline(): Promise<Set<string>> {
  const names = new Set<string>()

  if (IS_OMARCHY) {
    for (const path of OMARCHY_PACKAGE_LISTS) {
      const file = Bun.file(path)
      if (!(await file.exists())) continue
      for (const entry of parseNameList(await file.text(), "pacman")) names.add(entry)
    }
    if (names.size > 0) return names
  }

  const groups = await probe(["pacman", "-Qqg", "base", "base-devel"])
  if (groups.ok) for (const entry of parseNameList(groups.stdout, "pacman")) names.add(entry)
  return names
}

/**
 * `-Qqe` is the analogue of `brew bundle dump`: explicitly installed only, so
 * dependencies don't show up as drift. `-n` is native, `-m` foreign (AUR).
 * Unlike brew this needs no temp file, so packages/bundle's hand edits are never
 * at risk here.
 */
async function installed(): Promise<Set<string>> {
  const [native, foreign] = await Promise.all([
    probe(["pacman", "-Qqen"]),
    probe(["pacman", "-Qqem"]),
  ])
  const out = new Set<string>()
  if (native.ok) for (const n of parseNameList(native.stdout, "pacman")) out.add(n)
  if (foreign.ok) for (const n of parseNameList(foreign.stdout, "aur")) out.add(n)
  return out
}

const splitDirective = (line: string): { kind: string; name: string } | null => {
  const m = DIRECTIVE.exec(line.trim())
  const kind = m?.[1]
  const name = m?.[2]
  return kind && name ? { kind, name } : null
}

type Missing = { pacman: string[]; aur: string[] }

const missing = async (): Promise<Missing> => {
  const [want, have] = await Promise.all([declared(), installed()])
  const out: Missing = { pacman: [], aur: [] }
  for (const line of want) {
    if (have.has(line)) continue
    const d = splitDirective(line)
    if (d?.kind === "pacman") out.pacman.push(d.name)
    else if (d?.kind === "aur") out.aur.push(d.name)
  }
  return out
}

async function check(runtime: PackageRuntime): Promise<number> {
  if (!(await runtime.commandExists("pacman"))) {
    printError("pacman not found — is this an Arch-like system?")
    return 1
  }
  const want = await declared()
  if (want.size === 0) {
    printError("No packages/arch.txt")
    return 1
  }
  const gaps = await missing()
  const total = gaps.pacman.length + gaps.aur.length
  printInfo(`Checking packages/arch.txt + aur.txt — ${want.size} entries`)
  if (total === 0) {
    printSuccess("All declared packages are installed.")
    return 0
  }
  printWarning(`${total} declared package(s) not installed (install with: dotfiles pacman)`)
  for (const n of [...gaps.pacman, ...gaps.aur]) printWarning(`  ${n}`)
  return 1
}

/**
 * Names go in argv, never on stdin: needsStdin hands the child the real terminal
 * so sudo's prompt is reachable, and a piped manifest would take that away. Same
 * class of bug as the cask/sudo hang in packages.ts.
 *
 * yay is never run under sudo — it escalates itself and refuses to run as root.
 */
async function install(runtime: PackageRuntime): Promise<StepOutcome> {
  const want = await declared()
  if (want.size === 0) return { ok: false, detail: "no packages/arch.txt" }

  const gaps = await missing()
  const total = gaps.pacman.length + gaps.aur.length
  if (total === 0) return { ok: true, detail: `${want.size} package entries already satisfied` }

  const sudo =
    gaps.pacman.length > 0
      ? await runtime.warmSudo(
          `pacman is about to install ${gaps.pacman.length} package(s): ${gaps.pacman.join(", ")}.`,
        )
      : null

  let failed = 0
  try {
    if (gaps.pacman.length > 0) {
      printInfo(`Installing ${gaps.pacman.length} package(s) with pacman`)
      const code = await runtime.runInteractiveCode(
        ["sudo", "pacman", "-S", "--needed", "--noconfirm", ...gaps.pacman],
        { needsStdin: true },
      )
      if (code !== 0) failed += gaps.pacman.length
    }
  } finally {
    sudo?.release()
  }

  if (gaps.aur.length > 0) {
    printInfo(`Installing ${gaps.aur.length} AUR package(s) with yay`)
    const code = await runtime.runInteractiveCode(
      ["yay", "-S", "--needed", "--noconfirm", ...gaps.aur],
      { needsStdin: true },
    )
    if (code !== 0) failed += gaps.aur.length
  }

  if (failed > 0) {
    printWarning("Some packages failed — retry with: dotfiles retry-failed")
    return { ok: false, detail: `${failed} package(s) failed to install` }
  }
  return { ok: true, detail: `installed ${total} package entries` }
}

const manifestFor = (line: string): string =>
  splitDirective(line)?.kind === "aur" ? AUR_MANIFEST : ARCH_MANIFEST

async function declare(lines: readonly string[]): Promise<void> {
  for (const manifest of [ARCH_MANIFEST, AUR_MANIFEST]) {
    const names = lines
      .filter((l) => manifestFor(l) === manifest)
      .map((l) => splitDirective(l)?.name)
      .filter((n): n is string => n !== undefined)
    if (names.length === 0) continue
    const file = Bun.file(manifest)
    const current = (await file.exists()) ? await file.text() : ""
    const sep = current === "" || current.endsWith("\n") ? "" : "\n"
    await Bun.write(manifest, `${current}${sep}${names.join("\n")}\n`)
  }
}

async function undeclare(lines: readonly string[]): Promise<void> {
  const drop = new Set(
    lines.map((l) => splitDirective(l)?.name).filter((n): n is string => n !== undefined),
  )
  for (const manifest of [ARCH_MANIFEST, AUR_MANIFEST]) {
    const file = Bun.file(manifest)
    if (!(await file.exists())) continue
    const kept = (await file.text())
      .split("\n")
      .filter((l) => !drop.has(l.trim()))
      .join("\n")
    await Bun.write(manifest, kept)
  }
}

export const archBackend: PackageBackend = {
  id: "arch",
  label: "pacman",
  manifests: [ARCH_MANIFEST, AUR_MANIFEST],
  ignoreFile: ARCH_IGNORE,
  declared,
  installed,
  baseline,
  parseManifestLine: (line) => {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) return null
    // Callers hand us raw manifest lines (bare names) or already-formed
    // directives, depending on whether they came from a file or a diff.
    return DIRECTIVE.test(trimmed) ? trimmed : `pacman "${trimmed}"`
  },
  check,
  install,
  declare,
  undeclare,
  installCommand: (line) => {
    const d = splitDirective(line)
    if (!d) return null
    return d.kind === "aur"
      ? ["yay", "-S", "--needed", "--noconfirm", d.name]
      : ["sudo", "pacman", "-S", "--needed", "--noconfirm", d.name]
  },
  uninstallCommand: (line) => {
    const d = splitDirective(line)
    return d ? ["sudo", "pacman", "-Rns", "--noconfirm", d.name] : null
  },
  installHint: (tool) => `sudo pacman -S ${tool}`,
}
