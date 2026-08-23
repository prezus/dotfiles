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
 * Directives that were deliberately removed from packages/bundle and whose
 * packages are therefore still installed — the drift this fix must NOT undo.
 *
 * Two sources, because a removal is deliberate at every stage of its life:
 *
 *  1. The working tree (unstaged + staged). Catches a removal in progress.
 *  2. **History.** Any directive that has ever appeared in the manifest but is
 *     absent from it now was removed at some point, and that is a decision.
 *
 * Source 2 is not optional, and leaving it out was a real bug: the guard used to
 * consult only the two working-tree diffs, both of which compare against HEAD.
 * The moment you COMMITTED a removal it vanished from both, the guard went
 * empty, and the fix re-appended every package you had just deleted — silently,
 * off a single keypress. Committing the removal is what makes it most
 * deliberate, so the old guard was strongest exactly when it mattered least.
 * (Seen for real: `c850cfc "Remove unused packages from the bundle"` took out
 * seven entries, and the next doctor fix put all seven straight back.)
 *
 * Normalization matches normalizeBundle's, because the results are compared
 * against it: drop the leading +/-, drop trailing options, so
 * `tap "x", trusted: true` and `tap "x"` compare equal.
 *
 * The `---`/`+++` guard is load-bearing: a unified diff header
 * (`--- a/packages/bundle`) also starts with a minus, and reading it as a
 * directive would poison the set on every single diff.
 *
 * Returns empty on any git failure (not a repo, no HEAD, git absent), which
 * degrades to the old always-append behaviour rather than blocking the fix.
 */
async function removedBundleLines(): Promise<Set<string>> {
  const bundlePath = join(PACKAGES_DIR, "bundle")
  const directive = /^[-+](brew|cask|tap|go|cargo) /
  const normalize = (line: string): string => line.slice(1).replace(/,.*$/, "").trim()

  const removed = new Set<string>()

  // 1. Removals not yet committed.
  for (const args of [
    ["diff", "--", bundlePath],
    ["diff", "--cached", "--", bundlePath],
  ]) {
    const res = await probe(["git", ...args])
    if (!res.ok) continue
    for (const line of res.stdout.split("\n")) {
      if (line.startsWith("---") || !line.startsWith("-") || !directive.test(line)) continue
      removed.add(normalize(line))
    }
  }

  // 2. Removals already committed. Every directive the manifest has ever held,
  //    minus the ones it holds today, is a removal somebody made on purpose.
  //    One `git log -p` rather than a query per candidate: the candidate list is
  //    whatever is installed-but-undeclared, which on a drifted machine is not
  //    small, and this file's whole history is a few hundred lines of diff.
  const history = await probe(["git", "log", "-p", "--format=", "--", bundlePath])
  if (history.ok) {
    const everPresent = new Set<string>()
    for (const line of history.stdout.split("\n")) {
      if (line.startsWith("+++") || !line.startsWith("+") || !directive.test(line)) continue
      everPresent.add(normalize(line))
    }
    const current = new Set(
      (await Bun.file(bundlePath).text())
        .split("\n")
        .filter((l) => /^(brew|cask|tap|go|cargo) /.test(l))
        .map((l) => l.replace(/,.*$/, "").trim()),
    )
    for (const line of everPresent) if (!current.has(line)) removed.add(line)
  }

  return removed
}

/**
 * Every fix, keyed by the check it repairs.
 *
 * `satisfies` rather than an annotation: `Record<string, Fix>` would throw away
 * the one thing the literal actually knows — which check ids have a fix — while
 * still not being the type the lookup below needs. This way each entry is
 * checked against Fix and the keys stay visible.
 */
/**
 * A fix that simply runs the command the warning already names.
 *
 * Most of this file's entries are that, and several checks whose message ends
 * in "(run: dotfiles X)" had no fix at all — so the TUI showed no `[fix ⏎]` and
 * pressing return answered "nothing to fix" on a row that names its own remedy.
 */
const runsCommand = (label: string, run: () => Promise<number>, done: string): Fix => ({
  label,
  run: async () => ((await run()) === 0 ? done : `${label} failed`),
})

const FIXES = {
  rustup: runsCommand(
    "install rustup + toolchains",
    async () => (await import("../rust.ts")).rust(),
    "rust toolchains installed",
  ),

  // `agent-pi`, not `pi` — agentChecks derives its ids from the binary name.
  // A fix keyed to a non-existent check is silently dead: fixFor returns
  // undefined, the row shows no [fix ⏎], and nothing says why.
  "agent-pi": runsCommand(
    "install pinned Pi plugins",
    async () => (await import("../pi.ts")).piPlugins(["install"]),
    "Pi plugins reconciled",
  ),

  "stow-drift": runsCommand(
    "re-stow home/ + overlay",
    async () => (await import("../stow.ts")).stow([]),
    "stow re-applied",
  ),

  "cargo-tools": runsCommand(
    "install missing crates",
    async () => (await import("../langtools.ts")).langToolsCmd(),
    "language tools installed",
  ),

  "go-tools": runsCommand(
    "install missing go tools",
    async () => (await import("../langtools.ts")).langToolsCmd(),
    "language tools installed",
  ),

  "bun-globals": runsCommand(
    "install bun globals",
    async () => (await import("../bunglobals.ts")).bunGlobals(),
    "bun globals installed",
  ),

  fisher: runsCommand(
    "install fisher + plugins",
    async () => (await import("../fish.ts")).fish(),
    "fisher plugins installed",
  ),

  // Declared in a manifest but not installed — the forward drift direction.
  // The reverse ("installed but undeclared") is untracked-packages below, and
  // the two must not share a fix: this one INSTALLS, that one edits a manifest.
  "missing-packages": runsCommand(
    "install declared packages",
    async () => (await import("../packages.ts")).retryFailed(),
    "declared packages installed",
  ),

  "login-shell": {
    label: "set the login shell",
    run: async () => {
      const fish = await which("fish")
      if (!fish) return "fish is not installed"

      // Two different problems wear the same warning, and running chsh for the
      // second one just prints "Shell not changed": passwd may already be fish
      // while this SESSION's $SHELL is the pre-chsh value. Only a re-login truly
      // clears that, but set-environment fixes newly spawned terminals now.
      const { systemLoginShell } = await import("../fish.ts")
      if ((await systemLoginShell())?.endsWith("fish") === true) {
        const code = await runInteractiveCode([
          "systemctl",
          "--user",
          "set-environment",
          `SHELL=${fish}`,
        ])
        return code === 0
          ? "session SHELL updated — new terminals get fish (log out to make it stick)"
          : "could not update the session SHELL; log out and back in"
      }

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
      // git knows the difference. A package removed from the manifest shows up
      // either as a deleted line in the working-tree diff (removal in progress)
      // or as a directive present in history but absent today (removal already
      // committed). Either way it must be left alone; `dotfiles reconcile` is
      // what finishes it.
      const removed = await removedBundleLines()
      const deliberate = lines.filter((l) => removed.has(l))
      const genuine = lines.filter((l) => !removed.has(l))

      if (genuine.length === 0)
        return `${deliberate.length} entr${deliberate.length === 1 ? "y" : "ies"} removed from the manifest but still installed — run: dotfiles reconcile`

      const bundlePath = join(PACKAGES_DIR, "bundle")
      const existing = await Bun.file(bundlePath).text()
      const suffix = existing.endsWith("\n") ? "" : "\n"
      await Bun.write(bundlePath, `${existing}${suffix}${genuine.join("\n")}\n`)
      const appended = `appended ${genuine.length} entr${genuine.length === 1 ? "y" : "ies"} — review git diff`
      return deliberate.length === 0
        ? appended
        : `${appended} (skipped ${deliberate.length} pending removal — run: dotfiles reconcile)`
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
} satisfies Record<string, Fix>

async function skillsInstall(): Promise<string> {
  // Native since Phase 3, but it may clone the skills repo, so it still needs
  // the terminal for git's progress output.
  const code = await skills(["install"])
  return code === 0 ? "skills symlinks wired" : "skills install failed"
}

/**
 * A check id arrives as a plain string — it comes from CHECKS, and most checks
 * have no fix — so the lookup is genuinely partial. A Map says that in the type
 * system and answers it in one step, without asserting the id into a key union
 * it might not belong to.
 */
const FIX_BY_CHECK = new Map<string, Fix>(Object.entries(FIXES))

export const fixFor = (checkId: string): Fix | undefined => FIX_BY_CHECK.get(checkId)
