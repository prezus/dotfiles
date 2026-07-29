// `dotfiles stow` — preview then apply.
//
// The plan is computed natively (src/lib/stow.ts); GNU Stow still performs the
// mutation. Previously a conflict produced stow's own wall of text and you went
// to read the man page; now the conflicting paths are named up front.
import { DOTFILES_DIR, HOME } from "../lib/env.ts"
import { commandExists, runInteractive } from "../lib/exec.ts"
import { CONFLICT_REASON, planStow, type StowPlan } from "../lib/stow.ts"
import { printError, printInfo, printSuccess, printWarning } from "../lib/ui.ts"

export function summarize(plan: StowPlan): string {
  const parts = [`${plan.ok.length} already correct`]
  if (plan.create.length) parts.push(`${plan.create.length} to create`)
  if (plan.relink.length) parts.push(`${plan.relink.length} to relink`)
  if (plan.conflicts.length) parts.push(`${plan.conflicts.length} conflict(s)`)
  return parts.join(" · ")
}

function renderPlan(plan: StowPlan): void {
  printInfo(`Stowing home/ → ${HOME}  (${summarize(plan)})`)

  for (const action of plan.create) {
    printSuccess(`+ ${action.path}${action.folds ? "/  (folded)" : ""}`)
  }
  for (const action of plan.relink) {
    printWarning(`~ ${action.path} — currently → ${action.current}`)
  }
  for (const action of plan.conflicts) {
    printError(`! ${action.path} — ${CONFLICT_REASON[action.reason] ?? action.reason}`)
  }
}

async function applyStow(adopt: boolean): Promise<number> {
  const args = ["stow", "-R"]
  if (adopt) args.push("--adopt")
  args.push("-v", "-d", DOTFILES_DIR, "-t", HOME, "home")
  return await runInteractive(args)
}

export async function stow(argv: string[] = []): Promise<number> {
  if (!(await commandExists("stow"))) {
    printError("GNU Stow not installed (brew install stow)")
    return 1
  }

  const adopt = argv.includes("--adopt")
  const dryRun = argv.includes("--dry-run")

  if (adopt) {
    printWarning(
      "--adopt: existing files are moved INTO the repo (safe only if they match; review 'git diff' after)",
    )
  }

  const plan = await planStow()
  renderPlan(plan)

  if (dryRun) {
    printInfo("--dry-run: nothing was changed")
    return plan.conflicts.length === 0 ? 0 : 1
  }

  // Conflicts are exactly what makes real stow fail, so say so before it does.
  if (plan.conflicts.length > 0 && !adopt) {
    printError(`${plan.conflicts.length} conflict(s): real files already exist at those paths.`)
    printInfo(
      `First-time on an existing machine? Run: dotfiles stow --adopt  (adopts them; then check 'git -C ${DOTFILES_DIR} diff')`,
    )
    return 1
  }

  const code = await applyStow(adopt)
  if (code === 0) printSuccess("Dotfiles stowed")
  else printError("stow failed")
  return code
}
