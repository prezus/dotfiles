// Sequenced, fallible steps — the shape of `init` and `update`.
//
// Replaces the bash pattern where `cmd_init` set `TOTAL_STEPS=10` by hand and
// every step had to be counted manually against the ten print_step calls below
// it. The array IS the count.
//
// Failure policy is per-step and deliberately mixed, matching the original:
// three steps abort the run (Homebrew, Packages, Stow — nothing downstream can
// work without them), and the rest degrade to a warning and continue.
export type StepOutcome = {
  ok: boolean
  /** One line describing what happened. Shown next to the step. */
  detail?: string
}

export type Step = {
  id: string
  title: string
  /** Abort the whole run if this fails. */
  required?: boolean
  run: () => Promise<StepOutcome>
}

export type StepState = "pending" | "running" | "ok" | "warn" | "failed" | "skipped"

export type StepReport = {
  step: Step
  state: StepState
  detail?: string
}

export type StepsSummary = {
  reports: StepReport[]
  aborted: boolean
  /** The required step that stopped the run, if any. */
  abortedAt?: Step
}

export type StepsListener = (report: StepReport, index: number, total: number) => void

/**
 * Run steps in order. Never throws: a step that raises is reported as failed,
 * so one broken step cannot take down a whole `init`.
 */
export async function runSteps(steps: Step[], onUpdate?: StepsListener): Promise<StepsSummary> {
  const reports: StepReport[] = steps.map((step) => ({ step, state: "pending" }))
  const total = steps.length

  const emit = (index: number) => {
    const report = reports[index]
    if (report) onUpdate?.(report, index, total)
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (!step) continue

    reports[i] = { step, state: "running" }
    emit(i)

    let outcome: StepOutcome
    try {
      outcome = await step.run()
    } catch (error) {
      outcome = { ok: false, detail: String(error) }
    }

    if (outcome.ok) {
      reports[i] = { step, state: "ok", detail: outcome.detail }
      emit(i)
      continue
    }

    if (step.required) {
      reports[i] = { step, state: "failed", detail: outcome.detail }
      emit(i)
      // Everything after a required failure is skipped, not silently ignored.
      for (let j = i + 1; j < steps.length; j++) {
        const later = steps[j]
        if (later) {
          reports[j] = { step: later, state: "skipped" }
          emit(j)
        }
      }
      return { reports, aborted: true, abortedAt: step }
    }

    reports[i] = { step, state: "warn", detail: outcome.detail }
    emit(i)
  }

  return { reports, aborted: false }
}

export const countByState = (reports: StepReport[], state: StepState): number =>
  reports.filter((r) => r.state === state).length
