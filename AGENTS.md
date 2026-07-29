# DOTFILES

macOS dev environment via GNU Stow + a `dotfiles` CLI. Shell: zsh (current) → fish
(adopting). Packages via Homebrew + bun. Skills live in a **separate repo**
([prezus/skills](https://github.com/prezus/skills)) and are symlinked in.

> **Agents:** this file is the map. Each substantial app under `home/.config/`
> has its own `AGENTS.md` with local detail. Make changes via the paths in
> **WHERE TO LOOK**, respect **ANTI-PATTERNS**, and never edit `~` directly.

## STRUCTURE

```
dotfiles/
├── dotfiles                  # bash SHIM (~45 lines): ensures bun + node_modules, execs src/cli.ts
├── src/                      # the CLI (TypeScript, run by bun)
│   ├── cli.ts                #   COMMANDS table — single source of truth for help + completions
│   ├── commands/             #   one module per subcommand; doctor/ has checks|fixes|view|plain
│   ├── lib/                  #   env, exec (subprocess + PATH threading), fs, brew, stow, steps
│   └── tui/                  #   the ONLY OpenTUI-aware code (renderer, theme, pickers)
├── home/                     # Stowed to $HOME  (stow -t ~ home)
│   ├── .zshrc .zprofile .profile .gitconfig   # shell + git (top-level)
│   └── .config/
│       ├── fish/             # Fish shell (AGENTS.md) — conf.d/ + fisher plugins
│       ├── zed/              # Editor (AGENTS.md) — LSP/formatter/theme
│       ├── aerospace/        # Tiling WM (AGENTS.md) — aerospace.toml
│       ├── nvim/             # Neovim: init.lua + lazy-lock.json (lazy.nvim)
│       ├── starship/         # prompt (shared by zsh + fish)
│       ├── git/ ghostty/ ripgrep/ opencode/ gh/
├── packages/
│   ├── bundle                # Brewfile (brew/cask/tap/go/cargo) — primary package source
│   ├── bundle.ignore         # installed-but-intentionally-untracked (drift-check excludes)
│   ├── rust.txt              # rustup toolchains/components/targets (`dotfiles rust`)
│   └── bun-global.txt        # JS-only global CLIs with no brew formula
├── AGENTS.md README.md INSTALL.md   # this file + human docs + dotfiles spec
└── .gitignore
```

## WHERE TO LOOK

| Task | Location / Command |
|------|--------------------|
| Add a CLI tool (has brew formula) | add `brew "x"` / `cask "x"` to `packages/bundle` |
| Add a JS global with **no** brew formula | add to `packages/bun-global.txt` (installed by `dotfiles bun`) |
| Silence a package in the drift check | add a glob to `packages/bundle.ignore` — only for things that must NEVER be tracked |
| VS Code extension | **never here** — it's VS Code Settings Sync (sign in) |
| Shell alias / abbr (fish) | `home/.config/fish/conf.d/zz-aliases.fish` |
| Shell env var / PATH (fish) | `home/.config/fish/conf.d/env.fish` / `paths.fish` |
| Fish plugin | `home/.config/fish/fish_plugins` (fisher) |
| Zsh config | `home/.zshrc` (being migrated to fish) |
| Prompt | `home/.config/starship/starship.toml` (both shells) |
| Git identity / signing | `home/.gitconfig` |
| SSH config (1Password agent + compat) | **`dotfiles ssh`** — NOT committed (see `_setup_ssh`) |
| Neovim plugin/keymap | `home/.config/nvim/` (init.lua; full config not vendored) |
| Tiling WM | `home/.config/aerospace/aerospace.toml` |
| A skill | edit in **`~/Projects/skills`** (separate repo); `dotfiles skills update` to sync vendored |
| Wire a new machine | `dotfiles init` |

## CONVENTIONS

- **Stow owns `~`.** Files under `home/` mirror `$HOME`; stow creates the symlinks.
  Add a file under `home/`, then `dotfiles stow`.
- **Packages: brew first.** Anything with a Homebrew formula goes in
  `packages/bundle`; only JS-only tools without a formula go in `bun-global.txt`.
  Brew tools get fish completions for free (vendor completions dir).
- **Skills are not stored here.** They live in `prezus/skills` and are symlinked
  (`~/.agents/skills` + `~/.claude/skills`) by `dotfiles skills install`.
- **SSH + secrets are generated/local, not committed.** `dotfiles ssh` writes a
  managed block; keys live in 1Password.
- **Idempotency:** every `dotfiles` step is safe to re-run.
- **No hardcoded paths** in scripts — use `$DOTFILES_DIR`, `$HOME`, `$SKILLS_REPO`.

## ANTI-PATTERNS

- Editing `~/.config/*` or `~/.zshrc` directly — changes are lost / diverge from the repo until stowed.
- **NEVER commit a `vscode "…"` line to `packages/bundle`** — extensions come from VS Code
  Settings Sync, always, no exceptions. `brew bundle dump` emits one line per installed
  extension (currently ~25 on this machine), so **every** dump must be stripped before
  it's committed — see NOTES for the command.
- Committing skill files into this repo — they belong in `prezus/skills`.
- Committing `~/.ssh/config`, keys, or secrets — SSH is `dotfiles ssh`-managed; keys are in 1Password.
- Appending completions/inits to `config.fish` — use `conf.d/` (auto-sourced) or `completions/`.
- Putting a JS tool in `bun-global.txt` when a brew formula exists — prefer brew.
- Committing fisher-managed `functions/`/`completions/` — they're gitignored, restored by `fisher update`.

## COMMANDS (`dotfiles`)

```
dotfiles init            Full setup: brew → rust → packages → bun → Vite+ → stow → ssh → fish → skills
dotfiles update          Multi-select: repos / brew / language tools / re-stow / skills
                         --all or --only=repos,brew for non-interactive runs
dotfiles doctor          Health check. Interactive panel on a tty (⏎ fixes the selected
                         warning in place); plain lines when piped or --plain.
                         Exits 1 on a critical failure, so it works as a gate.
dotfiles stow            Re-symlink home/ → $HOME. --dry-run previews, --adopt on an
                         existing machine. Conflicts are named before stow is run.
dotfiles ssh             Write the 1Password-agent + legacy-compat block into ~/.ssh/config
dotfiles bun             Install JS globals from packages/bun-global.txt
dotfiles viteplus        Install Vite+ (vp/vpr) to ~/.vite-plus
dotfiles rust            rustup toolchains/targets from packages/rust.txt (+ ESP)
dotfiles fish            Default login shell + fisher plugins + tool completions
dotfiles skills          install | update | status | verify   (from prezus/skills)
dotfiles check-packages / retry-failed / edit
```

Every command honours `NO_COLOR`, `CI` and `--plain`, and emits no escape
sequences when piped.

## KEY DECISIONS (context for changes)

- **Skills in a separate repo**, symlinked — one source of truth, works across all 5 agents (Claude Code/Codex/Cursor/OpenCode/Pi). See `prezus/skills/VENDORING.md`.
- **brew vs bun split** — brew for anything with a formula (auto-completions); bun only for JS-only tools (`bun-global.txt`). npm globals are eliminated.
- **Node.js is managed by Vite+** (`VP_NODE_MANAGER=yes`), not Homebrew. `vp env` provides
  `node/npm/npx/corepack` shims in `~/.vite-plus/bin`. Default is **`latest`** (not Vite+'s
  own default of latest-LTS) — set by `_viteplus_default_node` in the CLI, because that
  choice lives in the machine-local `~/.vite-plus/config.json`, which is not stowed.
  Per-project: `vp env pin <v>` writes a standard `.node-version` (portable to fnm/mise/nvm
  if we ever migrate); `vp env use <v>` is session-only.
  - **`brew "node"` is deliberately NOT in `packages/bundle`, but IS installed — and can't
    be removed.** 12 formulae depend on it (`opencode`, `pi-coding-agent`, `mongosh`,
    `prettier`, `typescript`, `tailwindcss`, `jupyterlab`, …) and `brew uninstall node`
    refuses. Vite+'s shims can't satisfy them either: brew's node CLIs hardcode an absolute
    shebang (`#!/opt/homebrew/opt/node/bin/node`) and never consult PATH. This is fine —
    the two runtimes are isolated, so bumping Vite+'s Node can't break brew's CLIs. Strip
    `brew "node"` from any fresh `brew bundle dump`, same as the `vscode "…"` lines.
  - **PATH order is the whole ballgame.** Both nodes exist and can differ by a major
    version; whichever lands first in PATH wins. `~/.vite-plus/bin` is pinned ahead of
    `/opt/homebrew/bin` in `conf.d/paths.fish` — don't reorder it. `dotfiles doctor` prints
    the resolved `node` path and warns when the shim is outranked.
  - **Vite+ owns its shell integration** — it writes `conf.d/vite-plus.fish` + blocks in
    `.zshrc`/`.profile`/`.zshenv`; because those are stowed, its writes land in the repo and
    are committed (don't hand-edit or strip them).
- **1Password SSH** — no keygen; `dotfiles ssh` binds `IdentityAgent`; git signs via `op-ssh-sign`.
- **Two shells** — zsh is the current login shell; fish is being adopted (starship prompt shared, so both look identical). See `home/.config/fish/AGENTS.md`.
- **Vite+ (`vp`/`vpr`)** installed via `dotfiles viteplus`; fish integration in `home/.config/fish/{conf.d/vite-plus.fish,completions/vp*.fish}`.

## NOTES

- **The CLI is TypeScript, run by bun.** It was bash until it hit 631 lines against a
  documented ~370-line budget, which is what this note used to warn about. `dotfiles` is now
  a ~45-line bash shim whose only job is the bootstrap chicken/egg: `brew "oven-sh/bun/bun"`
  is `packages/bundle`, installed at **init step 3**, so on a bare machine the CLI's own
  runtime does not exist when it is first invoked. The shim installs bun (brew if present,
  else `curl bun.sh`), ensures `node_modules`, and execs `src/cli.ts`.
  **Keep the shim bash-3.2 compatible** — macOS ships 3.2 and init steps 1–3 run under it.
- **Adding a subcommand:** add one entry to `COMMANDS` in `src/cli.ts`. That is the single
  source of truth for `help`, for the hidden `__commands`, and therefore for the fish
  completion, which calls `dotfiles __commands` on every tab. There is no second list.
- **`src/tui/` is the only OpenTUI-aware code**, plus `commands/doctor/view.tsx`. OpenTUI is
  pre-1.0 and pinned exactly; `checks.ts` and the rest of the data layer import none of it,
  so a breaking bump touches one directory.
- **Tests:** `bun test` (109 of them) and `bunx tsc --noEmit`, both run by CI. Prefer pure
  functions over mocks — the SSH block splice, the stow planner, the Brewfile parser and the
  step runner are all tested without touching the machine.
- **Anything that owns the terminal** — `sudo`, `chsh`, `brew bundle`, third-party
  `curl | bash` installers — must be wrapped in `withSuspendedUI()`, or it deadlocks inside
  a raw-mode render.
- **`run()` vs `probe()`:** `probe()` for version checks and feature detection, where a
  missing binary is an expected answer (it yields exit 127). `run()` returns a `Result` and
  reserves `Err` for the process failing to start; a non-zero exit is ordinary data.
- `packages/bundle` is a `brew bundle dump` snapshot + a hand-added tail; re-dumping with
  `--force` overwrites hand edits, so review after. **Always strip VS Code extensions from
  a fresh dump** before committing:
  ```sh
  brew bundle dump --file=packages/bundle --force
  gsed -i '/^vscode "/d' packages/bundle    # or: sed -i '' '/^vscode "/d' packages/bundle
  ```
- OrbStack re-adds its own `~/.ssh/config` Include and completions — don't fight it.
- **No `brew "fisher"`.** fisher self-installs as a fish *function* and is what actually
  manages `fish_plugins`; a brew copy is redundant and can shadow it. `dotfiles doctor`
  checks fisher via `fish -c 'type -q fisher'`, not via brew.
- **Package drift has two directions**, and they're checked in two different places:
  - *bundle → not installed*: `dotfiles check-packages` (a thin `brew bundle check`). It
    walks the Brewfile and never enumerates the system, so it sees only this direction.
  - *installed → not in bundle*: `dotfiles doctor` → **Packages**. This is the silent
    direction — an ad-hoc `brew install` works fine here for months and is simply absent on
    the next machine. `_check_untracked_packages` diffs a throwaway `brew bundle dump`
    against the bundle (**to a temp file** — never over `packages/bundle`, which carries
    hand edits). Intentional exclusions go in `packages/bundle.ignore`, one glob per line.
