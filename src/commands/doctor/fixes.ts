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

      const bundlePath = join(PACKAGES_DIR, "bundle")
      const existing = await Bun.file(bundlePath).text()
      const suffix = existing.endsWith("\n") ? "" : "\n"
      await Bun.write(bundlePath, `${existing}${suffix}${lines.join("\n")}\n`)
      return `appended ${lines.length} entr${lines.length === 1 ? "y" : "ies"} — review git diff`
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
