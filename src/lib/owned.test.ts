// "What do we own in $HOME" is a security-ish question, not a cosmetic one: the
// answer decides what doctor is willing to DELETE. An earlier version scoped it
// to $HOME depth 3 and would have removed a git-tracked symlink in an unrelated
// project; the version after that scoped it to application directories and swept
// in ~20 of Claude Code's runtime folders to find our single symlink.
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findBrokenSymlinks, mirroredDirectories } from "./fs.ts"

let root: string
let source: string
let target: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dotfiles-owned-test-"))
  source = join(root, "home")
  target = join(root, "target")
  await mkdir(source, { recursive: true })
  await mkdir(target, { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("mirroredDirectories", () => {
  it("lists every directory the stow tree mirrors", async () => {
    await mkdir(join(source, ".config", "fish", "conf.d"), { recursive: true })
    await mkdir(join(source, ".local", "bin"), { recursive: true })

    const dirs = await mirroredDirectories(source, target)
    expect(dirs.map((d) => d.slice(target.length + 1)).sort()).toEqual([
      ".config",
      join(".config", "fish"),
      join(".config", "fish", "conf.d"),
      ".local",
      join(".local", "bin"),
    ])
  })

  it("ignores files — only directories are scan roots", async () => {
    await writeFile(join(source, ".zshrc"), "x")
    await mkdir(join(source, ".config"))
    const dirs = await mirroredDirectories(source, target)
    expect(dirs).toEqual([join(target, ".config")])
  })

  it("maps into the TARGET, never the source", async () => {
    await mkdir(join(source, ".config"))
    const dirs = await mirroredDirectories(source, target)
    expect(dirs[0]?.startsWith(target)).toBe(true)
    expect(dirs[0]?.startsWith(source)).toBe(false)
  })

  it("returns nothing for an empty or missing tree", async () => {
    expect(await mirroredDirectories(join(root, "nope"), target)).toEqual([])
  })

  it("does NOT include a directory the tree does not mirror", async () => {
    // The real case: ~/.claude exists and holds ~21 entries, but `home/` has no
    // .claude/, because Claude Code gets one skills symlink and nothing else.
    await mkdir(join(source, ".pi", "agent", "themes"), { recursive: true })
    await mkdir(join(target, ".claude", "debug"), { recursive: true })

    const dirs = await mirroredDirectories(source, target)
    expect(dirs.some((d) => d.includes(".claude"))).toBe(false)
    // Pi IS mirrored, because we genuinely stow its settings and themes.
    expect(dirs.some((d) => d.endsWith(join(".pi", "agent", "themes")))).toBe(true)
  })
})

describe("scan scope, end to end", () => {
  it("finds a dead link inside the mirrored tree", async () => {
    await mkdir(join(source, ".config"))
    await mkdir(join(target, ".config"))
    await symlink(join(root, "gone"), join(target, ".config", "dead.fish"))

    const dirs = await mirroredDirectories(source, target)
    const broken = (await Promise.all(dirs.map((d) => findBrokenSymlinks(d, 1)))).flat()
    expect(broken).toEqual([join(target, ".config", "dead.fish")])
  })

  it("ignores a dead link in another application's directory", async () => {
    // ~/.claude/debug/latest -> a debug log Claude Code already deleted.
    await mkdir(join(source, ".config"))
    await mkdir(join(target, ".config"))
    await mkdir(join(target, ".claude", "debug"), { recursive: true })
    await symlink(join(root, "gone.txt"), join(target, ".claude", "debug", "latest"))

    const dirs = await mirroredDirectories(source, target)
    const broken = (await Promise.all(dirs.map((d) => findBrokenSymlinks(d, 1)))).flat()
    expect(broken).toEqual([])
  })
})
