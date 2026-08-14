// `dotfiles reconcile` — resolve every difference between this machine and
// packages/bundle, one package at a time.
//
// This replaces `prune`, which wrapped `brew bundle cleanup`. That command
// answers the whole question with a single verb — everything undeclared gets
// uninstalled — and it cannot ask, so it never learns that half the list is
// software you want and simply never wrote down. It also folds in a `brew
// cleanup` of the download cache and a trust-store reset, neither of which is
// what "remove this package" means, and neither of which can be turned off.
//
// So this does NOT wrap Bundle's cleanup. It computes the drift itself and runs
// targeted uninstalls, which costs us Bundle's cascade handling (see
// ORPHANS below) and buys a command whose blast radius is exactly the list you
// were shown.
//
// ORPHANS: `brew bundle dump` lists only on-request packages, so a dependency
// pulled in by something you remove (openjdk@21 under ghidra) never appears
// here and is left behind. `brew autoremove` is the right tool for that and is
// suggested rather than run — it is a separate decision with its own blast
// radius.
import { join } from "node:path"
import { normalizeBundle, globToRegExp } from "./doctor/checks.ts"
import { PACKAGES_DIR } from "../lib/env.ts"
import { commandExists, probe, runInteractiveCode } from "../lib/exec.ts"
import type { ReconcileRow } from "../tui/reconcile-picker.tsx"
import {
  confirm,
  isInteractive,
  printError,
  printHeader,
  printInfo,
  printSuccess,
  printWarning,
} from "../lib/ui.ts"

/** `brew "broot"` -> { kind: "brew", name: "broot" } */
function splitDirective(line: string): { kind: string; name: string } | null {
  const m = /^(brew|cask|tap|go|cargo)\s+"([^"]+)"/.exec(line)
  return m?.[1] && m[2] ? { kind: m[1], name: m[2] } : null
}

/** Both directions of drift, as picker rows. Ordered safest-choice-first. */
export function buildRows(
  dumped: string,
  tracked: string,
  ignorePatterns: RegExp[],
): ReconcileRow[] {
  const installed = normalizeBundle(dumped)
  const declared = normalizeBundle(tracked)

  const undeclared = [...installed]
    .filter((l) => !declared.has(l))
    .filter((l) => !ignorePatterns.some((re) => re.test(l)))
  const phantom = [...declared]
    .filter((l) => !installed.has(l))
    .filter((l) => !ignorePatterns.some((re) => re.test(l)))

  return [
    ...undeclared.map((id) => ({
      id,
      group: "INSTALLED, NOT DECLARED",
      // "keep" first: the safe default is to write it down, never to delete.
      choices: ["keep", "remove", "ignore"],
    })),
    ...phantom.map((id) => ({
      id,
      group: "DECLARED, NOT INSTALLED",
      // "install" first for the same reason — honour the manifest by default.
      choices: ["install", "undeclare"],
    })),
  ]
}

async function readIgnorePatterns(): Promise<RegExp[]> {
  const file = Bun.file(join(PACKAGES_DIR, "bundle.ignore"))
  if (!(await file.exists())) return []
  return (await file.text())
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map(globToRegExp)
}

/** Append directives to a manifest file, keeping a trailing newline. */
async function appendLines(path: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : ""
  const suffix = existing === "" || existing.endsWith("\n") ? "" : "\n"
  await Bun.write(path, `${existing}${suffix}${lines.join("\n")}\n`)
}

/** Delete directives from packages/bundle by exact normalized match. */
async function removeLines(path: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return
  const drop = new Set(lines)
  const kept = (await Bun.file(path).text())
    .split("\n")
    // Compare on the same normalization the sets were built with, so an entry
    // carrying `, trusted: true` still matches the bare directive it came from.
    .filter((raw) => !drop.has(raw.trim().replace(/,.*$/, "")))
  await Bun.write(path, kept.join("\n"))
}

/**
 * Compute the drift. Separate from the picker and from apply so the dashboard
 * can gather rows, render the picker on ITS renderer, and hand the answers back
 * — see runHomeTui. A command that stands up its own CliRenderer while the
 * dashboard's is mounted clobbers the global in setRenderer(), and the next
 * needsStdin child then suspends a destroyed renderer and blocks forever on an
 * invisible sudo prompt (home.tsx → the comment above `view`).
 *
 * Returns null when the drift could not be computed at all.
 */
export async function collectReconcileRows(): Promise<ReconcileRow[] | null> {
  if (!(await commandExists("brew"))) {
    printError("Homebrew not installed")
    return null
  }
  const bundlePath = join(PACKAGES_DIR, "bundle")
  if (!(await Bun.file(bundlePath).exists())) {
    printError("No packages/bundle")
    return null
  }

  // Dump to a TEMP file — never over packages/bundle, which carries hand edits
  // and comments that a dump would flatten. Same rule as doctor's drift check.
  const tmp = join(process.env.TMPDIR ?? "/tmp", `dotfiles-reconcile.${process.pid}`)
  try {
    const dump = await probe(["brew", "bundle", "dump", `--file=${tmp}`, "--force"])
    if (!dump.ok) {
      printError("could not dump brew state")
      return null
    }
    return buildRows(
      await Bun.file(tmp).text(),
      await Bun.file(bundlePath).text(),
      await readIgnorePatterns(),
    )
  } finally {
    await Bun.file(tmp)
      .unlink()
      .catch(() => {})
  }
}

export async function reconcile(): Promise<number> {
  printHeader("Reconcile")

  printInfo("Reading installed packages...")
  const rows = await collectReconcileRows()
  if (rows === null) return 1

  if (rows.length === 0) {
    printSuccess("no drift — this machine matches packages/bundle")
    return 0
  }

  if (!isInteractive()) {
    // Every choice this command offers is a question, so there is nothing
    // sensible to default to when nobody can answer. List and stop.
    printWarning(`${rows.length} mismatch(es) — run on a terminal to resolve them:`)
    for (const row of rows) printInfo(`    ${row.id}  (${row.group.toLowerCase()})`)
    return 1
  }

  // Standalone only: nothing else owns the terminal here, so a renderer of our
  // own is correct. From the dashboard this path is never taken.
  const { pickReconcile } = await import("../tui/reconcile-picker.tsx")
  const choice = await pickReconcile(rows)
  if (!choice) {
    printInfo("cancelled — nothing changed")
    return 0
  }
  return await applyReconcile(rows, choice)
}

/** Perform the chosen dispositions. Assumes the picker has already closed. */
export async function applyReconcile(
  rows: ReconcileRow[],
  choice: ReadonlyMap<string, string>,
): Promise<number> {
  const bundlePath = join(PACKAGES_DIR, "bundle")
  const pick = (want: string): string[] =>
    rows.filter((r) => choice.get(r.id) === want).map((r) => r.id)

  const keep = pick("keep")
  const ignore = pick("ignore")
  const remove = pick("remove")
  const install = pick("install")
  const undeclare = pick("undeclare")

  // ── Manifest edits first. These are safe and reviewable in git diff, so they
  // land before the confirm gate rather than behind it — if you abort the
  // uninstalls, the declarations you made are still recorded.
  await appendLines(bundlePath, keep)
  await removeLines(bundlePath, undeclare)
  await appendLines(join(PACKAGES_DIR, "bundle.ignore"), ignore)
  if (keep.length > 0) printSuccess(`declared ${keep.length} in packages/bundle`)
  if (undeclare.length > 0) printSuccess(`undeclared ${undeclare.length} from packages/bundle`)
  if (ignore.length > 0) printSuccess(`added ${ignore.length} to packages/bundle.ignore`)

  if (install.length > 0) {
    printInfo(`installing ${install.length}...`)
    for (const line of install) {
      const d = splitDirective(line)
      if (!d) continue
      const cmd =
        d.kind === "tap"
          ? ["brew", "tap", d.name]
          : ["brew", "install", ...(d.kind === "cask" ? ["--cask"] : []), d.name]
      if ((await runInteractiveCode(cmd, { needsStdin: true })) !== 0)
        printWarning(`failed to install ${d.name}`)
    }
  }

  // ── The destructive half, behind one gate showing the whole list.
  if (remove.length === 0) {
    printSuccess("reconciled — no uninstalls requested")
    return 0
  }

  printWarning(`About to uninstall ${remove.length} package(s):`)
  for (const line of remove) printInfo(`    ${line}`)
  if (!(await confirm("Uninstall these?", false))) {
    printInfo("skipped uninstalls — manifest changes above were kept")
    return 0
  }

  let failed = 0
  for (const line of remove) {
    const d = splitDirective(line)
    if (!d) continue
    const cmd =
      d.kind === "tap"
        ? ["brew", "untap", d.name]
        : ["brew", "uninstall", ...(d.kind === "cask" ? ["--cask"] : []), d.name]
    if ((await runInteractiveCode(cmd, { needsStdin: true })) !== 0) {
      printWarning(`failed to uninstall ${d.name}`)
      failed++
    }
  }

  if (failed > 0) {
    printError(`${failed} of ${remove.length} uninstalls failed`)
    return 1
  }
  printSuccess(`uninstalled ${remove.length}`)
  printInfo("Dependencies orphaned by these removals: brew autoremove")
  return 0
}
