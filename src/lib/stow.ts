// A model of what `stow -R -d $DOTFILES_DIR -t $HOME home` will do.
//
// DELIBERATELY NOT A REIMPLEMENTATION. GNU Stow still performs every mutation;
// this only predicts it, so the CLI can show a reviewable plan and doctor can
// report drift without touching anything. Stow owns every symlink in $HOME, and
// its tree folding/unfolding is subtle enough that a bug in a real
// reimplementation would scatter or delete links. With a planner, the worst case
// of a bug is a wrong preview.
//
// Verified against this machine's actual layout:
//   ~/.zshrc                        -> Projects/dotfiles/home/.zshrc
//   ~/.config/starship/starship.toml -> ../../Projects/dotfiles/home/.config/...
// i.e. links are RELATIVE to the link's own parent directory, and stow descends
// through directories that already exist rather than folding them.
import { lstat, readdir, readlink } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { HOME, HOME_DIR, HOME_DIRS } from "./env.ts"

export type StowAction =
  /** Link already points where it should. */
  | { kind: "ok"; path: string; link: string; target: string }
  /** Nothing at the target — stow will create a link. `folds` when it links a
   *  whole directory in one go rather than descending into it. */
  | { kind: "create"; path: string; link: string; target: string; folds: boolean }
  /** A stow-owned link pointing at the wrong place; `stow -R` fixes it. */
  | { kind: "relink"; path: string; link: string; target: string; current: string }
  /**
   * Something we don't own is in the way, but its CONTENT is byte-identical to
   * the file we would link. Removing it loses nothing, so stow can take
   * ownership. This is how the tool stops fighting other providers: OrbStack
   * installs its own absolute links for docker/kubectl/orbctl completions, and
   * `<tool> completion fish` asks OrbStack's own binary — so the bytes match by
   * construction, and reclaiming is a no-op except for who owns the link.
   */
  | { kind: "reclaim"; path: string; link: string; target: string; current?: string }
  /** Something we don't own is in the way. This is what makes stow fail. */
  | {
      kind: "conflict"
      path: string
      link: string
      target: string
      reason: ConflictReason
      current?: string
    }

/** Why a path could not be claimed. Named so CONFLICT_REASON stays exhaustive over it. */
export type ConflictReason =
  | "real-file"
  | "real-dir"
  | "foreign-link"
  | "absolute-link"
  /** Two stow packages supply this file — a repo bug, not a machine one. */
  | "overlay-collision"

type OfKind<K extends StowAction["kind"]> = Extract<StowAction, { kind: K }>

export type StowPlan = {
  actions: StowAction[]
  ok: OfKind<"ok">[]
  create: OfKind<"create">[]
  relink: OfKind<"relink">[]
  reclaim: OfKind<"reclaim">[]
  conflicts: OfKind<"conflict">[]
}

/** Byte-for-byte comparison. Only called for the handful of blocked paths. */
async function sameContent(a: string, b: string): Promise<boolean> {
  try {
    const [ba, bb] = await Promise.all([Bun.file(a).arrayBuffer(), Bun.file(b).arrayBuffer()])
    const va = new Uint8Array(ba)
    const vb = new Uint8Array(bb)
    // Compare the ACTUAL buffer lengths, not a stat() size taken beforehand.
    // Mutation testing found the earlier version was one early-return away from
    // reporting a truncated file as identical: the byte loop ran to va.length,
    // so a file that was a prefix of the other compared equal. `reclaim` DELETES
    // based on this answer, so it must not depend on a single guard.
    if (va.length !== vb.length) return false
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false
    return true
  } catch {
    return false
  }
}

async function lstatSafe(path: string) {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

/**
 * Plan for a SINGLE package. The multi-package case with one source dir is
 * exactly this, so it delegates rather than keeping a second copy of the
 * fold/reclaim/relink rules in sync.
 */
export function planStow(
  sourceDir: string = HOME_DIR,
  targetDir: string = HOME,
): Promise<StowPlan> {
  return planStowAll([sourceDir], targetDir)
}

// `satisfies`, not an annotation: an annotation would erase the literal keys and
// leave an open dictionary, so a typo'd or missing reason would go unnoticed.
// This way the object stays exhaustive over ConflictReason AND keeps its keys.
export const CONFLICT_REASON = {
  "real-file": "a real file exists here",
  "real-dir": "a real directory exists where a file belongs",
  "foreign-link": "a symlink pointing outside the repo",
  "absolute-link": "an absolute symlink — stow only claims relative ones",
  "overlay-collision": "supplied by more than one stow package — see AGENTS.md PLATFORMS",
} satisfies Record<ConflictReason, string>

/**
 * Plan `stow -R -d $DOTFILES_DIR -t $HOME home home-<platform>`.
 *
 * NOT planStow called per package and concatenated: both walks would see an
 * absent ~/.config/fish and both emit `create … folds: true`, and stow folds a
 * directory only when ONE package supplies it. Providers must be counted first.
 */
export async function planStowAll(
  sourceDirs: readonly string[] = HOME_DIRS,
  targetDir: string = HOME,
): Promise<StowPlan> {
  // rel path -> the source dirs supplying it, in package order.
  const providers = new Map<string, string[]>()

  const collect = async (sourceDir: string, rel: string): Promise<void> => {
    const src = join(sourceDir, rel)
    const existing = providers.get(rel)
    if (existing) existing.push(sourceDir)
    else providers.set(rel, [sourceDir])

    const stats = await lstatSafe(src)
    if (!stats?.isDirectory()) return
    for (const child of (await readdir(src)).sort()) await collect(sourceDir, join(rel, child))
  }

  for (const sourceDir of sourceDirs) {
    if (!(await lstatSafe(sourceDir))) continue // overlay may not exist yet
    for (const entry of (await readdir(sourceDir)).sort()) await collect(sourceDir, entry)
  }

  const actions: StowAction[] = []
  const visited = new Set<string>()

  const visit = async (rel: string): Promise<void> => {
    if (visited.has(rel)) return
    visited.add(rel)

    const owners = providers.get(rel) ?? []
    const sourceDir = owners[0]
    if (sourceDir === undefined) return

    const src = join(sourceDir, rel)
    const link = join(targetDir, rel)
    const target = relative(dirname(link), src)
    const srcStats = await lstatSafe(src)
    const srcIsDir = srcStats?.isDirectory() ?? false

    const children = async (): Promise<void> => {
      const names = new Set<string>()
      for (const owner of owners) {
        const dir = join(owner, rel)
        if ((await lstatSafe(dir))?.isDirectory()) {
          for (const child of await readdir(dir)) names.add(child)
        }
      }
      for (const child of [...names].sort()) await visit(join(rel, child))
    }

    // Same file from two packages is unresolvable; same directory just means it
    // cannot fold.
    if (owners.length > 1) {
      if (srcIsDir) return await children()
      actions.push({ kind: "conflict", path: rel, link, target, reason: "overlay-collision" })
      return
    }

    const stats = await lstatSafe(link)

    if (!stats) {
      actions.push({ kind: "create", path: rel, link, target, folds: srcIsDir })
      return
    }

    if (stats.isSymbolicLink()) {
      const current = await readlink(link)
      const resolved = resolve(dirname(link), current)

      if (isAbsolute(current)) {
        const kind = (await sameContent(link, src)) ? "reclaim" : "conflict"
        actions.push(
          kind === "reclaim"
            ? { kind: "reclaim", path: rel, link, target, current }
            : { kind: "conflict", path: rel, link, target, reason: "absolute-link", current },
        )
        return
      }

      if (resolved === src) {
        actions.push({ kind: "ok", path: rel, link, target })
        return
      }

      // Ours = inside ANY package, so a file moved home/ -> home-darwin/ reads as
      // stale rather than foreign.
      const insideAny = sourceDirs.some((dir) => {
        const fromSource = relative(dir, resolved)
        return fromSource !== ".." && !fromSource.startsWith(`..${sep}`) && !isAbsolute(fromSource)
      })
      if (insideAny) actions.push({ kind: "relink", path: rel, link, target, current })
      else if (await sameContent(link, src)) actions.push({ kind: "reclaim", path: rel, link, target, current })
      else actions.push({ kind: "conflict", path: rel, link, target, reason: "foreign-link", current })
      return
    }

    if (stats.isDirectory() && srcIsDir) return await children()

    if (!stats.isDirectory() && (await sameContent(link, src))) {
      actions.push({ kind: "reclaim", path: rel, link, target })
      return
    }

    actions.push({
      kind: "conflict",
      path: rel,
      link,
      target,
      reason: stats.isDirectory() ? "real-dir" : "real-file",
    })
  }

  for (const rel of [...providers.keys()].filter((r) => !r.includes(sep)).sort()) await visit(rel)

  return {
    actions,
    ok: actions.filter((a): a is OfKind<"ok"> => a.kind === "ok"),
    create: actions.filter((a): a is OfKind<"create"> => a.kind === "create"),
    relink: actions.filter((a): a is OfKind<"relink"> => a.kind === "relink"),
    reclaim: actions.filter((a): a is OfKind<"reclaim"> => a.kind === "reclaim"),
    conflicts: actions.filter((a): a is OfKind<"conflict"> => a.kind === "conflict"),
  }
}
