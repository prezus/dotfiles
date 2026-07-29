// `dotfiles update` — pull repos, then update every package source.
//
// Bash gated the work behind four sequential y/N prompts. Here the same choices
// are one selection, made once, before anything runs.
import { join } from "node:path"
import { readBundle } from "../lib/brew.ts"
import { DOTFILES_DIR, HOME, SKILLS_REPO } from "../lib/env.ts"
import { commandExists, env, probe, runInteractiveCode } from "../lib/exec.ts"
import { isDirectory, pathExists } from "../lib/fs.ts"
import { runSteps, type Step } from "../lib/steps.ts"
import { isInteractive, printHeader, printInfo, printSuccess, printWarning } from "../lib/ui.ts"
import { skills } from "./skills.ts"
import { stow } from "./stow.ts"

export type UpdateTask = {
  id: string
  title: string
  description: string
  /** Pre-selected in the picker; matches the bash prompt defaults. */
  default: boolean
}

/** The bash `confirm` prompts, as data. Note skills defaulted to N, not Y. */
export const UPDATE_TASKS: UpdateTask[] = [
  { id: "repos", title: "Repos", description: "git pull dotfiles + skills", default: true },
  { id: "brew", title: "Homebrew", description: "brew update && brew upgrade", default: true },
  {
    id: "extras",
    title: "Language tools",
    description: "rustup, cargo, go, bun, fisher, Vite+",
    default: true,
  },
  { id: "stow", title: "Re-stow", description: "re-symlink home/ → $HOME", default: true },
  { id: "skills", title: "Vendored skills", description: "re-sync from upstream", default: false },
]

/** Package sources `brew upgrade` does not touch. */
async function updateExtras(): Promise<void> {
  if (await commandExists("rustup")) {
    printInfo("rustup update...")
    await runInteractiveCode(["rustup", "update"])
  }
  if (await commandExists("cargo-install-update")) {
    printInfo("cargo install-update -a...")
    await runInteractiveCode(["cargo", "install-update", "-a"])
  }
  if (await commandExists("go")) {
    // The go tools are declared in the Brewfile as `go "…"` lines; brew does
    // not update them, so re-install each at @latest.
    const goEntries = (await readBundle()).filter((e) => e.kind === "go")
    if (goEntries.length > 0) {
      printInfo(`updating ${goEntries.length} go tool(s)...`)
      for (const entry of goEntries) {
        await runInteractiveCode(["go", "install", `${entry.name}@latest`])
      }
    }
  }
  if (await commandExists("bun")) {
    printInfo("bun update -g...")
    await runInteractiveCode(["bun", "update", "-g"])
  }
  const fisher = await probe(["fish", "-c", "type -q fisher; and fisher update"])
  if (fisher.ok) printSuccess("fisher plugins updated")

  // Pi extensions are the same shape as fisher plugins: `pi install` records the
  // source in settings.json, which is stowed and therefore committed — but
  // nothing ever installed them back. A fresh machine would stow a settings file
  // naming extensions and silently have none of them.
  if (await commandExists("pi")) {
    printInfo("pi update --extensions...")
    await runInteractiveCode(["pi", "update", "--extensions"])
  }

  const vp = join(env.get("HOME") ?? HOME, ".vite-plus", "bin", "vp")
  if (await pathExists(vp)) {
    printInfo("Vite+ upgrade (vp)...")
    await runInteractiveCode([vp, "upgrade"])
  }
}

/** HEAD before and after a pull, so we can tell whether we rewrote ourselves. */
async function gitHead(repo: string): Promise<string> {
  return (await probe(["git", "-C", repo, "rev-parse", "HEAD"])).stdout.trim()
}

async function pullRepos(): Promise<{ selfChanged: boolean }> {
  const before = await gitHead(DOTFILES_DIR)
  const pull = await runInteractiveCode(["git", "-C", DOTFILES_DIR, "pull", "--ff-only"])
  if (pull === 0) printSuccess("dotfiles updated")
  else printWarning("dotfiles pull skipped/failed")
  const after = await gitHead(DOTFILES_DIR)

  if (await isDirectory(join(SKILLS_REPO, ".git"))) {
    const code = await runInteractiveCode(["git", "-C", SKILLS_REPO, "pull", "--ff-only"])
    if (code === 0) printSuccess("skills repo updated")
    else printWarning("skills pull skipped/failed")
  }

  if (before === after || before === "" || after === "") return { selfChanged: false }

  // Did the pull touch code this process is running? Bash had a real hazard
  // here: it pulls the very file the interpreter is reading, and bash reads
  // scripts incrementally, so a changed byte offset can resume mid-function.
  // Bun loaded this module up front so we are safe *now*, but the code on disk
  // no longer matches what is running.
  const changed = await probe(["git", "-C", DOTFILES_DIR, "diff", "--name-only", before, after])
  const touchedSelf = changed.stdout
    .split("\n")
    .some((f) => f.startsWith("src/") || f === "bun.lock" || f === "package.json" || f === "dotfiles")
  return { selfChanged: touchedSelf }
}

function selectedTasks(argv: string[]): Set<string> {
  const all = new Set(UPDATE_TASKS.map((t) => t.id))
  const only = argv.find((a) => a.startsWith("--only="))
  if (only) {
    return new Set(
      only
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => all.has(s)),
    )
  }
  if (argv.includes("--all")) return all
  return new Set(UPDATE_TASKS.filter((t) => t.default).map((t) => t.id))
}

export async function update(argv: string[] = []): Promise<number> {
  let chosen: Set<string>

  if (isInteractive() && !argv.includes("--all") && !argv.some((a) => a.startsWith("--only="))) {
    const { pickUpdateTasks } = await import("../tui/update-picker.tsx")
    const picked = await pickUpdateTasks(UPDATE_TASKS)
    if (picked === null) {
      printInfo("cancelled")
      return 0
    }
    chosen = picked
  } else {
    chosen = selectedTasks(argv)
  }

  if (chosen.size === 0) {
    printInfo("nothing selected")
    return 0
  }

  printHeader("Updating")
  let selfChanged = false

  const steps: Step[] = []
  if (chosen.has("repos")) {
    steps.push({
      id: "repos",
      title: "Pull repos",
      run: async () => {
        const result = await pullRepos()
        selfChanged = result.selfChanged
        return { ok: true }
      },
    })
  }
  if (chosen.has("brew")) {
    steps.push({
      id: "brew",
      title: "Homebrew packages",
      run: async () => {
        const updated = await runInteractiveCode(["brew", "update"])
        const upgraded = await runInteractiveCode(["brew", "upgrade"])
        return { ok: updated === 0 && upgraded === 0 }
      },
    })
  }
  if (chosen.has("extras")) {
    steps.push({
      id: "extras",
      title: "Language tools",
      run: async () => {
        await updateExtras()
        return { ok: true }
      },
    })
  }
  if (chosen.has("stow")) {
    steps.push({ id: "stow", title: "Re-stow", run: async () => ({ ok: (await stow([])) === 0 }) })
  }
  if (chosen.has("skills")) {
    steps.push({
      id: "skills",
      title: "Vendored skills",
      run: async () => ({ ok: (await skills(["update"])) === 0 }),
    })
  }

  const summary = await runSteps(steps, (report, index, total) => {
    if (report.state === "running") console.log(`\n[${index + 1}/${total}] ${report.step.title}`)
    else if (report.state === "warn") printWarning(`${report.step.title} incomplete`)
  })

  if (selfChanged) {
    printWarning("The pull changed the CLI's own source — re-run `dotfiles update` to use it.")
  }

  const failures = summary.reports.filter((r) => r.state === "warn" || r.state === "failed")
  printHeader(failures.length === 0 ? "Up to date ✨" : `${failures.length} step(s) incomplete`)
  return failures.length === 0 ? 0 : 1
}
