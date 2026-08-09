import { describe, expect, it } from "bun:test"
import { warmSudo, type SudoRuntime } from "./sudo.ts"

type Recorded = {
  runtime: SudoRuntime
  prompts: string[]
  tickets: () => number
}

function fakeSudo(opts: { ticket?: boolean; accepts?: boolean; interactive?: boolean }): Recorded {
  const prompts: string[] = []
  let tickets = 0
  let held = opts.ticket ?? false
  return {
    prompts,
    tickets: () => tickets,
    runtime: {
      hasTicket: async () => {
        tickets++
        return held
      },
      prompt: async (message) => {
        prompts.push(message)
        held = opts.accepts ?? true
        return held
      },
      interactive: () => opts.interactive ?? true,
    },
  }
}

describe("warmSudo", () => {
  it("does not ask again when the ticket is already valid", async () => {
    const { runtime, prompts } = fakeSudo({ ticket: true })

    const session = await warmSudo("because", runtime)
    session.release()

    expect(prompts).toEqual([])
    expect(session.granted).toBe(true)
  })

  it("puts the reason in sudo's own prompt, which is the only screen the user sees", async () => {
    const { runtime, prompts } = fakeSudo({ ticket: false })

    const session = await warmSudo("Homebrew needs it", runtime)
    session.release()

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain("Homebrew needs it")
    // %p is sudo's expansion for the account being authenticated.
    expect(prompts[0]).toContain("%p")
    expect(session.granted).toBe(true)
  })

  it("degrades instead of failing when the password is declined", async () => {
    const { runtime } = fakeSudo({ ticket: false, accepts: false })

    const session = await warmSudo("because", runtime)

    expect(session.granted).toBe(false)
    expect(() => session.release()).not.toThrow()
  })

  it("never prompts with nobody at a keyboard — a script must not hang here", async () => {
    const { runtime, prompts } = fakeSudo({ ticket: false, interactive: false })

    const session = await warmSudo("because", runtime)

    expect(prompts).toEqual([])
    expect(session.granted).toBe(false)
  })

  it("keeps the ticket warm, since macOS expires it long before a bundle finishes", async () => {
    const { runtime, tickets } = fakeSudo({ ticket: true })

    const session = await warmSudo("because", runtime)
    const afterWarm = tickets()
    // The refresher is on a timer; releasing must stop it rather than leave a
    // `sudo -n -v` firing for the life of the process.
    session.release()
    await Bun.sleep(10)

    expect(afterWarm).toBe(1)
    expect(tickets()).toBe(1)
  })
})
