import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { planStow, planStowAll } from "./stow.ts"

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
  it("creates the relative link GNU Stow expects", async () => {
    await writeFile(join(source, ".zshrc"), "x")
    const plan = await planStow(source, target)
    expect(plan.create).toEqual([
      expect.objectContaining({ path: ".zshrc", target: "../home/.zshrc" }),
    ])
    expect(plan.conflicts).toEqual([])
  })

  it("folds new directories but descends into existing target directories", async () => {
    await mkdir(join(source, ".config", "ghostty"), { recursive: true })
    await writeFile(join(source, ".config", "ghostty", "config"), "x")
    expect((await planStow(source, target)).create).toEqual([
      expect.objectContaining({ path: ".config", folds: true }),
    ])

    await mkdir(join(target, ".config"))
    expect((await planStow(source, target)).create.map((action) => action.path)).toEqual([
      join(".config", "ghostty"),
    ])
  })

  it("recognizes a relative link already owned by Stow", async () => {
    await writeFile(join(source, ".zshrc"), "x")
    await symlink(join("..", "home", ".zshrc"), join(target, ".zshrc"))
    const plan = await planStow(source, target)
    expect(plan.ok.map((action) => action.path)).toEqual([".zshrc"])
    expect(plan.create).toEqual([])
  })

  it("conflicts with a real file whose bytes differ", async () => {
    await writeFile(join(source, ".zshrc"), "ours")
    await writeFile(join(target, ".zshrc"), "user data")
    const plan = await planStow(source, target)
    expect(plan.conflicts[0]).toMatchObject({ path: ".zshrc", reason: "real-file" })
    expect(plan.reclaim).toEqual([])
  })

  it("reclaims a real file only when its bytes match", async () => {
    await writeFile(join(source, ".zshrc"), "same bytes")
    await writeFile(join(target, ".zshrc"), "same bytes")
    const plan = await planStow(source, target)
    expect(plan.reclaim.map((action) => action.path)).toEqual([".zshrc"])
    expect(plan.conflicts).toEqual([])
  })

  it("never reclaims a real directory", async () => {
    await writeFile(join(source, "thing"), "x")
    await mkdir(join(target, "thing"))
    const plan = await planStow(source, target)
    expect(plan.reclaim).toEqual([])
    expect(plan.conflicts[0]?.reason).toBe("real-dir")
  })

  it("does not mistake truncated or extended files for identical content", async () => {
    await writeFile(join(source, "truncated"), "abcdef")
    await writeFile(join(target, "truncated"), "abc")
    await writeFile(join(source, "extended"), "abc")
    await writeFile(join(target, "extended"), "abcdef")
    const plan = await planStow(source, target)
    expect(plan.reclaim).toEqual([])
    expect(plan.conflicts.map((action) => action.path).sort()).toEqual(["extended", "truncated"])
  })

  it("does not claim a foreign link into a similarly named sibling", async () => {
    await writeFile(join(source, ".zshrc"), "ours")
    const sibling = join(root, "home-old")
    await mkdir(sibling)
    await writeFile(join(sibling, ".zshrc"), "foreign")
    await symlink(join("..", "home-old", ".zshrc"), join(target, ".zshrc"))
    const plan = await planStow(source, target)
    expect(plan.relink).toEqual([])
    expect(plan.conflicts[0]?.reason).toBe("foreign-link")
  })

  it("reclaims an absolute link when the linked bytes match", async () => {
    await writeFile(join(source, ".zshenv"), "x")
    await symlink(join(source, ".zshenv"), join(target, ".zshenv"))
    const plan = await planStow(source, target)
    expect(plan.reclaim.map((action) => action.path)).toEqual([".zshenv"])
    expect(plan.ok).toEqual([])
  })

  it("conflicts with an absolute link whose linked bytes differ", async () => {
    const foreign = join(root, "OrbStack-docker.fish")
    await writeFile(foreign, "foreign")
    await writeFile(join(source, "docker.fish"), "ours")
    await symlink(foreign, join(target, "docker.fish"))
    const plan = await planStow(source, target)
    expect(plan.reclaim).toEqual([])
    expect(plan.conflicts[0]).toMatchObject({ reason: "absolute-link", current: foreign })
  })

  it("relinks a stale link that remains inside the package", async () => {
    await writeFile(join(source, "a"), "a")
    await writeFile(join(source, "b"), "b")
    await symlink(join("..", "home", "b"), join(target, "a"))
    expect((await planStow(source, target)).relink.map((action) => action.path)).toEqual(["a"])
  })
})

// The invariants that separate planStowAll from "call planStow twice": a shared
// directory must not fold, and a shared file must surface before stow runs.
describe("planStowAll", () => {
  it("does not fold a directory that two packages both supply", async () => {
    const overlay = join(root, "home-linux")
    await mkdir(join(source, ".config", "fish"), { recursive: true })
    await mkdir(join(overlay, ".config", "fish"), { recursive: true })
    await writeFile(join(source, ".config", "fish", "config.fish"), "shared")
    await writeFile(join(overlay, ".config", "fish", "linux.fish"), "linux")

    const plan = await planStowAll([source, overlay], target)

    // Folding .config would hide the overlay's file behind a link to home/.
    expect(plan.create.find((a) => a.path === ".config")).toBeUndefined()
    expect(plan.conflicts).toEqual([])
    expect(plan.create.map((a) => a.path).sort()).toEqual([
      join(".config", "fish", "config.fish"),
      join(".config", "fish", "linux.fish"),
    ])
  })

  it("folds a directory only one package supplies", async () => {
    const overlay = join(root, "home-linux")
    await mkdir(join(source, ".config", "nvim"), { recursive: true })
    await mkdir(join(overlay, ".config"), { recursive: true })
    await writeFile(join(source, ".config", "nvim", "init.lua"), "x")
    await writeFile(join(overlay, ".config", "linux-only"), "x")

    const plan = await planStowAll([source, overlay], target)

    // .config cannot fold, but nvim/ (shared tree only) still folds below it.
    expect(plan.create.map((a) => a.path).sort()).toEqual([
      join(".config", "linux-only"),
      join(".config", "nvim"),
    ])
    expect(plan.create.find((a) => a.path === join(".config", "nvim"))?.folds).toBe(true)
  })

  it("reports a file supplied by both packages as an overlay collision", async () => {
    const overlay = join(root, "home-linux")
    await mkdir(source, { recursive: true })
    await mkdir(overlay, { recursive: true })
    await writeFile(join(source, ".gitconfig"), "shared")
    await writeFile(join(overlay, ".gitconfig"), "linux")

    const plan = await planStowAll([source, overlay], target)

    expect(plan.conflicts).toEqual([
      expect.objectContaining({ path: ".gitconfig", reason: "overlay-collision" }),
    ])
  })

  it("relinks a file that moved from the shared tree into an overlay", async () => {
    const overlay = join(root, "home-linux")
    await mkdir(source, { recursive: true })
    await mkdir(overlay, { recursive: true })
    await writeFile(join(overlay, ".zshrc"), "moved")
    // The live link still points at the old shared location.
    await symlink(join("..", "home", ".zshrc"), join(target, ".zshrc"))

    const plan = await planStowAll([source, overlay], target)

    // Stale-but-ours: `stow -R` fixes it, so not a foreign-link conflict.
    expect(plan.relink).toEqual([expect.objectContaining({ path: ".zshrc" })])
    expect(plan.conflicts).toEqual([])
  })

  it("skips an overlay directory that does not exist yet", async () => {
    await writeFile(join(source, ".gitconfig"), "shared")
    const plan = await planStowAll([source, join(root, "absent")], target)
    expect(plan.create).toEqual([expect.objectContaining({ path: ".gitconfig" })])
  })
})
