// `dotfiles rust` — rustup toolchains, components and targets.
//
// Rust is NOT an OS package on either platform: brew's single `rust` formula
// (and Arch's `rustup` package) can't manage the cross/embedded toolchains and
// targets this setup needs. This runs BEFORE the lang-tools step, so `cargo`
// exists for packages/cargo.txt — which is why activating cargo on PATH matters.
import { join } from "node:path"
import { PACKAGES_DIR } from "../lib/env.ts"
import { commandExists, env, probe, runInteractiveCode } from "../lib/exec.ts"
import { pathExists } from "../lib/fs.ts"
import { parseRustList } from "../lib/lists.ts"
import { printInfo, printSuccess, printWarning } from "../lib/ui.ts"

const RUST_LIST = join(PACKAGES_DIR, "rust.txt")

export type RustRuntime = {
  probe: typeof probe
  commandExists: typeof commandExists
  runInteractiveCode: typeof runInteractiveCode
}

const defaultRustRuntime: RustRuntime = { probe, commandExists, runInteractiveCode }

export type RustOptions = {
  rustListPath?: string
  runtime?: RustRuntime
}

/** Put ~/.cargo/bin on PATH for the rest of this process. */
export async function activateCargo(): Promise<void> {
  const cargoEnv = Bun.file(join(env.get("HOME") ?? "", ".cargo", "env"))
  if (await cargoEnv.exists()) {
    // ~/.cargo/env wraps its export in a `case` statement, but the export line
    // itself parses fine and is all we need.
    env.absorbShellenv(await cargoEnv.text())
  }
  env.prepend("PATH", join(env.get("HOME") ?? "", ".cargo", "bin"))
}

export async function installRustup(): Promise<boolean> {
  if (await commandExists("rustup")) {
    printSuccess("rustup already installed")
  } else {
    printInfo("Installing rustup...")
    const code = await runInteractiveCode([
        "/bin/bash",
        "-c",
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path",
      ],
      { needsStdin: true },
    )

    if (code !== 0) {
      printWarning("rustup install failed")
      return false
    }
  }
  await activateCargo()
  return true
}

export async function applyRustList(options: RustOptions = {}): Promise<boolean> {
  const file = Bun.file(options.rustListPath ?? RUST_LIST)
  const runtime = options.runtime ?? defaultRustRuntime
  if (!(await file.exists())) {
    printInfo("no rust.txt; skipping toolchains/targets")
    return true
  }

  let ok = true
  const entries = parseRustList(await file.text())
  for (const entry of entries) {
    let res
    switch (entry.kind) {
      case "toolchain":
        // --no-self-update: rustup's own updates are handled by `dotfiles update`.
        res = await runtime.probe(["rustup", "toolchain", "install", entry.value, "--no-self-update"])
        break
      case "component":
        res = await runtime.probe(["rustup", "component", "add", entry.value])
        break
      case "target":
        res = await runtime.probe(["rustup", "target", "add", entry.value])
        break
      case "esp":
        continue // handled separately, after packages
    }

    if (res.ok) printSuccess(`${entry.kind}: ${entry.value}`)
    else {
      ok = false
      printWarning(`${entry.kind} failed: ${entry.value}`)
    }
  }
  return ok
}

/**
 * ESP (Xtensa) toolchain via espup. Separate from the rest because `espup` is a
 * cargo tool from packages/cargo.txt, so this must run AFTER the lang-tools step.
 */
export async function installRustEsp(options: RustOptions = {}): Promise<boolean> {
  const file = Bun.file(options.rustListPath ?? RUST_LIST)
  const runtime = options.runtime ?? defaultRustRuntime
  if (!(await file.exists())) return true
  const wanted = parseRustList(await file.text()).some((e) => e.kind === "esp")
  if (!wanted) return true

  if (!(await runtime.commandExists("espup"))) {
    printWarning("espup not installed yet (packages/cargo.txt — run: dotfiles lang-tools)")
    return false
  }

  const toolchains = await runtime.probe(["rustup", "toolchain", "list"])
  if (!toolchains.ok) {
    printWarning("could not inspect installed Rust toolchains")
    return false
  }
  if (toolchains.stdout.split("\n").some((l) => l.startsWith("esp"))) {
    printSuccess("ESP (Xtensa) toolchain already installed")
    return true
  }

  printInfo("Installing ESP (Xtensa) toolchain via espup...")
  const code = await runtime.runInteractiveCode(["espup", "install"])
  if (code === 0) {
    printSuccess("ESP toolchain installed")
    return true
  }
  printWarning("espup install failed")
  return false
}

export async function rust(): Promise<number> {
  const installed = await installRustup()
  if (!installed) return 1
  const listOk = await applyRustList()
  const espOk = await installRustEsp()
  return listOk && espOk ? 0 : 1
}

/** `dotfiles viteplus` and friends need this too; exported for init. */
export async function cargoInstalled(): Promise<boolean> {
  return (await commandExists("cargo")) || (await pathExists(join(env.get("HOME") ?? "", ".cargo", "bin", "cargo")))
}
