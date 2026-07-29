import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { installPackages, type PackageRuntime } from "./packages.ts"

const dirs: string[] = []

async function bundleFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dotfiles-packages-"))
  dirs.push(dir)
  const path = join(dir, "bundle")
  await Bun.write(path, 'brew "git"\ngo "golang.org/x/tools/gopls"\ncargo "cargo-expand"\n')
  return path
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("installPackages", () => {
  it("leaves a satisfied Brewfile untouched", async () => {
    const calls: string[][] = []
    const runtime: PackageRuntime = {
      commandExists: async () => true,
      runInteractiveCode: async (command) => {
        calls.push(command)
        return 0
      },
    }
    const path = await bundleFile()

    const outcome = await installPackages({ bundlePath: path, runtime })

    expect(outcome.ok).toBe(true)
    expect(calls).toEqual([["brew", "bundle", "check", "--verbose", `--file=${path}`]])
  })

  it("delegates an unsatisfied Brewfile to Homebrew Bundle so every directive is installed", async () => {
    const calls: string[][] = []
    const runtime: PackageRuntime = {
      commandExists: async () => true,
      runInteractiveCode: async (command) => {
        calls.push(command)
        return calls.length === 1 ? 1 : 0
      },
    }
    const path = await bundleFile()

    const outcome = await installPackages({ bundlePath: path, runtime })

    expect(outcome.ok).toBe(true)
    expect(calls).toEqual([
      ["brew", "bundle", "check", "--verbose", `--file=${path}`],
      ["brew", "bundle", "install", `--file=${path}`],
    ])
  })
})
