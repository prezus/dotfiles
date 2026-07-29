// The mixed failure policy is the subtle part of `init`: three of ten steps
// abort the run and seven degrade to a warning. Getting that backwards either
// bricks an init on a cosmetic failure, or ploughs on installing packages after
// Homebrew failed.
import { describe, expect, it } from "bun:test"
import { countByState, runSteps, type Step } from "./steps.ts"

const step = (id: string, ok: boolean, required = false): Step => ({
  id,
  title: id,
  required,
  run: async () => ({ ok, detail: ok ? "fine" : "broke" }),
})

describe("runSteps", () => {
  it("runs every step in order when all succeed", async () => {
    const order: string[] = []
    const steps: Step[] = ["a", "b", "c"].map((id) => ({
      id,
      title: id,
      run: async () => {
        order.push(id)
        return { ok: true }
      },
    }))

    const summary = await runSteps(steps)
    expect(order).toEqual(["a", "b", "c"])
    expect(summary.aborted).toBe(false)
    expect(countByState(summary.reports, "ok")).toBe(3)
  })

  it("continues past an OPTIONAL failure, marking it warn", async () => {
    const summary = await runSteps([step("a", true), step("b", false), step("c", true)])
    expect(summary.aborted).toBe(false)
    expect(countByState(summary.reports, "warn")).toBe(1)
    expect(countByState(summary.reports, "ok")).toBe(2)
  })

  it("aborts on a REQUIRED failure", async () => {
    const summary = await runSteps([step("a", true), step("b", false, true), step("c", true)])
    expect(summary.aborted).toBe(true)
    expect(summary.abortedAt?.id).toBe("b")
  })

  it("does not RUN steps after a required failure", async () => {
    let laterRan = false
    const summary = await runSteps([
      step("brew", false, true),
      {
        id: "packages",
        title: "packages",
        run: async () => {
          laterRan = true
          return { ok: true }
        },
      },
    ])
    // Installing packages after Homebrew failed is the exact thing to avoid.
    expect(laterRan).toBe(false)
    expect(summary.aborted).toBe(true)
  })

  it("reports skipped steps rather than silently omitting them", async () => {
    const summary = await runSteps([step("a", false, true), step("b", true), step("c", true)])
    expect(countByState(summary.reports, "skipped")).toBe(2)
    expect(summary.reports).toHaveLength(3)
  })

  it("treats a thrown step as failed, not as a crash", async () => {
    const summary = await runSteps([
      {
        id: "boom",
        title: "boom",
        run: async () => {
          throw new Error("kaboom")
        },
      },
      step("after", true),
    ])
    expect(summary.aborted).toBe(false)
    expect(countByState(summary.reports, "warn")).toBe(1)
    expect(summary.reports[0]?.detail).toContain("kaboom")
    // A non-required step that throws must not stop the run.
    expect(countByState(summary.reports, "ok")).toBe(1)
  })

  it("streams state transitions so a UI can render progress", async () => {
    const seen: string[] = []
    await runSteps([step("a", true), step("b", false)], (report) => {
      seen.push(`${report.step.id}:${report.state}`)
    })
    expect(seen).toEqual(["a:running", "a:ok", "b:running", "b:warn"])
  })

  it("reports the total so no step count is maintained by hand", async () => {
    // The bash had TOTAL_STEPS=10 as a literal that had to match the ten
    // print_step calls below it.
    const totals: number[] = []
    await runSteps([step("a", true), step("b", true)], (_r, _i, total) => totals.push(total))
    expect(new Set(totals)).toEqual(new Set([2]))
  })
})
