import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
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
  await mkdir(source)
  await mkdir(target)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function brokenInOwnedDirectories(): Promise<string[]> {
  const directories = await mirroredDirectories(source, target)
  return (await Promise.all(directories.map((directory) => findBrokenSymlinks(directory, 1)))).flat()
}

describe("owned HOME scan scope", () => {
  it("finds dead links inside directories mirrored by the stow tree", async () => {
    await mkdir(join(source, ".config"))
    await mkdir(join(target, ".config"))
    await symlink(join(root, "gone"), join(target, ".config", "dead.fish"))
    expect(await brokenInOwnedDirectories()).toEqual([join(target, ".config", "dead.fish")])
  })

  it("does not inspect an unrelated application's directory", async () => {
    await mkdir(join(source, ".config"))
    await mkdir(join(target, ".config"))
    await mkdir(join(target, ".claude", "debug"), { recursive: true })
    await symlink(join(root, "gone"), join(target, ".claude", "debug", "latest"))
    expect(await brokenInOwnedDirectories()).toEqual([])
  })
})
