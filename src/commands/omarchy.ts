// `dotfiles omarchy-includes` — own the override, not the default.
//
// Omarchy ships ~/.config/ghostty/config and ~/.config/foot/foot.ini as working
// defaults that each carry an include of the CURRENT THEME:
//
//   config-file = ?"~/.local/state/omarchy/current/theme/ghostty.conf"
//   include=~/.local/state/omarchy/current/theme/foot.ini
//
// Losing that line silently breaks `omarchy theme set`. And `omarchy refresh
// config <path>` rewrites the file from the package default — through a stow
// symlink, since cp -f follows it — so owning these files means fighting the
// tool for no gain.
//
// Instead we append one include of our own and keep our settings in a file
// Omarchy has never heard of. A refresh then costs one re-run of this step.
import { join } from "node:path"
import { HOME } from "../lib/env.ts"
import { applyManagedBlock, markersFor } from "../lib/managed-block.ts"
import { IS_OMARCHY } from "../lib/platform.ts"
import { printInfo, printSuccess, printWarning } from "../lib/ui.ts"

type Target = {
  /** The Omarchy-owned file we append to. */
  config: string
  /** Our stowed file it should include. */
  personal: string
  line: (personal: string) => string
  markerName: string
}

/**
 * ghostty only.
 *
 * foot is deliberately absent even though Omarchy configures it the same way.
 * Two reasons: this repo has no foot config, so the include would point at
 * nothing; and foot.ini is SECTION-SCOPED — its `include=` belongs to `[main]`,
 * so a block appended at the end of the file lands inside `[text-bindings]` and
 * foot reads it as a keybinding ("not a valid XKB key name"). Appending to an
 * INI is not the same operation as appending to a flat config. Add foot here
 * only alongside a real config, and insert into `[main]` rather than appending.
 */
const TARGETS: Target[] = [
  {
    config: join(HOME, ".config", "ghostty", "config"),
    personal: join(HOME, ".config", "ghostty", "personal.conf"),
    // `?` marks the include optional, so ghostty starts fine before stow runs.
    line: (p) => `config-file = ?${p}`,
    markerName: "ghostty",
  },
]

/** Omarchy's own theme includes. Losing one silently breaks `omarchy theme set`. */
const THEME_INCLUDES = [
  join(HOME, ".config", "ghostty", "config"),
  join(HOME, ".config", "foot", "foot.ini"),
]

export async function omarchyIncludes(): Promise<number> {
  if (!IS_OMARCHY) {
    printInfo("not Omarchy — nothing to include")
    return 0
  }

  let touched = 0
  for (const target of TARGETS) {
    const file = Bun.file(target.config)
    if (!(await file.exists())) continue

    const current = await file.text()
    const next = applyManagedBlock(
      current,
      [target.line(target.personal)],
      markersFor(target.markerName),
    )
    if (next === current) {
      printSuccess(`${target.config} — include already present`)
      continue
    }
    await Bun.write(target.config, next)
    printSuccess(`${target.config} — include added`)
    touched++
  }

  if (touched === 0) printInfo("terminal includes already up to date")

  // The whole point of the exercise: if this goes missing, theming breaks.
  for (const path of THEME_INCLUDES) {
    const file = Bun.file(path)
    if (!(await file.exists())) continue
    if (!(await file.text()).includes("current/theme")) {
      printWarning(`${path} lost its omarchy theme include — omarchy theme set will not apply`)
    }
  }
  return 0
}
