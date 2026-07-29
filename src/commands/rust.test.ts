import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyRustList, type RustRuntime } from "./rust.ts"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("Rust manifest", () => {
  it("reports failure while continuing through every requested entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dotfiles-rust-"))
    dirs.push(dir)
    const path = join(dir, "rust.txt")
    await Bun.write(path, "toolchain stable\ncomponent clippy\ntarget wasm32-unknown-unknown\n")
    const attempted: string[] = []
    const runtime: RustRuntime = {
      probe: async (command) => {
        attempted.push(command.slice(1, 3).join(" "))
        const ok = !command.includes("clippy")
        return { code: ok ? 0 : 1, stdout: "", stderr: "", ok }
      },
      commandExists: async () => false,
      runInteractiveCode: async () => 0,
    }

    const ok = await applyRustList({ rustListPath: path, runtime })

    expect(ok).toBe(false)
    expect(attempted).toEqual([
      "toolchain install",
      "component add",
      "target add",
    ])
  })
})
