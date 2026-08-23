// `dotfiles fish` — make fish the login shell, install plugins, generate completions.
//
// Three distinct jobs, two of which need the real terminal (sudo, chsh). Those
// children are marked needsStdin, and exec.ts suspends any mounted UI around
// them — the command itself does not need to know a UI exists.
import { userInfo } from "node:os"
import { join } from "node:path"
import { FISH_TOOL_COMPLETIONS, HOME_DIR } from "../lib/env.ts"
import { commandExists, probe, runInteractiveCode, which } from "../lib/exec.ts"
import { IS_DARWIN } from "../lib/platform.ts"
import { confirm, printError, printInfo, printSuccess, printWarning } from "../lib/ui.ts"

/** The shell out of `dscl . -read /Users/<u> UserShell`. Exported to be tested. */
export function parseLoginShell(dsclOutput: string): string | null {
  const m = /^UserShell:\s*(\S+)\s*$/m.exec(dsclOutput)
  return m?.[1] ?? null
}

/**
 * 7th field of a passwd line. Exported to be tested: a wrong index silently
 * yields the home directory instead of the shell.
 */
export function parsePasswdShell(getentOutput: string): string | null {
  const line = getentOutput.split("\n").find((l) => l.trim() !== "")
  if (line === undefined) return null
  const fields = line.split(":")
  // A passwd line has exactly 7 fields; anything shorter is not one.
  if (fields.length < 7) return null
  const shell = fields[6]?.trim()
  return shell ? shell : null
}

/**
 * The login shell as the SYSTEM records it.
 *
 * Deliberately not `$SHELL`. That is the shell of whatever session we were
 * launched from, and `chsh` only affects sessions started after it runs — so a
 * terminal opened before the switch reports the old shell for as long as it
 * lives. Reading it meant this command offered to change a shell it had already
 * changed, on every run, and never once said "already fish" on the machine
 * where it had just succeeded.
 */
export async function systemLoginShell(): Promise<string | null> {
  // macOS keeps this in Directory Services, not /etc/passwd; dscl does not exist
  // on Linux. getent reads NSS, so it also covers LDAP users.
  const user = userInfo().username
  const res = IS_DARWIN
    ? await probe(["/usr/bin/dscl", ".", "-read", `/Users/${user}`, "UserShell"])
    : await probe(["getent", "passwd", user])
  if (!res.ok) return process.env.SHELL ?? null
  const parsed = IS_DARWIN ? parseLoginShell(res.stdout) : parsePasswdShell(res.stdout)
  return parsed ?? (process.env.SHELL ?? null)
}

/** Add fish to /etc/shells so chsh will accept it. Needs sudo. */
async function registerShell(fishPath: string): Promise<void> {
  const shells = Bun.file("/etc/shells")
  const contents = (await shells.exists()) ? await shells.text() : ""
  if (contents.split("\n").some((l) => l.trim() === fishPath)) return

  printInfo("Adding fish to /etc/shells (sudo)...")
  await runInteractiveCode(
    ["/bin/bash", "-c", `echo ${JSON.stringify(fishPath)} | sudo tee -a /etc/shells >/dev/null`],
    { needsStdin: true },
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
    const res = await probe([tool, "completion", "fish"])
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

  const current = await systemLoginShell()
  if (current !== fishPath) {
    // Changing the login shell is not something to do on an unattended run just
    // because nobody was there to say no. bash's `read` would have taken EOF as
    // the default and gone ahead; require a real answer instead.
    if (!process.stdin.isTTY) {
      printInfo(`login shell is ${current ?? "unknown"} — run interactively to switch to fish`)
    } else if (await confirm("Set fish as your default shell?", true)) {
      // chsh prompts for a password — it must own the terminal.
      const code = await runInteractiveCode(["chsh", "-s", fishPath], { needsStdin: true })
      if (code === 0) printSuccess("Default shell → fish (log out/in to apply)")
      else printWarning("chsh failed")
    }
  } else if (process.env.SHELL !== fishPath) {
    // The switch has already happened; THIS session simply predates it. Saying
    // "already the default shell" here reads as a contradiction of the zsh
    // prompt the user is looking at, so name the reason instead.
    printSuccess(`fish is already the login shell — this session predates the change (${process.env.SHELL})`)
  } else {
    printSuccess("fish is already the default shell")
  }

  // Bootstrap fisher, then install plugins from the tracked fish_plugins
  // manifest. fisher self-installs as a fish FUNCTION — there is deliberately
  // no `brew "fisher"`, which would shadow it (AGENTS.md → NOTES).
  printInfo("Installing fish plugins via fisher...")
  const fisher = await probe([
    "fish",
    "-c",
    "type -q fisher; or curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher; fisher update",
  ])
  if (fisher.ok) printSuccess("fish plugins installed")
  else printWarning("fisher/plugin install had issues")

  await generateToolCompletions()
  return 0
}
