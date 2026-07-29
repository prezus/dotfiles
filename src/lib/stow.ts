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
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { HOME, HOME_DIR } from "./env.ts"

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
      reason: "real-file" | "real-dir" | "foreign-link" | "absolute-link"
      current?: string
    }

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
 * Compute the plan for stowing `sourceDir` into `targetDir`.
 * Defaults to the repo's `home/` → `$HOME`.
 */
export async function planStow(
  sourceDir: string = HOME_DIR,
  targetDir: string = HOME,
): Promise<StowPlan> {
  const actions: StowAction[] = []

  const visit = async (rel: string): Promise<void> => {
    const src = join(sourceDir, rel)
    const link = join(targetDir, rel)
    // Stow writes relative links, resolved from the link's own directory.
    const target = relative(dirname(link), src)

    const stats = await lstatSafe(link)
    const srcStats = await lstatSafe(src)
    const srcIsDir = srcStats?.isDirectory() ?? false

    if (!stats) {
      // Nothing there — stow folds the whole directory into one link.
      actions.push({ kind: "create", path: rel, link, target, folds: srcIsDir })
      return
    }

    if (stats.isSymbolicLink()) {
      const current = await readlink(link)
      const resolved = resolve(dirname(link), current)

      // Stow only claims ownership of RELATIVE links into the package. An
      // absolute link is "not owned by stow" even when it points at exactly the
      // right file, and stow reports it as a conflict. Verified against
      // `stow -n`: ~/.zshenv -> /Users/arkan/Projects/dotfiles/home/.zshenv is
      // the correct target yet still conflicts.
      if (isAbsolute(current)) {
        // Even pointing at the right file, an absolute link is not stow's. If
        // the bytes match ours it is reclaimable rather than a real conflict.
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
      } else if (resolved.startsWith(sourceDir)) {
        // Ours, but stale — points elsewhere inside the package.
        actions.push({ kind: "relink", path: rel, link, target, current })
      } else if (await sameContent(link, src)) {
        actions.push({ kind: "reclaim", path: rel, link, target, current })
      } else {
        actions.push({ kind: "conflict", path: rel, link, target, reason: "foreign-link", current })
      }
      return
    }

    if (stats.isDirectory() && srcIsDir) {
      // Target dir already exists, so stow unfolds: descend and link leaves.
      const children = await readdir(src)
      for (const child of children.sort()) await visit(join(rel, child))
      return
    }

    // A real FILE whose bytes already match ours is reclaimable; a directory
    // never is, because removing it could take unrelated content with it.
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

  for (const entry of (await readdir(sourceDir)).sort()) await visit(entry)

  return {
    actions,
    ok: actions.filter((a): a is OfKind<"ok"> => a.kind === "ok"),
    create: actions.filter((a): a is OfKind<"create"> => a.kind === "create"),
    relink: actions.filter((a): a is OfKind<"relink"> => a.kind === "relink"),
    reclaim: actions.filter((a): a is OfKind<"reclaim"> => a.kind === "reclaim"),
    conflicts: actions.filter((a): a is OfKind<"conflict"> => a.kind === "conflict"),
  }
}

export const CONFLICT_REASON: Record<string, string> = {
  "real-file": "a real file exists here",
  "real-dir": "a real directory exists where a file belongs",
  "foreign-link": "a symlink pointing outside the repo",
  "absolute-link": "an absolute symlink — stow only claims relative ones",
}
