// Line-oriented doctor output, for pipes, redirects, CI and --plain.
// Deliberately mirrors the bash layout so the port can be diffed against a
// pre-migration baseline.
import { SECTIONS, type CompletedCheck, type Status } from "./checks.ts"
import { BOLD, RESET, printHeader, printInfo, printSuccess, printWarning, printError } from "../../lib/ui.ts"

// `satisfies` keeps the literal's keys while still proving every Status is
// covered; an annotation would widen this to an open dictionary and a missing
// status would only surface as undefined at call time.
const emit = {
  ok: printSuccess,
  warn: printWarning,
  fail: printError,
  info: printInfo,
} satisfies Record<Status, (msg: string) => void>

export function renderPlain(checks: CompletedCheck[], criticalIssues: number): void {
  printHeader("Diagnostics")

  for (const section of SECTIONS) {
    const rows = checks.filter((c) => c.section === section)
    if (rows.length === 0) continue

    console.log(`\n${BOLD}${section}${RESET}`)
    for (const check of rows) {
      emit[check.result.status](check.result.message)
      for (const line of check.result.extra ?? []) {
        if (line.kind === "raw") console.log(line.text)
        else if (line.kind === "warn") printWarning(line.text)
        else printInfo(line.text)
      }
    }
  }

  console.log()
  printHeader(
    criticalIssues === 0 ? "All critical checks passed ✨" : `${criticalIssues} critical issue(s)`,
  )
}
