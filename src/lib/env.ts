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

/** espup's install root. Its subdirectories are version-stamped and move on
 *  `espup update`, so never pin a path under here — resolve by glob. The shells
 *  do the same in conf.d/esp32.fish and .config/esp32/env.sh. */
export const ESP_ROOT = join(HOME, ".rustup", "toolchains", "esp")

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

// The skills symlink chain. Not stow's — these cross into a separate repo and
// chain through each other, which stow doesn't model (INSTALL.md → GNU Stow).
export const AGENTS_SKILLS_LINK = join(HOME, ".agents", "skills")
export const CLAUDE_SKILLS_LINK = join(HOME, ".claude", "skills")
export const PI_SKILLS_LINK = join(HOME, ".pi", "agent", "skills")

/**
 * The paths this repo places into $HOME, beyond the stow tree. Everything else
 * under those application directories belongs to the app, not to us.
 *
 * `~/.claude` is the clearest case: it has ~21 entries — auth, sessions, debug
 * logs, project state — and exactly ONE is ours. Claude Code is the only agent
 * that won't read the vendor-neutral `~/.agents/skills`, so we place a single
 * shim symlink and touch nothing else (INSTALL.md → Target state).
 */
export const OWNED_LINKS = [AGENTS_SKILLS_LINK, CLAUDE_SKILLS_LINK, PI_SKILLS_LINK] as const

export const SCRIPT_NAME = "dotfiles"
// Single source of truth — package.json, so `--version` can't drift from it.
export { version as VERSION } from "../../package.json" with { type: "json" }
