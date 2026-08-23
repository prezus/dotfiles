#!/usr/bin/env bun
// dotfiles — dotfiles management CLI.
//
// Reached via the `dotfiles` bash shim, which guarantees bun + node_modules
// exist before this file runs. See that script for the bootstrap chicken/egg.
//
// SINGLE SOURCE OF TRUTH for the command list is COMMANDS below. The fish
// completion (home/.config/fish/completions/dotfiles.fish) calls the hidden
// `__commands` subcommand on every tab-complete, so adding an entry here is all
// that is required — there is no second list to keep in sync.
import { SCRIPT_NAME, VERSION } from "./lib/env.ts"
import { PLATFORM, type Platform } from "./lib/platform.ts"
import { BOLD, RESET, isInteractive, printError } from "./lib/ui.ts"

type Command = {
  name: string
  /** Shown by `help` and, tab-separated, by `__commands`. */
  description: string
  /** Longer form for `help`, when the completion blurb is too terse. */
  help?: string
  /** Omitted = every platform. Filters help and the fish completion; dispatch
   *  stays permissive so a stale completion cache explains itself. */
  platforms?: readonly Platform[]
  run: (args: string[]) => Promise<number>
}

// Every `run` dynamically imports its module rather than importing at the top of
// this file. That is deliberate and load-bearing, not style:
//
// `dotfiles __commands` is called by the fish completion on EVERY tab-press, and
// there is no build step — bun evaluates the whole module graph on each process.
// Eagerly importing all sixteen command modules meant tab-completion paid for
// every dependency any command might need. Measured: 7ms on the fast path with
// lazy imports versus 70ms once a heavy module graph is in the eager set.
//
// Keep it this way. The COMMANDS table is still the single source of truth for
// help, __commands and therefore the completion — only the module load moved.
const ALL_COMMANDS: Command[] = [
  {
    name: "init",
    description: "Full setup: packages/rust/bun/Plannotator/stow/mise/Pi/ssh/fish/skills",
    help:
      "Full setup. macOS: brew → rust → packages → bun → Plannotator → stow → mise → Pi → ssh → fish → skills\n" +
      "Linux: pacman/yay → rust → bun → Plannotator → stow → mise → Pi → ssh → fish → skills → omarchy includes",
    run: async () => (await import("./commands/init.ts")).init(),
  },
  {
    name: "update",
    description: "Update repos, packages, language tools, stow, Pi plugins, and skills",
    help: "pull repos → brew + rust/cargo/go/bun/fisher → re-stow → Pi plugins → skills sync",
    run: async (args) => (await import("./commands/update.ts")).update(args),
  },
  {
    name: "doctor",
    description: "Health check (packages, stow, fish, skills links, 1Password, signing)",
    run: async (args) => (await import("./commands/doctor/index.ts")).doctor(args),
  },
  {
    name: "brew",
    platforms: ["darwin"],
    description: "Install Homebrew + everything in packages/bundle",
    help:
      "Install Homebrew, then `brew bundle` packages/bundle — init's brew steps alone.\n" +
      "Run it from a shell to stay out of the dashboard entirely.",
    run: async () => (await import("./commands/homebrew.ts")).homebrew(),
  },
  {
    name: "pacman",
    platforms: ["linux"],
    description: "Install pacman/yay + everything in packages/arch.txt",
    help: "Install bootstrap packages + yay, then packages/arch.txt and aur.txt.",
    run: async () => (await import("./commands/pacman.ts")).pacmanCmd(),
  },
  {
    name: "omarchy-includes",
    platforms: ["linux"],
    description: "Add our managed include to Omarchy's ghostty/foot configs",
    help:
      "Append a managed include line to the Omarchy-owned terminal configs.\n" +
      "Re-run after `omarchy refresh config` reverts one.",
    run: async () => (await import("./commands/omarchy.ts")).omarchyIncludes(),
  },
  {
    name: "reconcile",
    description: "Resolve each difference between this machine and the package manifests",
    help:
      "Walk every mismatch one at a time: keep it (declare it), remove it,\n" +
      "or never track it. Uninstalls are batched behind a single confirm.",
    run: async () => (await import("./commands/reconcile.ts")).reconcile(),
  },
  {
    name: "stow",
    description: "Re-symlink home/ + the platform overlay into $HOME",
    help: "Re-symlink home/ + home-<platform>/ → $HOME  (--adopt on an existing machine, --dry-run to preview)",
    run: async (args) => (await import("./commands/stow.ts")).stow(args),
  },
  {
    name: "ssh",
    description: "Maintain ~/.ssh/config (1Password agent + legacy compat)",
    run: async () => (await import("./commands/ssh.ts")).ssh(),
  },
  {
    name: "bun",
    description: "Install JS globals from packages/bun-global.txt",
    run: async () => (await import("./commands/bunglobals.ts")).bunGlobals(),
  },
  {
    name: "lang-tools",
    description: "Install crates + go tools from packages/{cargo,go}.txt",
    run: async () => (await import("./commands/langtools.ts")).langToolsCmd(),
  },
  {
    name: "rust",
    description: "Install rustup toolchains/targets from packages/rust.txt",
    help: "Install rustup + toolchains/targets from packages/rust.txt (+ ESP)",
    run: async () => (await import("./commands/rust.ts")).rust(),
  },
  {
    name: "plannotator",
    description: "Install the Plannotator CLI",
    help: "Install the Plannotator binary to ~/.local/bin (integrations are stowed)",
    run: async () => (await import("./commands/plannotator.ts")).plannotator(),
  },
  {
    name: "fish",
    description: "Make fish the default login shell + install fisher plugins",
    run: async () => (await import("./commands/fish.ts")).fish(),
  },
  {
    name: "skills",
    // `verify` was dispatched by the bash but missing from its completion list,
    // so fish never suggested it. Now that it is real TypeScript, list it.
    description: "install | update | status | verify (from prezus/skills)",
    run: async (args) => (await import("./commands/skills.ts")).skills(args),
  },
  {
    name: "pi",
    description: "install | update | status | verify pinned Pi plugins",
    run: async (args) => (await import("./commands/pi.ts")).piPlugins(args),
  },
  {
    name: "check-packages",
    description: "Show which declared packages are missing",
    run: async () => {
      const { backend } = await import("./lib/pkgbackend.ts")
      const { defaultRuntime } = await import("./commands/packages.ts")
      return backend.check(defaultRuntime)
    },
  },
  {
    name: "retry-failed",
    description: "Reinstall packages that failed during init",
    run: async () => {
      const { backend } = await import("./lib/pkgbackend.ts")
      const { defaultRuntime } = await import("./commands/packages.ts")
      const outcome = await backend.install(defaultRuntime)
      return outcome.ok ? 0 : 1
    },
  },
  {
    name: "keys",
    description: "Keyboard visualizer: see what your keys send, record and diff machines",
    help:
      "Serve a keyboard visualizer and open it.  --raw reads evdev below the\n" +
      "compositor (Linux), so chords Hyprland grabs are still visible.\n" +
      "record <name> captures this machine; diff <a> <b> compares two.",
    run: async (args) => (await import("./commands/keys.ts")).keys(args),
  },
  {
    name: "edit",
    description: "Open the dotfiles repo in $EDITOR",
    run: async () => (await import("./commands/edit.ts")).edit(),
  },
  {
    name: "help",
    description: "Show this help",
    run: async () => {
      printHelp()
      return 0
    },
  },
]

const COMMANDS: Command[] = ALL_COMMANDS.filter(
  (c) => c.platforms === undefined || c.platforms.includes(PLATFORM),
)

/** Machine-readable `name<TAB>description`, one per line — powers the fish completion. */
function printCommands(): void {
  process.stdout.write(COMMANDS.map((c) => `${c.name}\t${c.description}`).join("\n") + "\n")
}

function printHelp(): void {
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2
  const lines = COMMANDS.map((c) => {
    // A `help` may run to a second line; align its continuation under the first
    // rather than making each entry hard-code the column it happens to land in.
    const indent = " ".repeat(width + 2)
    const body = (c.help ?? c.description).split("\n").join(`\n${indent}`)
    return `  ${BOLD}${c.name}${RESET}${" ".repeat(width - c.name.length)}${body}`
  })
  process.stdout.write(
    `${BOLD}dotfiles${RESET} — dotfiles management\n\n${lines.join("\n")}\n\n` +
      `  (--version for version)\n`,
  )
}

async function main(argv: string[]): Promise<number> {
  const [first, ...rest] = argv

  if (first === "--version") {
    console.log(`${SCRIPT_NAME} ${VERSION}`)
    return 0
  }
  // Hidden: consumed by the fish completion, must stay free of colour and TUI.
  if (first === "__commands") {
    printCommands()
    return 0
  }

  // Bare `dotfiles` opens the dashboard. A TUI you have to remember a
  // subcommand to reach isn't much of a TUI.
  //
  // Only on a real terminal, though: piped, redirected, under CI or with
  // --plain it still prints help, because scripts and `dotfiles | grep` must
  // never land in a full-screen app.
  if (first === undefined) {
    if (!isInteractive()) {
      printHelp()
      return 0
    }
    const { runHomeTui } = await import("./tui/home.tsx")
    return await runHomeTui(
      COMMANDS.filter((c) => c.name !== "help").map((c) => ({
        name: c.name,
        description: c.description,
        run: () => c.run([]),
      })),
    )
  }

  const name = first
  if (name === "-h" || name === "--help") {
    printHelp()
    return 0
  }

  const command = COMMANDS.find((c) => c.name === name)
  if (!command) {
    const otherPlatform = ALL_COMMANDS.find((c) => c.name === name)
    if (otherPlatform) {
      printError(`${name} is ${otherPlatform.platforms?.join("/")}-only (this is ${PLATFORM})`)
      return 1
    }
    printError(`unknown command: ${name}`)
    printHelp()
    return 1
  }

  return await command.run(rest)
}

process.exit(await main(process.argv.slice(2)))
