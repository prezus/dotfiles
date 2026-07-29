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
import { join, resolve } from "node:path"
import {
  DOTFILES_DIR,
  FISH_TOOL_COMPLETIONS,
  HOME,
  HOME_DIR,
  OP_AGENT_SOCK,
  PACKAGES_DIR,
  SKILLS_REPO,
  SKILLS_SRC,
} from "../../lib/env.ts"
import { commandExists, extract, probe, which } from "../../lib/exec.ts"
import {
  countFilesRecursive,
  countSubdirectories,
  isDirectory,
  isSocket,
  pathExists,
  readlinkSafe,
} from "../../lib/fs.ts"
import { findBrokenOwnedLinks } from "../../lib/owned.ts"

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
    if (!(await commandExists("stow"))) return { status: "fail", message: "GNU Stow — missing" }
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
 * Node is owned by Vite+, but Homebrew keeps its own `node` as an unremovable
 * transitive dep of ~12 CLIs. Both exist and can differ by a MAJOR version, so
 * PATH order alone decides which one runs. Report what PATH actually resolves
 * and flag it when the shim is not winning. (AGENTS.md → KEY DECISIONS.)
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
    const shell = process.env.SHELL ?? ""
    if (shell.endsWith("fish")) return { status: "ok", message: `login shell: fish (${shell})` }
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
    const ours: string[] = []
    const shadowed: string[] = []
    const missing: string[] = []

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
        ;(resolved.startsWith(HOME_DIR) ? ours : shadowed).push(tool)
      }),
    )
    // Preserve the declared order rather than completion-race order.
    const order = (a: string, b: string) =>
      FISH_TOOL_COMPLETIONS.indexOf(a as never) - FISH_TOOL_COMPLETIONS.indexOf(b as never)
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
    ).filter((t): t is string => t !== null)
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

const agentsSkillsCheck: Check = {
  id: "skills-agents",
  section: "Skills",
  label: "~/.agents/skills",
  run: async () => {
    const target = await readlinkSafe(join(HOME, ".agents", "skills"))
    if (target !== SKILLS_SRC)
      return { status: "warn", message: "~/.agents/skills — not linked (dotfiles skills install)" }
    const count = await countSubdirectories(SKILLS_SRC)
    return { status: "ok", message: `~/.agents/skills → ${SKILLS_SRC} (${count} skills)` }
  },
}

const claudeSkillsCheck: Check = {
  id: "skills-claude",
  section: "Skills",
  label: "~/.claude/skills",
  run: async () => {
    const target = await readlinkSafe(join(HOME, ".claude", "skills"))
    if (target !== join(HOME, ".agents", "skills"))
      return { status: "warn", message: "~/.claude/skills — not linked (dotfiles skills install)" }
    return { status: "ok", message: "~/.claude/skills → ~/.agents/skills" }
  },
}

/** Pi reads the same canonical pool — only checked when Pi is set up here. */
const piSkillsCheck: Check = {
  id: "skills-pi",
  section: "Skills",
  label: "~/.pi/agent/skills",
  run: async () => {
    if (!(await isDirectory(join(HOME, ".pi", "agent"))))
      return { status: "info", message: "" } // filtered out by the renderers
    const target = await readlinkSafe(join(HOME, ".pi", "agent", "skills"))
    if (target !== join(HOME, ".agents", "skills"))
      return { status: "warn", message: "~/.pi/agent/skills — not linked (dotfiles skills install)" }
    return { status: "ok", message: "~/.pi/agent/skills → ~/.agents/skills" }
  },
}

type VendorManifest = {
  vendors: { source: string; pinnedCommit: string; vendoredOn: string }[]
}

/** Replaces a `node -e "require(...)"` shell-out with a native JSON read. */
const vendoredCheck: Check = {
  id: "skills-vendored",
  section: "Skills",
  label: "vendored",
  run: async () => {
    const manifest = Bun.file(join(SKILLS_REPO, "vendor-manifest.json"))
    if (!(await manifest.exists())) return { status: "info", message: "" }

    const parsed = await Result.tryPromise(async () => (await manifest.json()) as VendorManifest)
    return Result.match<VendorManifest, unknown, CheckResult>(parsed, {
      ok: (data) => ({
        status: "info",
        message: `vendored: ${data.vendors
          .map((v) => `${v.source} @ ${v.pinnedCommit.slice(0, 10)} (${v.vendoredOn})`)
          .join(" · ")}`,
      }),
      err: () => ({
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

/** Keep only tracked directives, drop trailing options (`, trusted: true`) so
 *  flag churn isn't reported as drift. Port of bash `_bundle_norm`. */
export function normalizeBundle(text: string): Set<string> {
  const keep = /^(brew|cask|tap|go|cargo) /
  return new Set(
    text
      .split("\n")
      .filter((l) => keep.test(l))
      .map((l) => l.replace(/,.*$/, ""))
      .sort(),
  )
}

/** Port of bash `[[ "$line" == $pat ]]` — a glob, not a regex. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`)
}

/**
 * Reverse drift. `brew bundle check` walks the Brewfile asking "is each entry
 * installed?" — it never enumerates the system, so a package installed ad hoc
 * and never added to packages/bundle is invisible to it. That's the silent
 * direction: it works here for months and is simply absent on the next machine.
 */
const untrackedPackagesCheck: Check = {
  id: "untracked-packages",
  section: "Packages",
  label: "packages/bundle",
  run: async () => {
    if (!(await commandExists("brew"))) return { status: "info", message: "" }
    const bundlePath = join(PACKAGES_DIR, "bundle")
    if (!(await Bun.file(bundlePath).exists())) return { status: "info", message: "" }

    // NOTE: dumps to a TEMP file — never to packages/bundle, which carries hand edits.
    const tmp = join(
      process.env.TMPDIR ?? "/tmp",
      `dotfiles-bundle-dump.${process.pid}`,
    )
    try {
      const dump = await probe(["brew", "bundle", "dump", `--file=${tmp}`, "--force"])
      if (!dump.ok)
        return { status: "warn", message: "untracked packages — could not dump brew state" }

      const [dumped, tracked] = await Promise.all([
        Bun.file(tmp).text(),
        Bun.file(bundlePath).text(),
      ])
      const trackedSet = normalizeBundle(tracked)

      const ignoreFile = Bun.file(join(PACKAGES_DIR, "bundle.ignore"))
      const patterns = (await ignoreFile.exists())
        ? (await ignoreFile.text())
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l !== "" && !l.startsWith("#"))
            .map(globToRegExp)
        : []

      const untracked = [...normalizeBundle(dumped)]
        .filter((line) => !trackedSet.has(line))
        .filter((line) => !patterns.some((re) => re.test(line)))

      if (untracked.length === 0)
        return { status: "ok", message: "packages/bundle — no untracked installs" }

      return {
        status: "warn",
        message: `${untracked.length} installed package(s) missing from packages/bundle:`,
        extra: untracked.map((p) => ({ kind: "raw" as const, text: `    ${p}` })),
      }
    } finally {
      // try/finally, not the bash pattern of an `rm -f` on every exit path —
      // where a `set -e` abort in between leaked the temp file.
      await Bun.file(tmp)
        .unlink()
        .catch(() => {})
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
  run: async () => ({
    status: "info",
    message: `stow tree: ${await countFilesRecursive(HOME_DIR)} tracked files under home/`,
  }),
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

// ─── registry ───────────────────────────────────────────────────────

export const CHECKS: Check[] = [
  brewCheck,
  stowCheck,
  gitCheck,
  nodeCheck,
  bunCheck,
  rustupCheck,
  goCheck,
  viteplusCheck,
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
  untrackedPackagesCheck,
  pathCheck,
  stowTreeCheck,
  brokenSymlinksCheck,
]

/** A check that resolved to an empty message is "not applicable here" — e.g.
 *  Pi isn't installed, or there is no vendor manifest. Renderers drop these. */
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
