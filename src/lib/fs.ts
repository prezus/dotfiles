// Filesystem helpers. These replace the bash `readlink`/`find`/`ln`/`mv`/`mkdir`
// shell-outs — ~30 subprocess spawns in the original, now in-process.
import { constants } from "node:fs"
import {
  access,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  stat,
  symlink,
  unlink,
} from "node:fs/promises"
import { dirname, join } from "node:path"

/** Resolve a symlink's target, or null if `path` isn't a symlink. */
export async function readlinkSafe(path: string): Promise<string | null> {
  try {
    return await readlink(path)
  } catch {
    return null
  }
}

/** True if the path exists, following symlinks. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** True if the path exists as a link, file or dir — WITHOUT following links. */
export async function lexists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function isSocket(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSocket()
  } catch {
    return false
  }
}

/** Count immediate subdirectories — the port of `find -maxdepth 1 -type d | wc -l`. */
export async function countSubdirectories(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).length
  } catch {
    return 0
  }
}

/** Count files recursively — the port of `find <dir> -type f | wc -l`. */
export async function countFilesRecursive(path: string): Promise<number> {
  let total = 0
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries.map(async (e) => {
        const full = join(dir, e.name)
        if (e.isDirectory()) return walk(full)
        if (e.isFile()) total++
      }),
    )
  }
  await walk(path)
  return total
}

/**
 * Symlinks under `root` whose target no longer resolves.
 * Port of `find "$HOME" -maxdepth 3 -type l` + an existence test per link.
 */
export async function findBrokenSymlinks(root: string, maxDepth: number): Promise<string[]> {
  const broken: string[] = []

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable dir — the bash `2>/dev/null` equivalent
    }
    await Promise.all(
      entries.map(async (e) => {
        const full = join(dir, e.name)
        if (e.isSymbolicLink()) {
          if (!(await pathExists(full))) broken.push(full)
          return
        }
        if (e.isDirectory()) return walk(full, depth + 1)
      }),
    )
  }

  await walk(root, 1)
  return broken.sort()
}

/**
 * The $HOME directories this repo actually places files into — i.e. the mirror
 * of the stow tree, derived rather than hardcoded.
 *
 * This is the definition of "ours". `home/` contains `.pi/` because we stow
 * Pi's settings.json and themes/, so `~/.pi/agent/themes` is scanned. There is
 * no `home/.claude/`, because Claude Code gets nothing from us except one
 * skills symlink — so none of its 20-odd runtime directories are ever visited.
 */
export async function mirroredDirectories(sourceDir: string, targetDir: string): Promise<string[]> {
  const dirs: string[] = []

  const walk = async (rel: string): Promise<void> => {
    const from = rel === "" ? sourceDir : join(sourceDir, rel)
    let entries
    try {
      entries = await readdir(from, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const childRel = rel === "" ? entry.name : join(rel, entry.name)
      dirs.push(join(targetDir, childRel))
      await walk(childRel)
    }
  }

  await walk("")
  return dirs
}

export type LinkOutcome =
  | { action: "already-linked"; link: string; target: string }
  | { action: "created"; link: string; target: string }
  | { action: "replaced-link"; link: string; target: string }
  | { action: "backed-up"; link: string; target: string; backup: string }

/**
 * Idempotent symlink with backup — the port of bash `_link`.
 * A real file or directory at `link` is MOVED aside, never deleted.
 */
export async function link(linkPath: string, target: string): Promise<LinkOutcome> {
  const existingTarget = await readlinkSafe(linkPath)

  if (existingTarget !== null) {
    if (existingTarget === target) return { action: "already-linked", link: linkPath, target }
    await unlink(linkPath)
    await mkdir(dirname(linkPath), { recursive: true })
    await symlink(target, linkPath)
    return { action: "replaced-link", link: linkPath, target }
  }

  if (await lexists(linkPath)) {
    const backup = `${linkPath}.bak.${timestamp()}`
    await rename(linkPath, backup)
    await mkdir(dirname(linkPath), { recursive: true })
    await symlink(target, linkPath)
    return { action: "backed-up", link: linkPath, target, backup }
  }

  await mkdir(dirname(linkPath), { recursive: true })
  await symlink(target, linkPath)
  return { action: "created", link: linkPath, target }
}

/** `date +%Y%m%d_%H%M%S`, matching the bash backup suffix format. */
export function timestamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0")
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}
