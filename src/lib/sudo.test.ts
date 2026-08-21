import { describe, expect, it } from "bun:test"
import { warmSudo, type SudoRuntime } from "./sudo.ts"

function runtime(options: { ticket?: boolean; interactive?: boolean }) {
  const prompts: string[] = []
  const fake: SudoRuntime = {
    hasTicket: async () => options.ticket ?? false,
    interactive: () => options.interactive ?? true,
    prompt: async (message) => {
      prompts.push(message)
      return true
    },
  }
  return { fake, prompts }
}

describe("warmSudo", () => {
  it("never prompts when no user can answer", async () => {
    const { fake, prompts } = runtime({ interactive: false })
    const session = await warmSudo("because", fake)
    expect(session.granted).toBe(false)
    expect(prompts).toEqual([])
  })

  it("shows the reason in sudo's prompt and returns a releasable session", async () => {
    const { fake, prompts } = runtime({ ticket: false })
    const session = await warmSudo("Homebrew needs it", fake)
    expect(prompts[0]).toContain("Homebrew needs it")
    expect(prompts[0]).toContain("%p")
    expect(session.granted).toBe(true)
    expect(() => session.release()).not.toThrow()
  })
})
