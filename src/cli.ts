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
import { bunGlobals } from "./commands/bunglobals.ts"
import { doctor } from "./commands/doctor/index.ts"
import { edit } from "./commands/edit.ts"
import { homebrew } from "./commands/homebrew.ts"
import { init } from "./commands/init.ts"
import { checkPackages, retryFailed } from "./commands/packages.ts"
import { plannotator } from "./commands/plannotator.ts"
import { fish } from "./commands/fish.ts"
import { rust } from "./commands/rust.ts"
import { skills } from "./commands/skills.ts"
import { ssh } from "./commands/ssh.ts"
import { update } from "./commands/update.ts"
import { viteplus } from "./commands/viteplus.ts"
import { stow } from "./commands/stow.ts"
import { SCRIPT_NAME, VERSION } from "./lib/env.ts"
import { BOLD, RESET, isInteractive, printError } from "./lib/ui.ts"

type Command = {
  name: string
  /** Shown by `help` and, tab-separated, by `__commands`. */
  description: string
  /** Longer form for `help`, when the completion blurb is too terse. */
  help?: string
  run: (args: string[]) => Promise<number>
}

const COMMANDS: Command[] = [
  {
    name: "init",
    description: "Full setup: brew/rust/packages/bun/vite+/Plannotator/stow/ssh/fish/skills",
    help: "Full setup: brew → rust → packages → bun → Vite+ → Plannotator → stow → ssh → fish → skills",
    run: () => init(),
  },
  {
    name: "update",
    description: "Update everything: repos, brew, rust/cargo/go/bun/fisher/vite+, skills",
    help: "pull repos → brew + rust/cargo/go/bun/fisher/vite+ → re-stow → skills sync",
    run: (args) => update(args),
  },
  {
    name: "doctor",
    description: "Health check (brew, stow, fish, skills links, 1Password, signing)",
    run: (args) => doctor(args),
  },
  {
    name: "brew",
    description: "Install Homebrew + everything in packages/bundle",
    help:
      "Install Homebrew, then `brew bundle` packages/bundle — init's brew steps alone.\n" +
      "Run it from a shell to stay out of the dashboard entirely.",
    run: () => homebrew(),
  },
  {
    name: "stow",
    description: "Re-symlink home/ into $HOME (--adopt on an existing machine)",
    help: "Re-symlink home/ → $HOME  (--adopt on an existing machine, --dry-run to preview)",
    run: (args) => stow(args),
  },
  {
    name: "ssh",
    description: "Maintain ~/.ssh/config (1Password agent + legacy compat)",
    run: () => ssh(),
  },
  {
    name: "bun",
    description: "Install JS globals from packages/bun-global.txt",
    run: () => bunGlobals(),
  },
  {
    name: "viteplus",
    description: "Install Vite+ (vp/vpr)",
    help: "Install Vite+ (vp/vpr) to ~/.vite-plus",
    run: () => viteplus(),
  },
  {
    name: "rust",
    description: "Install rustup toolchains/targets from packages/rust.txt",
    help: "Install rustup + toolchains/targets from packages/rust.txt (+ ESP)",
    run: () => rust(),
  },
  {
    name: "plannotator",
    description: "Install the Plannotator CLI",
    help: "Install the Plannotator binary to ~/.local/bin (integrations are stowed)",
    run: () => plannotator(),
  },
  {
    name: "fish",
    description: "Make fish the default login shell + install fisher plugins",
    run: () => fish(),
  },
  {
    name: "skills",
    // `verify` was dispatched by the bash but missing from its completion list,
    // so fish never suggested it. Now that it is real TypeScript, list it.
    description: "install | update | status | verify (from prezus/skills)",
    run: (args) => skills(args),
  },
  {
    name: "check-packages",
    description: "Show which Brewfile packages are missing",
    run: () => checkPackages(),
  },
  {
    name: "retry-failed",
    description: "Reinstall packages that failed during init",
    run: () => retryFailed(),
  },
  {
    name: "edit",
    description: "Open the dotfiles repo in $EDITOR",
    run: () => edit(),
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
    printError(`unknown command: ${name}`)
    printHelp()
    return 1
  }

  return await command.run(rest)
}

process.exit(await main(process.argv.slice(2)))
