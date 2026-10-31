import { describe, expect, test } from "bun:test"
import { Either } from "effect"
import { parseManifest } from "./mcp.ts"

// The repo is public and the manifest is mirrored into other clients' configs.
// An entry that can hold a credential must never be copied, however it is spelled.
describe("parseManifest", () => {
  test("mirrors only bare https URL servers; refuses anything that can carry a credential", () => {
    const manifest = parseManifest(
      JSON.stringify({
        mcpServers: {
          executor: { url: "https://executor.example/mcp", description: "gateway", exposure: "codemode" },
          headers: { url: "https://a.example/mcp", headers: { Authorization: "Bearer ${TOKEN}" } },
          oauth: { url: "https://b.example/mcp", oauth: { clientSecret: "${SECRET}" } },
          stdio: { command: "npx", args: ["server"], env: { KEY: "${KEY}" } },
          plain: { url: "http://c.example/mcp" },
          off: { url: "https://d.example/mcp", enabled: false },
        },
      }),
    )
    expect(Either.isRight(manifest)).toBe(true)
    if (Either.isLeft(manifest)) return
    expect(manifest.right.servers).toEqual([{ name: "executor", url: "https://executor.example/mcp" }])
    expect(manifest.right.refused.map((r) => r.name).sort()).toEqual(["headers", "oauth", "off", "plain", "stdio"])
  })
})
