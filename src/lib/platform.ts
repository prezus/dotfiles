// The only file that inspects the OS. Modules import IS_DARWIN to pick a command
// or a behaviour; a path fork belongs in env.ts, which imports from here.
//
// Sync, not async: env.ts exports consts imported at module scope by ~20 modules,
// and `dotfiles __commands` runs on every fish tab-press (7ms — see cli.ts). A
// top-level await in that graph would tax every tab.
import { readFileSync } from "node:fs"

export type Platform = "darwin" | "linux"

export type Distro = "macos" | "omarchy" | "arch" | "other"

export const PLATFORM: Platform = process.platform === "darwin" ? "darwin" : "linux"
export const IS_DARWIN = PLATFORM === "darwin"
export const IS_LINUX = PLATFORM === "linux"

/** Values in os-release may be bare or quoted. */
const osReleaseField = (text: string, key: string): string | undefined => {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(text)
  if (!m) return undefined
  const raw = m[1]
  if (raw === undefined) return undefined
  return raw.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")
}

function readDistro(): Distro {
  if (IS_DARWIN) return "macos"
  try {
    const text = readFileSync("/etc/os-release", "utf8")
    const id = osReleaseField(text, "ID")
    if (id === "omarchy") return "omarchy"
    const like = osReleaseField(text, "ID_LIKE")?.split(/\s+/) ?? []
    if (id === "arch" || like.includes("arch")) return "arch"
    return "other"
  } catch {
    // Runs at import time — throwing would take the whole CLI down.
    return "other"
  }
}

export const DISTRO: Distro = readDistro()

// Kept separate so a plain Arch box gets pacman/yay/fish but skips the Hyprland
// overlay, rather than failing on Omarchy paths it doesn't have.
export const IS_ARCH_LIKE = DISTRO === "omarchy" || DISTRO === "arch"
export const IS_OMARCHY = DISTRO === "omarchy"
