// `dotfiles doctor` entry point.
//
// Picks a renderer, never a different set of checks: the TUI and the plain
// output are two views of the same `runChecks()` result.
import { isInteractive } from "../../lib/ui.ts"
import { countCriticalIssues, isApplicable, runChecks } from "./checks.ts"
import { renderPlain } from "./plain.ts"

export async function doctor(args: string[] = []): Promise<number> {
  const wantsPlain = args.includes("--plain") || !isInteractive()

  if (wantsPlain) {
    const checks = (await runChecks()).filter(isApplicable)
    const issues = countCriticalIssues(checks)
    renderPlain(checks, issues)
    // Behaviour change from bash, which always exited 0 and so could never be
    // used as a health gate.
    return issues === 0 ? 0 : 1
  }

  // Imported lazily so the plain path never loads OpenTUI — it keeps `doctor`
  // in a pipe fast, and keeps the TUI off the critical path if it ever breaks.
  const { runDoctorTui } = await import("./view.tsx")
  return await runDoctorTui()
}
