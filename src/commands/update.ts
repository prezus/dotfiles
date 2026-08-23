// `dotfiles update` — pull repos, then update every package source.
//
// Bash gated the work behind four sequential y/N prompts. Here the same choices
// are one selection, made once, before anything runs.
import { join } from "node:path"
import { readBundle } from "../lib/brew.ts"
import { DOTFILES_DIR, HOME, SKILLS_REPO } from "../lib/env.ts"
import { commandExists, env, probe, runInteractiveCode } from "../lib/exec.ts"
import { isDirectory, pathExists } from "../lib/fs.ts"
import { IS_DARWIN } from "../lib/platform.ts"
import { runSteps, type Step, type StepOutcome } from "../lib/steps.ts"
import { getStepSink, isInteractive, printHeader, printInfo, printSuccess, printWarning } from "../lib/ui.ts"
import { piPlugins } from "./pi.ts"
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
  {
    id: "packages",
    title: IS_DARWIN ? "Homebrew" : "pacman",
    description: IS_DARWIN ? "brew update && brew upgrade" : "yay -Syu (repos + AUR)",
    default: true,
  },
  {
    id: "extras",
    title: "Language tools",
    description: "rustup, cargo, go, bun, fisher, Vite+",
    default: true,
  },
  { id: "stow", title: "Re-stow", description: "re-symlink home/ → $HOME", default: true },
  {
    id: "pi",
    title: "Pi plugins",
    description: "review and advance tracked plugin pins",
    default: false,
  },
  { id: "skills", title: "Vendored skills", description: "re-sync from upstream", default: false },
]

export type UpdateRuntime = {
  commandExists: typeof commandExists
  runInteractiveCode: typeof runInteractiveCode
  probe: typeof probe
  readBundle: typeof readBundle
  pathExists: typeof pathExists
}

const defaultUpdateRuntime: UpdateRuntime = {
  commandExists,
  runInteractiveCode,
  probe,
  readBundle,
  pathExists,
}

/** Package sources `brew upgrade` does not touch. Attempts all and reports all failures. */
export async function updateExtras(runtime: UpdateRuntime = defaultUpdateRuntime): Promise<StepOutcome> {
  const failed: string[] = []
  const runOne = async (label: string, command: string[]): Promise<void> => {
    if ((await runtime.runInteractiveCode(command)) !== 0) failed.push(label)
  }

  if (await runtime.commandExists("rustup")) {
    printInfo("rustup update...")
    await runOne("rustup", ["rustup", "update"])
  }
  if (await runtime.commandExists("cargo-install-update")) {
    printInfo("cargo install-update -a...")
    await runOne("cargo", ["cargo", "install-update", "-a"])
  }
  if (await runtime.commandExists("go")) {
    const goEntries = (await runtime.readBundle()).filter((e) => e.kind === "go")
    if (goEntries.length > 0) {
      printInfo(`updating ${goEntries.length} go tool(s)...`)
      for (const entry of goEntries) {
        await runOne(`go:${entry.name}`, ["go", "install", `${entry.name}@latest`])
      }
    }
  }
  if (await runtime.commandExists("bun")) {
    printInfo("bun update -g...")
    await runOne("bun", ["bun", "update", "-g"])
  }
  if (await runtime.commandExists("fish")) {
    const fisher = await runtime.probe(["fish", "-c", "type -q fisher"])
    if (fisher.ok) {
      await runOne("fisher", ["fish", "-c", "fisher update"])
      if (!failed.includes("fisher")) printSuccess("fisher plugins updated")
    }
  }

  const vp = join(env.get("HOME") ?? HOME, ".vite-plus", "bin", "vp")
  if (await runtime.pathExists(vp)) {
    printInfo("Vite+ upgrade (vp)...")
    await runOne("Vite+", [vp, "upgrade"])
  }

  return failed.length === 0 ? { ok: true } : { ok: false, detail: `failed: ${failed.join(", ")}` }
}

/** HEAD before and after a pull, so we can tell whether we rewrote ourselves. */
async function gitHead(repo: string): Promise<string> {
  return (await probe(["git", "-C", repo, "rev-parse", "HEAD"])).stdout.trim()
}

async function pullRepos(): Promise<{ ok: boolean; selfChanged: boolean; detail?: string }> {
  const failed: string[] = []
  const before = await gitHead(DOTFILES_DIR)
  const pull = await runInteractiveCode(["git", "-C", DOTFILES_DIR, "pull", "--ff-only"])
  if (pull === 0) printSuccess("dotfiles updated")
  else {
    failed.push("dotfiles pull")
    printWarning("dotfiles pull skipped/failed")
  }
  const after = await gitHead(DOTFILES_DIR)

  if (await isDirectory(join(SKILLS_REPO, ".git"))) {
    const code = await runInteractiveCode(["git", "-C", SKILLS_REPO, "pull", "--ff-only"])
    if (code === 0) printSuccess("skills repo updated")
    else {
      failed.push("skills pull")
      printWarning("skills pull skipped/failed")
    }
  }

  const outcome = (selfChanged: boolean) => ({
    ok: failed.length === 0,
    selfChanged,
    detail: failed.length > 0 ? `failed: ${failed.join(", ")}` : undefined,
  })
  if (before === after || before === "" || after === "") return outcome(false)

  // Did the pull touch code this process is running? Bash had a real hazard
  // here: it pulls the very file the interpreter is reading, and bash reads
  // scripts incrementally, so a changed byte offset can resume mid-function.
  // Bun loaded this module up front so we are safe *now*, but the code on disk
  // no longer matches what is running.
  const changed = await probe(["git", "-C", DOTFILES_DIR, "diff", "--name-only", before, after])
  const touchedSelf = changed.stdout
    .split("\n")
    .some((f) => f.startsWith("src/") || f === "bun.lock" || f === "package.json" || f === "dotfiles")
  return outcome(touchedSelf)
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
        return { ok: result.ok, detail: result.detail }
      },
    })
  }
  if (chosen.has("packages")) {
    steps.push({
      id: "packages",
      title: IS_DARWIN ? "Homebrew packages" : "pacman packages",
      run: async () => {
        if (!IS_DARWIN) {
          // yay -Syu covers repo AND AUR in one transaction, and escalates
          // itself — wrapping it in sudo makes it refuse to run.
          return { ok: (await runInteractiveCode(["yay", "-Syu"], { needsStdin: true })) === 0 }
        }
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
      run: () => updateExtras(),
    })
  }
  if (chosen.has("stow")) {
    steps.push({ id: "stow", title: "Re-stow", run: async () => ({ ok: (await stow([])) === 0 }) })
  }
  if (chosen.has("pi")) {
    steps.push({
      id: "pi",
      title: "Pi plugins",
      run: async () => ({
        ok: (await piPlugins(["update", ...(argv.includes("--all") ? ["--all"] : [])])) === 0,
      }),
    })
  }
  if (chosen.has("skills")) {
    steps.push({
      id: "skills",
      title: "Vendored skills",
      run: async () => ({ ok: (await skills(["update"])) === 0 }),
    })
  }

  const summary = await runSteps(steps, (report, index, total) => {
    // Structured progress for the TUI's status bar; the printed lines below are
    // for the plain CLI (and become single pane rows when a sink is installed).
    getStepSink()?.({ index, total, title: report.step.title, state: report.state })
    if (report.state === "running") printHeader(`[${index + 1}/${total}] ${report.step.title}`)
    else if (report.state === "warn") printWarning(`${report.step.title} incomplete`)
  })

  if (selfChanged) {
    printWarning("The pull changed the CLI's own source — re-run `dotfiles update` to use it.")
  }

  const failures = summary.reports.filter((r) => r.state === "warn" || r.state === "failed")
  printHeader(failures.length === 0 ? "Up to date ✨" : `${failures.length} step(s) incomplete`)
  return failures.length === 0 ? 0 : 1
}
