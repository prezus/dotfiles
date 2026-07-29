// ~/.ssh/config is shared with tools that write their own blocks (OrbStack
// re-adds an `Include` and must stay at the top). The managed block has to be
// replaceable in place without disturbing a single byte around it.
import { describe, expect, it } from "bun:test"
import { applyManagedBlock, buildBlock, stripManagedBlock } from "./ssh.ts"

const SOCK = "/Users/x/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"

describe("stripManagedBlock", () => {
  it("removes the block and its markers", () => {
    const config = ["before", ...buildBlock(SOCK).split("\n"), "after"].join("\n")
    const stripped = stripManagedBlock(config)
    expect(stripped).not.toContain("IdentityAgent")
    expect(stripped).not.toContain(">>> dotfiles managed ssh")
    expect(stripped).toContain("before")
    expect(stripped).toContain("after")
  })

  it("leaves a config with no managed block untouched", () => {
    const config = "Host github.com\n    User git\n"
    expect(stripManagedBlock(config)).toBe(config)
  })
})

describe("legacy `dot` markers", () => {
  // Found on the real machine: ~/.ssh/config carried a block under the tool's
  // former name, which the current markers could not see. The bash appended a
  // second identical `Host *` stanza rather than replacing it.
  const LEGACY = [
    "# >>> dot managed ssh >>>",
    "Host *",
    '    IdentityAgent "/old/agent.sock"',
    "# <<< dot managed ssh <<<",
  ].join("\n")

  it("adopts and removes a block written under the old name", () => {
    const stripped = stripManagedBlock(LEGACY)
    expect(stripped).not.toContain("IdentityAgent")
    expect(stripped).not.toContain("dot managed ssh")
  })

  it("collapses a legacy + current pair into exactly one block", () => {
    const both = `${LEGACY}\n${buildBlock(SOCK)}\n`
    const applied = applyManagedBlock(both, SOCK)
    expect(applied.split("Host *").length - 1).toBe(1)
    expect(applied).not.toContain("/old/agent.sock")
  })

  it("still preserves foreign content around a legacy block", () => {
    const config = `Include ~/.orbstack/ssh/config\n${LEGACY}\nHost mine\n    User me\n`
    const applied = applyManagedBlock(config, SOCK)
    expect(applied).toContain("Include ~/.orbstack/ssh/config")
    expect(applied).toContain("Host mine")
  })
})

describe("applyManagedBlock", () => {
  it("is idempotent — applying twice equals applying once", () => {
    const once = applyManagedBlock("", SOCK)
    const twice = applyManagedBlock(once, SOCK)
    expect(twice).toBe(once)
  })

  it("never accumulates duplicate blocks across many runs", () => {
    let config = "Include ~/.orbstack/ssh/config\n"
    for (let i = 0; i < 5; i++) config = applyManagedBlock(config, SOCK)
    const occurrences = config.split("# >>> dotfiles managed ssh >>>").length - 1
    expect(occurrences).toBe(1)
  })

  it("preserves foreign content, including OrbStack's Include at the top", () => {
    // AGENTS.md: OrbStack re-adds its Include and it must stay at the top.
    const original = "Include ~/.orbstack/ssh/config\n\nHost myserver\n    User me\n"
    const applied = applyManagedBlock(original, SOCK)
    expect(applied.startsWith("Include ~/.orbstack/ssh/config")).toBe(true)
    expect(applied).toContain("Host myserver")
    expect(applied).toContain("User me")
  })

  it("updates the socket path in place when it changes", () => {
    const first = applyManagedBlock("", "/old/agent.sock")
    const second = applyManagedBlock(first, SOCK)
    expect(second).toContain(SOCK)
    expect(second).not.toContain("/old/agent.sock")
  })

  it("quotes the socket path, which contains spaces", () => {
    // "Group Containers" has a space; an unquoted path breaks ssh silently.
    expect(buildBlock(SOCK)).toContain(`IdentityAgent "${SOCK}"`)
  })

  it("keeps the legacy-host compatibility stanza", () => {
    const applied = applyManagedBlock("", SOCK)
    expect(applied).toContain("Host 192.168.*")
    expect(applied).toContain("KexAlgorithms +diffie-hellman-group14-sha1")
    expect(applied).toContain("PubkeyAcceptedAlgorithms +ssh-rsa")
  })

  it("ends with exactly one trailing newline", () => {
    const applied = applyManagedBlock("Host x\n\n\n", SOCK)
    expect(applied.endsWith("\n")).toBe(true)
    expect(applied.endsWith("\n\n")).toBe(false)
  })
})
