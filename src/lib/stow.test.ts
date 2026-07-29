// The stow planner predicts what GNU Stow will do to $HOME. It never mutates,
// but a wrong prediction is still a lie to the user, so the model is pinned
// here against a real temp filesystem.
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { planStow } from "./stow.ts"

let root: string
let source: string
let target: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dotfiles-stow-test-"))
  source = join(root, "home")
  target = join(root, "target")
  await mkdir(source, { recursive: true })
  await mkdir(target, { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("planStow", () => {
  it("plans a create for a file that is not yet linked", async () => {
    await writeFile(join(source, ".zshrc"), "x")
    const plan = await planStow(source, target)
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]?.path).toBe(".zshrc")
    expect(plan.conflicts).toHaveLength(0)
  })

  it("uses a RELATIVE link target, as stow does", async () => {
    await writeFile(join(source, ".zshrc"), "x")
    const plan = await planStow(source, target)
    // Verified against the real machine: ~/.zshrc -> Projects/dotfiles/home/.zshrc
    expect(plan.create[0]?.target).toBe("../home/.zshrc")
  })

  it("folds a whole directory when nothing exists at the target", async () => {
    await mkdir(join(source, ".config", "ghostty"), { recursive: true })
    await writeFile(join(source, ".config", "ghostty", "config"), "x")

    const plan = await planStow(source, target)
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]?.path).toBe(".config")
    expect(plan.create[0]?.folds).toBe(true)
  })

  it("unfolds and descends when the target directory already exists", async () => {
    await mkdir(join(source, ".config", "ghostty"), { recursive: true })
    await writeFile(join(source, ".config", "ghostty", "config"), "x")
    await mkdir(join(target, ".config"), { recursive: true }) // pre-existing real dir

    const plan = await planStow(source, target)
    // Descends one level: links .config/ghostty rather than folding .config
    expect(plan.create.map((a) => a.path)).toEqual([join(".config", "ghostty")])
  })

  it("recognises an already-correct link", async () => {
    await writeFile(join(source, ".zshrc"), "x")
    // Relative — the only form stow considers its own.
    await symlink(join("..", "home", ".zshrc"), join(target, ".zshrc"))

    const plan = await planStow(source, target)
    expect(plan.ok.map((a) => a.path)).toEqual([".zshrc"])
    expect(plan.create).toHaveLength(0)
  })

  it("flags a real file with DIFFERENT content as a conflict", async () => {
    await writeFile(join(source, ".zshrc"), "x")
    await writeFile(join(target, ".zshrc"), "pre-existing user file")

    const plan = await planStow(source, target)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.reason).toBe("real-file")
    // Never reclaim something whose bytes we would be destroying.
    expect(plan.reclaim).toHaveLength(0)
  })

  it("reclaims a real file whose content is already identical", async () => {
    await writeFile(join(source, ".zshrc"), "same bytes")
    await writeFile(join(target, ".zshrc"), "same bytes")

    const plan = await planStow(source, target)
    expect(plan.reclaim.map((a) => a.path)).toEqual([".zshrc"])
    expect(plan.conflicts).toHaveLength(0)
  })

  it("never reclaims a directory, even an empty one", async () => {
    // Removing a directory could take unrelated content with it.
    await writeFile(join(source, "thing"), "x")
    await mkdir(join(target, "thing"))

    const plan = await planStow(source, target)
    expect(plan.reclaim).toHaveLength(0)
    expect(plan.conflicts[0]?.reason).toBe("real-dir")
  })

  it("distinguishes same-size-different-bytes from identical", async () => {
    await writeFile(join(source, "f"), "aaaa")
    await writeFile(join(target, "f"), "bbbb") // same length, different content
    const plan = await planStow(source, target)
    expect(plan.reclaim).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
  })

  it("never reclaims when the existing file is a PREFIX of ours", async () => {
    // Found by mutation testing. The comparison loop ran to the shorter
    // buffer's length, so a truncated file compared equal to the full one and
    // would have been silently deleted by reclaim.
    await writeFile(join(source, "f"), "abcdef")
    await writeFile(join(target, "f"), "abc") // a truncated copy
    const plan = await planStow(source, target)
    expect(plan.reclaim).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
  })

  it("never reclaims when ours is a prefix of the existing file", async () => {
    await writeFile(join(source, "f"), "abc")
    await writeFile(join(target, "f"), "abcdef") // extra content we would destroy
    const plan = await planStow(source, target)
    expect(plan.reclaim).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
  })

  it("reclaims two empty files, which are genuinely identical", async () => {
    await writeFile(join(source, "f"), "")
    await writeFile(join(target, "f"), "")
    const plan = await planStow(source, target)
    expect(plan.reclaim).toHaveLength(1)
  })

  it("flags a RELATIVE symlink pointing outside the repo as a foreign link", async () => {
    await writeFile(join(root, "elsewhere.fish"), "someone else's file")
    await writeFile(join(source, "docker.fish"), "ours")
    await symlink(join("..", "elsewhere.fish"), join(target, "docker.fish"))

    const plan = await planStow(source, target)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.reason).toBe("foreign-link")
  })

  it("does not claim a link into a sibling whose name shares the source prefix", async () => {
    await writeFile(join(source, ".zshrc"), "ours")
    const sibling = join(root, "home-old")
    await mkdir(sibling)
    await writeFile(join(sibling, ".zshrc"), "foreign")
    await symlink(join("..", "home-old", ".zshrc"), join(target, ".zshrc"))

    const plan = await planStow(source, target)

    expect(plan.relink).toHaveLength(0)
    expect(plan.conflicts[0]?.reason).toBe("foreign-link")
  })

  it("flags OrbStack-style absolute completions as conflicts", async () => {
    // The real case on this machine: OrbStack installs its own
    // docker/kubectl/orbctl fish completions as ABSOLUTE symlinks into
    // /Applications, and stow refuses to stow over them.
    const foreign = join(root, "OrbStack-docker.fish")
    await writeFile(foreign, "orbstack's file")
    await writeFile(join(source, "docker.fish"), "ours")
    await symlink(foreign, join(target, "docker.fish")) // absolute

    const plan = await planStow(source, target)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.reason).toBe("absolute-link")
    expect(plan.conflicts[0]?.current).toBe(foreign)
  })

  it("does not call an ABSOLUTE link 'already correct'", async () => {
    // Regression. The planner originally accepted this, but GNU Stow only
    // claims ownership of RELATIVE links into the package. Confirmed with
    // `stow -n` on the real machine:
    //   ~/.zshenv -> /Users/arkan/Projects/dotfiles/home/.zshenv
    // is the correct target and stow still reports
    //   "existing target is not owned by stow: .zshenv"
    await writeFile(join(source, ".zshenv"), "x")
    await symlink(join(source, ".zshenv"), join(target, ".zshenv")) // absolute

    const plan = await planStow(source, target)
    expect(plan.ok).toHaveLength(0)
  })

  it("reclaims an absolute link whose content already matches", async () => {
    await writeFile(join(source, ".zshenv"), "x")
    await symlink(join(source, ".zshenv"), join(target, ".zshenv"))

    const plan = await planStow(source, target)
    expect(plan.reclaim.map((a) => a.path)).toEqual([".zshenv"])
    expect(plan.conflicts).toHaveLength(0)
  })

  it("still conflicts on an absolute link whose content DIFFERS", async () => {
    const foreign = join(root, "someone-elses.fish")
    await writeFile(foreign, "different bytes entirely")
    await writeFile(join(source, "docker.fish"), "ours")
    await symlink(foreign, join(target, "docker.fish"))

    const plan = await planStow(source, target)
    expect(plan.reclaim).toHaveLength(0)
    expect(plan.conflicts[0]?.reason).toBe("absolute-link")
  })

  it("accepts the equivalent RELATIVE link as already correct", async () => {
    await writeFile(join(source, ".zshenv"), "x")
    await symlink(join("..", "home", ".zshenv"), join(target, ".zshenv")) // relative

    const plan = await planStow(source, target)
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.ok.map((a) => a.path)).toEqual([".zshenv"])
  })

  it("plans a relink for a stale link that still points inside the repo", async () => {
    await writeFile(join(source, "a"), "a")
    await writeFile(join(source, "b"), "b")
    // Relative and inside the package, so stow owns it — just aimed wrong.
    await symlink(join("..", "home", "b"), join(target, "a"))

    const plan = await planStow(source, target)
    expect(plan.relink).toHaveLength(1)
    expect(plan.relink[0]?.path).toBe("a")
  })

  it("is deterministic in ordering", async () => {
    for (const name of ["z", "a", "m"]) await writeFile(join(source, name), "x")
    const first = await planStow(source, target)
    const second = await planStow(source, target)
    expect(first.actions.map((a) => a.path)).toEqual(second.actions.map((a) => a.path))
    expect(first.actions.map((a) => a.path)).toEqual(["a", "m", "z"])
  })

  it("never reports an action outside the target directory", async () => {
    await mkdir(join(source, "nested", "deep"), { recursive: true })
    await writeFile(join(source, "nested", "deep", "file"), "x")
    await mkdir(join(target, "nested"), { recursive: true })

    const plan = await planStow(source, target)
    for (const action of plan.actions) expect(action.link.startsWith(target)).toBe(true)
  })
})
