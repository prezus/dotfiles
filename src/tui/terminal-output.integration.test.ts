import { afterEach, describe, expect, it } from "bun:test"
import { runInteractiveCode } from "../lib/exec.ts"
import { setTerminalSink } from "../lib/ui.ts"
import { TerminalSession } from "./terminal-session.ts"

afterEach(() => setTerminalSink(null))

const textAt = (session: TerminalSession, row: number): string =>
  session.snapshot().rows[row]?.runs.map((run) => run.text).join("").trimEnd() ?? ""

describe("child PTY to embedded terminal", () => {
  it("renders a tool's Unicode, ANSI and multiline redraw through the real process path", async () => {
    using session = new TerminalSession({ columns: 30, rows: 4 })
    setTerminalSink(session)

    const code = await runInteractiveCode([
      "/bin/sh",
      "-c",
      "printf '🔧 tool\\r\\nrunning\\r\\n\\033[1A\\r\\033[1;32mcomplete\\033[0m\\033[K'",
    ])

    expect(code).toBe(0)
    expect(textAt(session, 0)).toBe("🔧 tool")
    expect(textAt(session, 1)).toBe("complete")
    const completed = session.snapshot().rows[1]?.runs.find((run) => run.text === "complete")
    expect(completed?.attributes).toBe(1)
  })
})
