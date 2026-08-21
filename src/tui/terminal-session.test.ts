import { describe, expect, it } from "bun:test"
import { TerminalSession } from "./terminal-session.ts"

const textAt = (session: TerminalSession, row: number): string =>
  session.snapshot().rows[row]?.runs.map((run) => run.text).join("").trimEnd() ?? ""

describe("TerminalSession adapter behavior not covered by process integration", () => {
  it("returns terminal query responses to the connected PTY", () => {
    const replies: Uint8Array[] = []
    using session = new TerminalSession({ columns: 20, rows: 2 })
    session.connectPty((bytes) => replies.push(bytes))
    session.write(new TextEncoder().encode("\x1b[5n"))
    expect(new TextDecoder().decode(replies[0])).toBe("\x1b[0n")
  })

  it("exposes libghostty scrollback through a tail-relative offset", () => {
    using session = new TerminalSession({ columns: 20, rows: 2, maxScrollback: 20 })
    session.write(new TextEncoder().encode("one\r\ntwo\r\nthree\r\nfour"))
    session.scrollToOffset(1)
    expect(textAt(session, 0)).toBe("two")
    expect(textAt(session, 1)).toBe("three")
    expect(session.snapshot().scrollbackRows).toBe(2)
  })
})
