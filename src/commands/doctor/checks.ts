// Doctor checks, as DATA.
//
// The bash original fused checking with printing: `cmd_doctor` interleaved
// `command_exists` probes with `print_success` calls, so a result was never
// available as a value. That is why it could not be made interactive, tested,
// or run concurrently.
//
// Each check here is a value with a `run()`. Three consumers share this one
// source: the full-screen view, the plain renderer, and `bun test`.
//
// IMPORTANT: this file must NOT import anything from @opentui or src/tui.
// Keeping the data layer renderer-free is what lets a breaking OpenTUI bump
// touch one directory instead of the whole command.
import { Result } from "better-result"
import { Schema } from "effect"
import { systemLoginShell } from "../fish.ts"
import { readPiPluginStatuses } from "../pi.ts"
import { readdir } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import {
  DOTFILES_DIR,
  ESP_ROOT,
  FISH_TOOL_COMPLETIONS,
  HOME,
  HOME_DIR,
  HOME_DIRS,
  PACKAGES_DIR,
  OMARCHY_PATH,
  OP_AGENT_SOCK,
  SKILLS_REPO,
  SKILLS_SRC,
} from "../../lib/env.ts"
import { commandExists, extract, probe, which } from "../../lib/exec.ts"
import {
  countFilesRecursive,
  isDirectory,
  isSocket,
  pathExists,
  readlinkSafe,
} from "../../lib/fs.ts"
import { findBrokenOwnedLinks } from "../../lib/owned.ts"
import { CONFLICT_REASON, planStowAll } from "../../lib/stow.ts"
import { readEntries } from "../../lib/skills-layout.ts"
import { IS_DARWIN, IS_OMARCHY, PLATFORM, type Platform } from "../../lib/platform.ts"
import { backend } from "../../lib/pkgbackend.ts"
import { VendorManifestJson } from "../../lib/vendor-manifest.ts"

export type Status = "ok" | "warn" | "fail" | "info"

export const SECTIONS = [
  "Tooling",
  "Shell",
  "Skills",
  "Security",
  "Packages",
  "Environment",
] as const
export type Section = (typeof SECTIONS)[number]

/** Additional lines rendered under a check's main line. */
export type ExtraLine =
  /** Indented, no glyph — e.g. the broken-symlink list. */
  | { kind: "raw"; text: string }
  /** Its own ⚠ glyph — e.g. the "node is not the Vite+ shim" explanation. */
  | { kind: "warn"; text: string }
  /** Its own ℹ glyph — e.g. the git signing key. */
  | { kind: "info"; text: string }

export type CheckResult = {
  status: Status
  /** The full line as the plain renderer prints it, after the glyph. */
  message: string
  extra?: ExtraLine[]
}

export type Fix = {
  label: string
  run: () => Promise<void>
}

export type Check = {
  id: string
  section: Section
  /** Short name for the TUI's left column. */
  label: string
  /** Counts toward the exit code and the "N critical issue(s)" footer. */
  critical?: boolean
  /** Omitted = every platform. Filtered before running, NOT via isApplicable:
   *  platform is static, so a Mac-only check must never spawn a subprocess on
   *  Linux, and view.tsx seeds its pending rows from CHECKS before any result. */
  platforms?: readonly Platform[]
  run: () => Promise<CheckResult>
}

export type CompletedCheck = Check & { result: CheckResult }

// ─── helpers ────────────────────────────────────────────────────────

/** Port of the bash `grep -oE "[0-9]+(\.[0-9]+)+" | head -1`. */
const firstVersion = (text: string): string | undefined => extract(text, /([0-9]+(?:\.[0-9]+)+)/)

const firstLine = (text: string): string => text.split("\n")[0]?.trim() ?? ""

const VITE_PLUS_BIN = join(HOME, ".vite-plus", "bin")
const VP = join(VITE_PLUS_BIN, "vp")
const NODE_SHIM = join(VITE_PLUS_BIN, "node")

/** `vp env current` → the bare version. Captured in full: piping vp into an
 *  early-exiting reader SIGPIPEs it into an "Abort trap: 6" (see the original). */
async function viteplusCurrentNode(): Promise<string | undefined> {
  const res = await probe([VP, "env", "current"])
  return extract(res.stdout, /Version\s+(\S+)/)
}

// ─── Tooling ────────────────────────────────────────────────────────

const brewCheck: Check = {
  id: "brew",
  section: "Tooling",
  label: "Homebrew",
  critical: true,
  platforms: ["darwin"],
  run: async () => {
    const path = await which("brew")
    if (!path) return { status: "fail", message: "Homebrew — missing" }
    const version = firstLine((await probe(["brew", "--version"])).stdout)
    return { status: "ok", message: `Homebrew — ${version} (${path})` }
  },
}

const stowCheck: Check = {
  id: "stow",
  section: "Tooling",
  label: "GNU Stow",
  critical: true,
  run: async () => {
    if (!(await commandExists("stow")))
      return { status: "fail", message: `GNU Stow — missing (${backend.installHint("stow")})` }
    const version = firstVersion((await probe(["stow", "--version"])).stdout)
    return { status: "ok", message: `GNU Stow — ${version}` }
  },
}

const gitCheck: Check = {
  id: "git",
  section: "Tooling",
  label: "git",
  critical: true,
  run: async () => {
    if (!(await commandExists("git"))) return { status: "fail", message: "git — missing" }
    const version = firstVersion((await probe(["git", "--version"])).stdout)
    return { status: "ok", message: `git — ${version}` }
  },
}

/**
 * Which tool owns `node`, and is PATH actually resolving to it?
 *
 * Whatever manages Node, the OS package manager keeps its own copy as an
 * unremovable transitive dep of a dozen CLIs. Both exist and can differ by a
 * MAJOR version, so PATH order alone decides which runs.
 *
 * Linux is already on mise. macOS is still on Vite+ until the migration in
 * issue #1 lands — at which point this branch collapses to the mise arm and
 * VITE_PLUS_BIN/viteplusCurrentNode go with it.
 */
const nodeCheck: Check = {
  id: "node",
  section: "Tooling",
  label: "node",
  run: async () => {
    const actual = await which("node")
    if (!actual) return { status: "warn", message: "node — missing" }

    const [nodeV, npmV] = await Promise.all([
      probe(["node", "--version"]),
      probe(["npm", "--version"]),
    ])
    const message = `node — ${nodeV.stdout.trim()} · npm ${npmV.stdout.trim()} (${actual})`

    if (IS_DARWIN) {
      if ((await pathExists(NODE_SHIM)) && actual !== NODE_SHIM) {
        const want = await viteplusCurrentNode()
        return {
          status: "warn",
          message,
          extra: [
            { kind: "warn", text: `  ↳ NOT the Vite+ shim — expected v${want ?? "?"} from ${NODE_SHIM}` },
            { kind: "warn", text: `     ${VITE_PLUS_BIN} is outranked in PATH by ${actual.replace(/\/node$/, "")}` },
          ],
        }
      }
      return { status: "ok", message }
    }

    if (!(await commandExists("mise"))) return { status: "ok", message }
    const want = extract((await probe(["mise", "current", "node"])).stdout, /([0-9][^\s]*)/)
    // mise resolves through ~/.local/share/mise/{installs,shims}; either is its.
    const owned = actual.includes("/mise/")
    if (!owned) {
      return {
        status: "warn",
        message,
        extra: [
          { kind: "warn", text: `  ↳ NOT mise's node — expected v${want ?? "?"} (mise current node)` },
          { kind: "warn", text: `     mise is outranked in PATH by ${actual.replace(/\/node$/, "")}` },
        ],
      }
    }
    return { status: "ok", message }
  },
}

const bunCheck: Check = {
  id: "bun",
  section: "Tooling",
  label: "bun",
  run: async () => {
    if (!(await commandExists("bun"))) return { status: "warn", message: "bun — missing" }
    const [version, globals] = await Promise.all([probe(["bun", "--version"]), probe(["bun", "pm", "ls", "-g"])])
    const count = globals.stdout.split("\n").filter((l) => l.includes("── ")).length
    return { status: "ok", message: `bun — v${version.stdout.trim()} · ${count} global(s)` }
  },
}

const rustupCheck: Check = {
  id: "rustup",
  section: "Tooling",
  label: "rustup",
  run: async () => {
    if (!(await commandExists("rustup")))
      return { status: "warn", message: "rustup — not installed (dotfiles rust)" }
    const [rustc, toolchains] = await Promise.all([
      probe(["rustc", "--version"]),
      probe(["rustup", "toolchain", "list"]),
    ])
    const count = toolchains.stdout.split("\n").filter((l) => l.trim() !== "").length
    return {
      status: "ok",
      message: `rustup — rustc ${firstVersion(rustc.stdout)} · ${count} toolchain(s)`,
    }
  },
}

const goCheck: Check = {
  id: "go",
  section: "Tooling",
  label: "go",
  run: async () => {
    if (!(await commandExists("go"))) return { status: "warn", message: "go — missing" }
    const version = extract((await probe(["go", "version"])).stdout, /(go[0-9.]+)/)
    return { status: "ok", message: `go — ${version}` }
  },
}

const viteplusCheck: Check = {
  id: "viteplus",
  section: "Tooling",
  label: "Vite+",
  run: async () => {
    if (!(await pathExists(VP)))
      return { status: "warn", message: "Vite+ — not installed (dotfiles viteplus)" }
    const version = firstLine((await probe([VP, "--version"])).stdout)
    return { status: "ok", message: `Vite+ — ${version}` }
  },
}

/**
 * The coding agents this repo actually configures.
 *
 * They were absent from doctor for no better reason than that the bash never
 * checked them — yet Pi has more tracked config here than most of the tools
 * above it (settings.json, themes/, a README), and the entire point of the
 * skills symlink chain is to serve these. `auth.json` and `sessions/` are
 * deliberately NOT ours and are never inspected.
 */
const AGENT_TOOLS = [
  { bin: "pi", label: "Pi", formula: "pi-coding-agent" },
  { bin: "opencode", label: "OpenCode", formula: "opencode" },
] as const

const agentChecks: Check[] = AGENT_TOOLS.map(({ bin, label, formula }) => ({
  id: `agent-${bin}`,
  section: "Tooling",
  label,
  run: async () => {
    const path = await which(bin)
    if (!path) return { status: "warn", message: `${label} — missing (brew install ${formula})` }
    const version = firstLine((await probe([bin, "--version"])).stdout)

    // Pi extensions live in stowed settings while their installations are
    // machine-local. Compare declarations to package metadata instead of
    // counting `pi list` lines, which prints a source and path for each entry.
    if (bin === "pi") {
      const plugins = await readPiPluginStatuses()
      if (plugins._tag === "err") {
        return { status: "warn", message: `${label} — ${plugins.error.message}` }
      }
      const drifted = plugins.value.filter(
        (plugin) => plugin.version === undefined || plugin.version !== plugin.installedVersion,
      )
      return {
        status: drifted.length === 0 ? "ok" : "warn",
        message:
          drifted.length === 0
            ? `${label} — ${version || "installed"} · ${plugins.value.length} plugin(s) (${path})`
            : `${label} — ${drifted.length} plugin(s) missing or off-pin (dotfiles pi install)`,
      }
    }
    return { status: "ok", message: `${label} — ${version || "installed"} (${path})` }
  },
}))

// ─── Shell ──────────────────────────────────────────────────────────

const fishCheck: Check = {
  id: "fish",
  section: "Shell",
  label: "fish",
  critical: true,
  run: async () => {
    const path = await which("fish")
    if (!path) return { status: "fail", message: "fish — missing" }
    const version = firstVersion((await probe(["fish", "--version"])).stdout)
    return { status: "ok", message: `fish — ${version} (${path})` }
  },
}

/** Checked via `fish -c 'type -q fisher'`, never via brew: fisher self-installs
 *  as a fish FUNCTION, and a brew copy would shadow it (AGENTS.md → NOTES). */
const fisherCheck: Check = {
  id: "fisher",
  section: "Shell",
  label: "fisher",
  run: async () => {
    const present = await probe(["fish", "-c", "type -q fisher"])
    if (!present.ok) return { status: "warn", message: "fisher — not installed" }
    const manifest = Bun.file(join(HOME_DIR, ".config", "fish", "fish_plugins"))
    const text = (await manifest.exists()) ? await manifest.text() : ""
    const count = text.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("#")).length
    return { status: "ok", message: `fisher — ${count} plugin(s)` }
  },
}

const loginShellCheck: Check = {
  id: "login-shell",
  section: "Shell",
  label: "login shell",
  run: async () => {
    // NOT $SHELL. That is the shell of the session doctor was launched from, and
    // chsh only affects sessions started AFTER it runs — so right after a
    // successful chsh this reported the old shell and told you to run the
    // command you had just run. commands/fish.ts already reads the system
    // record for exactly this reason; this check was still on $SHELL.
    const shell = await systemLoginShell()
    if (shell === null)
      return { status: "warn", message: "login shell: could not read the system record" }
    if (shell.endsWith("fish")) {
      const current = process.env.SHELL ?? ""
      if (current.endsWith("fish")) return { status: "ok", message: `login shell: fish (${shell})` }
      // $SHELL is stamped once at LOGIN, so the compositor and every terminal it
      // spawns inherit the old value — a new window does not help. Ghostty reads
      // $SHELL in preference to passwd (verified: unset it and fish resolves).
      return {
        status: "warn",
        message: `login shell: fish, but SHELL=${current} until you log out`,
      }
    }
    return { status: "warn", message: `login shell: ${shell} — not fish yet (run: dotfiles fish)` }
  },
}

/** Generated completions are written into the repo's stow source and symlinked
 *  out; they're gitignored as machine-generated. Only expect them for tools
 *  that are actually installed. */
const fishCompletionsCheck: Check = {
  id: "fish-completions",
  section: "Shell",
  label: "fish completions",
  run: async () => {
    const dir = join(HOME, ".config", "fish", "completions")
    type CompletionTool = (typeof FISH_TOOL_COMPLETIONS)[number]
    const ours: CompletionTool[] = []
    const shadowed: CompletionTool[] = []
    const missing: CompletionTool[] = []

    await Promise.all(
      FISH_TOOL_COMPLETIONS.map(async (tool) => {
        if (!(await commandExists(tool))) return
        const path = join(dir, `${tool}.fish`)
        const file = Bun.file(path)
        if (!(await file.exists()) || file.size === 0) {
          missing.push(tool)
          return
        }
        // Non-empty is not enough. The bash check stopped here and reported a
        // green tick — but OrbStack installs its own docker/kubectl/orbctl
        // completions over ours, so "present" was hiding "not the repo's".
        const target = await readlinkSafe(path)
        const resolved = target === null ? path : resolve(dir, target)
        ;(HOME_DIRS.some((d) => resolved.startsWith(d)) ? ours : shadowed).push(tool)
      }),
    )
    // Preserve the declared order rather than completion-race order.
    const order = (a: CompletionTool, b: CompletionTool) =>
      FISH_TOOL_COMPLETIONS.indexOf(a) - FISH_TOOL_COMPLETIONS.indexOf(b)
    ours.sort(order)
    shadowed.sort(order)
    missing.sort(order)

    if (missing.length > 0) {
      return {
        status: "warn",
        message: `fish completions — missing/empty: ${missing.join(" ")} (run: dotfiles fish)`,
      }
    }

    // These files are gitignored machine-generated output, so git can't tell us
    // when a tool update has made them stale. Ask each binary what it would emit
    // now and compare. This is the visibility that version-tracking them would
    // have bought, without the 58KB of generated code or the chore of
    // hand-resolving a stow conflict after every tool upgrade.
    const stale = (
      await Promise.all(
        ours.map(async (tool) => {
          const fresh = await probe([tool, "completion", "fish"])
          if (!fresh.ok || fresh.stdout.trim() === "") return null
          const current = await Bun.file(join(HOME_DIR, ".config", "fish", "completions", `${tool}.fish`)).text()
          // Trailing-newline insensitive: shell redirection and Bun.write differ
          // by one byte, which would otherwise report permanent false drift.
          return current.trimEnd() === fresh.stdout.trimEnd() ? null : tool
        }),
      )
    ).filter((tool) => tool !== null)
    stale.sort(order)

    if (stale.length > 0) {
      return {
        status: "warn",
        message: `fish completions — stale: ${stale.join(" ")} (run: dotfiles fish)`,
        extra: [{ kind: "info", text: "the tool now emits different completions than the stored copy" }],
      }
    }

    const summary = ours.length ? ours.join(" ") : "none"
    if (shadowed.length === 0) {
      return { status: "ok", message: `fish completions — ${summary} present` }
    }
    // Not an error: AGENTS.md says OrbStack re-adds its own and not to fight it.
    // But regenerating ours is a no-op for those tools, which is worth knowing.
    return {
      status: "ok",
      message: `fish completions — ${summary} present`,
      extra: [
        {
          kind: "info",
          text: `${shadowed.join(" ")} shadowed by another provider (not the repo's copy)`,
        },
      ],
    }
  },
}

// ─── Skills ─────────────────────────────────────────────────────────

/**
 * Both layouts are correct — see INSTALL.md. A plain symlink is the cheap case;
 * a real directory of per-skill links is what Omarchy's own skills force, and
 * reporting that as "not linked" would send you to a command that is already done.
 */
async function skillsPathResult(label: string, path: string, wantLink: string): Promise<CheckResult> {
  const target = await readlinkSafe(path)
  if (target === wantLink) return { status: "ok", message: `${label} → ${wantLink}` }
  if (target !== null)
    return { status: "warn", message: `${label} → ${target} (expected ${wantLink})` }

  const entries = await readEntries(path)
  if (entries.length === 0)
    return { status: "warn", message: `${label} — not linked (dotfiles skills install)` }

  const foreign = entries.filter((e) => e.foreign)
  const ours = entries.length - foreign.length
  if (ours === 0)
    return {
      status: "warn",
      message: `${label} — merged dir, none of ours yet (dotfiles skills install)`,
      extra: [{ kind: "raw", text: `    ${foreign.length} from other providers` }],
    }
  return {
    status: "ok",
    message: `${label} — merged: ${ours} ours · ${foreign.length} from other providers`,
  }
}

const agentsSkillsCheck: Check = {
  id: "skills-agents",
  section: "Skills",
  label: "~/.agents/skills",
  run: () => skillsPathResult("~/.agents/skills", join(HOME, ".agents", "skills"), SKILLS_SRC),
}

const claudeSkillsCheck: Check = {
  id: "skills-claude",
  section: "Skills",
  label: "~/.claude/skills",
  run: () =>
    skillsPathResult("~/.claude/skills", join(HOME, ".claude", "skills"), join(HOME, ".agents", "skills")),
}

/** Pi reads the same canonical pool — only checked when Pi is set up here. */
const piSkillsCheck: Check = {
  id: "skills-pi",
  section: "Skills",
  label: "~/.pi/agent/skills",
  run: async () => {
    if (!(await isDirectory(join(HOME, ".pi", "agent"))))
      return { status: "info", message: "" } // filtered out by the renderers
    return await skillsPathResult(
      "~/.pi/agent/skills",
      join(HOME, ".pi", "agent", "skills"),
      join(HOME, ".agents", "skills"),
    )
  },
}

/** Replaces a `node -e "require(...)"` shell-out with a native JSON read. */
const vendoredCheck: Check = {
  id: "skills-vendored",
  section: "Skills",
  label: "vendored",
  run: async () => {
    const manifest = Bun.file(join(SKILLS_REPO, "vendor-manifest.json"))
    if (!(await manifest.exists())) return { status: "info", message: "" }

    const parsed = await Result.tryPromise(async () =>
      Schema.decodeUnknownSync(VendorManifestJson)(await manifest.text()),
    )
    return Result.match(parsed, {
      // One line per vendor, not all of them joined: the joined form ran to 235
      // columns, which wraps to three rows on a normal terminal and used to
      // overflow the panel because the height budget counted it as one.
      ok: (data): CheckResult => ({
        status: "info",
        message: `vendored: ${data.vendors.length} source(s)`,
        extra: data.vendors.map((v) => ({
          kind: "raw" as const,
          text: `${v.source} @ ${v.pinnedCommit.slice(0, 10)} (${v.vendoredOn})`,
        })),
      }),
      err: (): CheckResult => ({
        status: "warn",
        message: "vendored — vendor-manifest.json unreadable",
      }),
    })
  },
}

const vendoredIntegrityCheck: Check = {
  id: "skills-integrity",
  section: "Skills",
  label: "vendored integrity",
  run: async () => {
    const script = join(SKILLS_REPO, "scripts", "verify-vendored.sh")
    if (!(await pathExists(script))) return { status: "info", message: "" }
    const res = await probe([script], { cwd: SKILLS_REPO })
    if (res.ok) return { status: "ok", message: "vendored integrity — all hashes match" }
    return {
      status: "warn",
      message: `vendored integrity — drift detected (cd ${SKILLS_REPO} && scripts/verify-vendored.sh)`,
    }
  },
}

// ─── Security ───────────────────────────────────────────────────────

const onePasswordCheck: Check = {
  id: "1password",
  section: "Security",
  label: "1Password SSH agent",
  run: async () => {
    if (await isSocket(OP_AGENT_SOCK))
      return { status: "ok", message: "1Password SSH agent — socket present" }
    return {
      status: "warn",
      message:
        "1Password SSH agent — socket missing (enable in 1Password ▸ Settings ▸ Developer)",
    }
  },
}

const gitSigningCheck: Check = {
  id: "git-signing",
  section: "Security",
  label: "git signing",
  run: async () => {
    const [format, key, gpgsign] = await Promise.all([
      probe(["git", "config", "--get", "gpg.format"]),
      probe(["git", "config", "--get", "user.signingkey"]),
      probe(["git", "config", "--get", "commit.gpgsign"]),
    ])
    const signingKey = key.stdout.trim()
    if (format.stdout.trim() !== "ssh" || signingKey === "") {
      return {
        status: "warn",
        message: "git signing — not configured (needs gpg.format=ssh + user.signingkey)",
      }
    }
    return {
      status: "ok",
      message: `git signing — ssh · commit.gpgsign=${gpgsign.stdout.trim() || "unset"}`,
      extra: [{ kind: "info", text: `signing key: ${signingKey.slice(0, 40)}…` }],
    }
  },
}

// ─── Packages ───────────────────────────────────────────────────────

export { normalizeBundle } from "../../lib/brewbackend.ts"

/** Port of bash `[[ "$line" == $pat ]]` — a glob, not a regex. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`)
}

/**
 * Forward drift: declared in a manifest, absent from this machine.
 *
 * doctor had only the REVERSE direction (untrackedPackagesCheck). The forward
 * one lived solely in `dotfiles check-packages`, so a package you added to a
 * manifest on the other machine and never installed here showed up nowhere on
 * the dashboard — and `go — missing` was reported by the go tool check with no
 * indication that a manifest already declared it.
 */
const missingPackagesCheck: Check = {
  id: "missing-packages",
  section: "Packages",
  label: "declared packages",
  run: async () => {
    const declared = await backend.declared()
    if (declared.size === 0) return { status: "info", message: "" }
    const installedSet = await backend.installed()
    if (installedSet.size === 0) return { status: "info", message: "" }

    const missing = [...declared].filter((line) => !installedSet.has(line))
    const label = backend.manifests.map((m) => `packages/${basename(m)}`).join(" + ")
    if (missing.length === 0)
      return { status: "ok", message: `${label} — all ${declared.size} declared installed` }

    return {
      status: "warn",
      message: `${missing.length} declared package(s) not installed:`,
      extra: missing.map((p) => ({ kind: "raw" as const, text: `    ${p}` })),
    }
  },
}

/**
 * Manifests whose contents nothing else verified.
 *
 * `bunCheck`/`rustupCheck` report that the TOOL exists and count what it has
 * installed, which is not the same question as "is the manifest satisfied" —
 * a crate added on the other machine was invisible here.
 */
const manifestCheck = (
  id: string,
  label: string,
  file: string,
  installed: () => Promise<Set<string>>,
  tool: string,
): Check => ({
  id,
  section: "Packages",
  label,
  run: async () => {
    const manifest = Bun.file(join(PACKAGES_DIR, file))
    if (!(await manifest.exists())) return { status: "info", message: "" }
    const declared = (await manifest.text())
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"))
    if (declared.length === 0) return { status: "info", message: "" }
    if (!(await commandExists(tool)))
      return { status: "warn", message: `packages/${file} — ${tool} not available` }

    const have = await installed()
    const missing = declared.filter((d) => !have.has(d))
    if (missing.length === 0)
      return { status: "ok", message: `packages/${file} — all ${declared.length} installed` }
    return {
      status: "warn",
      message: `packages/${file} — ${missing.length} of ${declared.length} missing:`,
      extra: missing.map((m) => ({ kind: "raw" as const, text: `    ${m}` })),
    }
  },
})

const cargoToolsCheck = manifestCheck(
  "cargo-tools",
  "packages/cargo.txt",
  "cargo.txt",
  async () => {
    const res = await probe(["cargo", "install", "--list"])
    if (!res.ok) return new Set()
    return new Set(
      res.stdout
        .split("\n")
        .filter((l) => l !== "" && !/^[ \t]/.test(l))
        .map((l) => l.split(" ")[0] ?? "")
        .filter((n) => n !== ""),
    )
  },
  "cargo",
)

const goToolsCheck: Check = {
  id: "go-tools",
  section: "Packages",
  label: "packages/go.txt",
  run: async () => {
    const manifest = Bun.file(join(PACKAGES_DIR, "go.txt"))
    if (!(await manifest.exists())) return { status: "info", message: "" }
    const modules = (await manifest.text())
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"))
    if (modules.length === 0) return { status: "info", message: "" }

    // `go install` leaves no manifest, so presence of the binary is the record.
    const missing: string[] = []
    for (const module of modules) {
      const last = module.split("/").at(-1) ?? module
      const bin = /^v[0-9]+$/.test(last) ? (module.split("/").at(-2) ?? last) : last
      if (!(await commandExists(bin))) missing.push(bin)
    }
    if (missing.length === 0)
      return { status: "ok", message: `packages/go.txt — all ${modules.length} on PATH` }
    return {
      status: "warn",
      message: `packages/go.txt — ${missing.length} of ${modules.length} not on PATH:`,
      extra: missing.map((m) => ({ kind: "raw" as const, text: `    ${m}` })),
    }
  },
}

const bunGlobalsCheck = manifestCheck(
  "bun-globals",
  "packages/bun-global.txt",
  "bun-global.txt",
  async () => {
    const res = await probe(["bun", "pm", "ls", "-g"])
    if (!res.ok) return new Set()
    return new Set(
      res.stdout
        .split("\n")
        .map((l) => extract(l, /──\s+(\S+?)@/))
        .filter((n): n is string => n !== undefined),
    )
  },
  "bun",
)

const miseCheck: Check = {
  id: "mise",
  section: "Tooling",
  label: "mise",
  run: async () => {
    if (!(await commandExists("mise")))
      return { status: IS_DARWIN ? "info" : "warn", message: IS_DARWIN ? "" : "mise — not installed" }
    const version = firstVersion((await probe(["mise", "--version"])).stdout)

    // `.node-version` is what `vp env pin` writes, and recent mise ignores those
    // files unless the tool is opted in. Nothing else would catch this silently
    // reverting, and the symptom is per-project pins quietly stopping.
    const setting = await probe(["mise", "settings", "get", "idiomatic_version_file_enable_tools"])
    const honoursNodeVersion = setting.ok && setting.stdout.includes("node")
    if (!honoursNodeVersion) {
      return {
        status: "warn",
        message: `mise — ${version}`,
        extra: [
          { kind: "warn", text: "idiomatic_version_file_enable_tools lacks \"node\" — .node-version files are ignored" },
        ],
      }
    }
    return { status: "ok", message: `mise — ${version} · honours .node-version` }
  },
}

/**
 * Is $HOME actually in sync with the repo?
 *
 * `stow-tree` counts tracked files, which says nothing about whether they are
 * LINKED — editing the repo and forgetting to re-stow looked identical to a
 * healthy machine. This runs the same planner `dotfiles stow` uses.
 */
const stowDriftCheck: Check = {
  id: "stow-drift",
  section: "Environment",
  label: "stow drift",
  run: async () => {
    const plan = await planStowAll()
    const pending = plan.create.length + plan.relink.length
    if (plan.conflicts.length > 0) {
      return {
        status: "warn",
        message: `stow — ${plan.conflicts.length} conflict(s), ${pending} link(s) pending (dotfiles stow)`,
        extra: plan.conflicts.slice(0, 6).map((c) => ({
          kind: "raw" as const,
          text: `    ${c.path} — ${CONFLICT_REASON[c.reason]}`,
        })),
      }
    }
    if (pending > 0)
      return { status: "warn", message: `stow — ${pending} link(s) not placed (dotfiles stow)` }
    return { status: "ok", message: `stow — ${plan.ok.length} link(s) in place` }
  },
}

/** Ignore-file globs, shared by the untracked check and reconcile. */
export async function ignorePatterns(path: string): Promise<RegExp[]> {
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  return (await file.text())
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map(globToRegExp)
}

/**
 * Reverse drift. A `check` walks the manifest asking "is each entry installed?" —
 * it never enumerates the system, so a package installed ad hoc and never
 * declared is invisible to it. That's the silent direction: it works here for
 * months and is simply absent on the next machine.
 */
const untrackedPackagesCheck: Check = {
  id: "untracked-packages",
  section: "Packages",
  label: basename(backend.manifests[0] ?? "packages"),
  run: async () => {
    const declared = await backend.declared()
    if (declared.size === 0) return { status: "info", message: "" }

    const label = backend.manifests.map((m) => `packages/${basename(m)}`).join(" + ")
    const installedSet = await backend.installed()
    if (installedSet.size === 0)
      return { status: "warn", message: `untracked packages — could not read ${backend.label} state` }

    // Subtracting the OS baseline is what makes this question the same on both
    // platforms: "what did I add that I haven't declared". Without it, pacman
    // answers "the operating system".
    const [base, patterns] = await Promise.all([
      backend.baseline(),
      ignorePatterns(backend.ignoreFile),
    ])
    const untracked = [...installedSet]
      .filter((line) => !declared.has(line))
      .filter((line) => !base.has(line))
      .filter((line) => !patterns.some((re) => re.test(line)))

    if (untracked.length === 0) return { status: "ok", message: `${label} — no untracked installs` }

    return {
      status: "warn",
      message: `${untracked.length} installed package(s) missing from ${label}:`,
      extra: untracked.map((p) => ({ kind: "raw" as const, text: `    ${p}` })),
    }
  },
}

// ─── Environment ────────────────────────────────────────────────────

const pathCheck: Check = {
  id: "path",
  section: "Environment",
  label: "dotfiles on PATH",
  run: async () => {
    const onPath = (process.env.PATH ?? "").split(":").includes(DOTFILES_DIR)
    if (onPath) return { status: "ok", message: `dotfiles on PATH (${DOTFILES_DIR})` }
    return {
      status: "warn",
      message: `dotfiles not on PATH — add ${DOTFILES_DIR} (open a new shell after stow)`,
    }
  },
}

const stowTreeCheck: Check = {
  id: "stow-tree",
  section: "Environment",
  label: "stow tree",
  run: async () => {
    const counts = await Promise.all(
      HOME_DIRS.map(async (dir) => ({ pkg: basename(dir), n: await countFilesRecursive(dir) })),
    )
    const total = counts.reduce((sum, c) => sum + c.n, 0)
    const detail = counts.map((c) => `${c.pkg} ${c.n}`).join(", ")
    return { status: "info", message: `stow tree: ${total} tracked files (${detail})` }
  },
}

const brokenSymlinksCheck: Check = {
  id: "broken-symlinks",
  section: "Environment",
  label: "broken symlinks",
  run: async () => {
    const broken = await findBrokenOwnedLinks()
    if (broken.length === 0) return { status: "ok", message: "no broken symlinks (paths we place)" }
    return {
      status: "warn",
      message: `${broken.length} broken symlink(s):`,
      extra: broken.map((p) => ({ kind: "raw" as const, text: `    ${p}` })),
    }
  },
}

/**
 * Pick the version-stamped toolchain directory the shells would pick.
 *
 * MUST stay lexicographically last, because that is exactly what a fish glob
 * subscript `[-1]` and the shell `for` loops resolve to. A cleverer rule here
 * (semver, or the trailing _YYYYMMDD stamp) would be *more* correct in the
 * abstract and would make doctor disagree with the shell it is checking,
 * reporting a phantom "not on PATH" against a dir the shell never chose.
 */
export function newestEspVersionDir(names: string[]): string | null {
  const versions = names.filter((n) => n.startsWith("esp-")).sort()
  return versions.at(-1) ?? null
}

async function espGccBin(): Promise<{ bin: string | null; versions: number }> {
  const root = join(ESP_ROOT, "xtensa-esp-elf")
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return { bin: null, versions: 0 }
  }
  const newest = newestEspVersionDir(entries)
  if (newest === null) return { bin: null, versions: 0 }
  const bin = join(root, newest, "xtensa-esp-elf", "bin")
  return {
    bin: (await isDirectory(bin)) ? bin : null,
    versions: entries.filter((n) => n.startsWith("esp-")).length,
  }
}

/**
 * espup installs the Xtensa toolchain but wires nothing — it writes
 * ~/export-esp.sh and expects you to source it. We re-derive those vars in
 * conf.d/esp32.fish and .config/esp32/env.sh instead, from a glob, so an
 * `espup update` that moves the version dir cannot strand us.
 *
 * This check is what makes the next such break visible. Without it the symptom
 * surfaces as `cc-rs: failed to find tool "xtensa-esp32s3-elf-gcc"` inside an
 * unrelated project's build, which reads as a project bug, not an env one.
 */
const espToolchainCheck: Check = {
  id: "esp-toolchain",
  section: "Environment",
  label: "ESP toolchain",
  run: async () => {
    // Not installed is not a problem — most machines have no reason to have it.
    if (!(await isDirectory(ESP_ROOT))) return { status: "info", message: "" }

    const { bin, versions } = await espGccBin()
    if (bin === null)
      return {
        status: "warn",
        message: "ESP toolchain — installed, but no xtensa-esp-elf/*/xtensa-esp-elf/bin (rerun espup install)",
      }

    if (!(process.env.PATH ?? "").split(":").includes(bin))
      return {
        status: "warn",
        message: `ESP toolchain not on PATH — ${bin} (open a new shell after stow)`,
      }

    const message = `ESP toolchain — ${bin}`
    // More than one version dir is the one case where "newest" is a guess.
    if (versions > 1)
      return {
        status: "ok",
        message,
        extra: [
          {
            kind: "warn",
            text: `  ↳ ${versions} version dirs under xtensa-esp-elf/ — the shells take the last one alphabetically`,
          },
        ],
      }
    return { status: "ok", message }
  },
}

// ─── registry ───────────────────────────────────────────────────────

// ─── Linux / Omarchy ────────────────────────────────────────────────

const pacmanCheck: Check = {
  id: "pacman",
  section: "Tooling",
  label: "pacman",
  critical: true,
  platforms: ["linux"],
  run: async () => {
    if (!(await commandExists("pacman"))) return { status: "fail", message: "pacman — missing" }
    const version = firstVersion((await probe(["pacman", "--version"])).stdout)
    const explicit = (await probe(["pacman", "-Qqe"])).stdout.split("\n").filter((l) => l.trim() !== "")
    return { status: "ok", message: `pacman — ${version} · ${explicit.length} explicit package(s)` }
  },
}

const yayCheck: Check = {
  id: "yay",
  section: "Tooling",
  label: "yay",
  platforms: ["linux"],
  run: async () => {
    if (!(await commandExists("yay")))
      return { status: "warn", message: "yay — not installed (dotfiles pacman)" }
    return { status: "ok", message: `yay — ${firstVersion((await probe(["yay", "--version"])).stdout)}` }
  },
}

const omarchyCheck: Check = {
  id: "omarchy",
  section: "Environment",
  label: "Omarchy",
  platforms: ["linux"],
  run: async () => {
    if (!IS_OMARCHY) return { status: "info", message: "" }
    const version = (await probe(["cat", "/usr/share/omarchy/version"])).stdout.trim()
    // `omarchy dev link` repoints OMARCHY_PATH, which moves every default we
    // layer on top of — worth surfacing before debugging a "wrong" default.
    const dev = await pathExists("/etc/omarchy.conf")
    return {
      status: "info",
      message: `Omarchy — ${version || "?"}${dev ? " (dev link mode)" : ""} · ${OMARCHY_PATH}`,
    }
  },
}

/** Hyprland keeps running on the last good config, so a broken bindings.lua is
 *  invisible until you ask. That is exactly the file this repo now tracks. */
const hyprlandConfigCheck: Check = {
  id: "hyprland-config",
  section: "Environment",
  label: "Hyprland config",
  platforms: ["linux"],
  run: async () => {
    if (!(await commandExists("hyprctl"))) return { status: "info", message: "" }
    const res = await probe(["hyprctl", "configerrors"])
    const text = res.stdout.trim()
    if (!res.ok) return { status: "info", message: "" }
    if (text === "" || /no config errors/i.test(text))
      return { status: "ok", message: "Hyprland config — no errors" }
    return {
      status: "warn",
      message: "Hyprland reported config errors:",
      extra: text
        .split("\n")
        .slice(0, 8)
        .map((l) => ({ kind: "raw" as const, text: `    ${l.trim()}` })),
    }
  },
}

/** Losing these include lines silently breaks `omarchy theme set`. */
const terminalThemeCheck: Check = {
  id: "terminal-theme-include",
  section: "Environment",
  label: "terminal theming",
  platforms: ["linux"],
  run: async () => {
    if (!IS_OMARCHY) return { status: "info", message: "" }
    const targets = [
      { path: join(HOME, ".config", "ghostty", "config"), needle: "current/theme/ghostty.conf" },
      { path: join(HOME, ".config", "foot", "foot.ini"), needle: "current/theme/foot.ini" },
    ]
    const broken: string[] = []
    for (const t of targets) {
      const file = Bun.file(t.path)
      if (!(await file.exists())) continue
      if (!(await file.text()).includes(t.needle)) broken.push(basename(t.path))
    }
    if (broken.length === 0)
      return { status: "ok", message: "terminal theming — omarchy includes intact" }
    return {
      status: "warn",
      message: `theme include missing from ${broken.join(", ")} — omarchy theme set will not apply`,
    }
  },
}

const ALL_CHECKS: Check[] = [
  brewCheck,
  pacmanCheck,
  yayCheck,
  stowCheck,
  gitCheck,
  nodeCheck,
  bunCheck,
  rustupCheck,
  goCheck,
  viteplusCheck,
  miseCheck,
  ...agentChecks,
  fishCheck,
  fisherCheck,
  loginShellCheck,
  fishCompletionsCheck,
  agentsSkillsCheck,
  claudeSkillsCheck,
  piSkillsCheck,
  vendoredCheck,
  vendoredIntegrityCheck,
  onePasswordCheck,
  gitSigningCheck,
  missingPackagesCheck,
  untrackedPackagesCheck,
  cargoToolsCheck,
  goToolsCheck,
  bunGlobalsCheck,
  pathCheck,
  espToolchainCheck,
  stowTreeCheck,
  stowDriftCheck,
  brokenSymlinksCheck,
  omarchyCheck,
  hyprlandConfigCheck,
  terminalThemeCheck,
]

export const CHECKS: Check[] = ALL_CHECKS.filter(
  (c) => c.platforms === undefined || c.platforms.includes(PLATFORM),
)

/** A check that resolved to an empty message is "not applicable here" — e.g.
 *  Pi isn't installed, or there is no vendor manifest. That is a RUNTIME answer;
 *  platform is handled by the filter above. Renderers drop these. */
export const isApplicable = (c: CompletedCheck): boolean => c.result.message !== ""

/**
 * Run every check concurrently. The bash version was strictly serial: ~20
 * subprocess spawns plus a `find` walk, one after another.
 */
export async function runChecks(
  onResult?: (check: CompletedCheck) => void,
): Promise<CompletedCheck[]> {
  return await Promise.all(
    CHECKS.map(async (check) => {
      let result: CheckResult
      try {
        result = await check.run()
      } catch (err) {
        result = { status: "fail", message: `${check.label} — check failed: ${String(err)}` }
      }
      const completed = { ...check, result }
      onResult?.(completed)
      return completed
    }),
  )
}

/** Critical failures only — what the footer counts and the exit code reflects. */
export const countCriticalIssues = (checks: CompletedCheck[]): number =>
  checks.filter((c) => c.critical && c.result.status === "fail").length

/** A health check is successful only after every critical check has completed. */
export const doctorExitCode = (
  checks: CompletedCheck[],
  hasPendingCritical = false,
): number => (hasPendingCritical || countCriticalIssues(checks) > 0 ? 1 : 0)
