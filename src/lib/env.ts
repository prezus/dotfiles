// Single source of truth for every path the CLI touches.
// AGENTS.md CONVENTIONS: "No hardcoded paths in scripts" — this is the one file
// allowed to resolve $HOME / $DOTFILES_DIR / $SKILLS_REPO. Everything else imports.
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const HOME = homedir()

// src/lib/env.ts → src/lib → src → repo root
const SELF_DIR = dirname(fileURLToPath(import.meta.url))
export const DOTFILES_DIR = process.env.DOTFILES_DIR
  ? resolve(process.env.DOTFILES_DIR)
  : resolve(SELF_DIR, "..", "..")

export const PACKAGES_DIR = join(DOTFILES_DIR, "packages")

/** The stow SOURCE tree (repo), NOT $HOME. `dotfiles fish` writes generated
 *  completions in here and stow links them out — see AGENTS.md ANTI-PATTERNS. */
export const HOME_DIR = join(DOTFILES_DIR, "home")

export const LEGACY_SCRIPT = join(DOTFILES_DIR, "legacy", "dotfiles.bash")

// Skills live in a separate repo; dotfiles installs FROM it (see INSTALL.md).
export const SKILLS_REPO = process.env.SKILLS_REPO ?? join(HOME, "Projects", "skills")
export const SKILLS_SRC = process.env.SKILLS_SRC ?? join(SKILLS_REPO, "skills")

// Identical on every macOS install — 2BUA8C4S2C is 1Password's team id.
export const OP_AGENT_SOCK = join(
  HOME,
  "Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock",
)

/** Tools fish ships no completions for. Each must support `<tool> completion fish`. */
export const FISH_TOOL_COMPLETIONS = ["docker", "kubectl", "orb", "orbctl"] as const

/**
 * Where this repo is allowed to look for broken symlinks — and, by extension,
 * the only places it may offer to remove one.
 *
 * The bash scanned all of `$HOME` to depth 3, which reaches into ~/Projects and
 * every source repo under it. That surfaced (and would have offered to DELETE)
 * a git-tracked symlink in an unrelated project. A dotfiles CLI has no business
 * mutating anything it does not manage, so the scan is scoped to what stow
 * actually links into.
 */
export const MANAGED_ROOTS = [
  join(HOME, ".config"),
  join(HOME, ".local"),
  join(HOME, ".agents"),
  join(HOME, ".claude"),
  join(HOME, ".pi"),
] as const

export const SCRIPT_NAME = "dotfiles"
// Single source of truth — package.json, so `--version` can't drift from it.
export { version as VERSION } from "../../package.json" with { type: "json" }
