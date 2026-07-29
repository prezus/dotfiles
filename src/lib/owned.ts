// What this repo owns in $HOME — derived, not hardcoded.
//
// This exists because the first attempt hardcoded a list of APPLICATION
// directories (~/.claude, ~/.pi) when what we actually own is a set of PATHS we
// place. The difference is not academic: ~/.claude holds ~21 entries — auth,
// sessions, debug logs, project state, plugins — and exactly ONE of them is
// ours. Scanning the parent directory meant reporting, and offering to delete,
// files belonging to a different application.
//
// The rule: we own what we place. Two sources, nothing else.
//
//   1. The stow tree — every directory mirrored from `home/`.
//   2. The skills symlink chain, which stow does not model because it crosses
//      into a separate repo and chains through itself (INSTALL.md → GNU Stow).
//
// The asymmetry between agents falls out of this naturally. `home/.pi/` exists
// because we genuinely stow Pi's settings.json and themes/, so Pi's config dirs
// are ours to check. There is no `home/.claude/` — Claude Code is simply the one
// agent that will not read the vendor-neutral ~/.agents/skills, so it gets a
// single shim symlink and nothing else. Its runtime state is its own business.
import { HOME, HOME_DIR, OWNED_LINKS } from "./env.ts"
import { findBrokenSymlinks, mirroredDirectories, pathExists, readlinkSafe } from "./fs.ts"

/** Every $HOME directory the stow tree mirrors. */
export async function ownedDirectories(): Promise<string[]> {
  return await mirroredDirectories(HOME_DIR, HOME)
}

/**
 * Broken symlinks among the paths we place — and only those.
 *
 * Depth 1 per directory is complete: every directory we mirror is in the list,
 * so a link at any depth of the stow tree is covered by its own parent.
 */
export async function findBrokenOwnedLinks(): Promise<string[]> {
  const dirs = await ownedDirectories()

  const inTree = (await Promise.all(dirs.map((dir) => findBrokenSymlinks(dir, 1)))).flat()

  // The skills chain lives outside the stow tree, so check those three paths
  // individually rather than walking the app directories that contain them.
  const chain = await Promise.all(
    OWNED_LINKS.map(async (link) => {
      const target = await readlinkSafe(link)
      if (target === null) return null // not a link, or absent — not our problem
      return (await pathExists(link)) ? null : link
    }),
  )

  return [...inTree, ...chain.filter((l): l is string => l !== null)].sort()
}
