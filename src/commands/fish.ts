// `dotfiles fish` — make fish the login shell, install plugins, generate completions.
//
// Three distinct jobs, two of which need the real terminal (sudo, chsh). Inside
// the TUI they go through withSuspendedUI.
import { join } from "node:path"
import { FISH_TOOL_COMPLETIONS, HOME_DIR } from "../lib/env.ts"
import { commandExists, run, runInteractive, which } from "../lib/exec.ts"
import { confirm, printError, printInfo, printSuccess, printWarning } from "../lib/ui.ts"
import { withSuspendedUI } from "../tui/renderer.ts"

/** Add fish to /etc/shells so chsh will accept it. Needs sudo. */
async function registerShell(fishPath: string): Promise<void> {
  const shells = Bun.file("/etc/shells")
  const contents = (await shells.exists()) ? await shells.text() : ""
  if (contents.split("\n").some((l) => l.trim() === fishPath)) return

  printInfo("Adding fish to /etc/shells (sudo)...")
  await withSuspendedUI(() =>
    runInteractive(["/bin/bash", "-c", `echo ${JSON.stringify(fishPath)} | sudo tee -a /etc/shells >/dev/null`]),
  )
}

/**
 * Generate completions for tools fish ships none for. Written into the stow
 * SOURCE tree, not ~ — stow links them out. Machine-generated, so gitignored;
 * `dotfiles doctor` verifies them.
 */
export async function generateToolCompletions(): Promise<number> {
  const dir = join(HOME_DIR, ".config", "fish", "completions")
  let made = 0
  for (const tool of FISH_TOOL_COMPLETIONS) {
    if (!(await commandExists(tool))) continue
    const res = await run([tool, "completion", "fish"])
    if (!res.ok || res.stdout.trim() === "") continue
    await Bun.write(join(dir, `${tool}.fish`), res.stdout)
    made++
  }
  printSuccess(`fish tool completions generated (${made}/${FISH_TOOL_COMPLETIONS.length})`)
  return made
}

export async function fish(): Promise<number> {
  const fishPath = await which("fish")
  if (!fishPath) {
    printError("fish not installed")
    return 1
  }

  await registerShell(fishPath)

  if (process.env.SHELL !== fishPath) {
    // Changing the login shell is not something to do on an unattended run just
    // because nobody was there to say no. bash's `read` would have taken EOF as
    // the default and gone ahead; require a real answer instead.
    if (!process.stdin.isTTY) {
      printInfo(`login shell is ${process.env.SHELL} — run interactively to switch to fish`)
    } else if (await confirm("Set fish as your default shell?", true)) {
      // chsh prompts for a password — it must own the terminal.
      const code = await withSuspendedUI(() => runInteractive(["chsh", "-s", fishPath]))
      if (code === 0) printSuccess("Default shell → fish (log out/in to apply)")
      else printWarning("chsh failed")
    }
  } else {
    printSuccess("fish is already the default shell")
  }

  // Bootstrap fisher, then install plugins from the tracked fish_plugins
  // manifest. fisher self-installs as a fish FUNCTION — there is deliberately
  // no `brew "fisher"`, which would shadow it (AGENTS.md → NOTES).
  printInfo("Installing fish plugins via fisher...")
  const fisher = await run([
    "fish",
    "-c",
    "type -q fisher; or curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher; fisher update",
  ])
  if (fisher.ok) printSuccess("fish plugins installed")
  else printWarning("fisher/plugin install had issues")

  await generateToolCompletions()
  return 0
}
