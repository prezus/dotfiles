import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RunOptions } from "../lib/exec.ts"
import { installPackages, type PackageRuntime } from "./packages.ts"

const directories: string[] = []

async function bundleFile(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dotfiles-packages-"))
  directories.push(directory)
  const path = join(directory, "bundle")
  await Bun.write(path, contents)
  return path
}

function recorder(codes: number[], bundleCheckOutput = "") {
  const calls: { command: string[]; opts?: RunOptions }[] = []
  const sudoReasons: string[] = []
  let releases = 0
  const runtime: PackageRuntime = {
    commandExists: async () => true,
    runInteractiveCode: async (command, opts) => {
      calls.push({ command, opts })
      return codes[calls.length - 1] ?? 0
    },
    probe: async () => ({
      code: bundleCheckOutput === "" ? 0 : 1,
      stdout: bundleCheckOutput,
      stderr: "",
      ok: bundleCheckOutput === "",
    }),
    warmSudo: async (reason) => {
      sudoReasons.push(reason)
      return { granted: true, release: () => void releases++ }
    },
  }
  return { runtime, calls, sudoReasons, releases: () => releases }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("installPackages", () => {
  it("does not install when Homebrew reports the bundle satisfied", async () => {
    const { runtime, calls } = recorder([0])
    const path = await bundleFile('brew "git"\n')
    expect((await installPackages({ bundlePath: path, runtime })).ok).toBe(true)
    expect(calls.map((call) => call.command)).toEqual([
      ["brew", "bundle", "check", "--verbose", `--file=${path}`],
    ])
  })

  it("runs an unsatisfied formula bundle on the real terminal without asking for sudo", async () => {
    const { runtime, calls, sudoReasons } = recorder(
      [1, 0],
      "→ Formula ampcode/tap/ampcode needs to be installed or updated.\n",
    )
    await installPackages({ bundlePath: await bundleFile('brew "git"\n'), runtime })
    expect(calls[0]?.opts?.needsStdin).toBeUndefined()
    expect(calls[1]?.opts?.needsStdin).toBe(true)
    expect(sudoReasons).toEqual([])
  })

  it("warms sudo for casks and releases it even when installation fails", async () => {
    const { runtime, sudoReasons, releases } = recorder(
      [1, 1],
      [
        "→ Cask ghostty needs to be installed or updated.",
        "→ Cask orbstack needs to be installed or updated.",
      ].join("\n"),
    )
    const outcome = await installPackages({
      bundlePath: await bundleFile('cask "ghostty"\ncask "orbstack"\n'),
      runtime,
    })
    expect(outcome.ok).toBe(false)
    expect(sudoReasons[0]).toContain("2 cask(s)")
    expect(releases()).toBe(1)
  })
})
