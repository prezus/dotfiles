import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findBrokenSymlinks, link, readlinkSafe } from "./fs.ts"

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "dotfiles-fs-test-"))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("filesystem mutations", () => {
  it("creates, reuses and replaces symlinks", async () => {
    const first = join(directory, "first")
    const second = join(directory, "second")
    await mkdir(first)
    await mkdir(second)
    expect((await link(join(directory, "link"), first)).action).toBe("created")
    expect((await link(join(directory, "link"), first)).action).toBe("already-linked")
    expect((await link(join(directory, "link"), second)).action).toBe("replaced-link")
    expect(await readlinkSafe(join(directory, "link"))).toBe(second)
  })

  it("backs up occupied files and directories without losing their contents", async () => {
    const target = join(directory, "target")
    await mkdir(target)
    const file = join(directory, "file")
    await writeFile(file, "precious user data")
    const fileOutcome = await link(file, target)
    expect(fileOutcome.action).toBe("backed-up")
    if (fileOutcome.action === "backed-up") expect(await Bun.file(fileOutcome.backup).text()).toBe("precious user data")

    const folder = join(directory, "folder")
    await mkdir(folder)
    await writeFile(join(folder, "inner.txt"), "keep me")
    const folderOutcome = await link(folder, target)
    expect(folderOutcome.action).toBe("backed-up")
    if (folderOutcome.action === "backed-up") expect(await Bun.file(join(folderOutcome.backup, "inner.txt")).text()).toBe("keep me")
  })

  it("finds dangling links only within the requested depth", async () => {
    await symlink(join(directory, "missing"), join(directory, "bad"))
    await mkdir(join(directory, "a", "b", "c"), { recursive: true })
    await symlink(join(directory, "missing"), join(directory, "a", "b", "c", "deep"))
    expect(await findBrokenSymlinks(directory, 1)).toEqual([join(directory, "bad")])
    expect(await findBrokenSymlinks(directory, 9)).toEqual([join(directory, "a", "b", "c", "deep"), join(directory, "bad")])
  })
})
