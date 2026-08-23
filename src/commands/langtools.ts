// `dotfiles lang-tools` — crates and go modules, on both platforms.
//
// These were `cargo "…"` / `go "…"` lines in packages/bundle, so Homebrew Bundle
// was the only thing that installed them and a Linux machine silently got none —
// which is how `dotfiles rust` ended up reporting "espup not installed yet
// (comes from packages/bundle)" on a box with no Homebrew.
//
// They belong with rust.txt and bun-global.txt: installed by a language
// toolchain, not by an OS package manager, and identical on every platform.
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { PACKAGES_DIR } from "../lib/env.ts"
import { commandExists, env, probe, runInteractiveCode } from "../lib/exec.ts"
import type { StepOutcome } from "../lib/steps.ts"
import { printInfo, printSuccess, printWarning } from "../lib/ui.ts"

export const CARGO_MANIFEST = join(PACKAGES_DIR, "cargo.txt")
export const GO_MANIFEST = join(PACKAGES_DIR, "go.txt")

export function parseToolList(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
}

const readList = async (path: string): Promise<string[]> => {
  const file = Bun.file(path)
  return (await file.exists()) ? parseToolList(await file.text()) : []
}

/** `github.com/a-h/templ/cmd/templ` -> `templ`, which is what lands on PATH. */
export const goBinaryName = (module: string): string => {
  const last = module.split("/").at(-1) ?? module
  // Trailing major-version elements (`/v3`) are not the binary name.
  return /^v[0-9]+$/.test(last) ? (module.split("/").at(-2) ?? last) : last
}

/**
 * Where `go install` puts binaries: $GOBIN, else $GOPATH/bin. Empty if `go`
 * cannot be run at all.
 */
export async function goBinDir(): Promise<string> {
  const res = await probe(["go", "env", "GOBIN", "GOPATH"])
  if (!res.ok) return ""
  const [gobin = "", gopath = ""] = res.stdout.split("\n").map((l) => l.trim())
  if (gobin !== "") return gobin
  return gopath === "" ? "" : join(gopath, "bin")
}

/**
 * Put the `go install` bin directory on PATH for the rest of this process, and
 * make sure it exists on disk.
 *
 * conf.d/paths.fish appends ~/go/bin, but fish_add_path silently skips a
 * directory that does not exist (the same behaviour its /opt/homebrew comment
 * relies on). On a machine that has never installed a go tool the directory is
 * absent, so the entry never lands — and then `go install` writes seven binaries
 * nobody can run. Creating it makes the fish entry stick from the next shell on;
 * prepending makes this run's commandExists checks see what we just installed,
 * instead of doctor reporting the tools missing straight after installing them.
 */
export async function activateGo(): Promise<void> {
  const dir = await goBinDir()
  if (dir === "") return
  await mkdir(dir, { recursive: true })
  env.prepend("PATH", dir)
}

/** Crates already installed, from `cargo install --list`. */
async function installedCrates(): Promise<Set<string>> {
  const res = await probe(["cargo", "install", "--list"])
  if (!res.ok) return new Set()
  // Top-level lines are `name v1.2.3:`; binaries are indented beneath.
  return new Set(
    res.stdout
      .split("\n")
      .filter((l) => l !== "" && !l.startsWith(" ") && !l.startsWith("\t"))
      .map((l) => l.split(" ")[0] ?? "")
      .filter((n) => n !== ""),
  )
}

export async function langTools(): Promise<StepOutcome> {
  const [crates, modules] = await Promise.all([readList(CARGO_MANIFEST), readList(GO_MANIFEST)])
  if (crates.length === 0 && modules.length === 0) {
    return { ok: true, detail: "no language tools declared" }
  }

  let installed = 0
  let failed = 0

  if (crates.length > 0) {
    if (!(await commandExists("cargo"))) {
      printWarning("cargo not found — skipping crates (dotfiles rust)")
      failed += crates.length
    } else {
      const have = await installedCrates()
      const missing = crates.filter((c) => !have.has(c))
      if (missing.length === 0) {
        printSuccess(`${crates.length} crate(s) already installed`)
      } else {
        printInfo(`Installing ${missing.length} crate(s) with cargo`)
        // One at a time: `cargo install a b c` aborts the whole batch on the
        // first failure, and a single unbuildable crate must not cost the rest.
        for (const crate of missing) {
          if ((await runInteractiveCode(["cargo", "install", "--locked", crate])) === 0) {
            printSuccess(`crate: ${crate}`)
            installed++
          } else {
            printWarning(`crate failed: ${crate}`)
            failed++
          }
        }
      }
    }
  }

  if (modules.length > 0) {
    if (!(await commandExists("go"))) {
      printWarning("go not found — skipping go tools")
      failed += modules.length
    } else {
      await activateGo()
      for (const module of modules) {
        if (await commandExists(goBinaryName(module))) continue
        if ((await runInteractiveCode(["go", "install", `${module}@latest`])) === 0) {
          printSuccess(`go: ${goBinaryName(module)}`)
          installed++
        } else {
          printWarning(`go install failed: ${module}`)
          failed++
        }
      }
    }
  }

  if (failed > 0) return { ok: false, detail: `${failed} tool(s) failed, ${installed} installed` }
  return { ok: true, detail: installed > 0 ? `installed ${installed} tool(s)` : "all tools present" }
}

export async function langToolsCmd(): Promise<number> {
  const outcome = await langTools()
  if (outcome.ok) {
    printSuccess(outcome.detail ?? "language tools installed")
    return 0
  }
  printWarning(outcome.detail ?? "language tool installation failed")
  return 1
}
