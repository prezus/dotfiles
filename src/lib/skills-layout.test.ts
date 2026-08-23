import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { detectLayout, mergeInto, readEntries } from "./skills-layout.ts"

// mergeInto deletes, and the thing it must never delete belongs to a package
// manager that restores it on update — so the invariant is worth a real test
// against a real foreign provider, not a mock.
let root: string
let source: string
let vendor: string
let target: string

const skill = async (dir: string, name: string) => {
  await mkdir(join(dir, name), { recursive: true })
  await writeFile(join(dir, name, "SKILL.md"), name)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dotfiles-skills-test-"))
  source = join(root, "skills")
  vendor = join(root, "vendor-skills")
  target = join(root, "agents")
  await mkdir(source, { recursive: true })
  await mkdir(vendor, { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("mergeInto", () => {
  it("never removes an entry it did not create", async () => {
    await skill(source, "tdd")
    await skill(vendor, "omarchy")
    await mkdir(target, { recursive: true })
    await symlink(join(vendor, "omarchy"), join(target, "omarchy"))

    const result = await mergeInto(target, source)

    expect(result.preserved).toEqual(["omarchy"])
    expect(result.linked).toEqual(["tdd"])
    // The foreign link still points where its owner put it.
    expect(resolve(target, await readlink(join(target, "omarchy")))).toBe(join(vendor, "omarchy"))
    expect((await readdir(target)).sort()).toEqual(["omarchy", "tdd"])
  })

  it("prunes only our own links whose skill disappeared upstream", async () => {
    await skill(source, "kept")
    await mkdir(target, { recursive: true })
    await symlink(join(source, "kept"), join(target, "kept"))
    await symlink(join(source, "deleted-upstream"), join(target, "deleted-upstream"))
    await symlink(join(vendor, "theirs"), join(target, "theirs"))

    const result = await mergeInto(target, source)

    expect(result.pruned).toEqual(["deleted-upstream"])
    expect(result.preserved).toEqual(["theirs"])
    expect((await readdir(target)).sort()).toEqual(["kept", "theirs"])
  })

  it("is idempotent", async () => {
    await skill(source, "a")
    await skill(source, "b")
    await mergeInto(target, source)
    const second = await mergeInto(target, source)

    expect(second.linked).toEqual([])
    expect(second.pruned).toEqual([])
    expect((await readdir(target)).sort()).toEqual(["a", "b"])
  })

  it("leaves a foreign entry owning a name we also provide", async () => {
    await skill(source, "omarchy")
    await skill(vendor, "omarchy")
    await mkdir(target, { recursive: true })
    await symlink(join(vendor, "omarchy"), join(target, "omarchy"))

    const result = await mergeInto(target, source)

    expect(result.linked).toEqual([])
    expect(result.preserved).toEqual(["omarchy"])
    expect(resolve(target, await readlink(join(target, "omarchy")))).toBe(join(vendor, "omarchy"))
  })
})

describe("detectLayout", () => {
  it("is linked when nothing foreign is present", async () => {
    await skill(source, "a")
    await mergeInto(target, source)
    expect(await detectLayout([target], source)).toBe("linked")
  })

  it("is merged as soon as any inspected directory holds a foreign entry", async () => {
    const clean = join(root, "clean")
    await mkdir(clean, { recursive: true })
    await mkdir(target, { recursive: true })
    await symlink(join(vendor, "theirs"), join(target, "theirs"))
    expect(await detectLayout([clean, target], source)).toBe("merged")
  })

  it("treats an existing symlink as having no entries", async () => {
    await symlink(source, target)
    expect(await readEntries(target, source)).toEqual([])
    expect(await detectLayout([target], source)).toBe("linked")
  })
})
