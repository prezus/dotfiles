// `dotfiles rust` — rustup toolchains, components and targets.
//
// Rust is NOT in the Brewfile: brew's single `rust` formula can't manage the
// cross/embedded toolchains and targets this setup needs. This runs BEFORE
// package install during init, so `cargo` exists for the bundle's `cargo "…"`
// entries — which is why activating cargo on PATH here matters.
import { join } from "node:path"
import { PACKAGES_DIR } from "../lib/env.ts"
import { commandExists, env, probe, runInteractiveCode } from "../lib/exec.ts"
import { pathExists } from "../lib/fs.ts"
import { parseRustList } from "../lib/lists.ts"
import { printInfo, printSuccess, printWarning } from "../lib/ui.ts"

const RUST_LIST = join(PACKAGES_DIR, "rust.txt")

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

export async function applyRustList(): Promise<void> {
  const file = Bun.file(RUST_LIST)
  if (!(await file.exists())) {
    printInfo("no rust.txt; skipping toolchains/targets")
    return
  }

  const entries = parseRustList(await file.text())
  for (const entry of entries) {
    switch (entry.kind) {
      case "toolchain": {
        // --no-self-update: rustup's own updates are handled by `dotfiles update`.
        const res = await probe(["rustup", "toolchain", "install", entry.value, "--no-self-update"])
        if (res.ok) printSuccess(`toolchain: ${entry.value}`)
        break
      }
      case "component": {
        const res = await probe(["rustup", "component", "add", entry.value])
        if (res.ok) printSuccess(`component: ${entry.value}`)
        break
      }
      case "target": {
        const res = await probe(["rustup", "target", "add", entry.value])
        if (res.ok) printSuccess(`target: ${entry.value}`)
        break
      }
      case "esp":
        break // handled separately, after packages
    }
  }
}

/**
 * ESP (Xtensa) toolchain via espup. Separate from the rest because `espup` is a
 * cargo tool from packages/bundle, so this must run AFTER package install.
 */
export async function installRustEsp(): Promise<void> {
  const file = Bun.file(RUST_LIST)
  if (!(await file.exists())) return
  const wanted = parseRustList(await file.text()).some((e) => e.kind === "esp")
  if (!wanted) return

  if (!(await commandExists("espup"))) {
    printWarning("espup not installed yet (comes from packages/bundle); skipping ESP toolchain")
    return
  }

  const toolchains = await probe(["rustup", "toolchain", "list"])
  if (toolchains.stdout.split("\n").some((l) => l.startsWith("esp"))) {
    printSuccess("ESP (Xtensa) toolchain already installed")
    return
  }

  printInfo("Installing ESP (Xtensa) toolchain via espup...")
  const code = await runInteractiveCode(["espup", "install"])
  if (code === 0) printSuccess("ESP toolchain installed")
  else printWarning("espup install failed")
}

export async function rust(): Promise<number> {
  const ok = await installRustup()
  if (!ok) return 1
  await applyRustList()
  await installRustEsp()
  return 0
}

/** `dotfiles viteplus` and friends need this too; exported for init. */
export async function cargoInstalled(): Promise<boolean> {
  return (await commandExists("cargo")) || (await pathExists(join(env.get("HOME") ?? "", ".cargo", "bin", "cargo")))
}
