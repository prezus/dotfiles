// What "a package manager" means to this CLI, so packages/reconcile/doctor stop
// naming Homebrew directly.
//
// The currency is a Set of directive lines (`brew "x"`, `pacman "x"`, `aur "x"`)
// because reconcile.ts's buildRows/globToRegExp/splitDirective and doctor's
// untracked check already work in exactly that shape — keeping arch's directives
// syntactically identical means none of that machinery changes.
import { archBackend } from "./arch.ts"
import { brewBackend } from "./brewbackend.ts"
import { IS_DARWIN } from "./platform.ts"
import type { PackageRuntime } from "../commands/packages.ts"
import type { StepOutcome } from "./steps.ts"

export type PackageBackend = {
  id: "brew" | "arch"
  label: string
  /** Manifest files, for doctor labels and the fix's git-history walk. */
  manifests: readonly string[]
  ignoreFile: string
  declared: () => Promise<Set<string>>
  installed: () => Promise<Set<string>>
  /**
   * What the OS itself provides, and which a manifest must therefore NOT claim.
   *
   * This is the one place brew and pacman genuinely differ in kind. Homebrew
   * cannot see macOS's base system, so `brew bundle dump` is already "only what
   * I added" — baseline is empty. pacman manages EVERYTHING including the
   * kernel, and Omarchy ships 206 curated packages on top, so without
   * subtracting that, "installed but not declared" means "the operating system".
   */
  baseline: () => Promise<Set<string>>
  /** One manifest line -> normalized directive, or null for blanks/comments. */
  parseManifestLine: (line: string) => string | null
  check: (runtime: PackageRuntime) => Promise<number>
  install: (runtime: PackageRuntime) => Promise<StepOutcome>
  declare: (lines: readonly string[]) => Promise<void>
  undeclare: (lines: readonly string[]) => Promise<void>
  installCommand: (line: string) => string[] | null
  uninstallCommand: (line: string) => string[] | null
  /** How the user installs an arbitrary tool, e.g. for the missing-stow error. */
  installHint: (tool: string) => string
}

/** Selected once at import; every consumer goes through this. */
export const backend: PackageBackend = IS_DARWIN ? brewBackend : archBackend
