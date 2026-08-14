// Fix actions, keyed by check id.
//
// Every warning the bash doctor emitted ended in a parenthetical telling you
// which command to run next — "(run: dotfiles fish)", "(dotfiles skills
// install)". That was an actionable list rendered as prose because bash had no
// way to make it interactive. These are those parentheticals, as functions.
//
// Kept in a separate module from checks.ts so the check data stays free of
// side effects and can be unit-tested without any risk of mutation.
import { unlink } from "node:fs/promises"
import { join } from "node:path"
import { FISH_TOOL_COMPLETIONS, HOME_DIR, PACKAGES_DIR } from "../../lib/env.ts"
import { commandExists, probe, runInteractiveCode, which } from "../../lib/exec.ts"
import { findBrokenOwnedLinks } from "../../lib/owned.ts"
import { skills } from "../skills.ts"

export type Fix = {
  /** Shown next to the check in the TUI. Say what it will DO. */
  label: string
  run: () => Promise<string>
}

/**
 * Removals in progress: directives deleted from packages/bundle but not yet
 * committed, whose packages are therefore still installed.
 *
 * Both diffs are consulted because a removal is equally real whether or not it
 * has been staged. Normalization matches normalizeBundle's, because the results
 * are compared against it: strip the leading "-", drop trailing options, so
 * `tap "x", trusted: true` and `tap "x"` compare equal.
 *
 * The `---` guard is load-bearing: a unified diff header (`--- a/packages/bundle`)
 * also starts with a minus, and reading it as a removed directive would poison
 * the set on every single diff.
 *
 * Returns empty on any git failure (not a repo, no HEAD, git absent), which
 * degrades to the old always-append behaviour rather than blocking the fix.
 */
async function removedBundleLines(): Promise<Set<string>> {
  const bundlePath = join(PACKAGES_DIR, "bundle")
  const keep = /^-(brew|cask|tap|go|cargo) /
  const out = new Set<string>()
  for (const args of [
    ["diff", "--", bundlePath],
    ["diff", "--cached", "--", bundlePath],
  ]) {
    const res = await probe(["git", ...args])
    if (!res.ok) continue
    for (const line of res.stdout.split("\n")) {
      if (line.startsWith("---") || !keep.test(line)) continue
      out.add(line.slice(1).replace(/,.*$/, "").trim())
    }
  }
  return out
}

export const FIXES: Record<string, Fix> = {
  "login-shell": {
    label: "chsh to fish",
    run: async () => {
      const fish = await which("fish")
      if (!fish) return "fish is not installed"
      // chsh prompts for a password — must own the terminal.
      const code = await runInteractiveCode(["chsh", "-s", fish], { needsStdin: true })
      return code === 0 ? `login shell → ${fish} (log out/in to apply)` : "chsh failed"
    },
  },

  "fish-completions": {
    label: "regenerate completions",
    run: async () => {
      // Written into the stow SOURCE tree, not ~ — stow links them out.
      // Machine-generated, so gitignored. (AGENTS.md → ANTI-PATTERNS.)
      const dir = join(HOME_DIR, ".config", "fish", "completions")
      let made = 0
      for (const tool of FISH_TOOL_COMPLETIONS) {
        if (!(await commandExists(tool))) continue
        const res = await probe([tool, "completion", "fish"])
        if (!res.ok || res.stdout.trim() === "") continue
        await Bun.write(join(dir, `${tool}.fish`), res.stdout)
        made++
      }
      return `regenerated ${made}/${FISH_TOOL_COMPLETIONS.length} completions`
    },
  },

  "skills-agents": { label: "wire skills symlinks", run: skillsInstall },
  "skills-claude": { label: "wire skills symlinks", run: skillsInstall },
  "skills-pi": { label: "wire skills symlinks", run: skillsInstall },

  "untracked-packages": {
    label: "append to packages/bundle",
    run: async () => {
      // Recompute rather than trusting a possibly-stale render.
      const { CHECKS } = await import("./checks.ts")
      const check = CHECKS.find((c) => c.id === "untracked-packages")
      if (!check) return "check not found"
      const result = await check.run()
      const lines = (result.extra ?? []).map((l) => l.text.trim()).filter(Boolean)
      if (lines.length === 0) return "nothing untracked"

      // The check cannot tell the two directions of drift apart: "installed ad
      // hoc, never declared" and "deliberately undeclared, not yet uninstalled"
      // both surface as untracked. Appending is right for the first and destroys
      // the second — it silently restores exactly the lines you just deleted,
      // and the TUI applies fixes straight off a keypress with no confirmation.
      //
      // git knows the difference. A package removed from the manifest appears as
      // a deleted line in the working-tree diff, so anything matching one of
      // those is a removal in progress and must be left alone; `dotfiles prune`
      // is what finishes it.
      const removed = await removedBundleLines()
      const deliberate = lines.filter((l) => removed.has(l))
      const genuine = lines.filter((l) => !removed.has(l))

      if (genuine.length === 0)
        return `${deliberate.length} entr${deliberate.length === 1 ? "y" : "ies"} removed from the manifest but still installed — run: dotfiles prune`

      const bundlePath = join(PACKAGES_DIR, "bundle")
      const existing = await Bun.file(bundlePath).text()
      const suffix = existing.endsWith("\n") ? "" : "\n"
      await Bun.write(bundlePath, `${existing}${suffix}${genuine.join("\n")}\n`)
      const appended = `appended ${genuine.length} entr${genuine.length === 1 ? "y" : "ies"} — review git diff`
      return deliberate.length === 0
        ? appended
        : `${appended} (skipped ${deliberate.length} pending removal — run: dotfiles prune)`
    },
  },

  "broken-symlinks": {
    label: "remove broken links",
    run: async () => {
      // This action DELETES, so it must never reach a path the repo does not
      // place. Same derivation the check uses.
      const broken = await findBrokenOwnedLinks()
      let removed = 0
      for (const path of broken) {
        try {
          await unlink(path)
          removed++
        } catch {
          // Leave anything we can't remove; it'll show up on the next run.
        }
      }
      return `removed ${removed}/${broken.length} broken symlink(s)`
    },
  },
}

async function skillsInstall(): Promise<string> {
  // Native since Phase 3, but it may clone the skills repo, so it still needs
  // the terminal for git's progress output.
  const code = await skills(["install"])
  return code === 0 ? "skills symlinks wired" : "skills install failed"
}

export const fixFor = (checkId: string): Fix | undefined => FIXES[checkId]
