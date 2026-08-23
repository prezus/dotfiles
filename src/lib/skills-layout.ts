// Where the skill links go, and how to place them without destroying skills
// somebody else put there.
//
// Omarchy plants ~/.agents/skills, ~/.claude/skills and ~/.pi/agent/skills as
// REAL DIRECTORIES containing symlinks into /usr/share/omarchy (pacman-managed,
// restored on every `omarchy update`). INSTALL.md's original spec replaced such
// a directory with one symlink, which silently removed those skills.
//
// The trigger is "another provider is already here", not "this is Linux" — the
// same thing would be right if a Mac tool ever did it.
import { readdir, lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises"
import { join, resolve } from "node:path"
import { SKILLS_SRC } from "./env.ts"

export type Layout =
  /** No foreign entries: one symlink to $SKILLS_SRC. Cheapest, and the Mac's. */
  | "linked"
  /** Someone else is here: a real dir of per-skill links, theirs preserved. */
  | "merged"

export type SkillEntry = {
  name: string
  target: string
  /** Resolves outside $SKILLS_SRC, so not ours to touch. */
  foreign: boolean
}

const lstatSafe = async (path: string) => {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

/** Entries of `dir`, classified. Empty when `dir` is absent or a symlink. */
export async function readEntries(dir: string, source = SKILLS_SRC): Promise<SkillEntry[]> {
  const stats = await lstatSafe(dir)
  if (!stats?.isDirectory() || stats.isSymbolicLink()) return []
  const out: SkillEntry[] = []
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name)
    const entry = await lstatSafe(path)
    const target = entry?.isSymbolicLink() ? resolve(dir, await readlink(path)) : path
    out.push({ name, target, foreign: !target.startsWith(source) })
  }
  return out
}

/** "merged" as soon as ANY inspected directory holds an entry we don't provide. */
export async function detectLayout(
  dirs: readonly string[],
  source = SKILLS_SRC,
): Promise<Layout> {
  for (const dir of dirs) {
    if ((await readEntries(dir, source)).some((e) => e.foreign)) return "merged"
  }
  return "linked"
}

export type MergeResult = {
  linked: string[]
  preserved: string[]
  pruned: string[]
}

/**
 * Make `dir` a real directory holding one link per skill in $SKILLS_SRC, leaving
 * every foreign entry exactly as it was.
 *
 * INVARIANT: never removes an entry it did not create. The only unlink is of a
 * link that points into $SKILLS_SRC at a skill that no longer exists.
 */
export async function mergeInto(dir: string, source = SKILLS_SRC): Promise<MergeResult> {
  await mkdir(dir, { recursive: true })

  const wanted = new Set<string>()
  for (const name of await readdir(source)) {
    if ((await lstatSafe(join(source, name)))?.isDirectory()) wanted.add(name)
  }

  const result: MergeResult = { linked: [], preserved: [], pruned: [] }

  for (const entry of await readEntries(dir, source)) {
    if (entry.foreign) {
      result.preserved.push(entry.name)
      continue
    }
    // Ours, and the skill is gone upstream.
    if (!wanted.has(entry.name)) {
      await unlink(join(dir, entry.name))
      result.pruned.push(entry.name)
    }
  }

  for (const name of [...wanted].sort()) {
    const path = join(dir, name)
    const target = join(source, name)
    const existing = await lstatSafe(path)
    if (existing?.isSymbolicLink() && resolve(dir, await readlink(path)) === target) continue
    // A foreign entry occupying a name we also provide stays theirs — the
    // invariant outranks completeness, and status() reports the shadowing.
    if (existing) continue
    await symlink(target, path)
    result.linked.push(name)
  }

  return result
}
