// `dotfiles init` — wire a machine from zero.
//
// The ORDER IS LOAD-BEARING and was previously encoded only in comments:
//   - rust BEFORE packages, because packages/bundle contains `cargo "…"` entries
//     that need a working cargo
//   - ESP AFTER packages, because espup is itself one of those cargo entries
//   - stow AFTER Vite+, because Vite+ writes conf.d/vite-plus.fish into the repo
//   - skills LAST, since it only wires symlinks
//
// Every step also depends on earlier steps having amended the shared Env — see
// src/lib/exec.ts. On a fresh machine `brew` does not exist when this starts.
import { bunGlobals } from "./bunglobals.ts"
import { fish } from "./fish.ts"
import { ensureHomebrew } from "./homebrew.ts"
import { installPackages } from "./packages.ts"
import { applyRustList, installRustEsp, installRustup } from "./rust.ts"
import { skills } from "./skills.ts"
import { ssh } from "./ssh.ts"
import { stow } from "./stow.ts"
import { viteplus } from "./viteplus.ts"
import { runSteps, type Step } from "../lib/steps.ts"
import { printError, printHeader, printRaw, printSuccess, printWarning } from "../lib/ui.ts"

/** Adapt a command that returns an exit code into a step outcome. */
const fromExitCode = async (fn: () => Promise<number>) => {
  const code = await fn()
  return { ok: code === 0 }
}

export function initSteps(): Step[] {
  return [
    {
      id: "homebrew",
      title: "Homebrew",
      required: true,
      run: async () => ({ ok: await ensureHomebrew() }),
    },
    {
      id: "rust",
      title: "Rust (rustup)",
      // Before packages: the bundle has `cargo "…"` entries.
      run: async () => {
        const installed = await installRustup()
        const configured = installed ? await applyRustList() : false
        const ok = installed && configured
        return { ok, detail: ok ? undefined : "rust setup incomplete" }
      },
    },
    {
      id: "packages",
      title: "Packages",
      required: true,
      run: () => installPackages(),
    },
    {
      id: "rust-esp",
      title: "Rust (ESP)",
      // After packages: espup is a cargo tool from the bundle.
      run: async () => {
        const ok = await installRustEsp()
        return { ok, detail: ok ? undefined : "ESP toolchain incomplete" }
      },
    },
    { id: "bun", title: "Bun globals", run: () => fromExitCode(bunGlobals) },
    { id: "viteplus", title: "Vite+", run: () => fromExitCode(viteplus) },
    {
      id: "stow",
      title: "Stow dotfiles",
      required: true,
      run: () => fromExitCode(() => stow([])),
    },
    { id: "ssh", title: "SSH config", run: () => fromExitCode(ssh) },
    { id: "fish", title: "Fish shell", run: () => fromExitCode(fish) },
    { id: "skills", title: "Skills", run: () => fromExitCode(() => skills(["install"])) },
  ]
}

export async function init(): Promise<number> {
  const steps = initSteps()
  printHeader("Initializing dotfiles")

  const summary = await runSteps(steps, (report, index, total) => {
    if (report.state === "running") {
      printRaw(`\n[${index + 1}/${total}] ${report.step.title}`)
      return
    }
    if (report.state === "pending" || report.state === "skipped") return
    // The print* helpers supply the glyph; adding one here double-prints it.
    const line = `${report.step.title}${report.detail ? ` — ${report.detail}` : ""}`
    if (report.state === "ok") printSuccess(line)
    else if (report.state === "warn") printWarning(line)
    else printError(line)
  })

  if (summary.aborted) {
    printError(`init stopped at required step: ${summary.abortedAt?.title}`)
    const skipped = summary.reports.filter((r) => r.state === "skipped")
    if (skipped.length > 0) {
      printWarning(`${skipped.length} later step(s) not run: ${skipped.map((r) => r.step.title).join(", ")}`)
    }
    return 1
  }

  const warned = summary.reports.filter((r) => r.state === "warn")
  if (warned.length > 0) {
    printWarning(`${warned.length} step(s) incomplete: ${warned.map((r) => r.step.title).join(", ")}`)
  }
  printHeader("Done 🎉  (restart your shell)")
  return 0
}
