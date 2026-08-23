// `dotfiles init` — wire a machine from zero.
//
// The ORDER IS LOAD-BEARING:
//   - rust BEFORE packages on darwin, because packages/bundle has `cargo "…"`
//     entries that need a working cargo. arch.txt has none, so linux runs the
//     package step first — it is also what installs stow.
//   - ESP AFTER packages on darwin, because espup is one of those cargo entries
//   - mise AFTER stow, because its tracked config must exist before installation
//   - skills LAST, since it only wires symlinks
//
// Every step also depends on earlier steps having amended the shared Env — see
// src/lib/exec.ts. On a fresh machine the package manager does not exist when
// this starts.
import { bunGlobals } from "./bunglobals.ts"
import { fish } from "./fish.ts"
import { ensureHomebrew } from "./homebrew.ts"
import { omarchyIncludes } from "./omarchy.ts"
import { pacmanCmd } from "./pacman.ts"
import { langTools } from "./langtools.ts"
import { installPackages } from "./packages.ts"
import { plannotator } from "./plannotator.ts"
import { piPlugins } from "./pi.ts"
import { applyRustList, installRustEsp, installRustup } from "./rust.ts"
import { skills } from "./skills.ts"
import { ssh } from "./ssh.ts"
import { stow } from "./stow.ts"
import { runInteractiveCode } from "../lib/exec.ts"
import { runSteps, type Step } from "../lib/steps.ts"
import { IS_DARWIN } from "../lib/platform.ts"
import { getStepSink, printError, printHeader, printSuccess, printWarning } from "../lib/ui.ts"

/** Adapt a command that returns an exit code into a step outcome. */
const fromExitCode = async (fn: () => Promise<number>) => {
  const code = await fn()
  return { ok: code === 0 }
}

/**
 * Two arrays, not one filtered list: the ordering rationale above differs per
 * platform, and a filter would leave the Linux order implicit.
 */
export function initSteps(): Step[] {
  return IS_DARWIN ? darwinSteps() : linuxSteps()
}

/** Steps whose ordering and rationale are identical on both platforms. */
function sharedTail(): Step[] {
  return [
    { id: "bun", title: "Bun globals", run: () => fromExitCode(bunGlobals) },
    { id: "plannotator", title: "Plannotator", run: () => fromExitCode(plannotator) },
    {
      id: "stow",
      title: "Stow dotfiles",
      required: true,
      run: () => fromExitCode(() => stow([])),
    },
    {
      id: "mise",
      title: "mise toolchains",
      run: () => fromExitCode(() => runInteractiveCode(["mise", "install"])),
    },
    {
      id: "pi",
      title: "Pi plugins",
      run: () => fromExitCode(() => piPlugins(["install"])),
    },
    { id: "ssh", title: "SSH config", run: () => fromExitCode(ssh) },
    { id: "fish", title: "Fish shell", run: () => fromExitCode(fish) },
    { id: "skills", title: "Skills", run: () => fromExitCode(() => skills(["install"])) },
  ]
}

function linuxSteps(): Step[] {
  return [
    {
      // Also installs base-devel/git/STOW — nothing else does, and the stow step
      // is nine steps later.
      id: "pacman",
      title: "Packages (pacman + yay)",
      required: true,
      run: () => fromExitCode(pacmanCmd),
    },
    {
      id: "rust",
      // rustup's own installer on both: Arch's rustup package would be a
      // chicken/egg against the packages step, and rust.txt needs
      // rustup-managed toolchains for ESP anyway.
      run: async () => {
        const installed = await installRustup()
        const configured = installed ? await applyRustList() : false
        const ok = installed && configured
        return { ok, detail: ok ? undefined : "rust setup incomplete" }
      },
      title: "Rust (rustup)",
    },
    {
      // BEFORE rust-esp: espup is one of these crates, and the ESP step gates on
      // it. Placing it after was the bug that made `dotfiles rust` report
      // "espup not installed yet (comes from packages/bundle)" on Linux.
      id: "lang-tools",
      title: "Language tools (cargo/go)",
      run: () => langTools(),
    },
    {
      id: "rust-esp",
      title: "Rust (ESP)",
      run: async () => {
        const ok = await installRustEsp()
        return { ok, detail: ok ? undefined : "ESP toolchain incomplete" }
      },
    },
    ...sharedTail(),
    {
      // After stow: it references the personal.conf that stow places.
      id: "omarchy-includes",
      title: "Omarchy terminal includes",
      run: () => fromExitCode(omarchyIncludes),
    },
  ]
}

function darwinSteps(): Step[] {
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
      // BEFORE rust-esp: espup is one of these crates, and the ESP step gates on
      // it. Placing it after was the bug that made `dotfiles rust` report
      // "espup not installed yet (comes from packages/bundle)" on Linux.
      id: "lang-tools",
      title: "Language tools (cargo/go)",
      run: () => langTools(),
    },
    {
      id: "rust-esp",
      title: "Rust (ESP)",
      // After lang-tools: espup is one of its crates.
      run: async () => {
        const ok = await installRustEsp()
        return { ok, detail: ok ? undefined : "ESP toolchain incomplete" }
      },
    },
    ...sharedTail(),
  ]
}

export async function init(): Promise<number> {
  const steps = initSteps()
  printHeader("Initializing dotfiles")

  const summary = await runSteps(steps, (report, index, total) => {
    // Structured progress for the TUI's status bar; the printed lines below are
    // for the plain CLI (and become single pane rows when a sink is installed).
    getStepSink()?.({ index, total, title: report.step.title, state: report.state })
    if (report.state === "running") {
      printHeader(`[${index + 1}/${total}] ${report.step.title}`)
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
