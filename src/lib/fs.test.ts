// `link()` creates and replaces symlinks in $HOME, and the skills chain routes
// through it. The property that matters most: a real file is NEVER deleted, only
// moved aside. These run against a real temp dir — no mocks, so the test
// exercises the same syscalls production does.
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findBrokenSymlinks, link, readlinkSafe, timestamp } from "./fs.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dotfiles-fs-test-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("link", () => {
  it("creates a new symlink", async () => {
    const target = join(dir, "target")
    await mkdir(target)
    const outcome = await link(join(dir, "l"), target)
    expect(outcome.action).toBe("created")
    expect(await readlinkSafe(join(dir, "l"))).toBe(target)
  })

  it("is a no-op when already correct", async () => {
    const target = join(dir, "target")
    await mkdir(target)
    await link(join(dir, "l"), target)
    const second = await link(join(dir, "l"), target)
    expect(second.action).toBe("already-linked")
  })

  it("replaces a symlink pointing somewhere else", async () => {
    const wanted = join(dir, "wanted")
    const other = join(dir, "other")
    await mkdir(wanted)
    await mkdir(other)
    await symlink(other, join(dir, "l"))

    const outcome = await link(join(dir, "l"), wanted)
    expect(outcome.action).toBe("replaced-link")
    expect(await readlinkSafe(join(dir, "l"))).toBe(wanted)
  })

  it("backs up a real file rather than deleting it", async () => {
    const target = join(dir, "target")
    await mkdir(target)
    const occupied = join(dir, "occupied")
    await writeFile(occupied, "precious user data")

    const outcome = await link(occupied, target)
    expect(outcome.action).toBe("backed-up")
    if (outcome.action !== "backed-up") throw new Error("unreachable")

    // The critical assertion: the original bytes still exist somewhere.
    expect(await Bun.file(outcome.backup).text()).toBe("precious user data")
    expect(await readlinkSafe(occupied)).toBe(target)
  })

  it("backs up a real directory rather than deleting it", async () => {
    const target = join(dir, "target")
    await mkdir(target)
    const occupied = join(dir, "occupied")
    await mkdir(occupied)
    await writeFile(join(occupied, "inner.txt"), "keep me")

    const outcome = await link(occupied, target)
    expect(outcome.action).toBe("backed-up")
    if (outcome.action !== "backed-up") throw new Error("unreachable")
    expect(await Bun.file(join(outcome.backup, "inner.txt")).text()).toBe("keep me")
  })

  it("creates missing parent directories", async () => {
    const target = join(dir, "target")
    await mkdir(target)
    const nested = join(dir, "a", "b", "c", "l")
    const outcome = await link(nested, target)
    expect(outcome.action).toBe("created")
    expect(await readlinkSafe(nested)).toBe(target)
  })
})

describe("findBrokenSymlinks", () => {
  it("finds a dangling link and ignores a healthy one", async () => {
    const real = join(dir, "real")
    await writeFile(real, "x")
    await symlink(real, join(dir, "good"))
    await symlink(join(dir, "does-not-exist"), join(dir, "bad"))

    const broken = await findBrokenSymlinks(dir, 3)
    expect(broken).toEqual([join(dir, "bad")])
  })

  it("respects the depth limit", async () => {
    await mkdir(join(dir, "a", "b", "c", "d"), { recursive: true })
    await symlink(join(dir, "nope"), join(dir, "a", "b", "c", "d", "deep"))

    expect(await findBrokenSymlinks(dir, 2)).toEqual([])
    expect(await findBrokenSymlinks(dir, 9)).toEqual([
      join(dir, "a", "b", "c", "d", "deep"),
    ])
  })

  it("returns a stable sorted order", async () => {
    await symlink(join(dir, "nope"), join(dir, "zzz"))
    await symlink(join(dir, "nope"), join(dir, "aaa"))
    const broken = await findBrokenSymlinks(dir, 3)
    expect(broken).toEqual([...broken].sort())
  })

  it("does not throw on an unreadable directory", async () => {
    expect(await findBrokenSymlinks(join(dir, "missing"), 3)).toEqual([])
  })
})

describe("timestamp", () => {
  it("matches the bash `date +%Y%m%d_%H%M%S` backup suffix format", () => {
    expect(timestamp(new Date(2026, 6, 29, 9, 5, 3))).toBe("20260729_090503")
  })
})
