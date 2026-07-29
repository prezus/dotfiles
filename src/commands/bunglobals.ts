// `dotfiles bun` — global JS CLIs that have no Homebrew formula.
//
// Everything with a formula belongs in packages/bundle instead: brew tools get
// fish completions for free (AGENTS.md → CONVENTIONS). npm globals are
// eliminated entirely.
import { join } from "node:path"
import { PACKAGES_DIR } from "../lib/env.ts"
import { commandExists, runInteractiveCode } from "../lib/exec.ts"
import { parseSimpleList } from "../lib/lists.ts"
import { printInfo, printSuccess, printWarning } from "../lib/ui.ts"

export async function bunGlobals(): Promise<number> {
  if (!(await commandExists("bun"))) {
    printWarning("bun not installed; skipping bun globals")
    return 0
  }

  const file = Bun.file(join(PACKAGES_DIR, "bun-global.txt"))
  if (!(await file.exists())) {
    printInfo("no bun-global.txt; skipping")
    return 0
  }

  const packages = parseSimpleList(await file.text())
  if (packages.length === 0) {
    printInfo("no bun globals listed")
    return 0
  }

  printInfo(`Installing bun globals: ${packages.join(" ")}`)
  // One invocation — bun parallelises internally.
  const code = await runInteractiveCode(["bun", "add", "-g", ...packages])
  if (code === 0) printSuccess("bun globals installed")
  else printWarning("some bun globals failed")
  return code
}
