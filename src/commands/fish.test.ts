import { describe, expect, it } from "bun:test"
import { parseLoginShell } from "./fish.ts"

// Why this is read from dscl and not $SHELL: chsh only affects sessions started
// after it runs, so a terminal opened beforehand reports the OLD shell for as
// long as it lives. `dotfiles fish` used to trust $SHELL and therefore offered
// to change a shell it had already changed, every single run.
describe("parseLoginShell", () => {
  it("reads the shell out of dscl's one-line record", () => {
    expect(parseLoginShell("UserShell: /opt/homebrew/bin/fish\n")).toBe("/opt/homebrew/bin/fish")
  })

  it("tolerates the extra keys dscl prints for some accounts", () => {
    const out = "dsAttrTypeNative:_writers_UserShell: arkan\nUserShell: /bin/zsh\n"
    expect(parseLoginShell(out)).toBe("/bin/zsh")
  })

  it("returns null rather than a bogus path when the attribute is absent", () => {
    expect(parseLoginShell("No such key: UserShell\n")).toBeNull()
    expect(parseLoginShell("")).toBeNull()
  })
})
