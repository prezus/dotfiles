import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RunOptions } from "../lib/exec.ts"
import { installPackages, type PackageRuntime } from "./packages.ts"

const dirs: string[] = []

const FORMULAE_ONLY = 'brew "git"\ngo "golang.org/x/tools/gopls"\ncargo "cargo-expand"\n'

async function bundleFile(contents = FORMULAE_ONLY): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dotfiles-packages-"))
  dirs.push(dir)
  const path = join(dir, "bundle")
  await Bun.write(path, contents)
  return path
}

/** A runtime that records every call; `codes` supplies each exit status in order. */
function recorder(codes: number[]) {
  const calls: { command: string[]; opts?: RunOptions }[] = []
  const sudoReasons: string[] = []
  let released = 0
  const runtime: PackageRuntime = {
    commandExists: async () => true,
    runInteractiveCode: async (command, opts) => {
      calls.push({ command, opts })
      return codes[calls.length - 1] ?? 0
    },
    warmSudo: async (reason) => {
      sudoReasons.push(reason)
      return { granted: true, release: () => void released++ }
    },
  }
  return { runtime, calls, sudoReasons, released: () => released }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("installPackages", () => {
  it("leaves a satisfied Brewfile untouched", async () => {
    const { runtime, calls } = recorder([0])
    const path = await bundleFile()

    const outcome = await installPackages({ bundlePath: path, runtime })

    expect(outcome.ok).toBe(true)
    expect(calls.map((c) => c.command)).toEqual([
      ["brew", "bundle", "check", "--verbose", `--file=${path}`],
    ])
  })

  it("delegates an unsatisfied Brewfile to Homebrew Bundle so every directive is installed", async () => {
    const { runtime, calls } = recorder([1, 0])
    const path = await bundleFile()

    const outcome = await installPackages({ bundlePath: path, runtime })

    expect(outcome.ok).toBe(true)
    expect(calls.map((c) => c.command)).toEqual([
      ["brew", "bundle", "check", "--verbose", `--file=${path}`],
      ["brew", "bundle", "install", `--file=${path}`],
    ])
  })
})

// The regression these guard: a cask with a `pkg` payload calls sudo, sudo
// prompts on the CONTROLLING terminal, and a captured child's controlling
// terminal is the pane's PTY — invisible, and impossible to type at. The
// install pass must therefore ask for the real terminal; the read-only check
// pass must not, or it would suspend the UI for nothing.
describe("installPackages — the terminal a pass runs on", () => {
  it("keeps the read-only check captured", async () => {
    const { runtime, calls } = recorder([1, 0])

    await installPackages({ bundlePath: await bundleFile(), runtime })

    expect(calls[0]?.opts?.needsStdin).toBeUndefined()
  })

  it("hands the install pass the real terminal, so a sudo prompt is reachable", async () => {
    const { runtime, calls } = recorder([1, 0])

    await installPackages({ bundlePath: await bundleFile(), runtime })

    expect(calls[1]?.opts?.needsStdin).toBe(true)
  })
})

describe("installPackages — administrator rights", () => {
  it("warms sudo before pouring casks, and names how many", async () => {
    const { runtime, sudoReasons, released } = recorder([1, 0])
    const path = await bundleFile(`${FORMULAE_ONLY}cask "ghostty"\ncask "orbstack"\n`)

    await installPackages({ bundlePath: path, runtime })

    expect(sudoReasons).toHaveLength(1)
    expect(sudoReasons[0]).toContain("2 cask(s)")
    expect(released()).toBe(1)
  })

  it("never asks for a password a formula-only bundle will not need", async () => {
    const { runtime, sudoReasons } = recorder([1, 0])

    await installPackages({ bundlePath: await bundleFile(), runtime })

    expect(sudoReasons).toEqual([])
  })

  it("stops the keepalive even when the install fails", async () => {
    const { runtime, released } = recorder([1, 1])
    const path = await bundleFile(`${FORMULAE_ONLY}cask "ghostty"\n`)

    const outcome = await installPackages({ bundlePath: path, runtime })

    expect(outcome.ok).toBe(false)
    expect(released()).toBe(1)
  })
})
