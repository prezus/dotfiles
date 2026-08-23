// `dotfiles pacman` — Linux's `dotfiles brew`.
//
// ensureYay is also what guarantees `stow` exists: nothing else installs it, and
// the stow step runs long after this one.
import { archBackend } from "../lib/arch.ts"
import { commandExists, runInteractiveCode } from "../lib/exec.ts"
import { defaultRuntime } from "./packages.ts"
import { printError, printHeader, printInfo, printSuccess, printWarning } from "../lib/ui.ts"

/** Packages the CLI itself needs before any later step can run. */
const BOOTSTRAP = ["base-devel", "git", "stow"]

async function installYay(): Promise<boolean> {
  printInfo("Installing yay from the AUR...")
  const dir = `/tmp/yay-bootstrap.${process.pid}`
  const script = [
    `rm -rf ${dir}`,
    `git clone --depth 1 https://aur.archlinux.org/yay-bin.git ${dir}`,
    `cd ${dir}`,
    // makepkg refuses to run as root and calls sudo itself for the install half.
    `makepkg -si --noconfirm`,
    `rm -rf ${dir}`,
  ].join(" && ")
  const code = await runInteractiveCode(["/bin/bash", "-c", script], { needsStdin: true })
  if (code !== 0) {
    printWarning("yay install failed — AUR packages will be skipped")
    return false
  }
  printSuccess("yay installed")
  return true
}

export async function ensureYay(): Promise<boolean> {
  if (!(await commandExists("pacman"))) {
    printError("pacman not found — this command is for Arch-like systems")
    return false
  }

  const missing: string[] = []
  for (const pkg of BOOTSTRAP) {
    // base-devel is a group, so query it rather than probing for a binary.
    const probeName = pkg === "base-devel" ? "makepkg" : pkg
    if (!(await commandExists(probeName))) missing.push(pkg)
  }

  if (missing.length > 0) {
    printInfo(`Installing bootstrap packages: ${missing.join(", ")}`)
    const sudo = await defaultRuntime.warmSudo(
      `pacman needs to install ${missing.join(", ")} before setup can continue.`,
    )
    try {
      const code = await runInteractiveCode(
        ["sudo", "pacman", "-S", "--needed", "--noconfirm", ...missing],
        { needsStdin: true },
      )
      if (code !== 0) {
        printError("could not install bootstrap packages")
        return false
      }
    } finally {
      sudo.release()
    }
  }

  if (!(await commandExists("yay"))) return await installYay()
  printSuccess("pacman + yay ready")
  return true
}

export async function pacmanCmd(): Promise<number> {
  printHeader("Packages (pacman + yay)")
  if (!(await ensureYay())) return 1
  const outcome = await archBackend.install(defaultRuntime)
  if (outcome.ok) {
    printSuccess(outcome.detail ?? "packages installed")
    return 0
  }
  printWarning(outcome.detail ?? "package installation failed")
  return 1
}
