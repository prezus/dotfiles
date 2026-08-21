import { describe, expect, it } from "bun:test"
import { applyManagedBlock, buildBlock } from "./ssh.ts"

const socket = "/Users/x/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
const legacy = [
  "# >>> dot managed ssh >>>",
  "Host *",
  '    IdentityAgent "/old/agent.sock"',
  "# <<< dot managed ssh <<<",
].join("\n")

describe("managed SSH block", () => {
  it("adopts legacy markers without duplicating Host entries", () => {
    const applied = applyManagedBlock(`${legacy}\n${buildBlock(socket)}\n`, socket)
    expect(applied.split("Host *").length - 1).toBe(1)
    expect(applied).not.toContain("/old/agent.sock")
  })

  it("is idempotent while updating a changed socket path", () => {
    const updated = applyManagedBlock(applyManagedBlock("", "/old/agent.sock"), socket)
    expect(applyManagedBlock(updated, socket)).toBe(updated)
    expect(updated).toContain(socket)
    expect(updated).not.toContain("/old/agent.sock")
  })

  it("preserves foreign configuration and quotes the 1Password socket", () => {
    const original = "Include ~/.orbstack/ssh/config\n\nHost myserver\n    User me\n"
    const applied = applyManagedBlock(original, socket)
    expect(applied.startsWith("Include ~/.orbstack/ssh/config")).toBe(true)
    expect(applied).toContain("Host myserver")
    expect(applied).toContain(`IdentityAgent "${socket}"`)
  })
})
