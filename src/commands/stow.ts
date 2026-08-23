// `dotfiles stow` — preview then apply.
//
// The plan is computed natively (src/lib/stow.ts); GNU Stow still performs the
// mutation. Previously a conflict produced stow's own wall of text and you went
// to read the man page; now the conflicting paths are named up front.
import { unlink } from "node:fs/promises"
import { DOTFILES_DIR, HOME, STOW_PACKAGES } from "../lib/env.ts"
import { IS_DARWIN } from "../lib/platform.ts"
import { commandExists, runInteractiveCode } from "../lib/exec.ts"
import { CONFLICT_REASON, planStowAll, type StowPlan } from "../lib/stow.ts"
import { printError, printInfo, printSuccess, printWarning } from "../lib/ui.ts"

export function summarize(plan: StowPlan): string {
  const parts = [`${plan.ok.length} already correct`]
  if (plan.create.length) parts.push(`${plan.create.length} to create`)
  if (plan.relink.length) parts.push(`${plan.relink.length} to relink`)
  if (plan.reclaim.length) parts.push(`${plan.reclaim.length} to reclaim`)
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
  for (const action of plan.reclaim) {
    printInfo(`↻ ${action.path} — identical content, taking ownership of the link`)
  }
  for (const action of plan.conflicts) {
    printError(`! ${action.path} — ${CONFLICT_REASON[action.reason] ?? action.reason}`)
  }
}

/**
 * Remove things that block stow but whose bytes already match ours.
 *
 * This is what lets the CLI stop fighting other providers. OrbStack installs
 * absolute symlinks for the docker/kubectl/orbctl fish completions; our copies
 * come from `<tool> completion fish`, i.e. from OrbStack's own binaries, so the
 * content is identical by construction. Deleting the link loses nothing, and if
 * OrbStack re-adds it later the next run simply reclaims it again.
 *
 * Only ever removes a path the planner proved byte-identical to the repo copy.
 */
async function reclaim(plan: StowPlan): Promise<number> {
  let count = 0
  for (const action of plan.reclaim) {
    try {
      await unlink(action.link)
      count++
    } catch {
      printWarning(`could not reclaim ${action.path}`)
    }
  }
  return count
}

async function applyStow(adopt: boolean): Promise<number> {
  const args = ["stow", "-R"]
  if (adopt) args.push("--adopt")
  args.push("-v", "-d", DOTFILES_DIR, "-t", HOME, ...STOW_PACKAGES)
  return await runInteractiveCode(args)
}

export async function stow(argv: string[] = []): Promise<number> {
  if (!(await commandExists("stow"))) {
    printError(
      `GNU Stow not installed (${IS_DARWIN ? "brew install stow" : "sudo pacman -S stow"})`,
    )
    return 1
  }

  const adopt = argv.includes("--adopt")
  const dryRun = argv.includes("--dry-run")

  if (adopt) {
    printWarning(
      "--adopt: existing files are moved INTO the repo (safe only if they match; review 'git diff' after)",
    )
  }

  const plan = await planStowAll()
  renderPlan(plan)

  if (dryRun) {
    printInfo("--dry-run: nothing was changed")
    return plan.conflicts.length === 0 ? 0 : 1
  }

  if (plan.reclaim.length > 0) {
    const count = await reclaim(plan)
    printSuccess(`reclaimed ${count} path(s) with identical content`)
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
