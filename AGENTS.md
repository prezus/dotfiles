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
├── dotfiles                       # CLI (bash): init/update/doctor/stow/ssh/bun/viteplus/skills/...
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
dotfiles init         Full setup: brew → packages → bun globals → Vite+ → stow → ssh → fish → skills
dotfiles update       git pull → brew update/upgrade → re-stow → (skills sync)
dotfiles doctor       Health check (brew, stow, fish, skills links, 1Password, git signing)
dotfiles stow         Re-symlink home/ → $HOME
dotfiles ssh          Write the 1Password-agent + legacy-compat block into ~/.ssh/config
dotfiles bun          Install JS globals from packages/bun-global.txt
dotfiles viteplus     Install Vite+ (vp/vpr) to ~/.vite-plus
dotfiles skills       install | update | status   (from prezus/skills)
dotfiles check-packages / retry-failed / edit
```

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

- `dotfiles` is ~370 lines (adapted from dmmulroy's, trimmed to this stack) — keep it thin; if it grows, split into `lib/` or a real language, and never reintroduce the delimited-string step registry.
- **Adding a subcommand:** add it to the `case` dispatch **and** to `_print_commands()` (name<TAB>desc). The fish completion (`home/.config/fish/completions/dotfiles.fish`) reads `dotfiles __commands` dynamically, so it auto-updates from `_print_commands` — no separate completion edit needed.
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
