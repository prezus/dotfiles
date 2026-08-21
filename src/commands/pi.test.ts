import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseNpmPackageSource, piPlugins, type PiPluginRuntime } from "./pi.ts"

const writePackage = async (npmDir: string, name: string, version: string): Promise<void> => {
  const dir = join(npmDir, "node_modules", name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "package.json"), JSON.stringify({ name, version }))
}

const runtimeFor = (
  npmDir: string,
  run: PiPluginRuntime["runInteractiveCode"],
  latest: Readonly<Record<string, string>> = {},
): PiPluginRuntime => ({
  commandExists: async (bin) => bin === "bun",
  probe: async (command) => {
    const name = command[3] ?? ""
    const version = latest[name]
    return version
      ? { code: 0, stdout: JSON.stringify(version), stderr: "", ok: true }
      : { code: 1, stdout: "", stderr: "missing", ok: false }
  },
  runInteractiveCode: run,
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, contents) => writeFile(path, contents, "utf8"),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
})

describe("Pi plugin manifest", () => {
  it("parses scoped and unscoped npm package pins without confusing the scope marker", () => {
    expect(parseNpmPackageSource("npm:pi-stop@1.3.0")).toEqual({
      source: "npm:pi-stop@1.3.0",
      name: "pi-stop",
      version: "1.3.0",
    })
    expect(parseNpmPackageSource("npm:@juicesharp/rpiv-ask-user-question@2.6.4")).toEqual({
      source: "npm:@juicesharp/rpiv-ask-user-question@2.6.4",
      name: "@juicesharp/rpiv-ask-user-question",
      version: "2.6.4",
    })
  })

  it("reconciles every declaration through one exact Bun install", async () => {
    const root = await mkdtemp(join(tmpdir(), "dotfiles-pi-install-"))
    const settingsPath = join(root, "settings.json")
    const npmDir = join(root, "npm")
    await writeFile(
      settingsPath,
      JSON.stringify({ packages: ["npm:pi-stop@1.3.0", "npm:@scope/tool@2.0.0"] }),
    )

    const attempted: string[][] = []
    const runtime = runtimeFor(npmDir, async (command) => {
      attempted.push(command)
      await writePackage(npmDir, "pi-stop", "1.3.0")
      await writePackage(npmDir, "@scope/tool", "2.0.0")
      return 0
    })

    expect(await piPlugins(["install"], { settingsPath, npmDir, runtime })).toBe(0)
    expect(attempted).toEqual([
      ["bun", "add", "--exact", "pi-stop@1.3.0", "@scope/tool@2.0.0"],
    ])
  })

  it("changes tracked pins only after the selected package set installs", async () => {
    const root = await mkdtemp(join(tmpdir(), "dotfiles-pi-update-"))
    const settingsPath = join(root, "settings.json")
    const npmDir = join(root, "npm")
    const original = JSON.stringify({ theme: "dark", packages: ["npm:pi-stop@1.3.0"] })
    await writeFile(settingsPath, original)

    const failedRuntime = runtimeFor(npmDir, async () => 1, { "pi-stop": "1.4.0" })
    expect(await piPlugins(["update", "--all"], { settingsPath, npmDir, runtime: failedRuntime })).toBe(1)
    expect(await readFile(settingsPath, "utf8")).toBe(original)

    const successfulRuntime = runtimeFor(npmDir, async () => 0, { "pi-stop": "1.4.0" })
    expect(
      await piPlugins(["update", "--all"], {
        settingsPath,
        npmDir,
        runtime: successfulRuntime,
      }),
    ).toBe(0)
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
      theme: "dark",
      packages: ["npm:pi-stop@1.4.0"],
    })
  })
})
