import { describe, expect, it } from "bun:test"
import { countByState, runSteps, type Step } from "./steps.ts"

const step = (id: string, ok: boolean, required = false): Step => ({
  id,
  title: id,
  required,
  run: async () => ({ ok, detail: ok ? "fine" : "broke" }),
})

describe("runSteps", () => {
  it("runs successful steps in order", async () => {
    const order: string[] = []
    const steps = ["a", "b", "c"].map((id): Step => ({
      id,
      title: id,
      run: async () => {
        order.push(id)
        return { ok: true }
      },
    }))
    const summary = await runSteps(steps)
    expect(order).toEqual(["a", "b", "c"])
    expect(countByState(summary.reports, "ok")).toBe(3)
  })

  it("continues after an optional failure", async () => {
    const summary = await runSteps([step("a", false), step("b", true)])
    expect(summary.aborted).toBe(false)
    expect(summary.reports.map((report) => report.state)).toEqual(["warn", "ok"])
  })

  it("aborts after a required failure and reports later steps as skipped", async () => {
    let laterRan = false
    const summary = await runSteps([
      step("homebrew", false, true),
      { id: "packages", title: "packages", run: async () => (laterRan = true, { ok: true }) },
    ])
    expect(laterRan).toBe(false)
    expect(summary.abortedAt?.id).toBe("homebrew")
    expect(summary.reports.map((report) => report.state)).toEqual(["failed", "skipped"])
  })

  it("turns an unexpected optional exception into a warning and continues", async () => {
    const summary = await runSteps([
      { id: "boom", title: "boom", run: async () => { throw new Error("kaboom") } },
      step("after", true),
    ])
    expect(summary.reports[0]).toMatchObject({ state: "warn", detail: "Error: kaboom" })
    expect(summary.reports[1]?.state).toBe("ok")
  })
})
