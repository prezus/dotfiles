import { describe, expect, it } from "bun:test"
import { plannotator } from "./plannotator.ts"

function runtime(options: { present?: boolean; installCode?: number } = {}) {
  let present = options.present ?? false
  let installs = 0
  return {
    value: {
      pathExists: async () => present,
      version: async () => "plannotator 0.26.8",
      install: async () => {
        installs += 1
        if ((options.installCode ?? 0) === 0) present = true
        return options.installCode ?? 0
      },
    },
    installs: () => installs,
  }
}

describe("plannotator", () => {
  it("does not reinstall an existing binary", async () => {
    const fake = runtime({ present: true })
    expect(await plannotator(fake.value)).toBe(0)
    expect(fake.installs()).toBe(0)
  })

  it("installs a missing binary", async () => {
    const fake = runtime()
    expect(await plannotator(fake.value)).toBe(0)
    expect(fake.installs()).toBe(1)
  })

  it("fails when the installer fails", async () => {
    const fake = runtime({ installCode: 7 })
    expect(await plannotator(fake.value)).toBe(7)
  })
})
