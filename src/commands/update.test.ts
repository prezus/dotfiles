import { describe, expect, it } from "bun:test"
import { updateExtras, type UpdateRuntime } from "./update.ts"

describe("language-tool updates", () => {
  it("reports a failed updater after still attempting the remaining tools", async () => {
    const attempted: string[] = []
    const runtime: UpdateRuntime = {
      commandExists: async (bin) => bin === "rustup" || bin === "bun",
      runInteractiveCode: async (command) => {
        attempted.push(command[0] ?? "")
        return command[0] === "rustup" ? 1 : 0
      },
      probe: async () => ({ code: 127, stdout: "", stderr: "", ok: false }),
      readBundle: async () => [],
    }

    const outcome = await updateExtras(runtime)

    expect(attempted).toEqual(["rustup", "bun"])
    expect(outcome).toEqual({ ok: false, detail: "failed: rustup" })
  })
})
