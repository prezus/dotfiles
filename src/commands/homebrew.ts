// Homebrew install + activation.
//
// Not a dispatched subcommand — it is step 1 of `init`, and the step the whole
// sequencing problem revolves around: steps 2-10 all need `brew` on PATH, and on
// a fresh machine it did not exist when the process started.
//
// Bash solved this with `eval "$(brew shellenv)"`, which works because eval runs
// arbitrary shell. We cannot, and it turns out parsing shellenv is NOT enough:
//
//   $ brew shellenv          # Homebrew 6.0.13
//   export HOMEBREW_PREFIX="/opt/homebrew";
//   ...
//   eval "$(/usr/bin/env PATH_HELPER_ROOT=... /usr/libexec/path_helper -s)"
//
// There is no `export PATH=` line at all any more — PATH is delegated to
// path_helper inside a nested eval. Older Homebrew did emit one, so a parser
// that relies on it silently works on some machines and not others. We instead
// prepend the prefix's bin/sbin explicitly, which is deterministic.
import { join } from "node:path"
import { commandExists, env, run, runInteractive, which } from "../lib/exec.ts"
import { pathExists } from "../lib/fs.ts"
import { withSuspendedUI } from "../tui/renderer.ts"
import { printInfo, printSuccess, printWarning } from "../lib/ui.ts"

/** Apple Silicon first, then Intel — the only two prefixes Homebrew uses. */
const CANDIDATE_PREFIXES = ["/opt/homebrew", "/usr/local"]

async function detectPrefix(): Promise<string | null> {
  const existing = await which("brew")
  if (existing) {
    const res = await run([existing, "--prefix"])
    if (res.ok && res.stdout.trim()) return res.stdout.trim()
  }
  for (const prefix of CANDIDATE_PREFIXES) {
    if (await pathExists(join(prefix, "bin", "brew"))) return prefix
  }
  return null
}

/**
 * Make `brew` usable by every later step in this process. Idempotent.
 * Returns the prefix, or null if Homebrew isn't present.
 */
export async function activateHomebrew(): Promise<string | null> {
  const prefix = await detectPrefix()
  if (!prefix) return null

  // Absorb HOMEBREW_PREFIX / HOMEBREW_CELLAR / INFOPATH / MANPATH, and PATH too
  // on older Homebrew versions that still emit it.
  const shellenv = await run([join(prefix, "bin", "brew"), "shellenv"])
  if (shellenv.ok) env.absorbShellenv(shellenv.stdout)

  // Then assert PATH ourselves, AFTER absorbing, so we win regardless of which
  // shellenv format this Homebrew uses. prepend() de-duplicates, so re-running
  // init cannot grow PATH.
  env.prepend("PATH", join(prefix, "sbin"))
  env.prepend("PATH", join(prefix, "bin"))

  return prefix
}

export async function ensureHomebrew(): Promise<boolean> {
  if (await commandExists("brew")) {
    await activateHomebrew()
    printSuccess("Homebrew already installed")
    return true
  }

  printInfo("Installing Homebrew (non-interactive)...")
  // The installer needs the terminal: it prints progress and may ask for sudo.
  const code = await withSuspendedUI(() =>
    runInteractive(
      [
        "/bin/bash",
        "-c",
        'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      ],
      { extraEnv: { NONINTERACTIVE: "1" } },
    ),
  )
  if (code !== 0) {
    printWarning("Homebrew install failed")
    return false
  }

  const prefix = await activateHomebrew()
  if (!prefix) {
    printWarning("Homebrew installed but could not be located on PATH")
    return false
  }
  printSuccess(`Homebrew installed (${prefix})`)
  return true
}
