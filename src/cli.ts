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
import { doctor } from "./commands/doctor/index.ts"
import { runLegacy } from "./legacy.ts"
import { SCRIPT_NAME, VERSION } from "./lib/env.ts"
import { BOLD, RESET, printError } from "./lib/ui.ts"

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
    description: "Full setup: brew/rust/packages/bun/vite+/stow/ssh/fish/skills",
    help: "Full setup: brew → rust → packages → bun → Vite+ → stow → ssh → fish → skills",
    run: (args) => runLegacy("init", args),
  },
  {
    name: "update",
    description: "Update everything: repos, brew, rust/cargo/go/bun/fisher/vite+, skills",
    help: "pull repos → brew + rust/cargo/go/bun/fisher/vite+ → re-stow → skills sync",
    run: (args) => runLegacy("update", args),
  },
  {
    name: "doctor",
    description: "Health check (brew, stow, fish, skills links, 1Password, signing)",
    run: (args) => doctor(args),
  },
  {
    name: "stow",
    description: "Re-symlink home/ into $HOME (--adopt on an existing machine)",
    run: (args) => runLegacy("stow", args),
  },
  {
    name: "ssh",
    description: "Maintain ~/.ssh/config (1Password agent + legacy compat)",
    run: (args) => runLegacy("ssh", args),
  },
  {
    name: "bun",
    description: "Install JS globals from packages/bun-global.txt",
    run: (args) => runLegacy("bun", args),
  },
  {
    name: "viteplus",
    description: "Install Vite+ (vp/vpr)",
    help: "Install Vite+ (vp/vpr) to ~/.vite-plus",
    run: (args) => runLegacy("viteplus", args),
  },
  {
    name: "rust",
    description: "Install rustup toolchains/targets from packages/rust.txt",
    help: "Install rustup + toolchains/targets from packages/rust.txt (+ ESP)",
    run: (args) => runLegacy("rust", args),
  },
  {
    name: "fish",
    description: "Make fish the default login shell + install fisher plugins",
    run: (args) => runLegacy("fish", args),
  },
  {
    name: "skills",
    description: "install | update | status (from prezus/skills)",
    run: (args) => runLegacy("skills", args),
  },
  {
    name: "check-packages",
    description: "Show which Brewfile packages are missing",
    run: (args) => runLegacy("check-packages", args),
  },
  {
    name: "retry-failed",
    description: "Reinstall packages that failed during init",
    run: (args) => runLegacy("retry-failed", args),
  },
  {
    name: "edit",
    description: "Open the dotfiles repo in $EDITOR",
    run: (args) => runLegacy("edit", args),
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
  const lines = COMMANDS.map(
    (c) => `  ${BOLD}${c.name}${RESET}${" ".repeat(width - c.name.length)}${c.help ?? c.description}`,
  )
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

  const name = first ?? "help"
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
