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
| ESP32 / Xtensa toolchain env | `home/.config/fish/conf.d/esp32.fish` + `home/.config/esp32/env.sh` (espup installs it but wires nothing — nobody sources `~/export-esp.sh`) |
| Prompt | `home/.config/starship/starship.toml` (both shells) |
| Git identity / signing | `home/.gitconfig` |
| SSH config (1Password agent + compat) | **`dotfiles ssh`** — NOT committed (see `src/commands/ssh.ts`) |
| Neovim plugin/keymap | `home/.config/nvim/` (init.lua; full config not vendored) |
| Tiling WM | `home/.config/aerospace/aerospace.toml` |
| A skill | edit in **`~/Projects/skills`** (separate repo); `dotfiles skills update` to sync vendored |
| Pi agent config / plugins | `home/.pi/agent/`; plugins: `dotfiles pi {install,status,update,verify}` |
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
dotfiles                 Opens the DASHBOARD — machine status + every command one key away.
                         Piped, redirected, under CI or --plain it prints help instead.
dotfiles init            Full setup: brew → rust → packages → bun → Vite+ → Plannotator → stow → Pi → ssh → fish → skills
dotfiles update          Multi-select: repos / brew / language tools / re-stow / Pi plugins / skills
                         --all or --only=repos,brew for non-interactive runs
dotfiles doctor          Health check. Interactive panel on a tty (⏎ fixes the selected
                         warning in place); plain lines when piped or --plain.
                         Exits 1 on a critical failure, so it works as a gate.
dotfiles brew            Homebrew + `brew bundle` packages/bundle — init's brew steps
                         alone, and the escape hatch when they fail inside the dashboard.
dotfiles stow            Re-symlink home/ → $HOME. --dry-run previews, --adopt on an
                         existing machine. Conflicts are named before stow is run.
dotfiles ssh             Write the 1Password-agent + legacy-compat block into ~/.ssh/config
dotfiles bun             Install JS globals from packages/bun-global.txt
dotfiles viteplus        Install Vite+ (vp/vpr) to ~/.vite-plus
dotfiles plannotator     Install the Plannotator CLI to ~/.local/bin
dotfiles rust            rustup toolchains/targets from packages/rust.txt (+ ESP)
dotfiles fish            Default login shell + fisher plugins + tool completions
dotfiles skills          install | update | status | verify   (from prezus/skills)
dotfiles pi              install | update | status | verify   (exact pins in Pi settings)
dotfiles check-packages / retry-failed / edit
```

Every command honours `NO_COLOR`, `CI` and `--plain`, and emits no escape
sequences when piped.

## KEY DECISIONS (context for changes)

- **Skills in a separate repo**, symlinked — one source of truth, works across all 5 agents (Claude Code/Codex/Cursor/OpenCode/Pi). See `prezus/skills/VENDORING.md`.
- **brew vs bun split** — brew for anything with a formula (auto-completions); bun only for JS-only tools (`bun-global.txt`). npm globals are eliminated.
- **Node.js is managed by Vite+** (`VP_NODE_MANAGER=yes`), not Homebrew. `vp env` provides
  `node/npm/npx/corepack` shims in `~/.vite-plus/bin`. Default is **`latest`** (not Vite+'s
  own default of latest-LTS) — set by `setDefaultNodeLatest` in `src/commands/viteplus.ts`, because that
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
- **Tests:** Run `bun run test` and `bun run typecheck` yourself; this single-user repo has
  no CI. Do not add tests by default. Add one for a reproduced regression, a destructive
  operation, an external contract, or a non-obvious invariant that types cannot express.
  Prefer one integration path over exhaustive unit examples. Do not test trivial formatting,
  mirror every implementation branch, or pin internal arrays and constants. A test written
  alongside an implementation does not prove that the chosen behavior matches the request.
  Prefer real temp files and processes over mocks when a test is justified.
- **Keyboard behaviour is a pure reducer** (`src/tui/interaction.ts`), not logic buried in a
  component. Components render state and perform intents; they decide nothing. This is what
  makes the interactive paths testable without a terminal — everything except drawing and
  restoring cooked mode, both of which are OpenTUI's.

- **Nothing renders an unbounded list.** Every screen used to draw all its rows —
  `rows.map`, doctor's 26 checks, a fixed 24-line output tail — so on a short terminal the
  row you needed to act on simply was not on screen. `src/tui/scroll.ts` owns list
  arithmetic: `windowFor` for cursor-driven lists and `fitWindow` for doctor, whose rows
  are **not** all one row tall because a failing check draws its `extra` detail lines too.
  The output pane uses libghostty's viewport and scrollback instead.
- **Resize is a subscription, not a read.** `useTerminalSize()`
  (`src/tui/use-terminal-size.ts`) drives screen layout and resizes the embedded libghostty
  grid. `exec.ts` separately resizes the child's PTY to the same dimensions; `lib/` reaches
  the pane through `TerminalSink` and does not import the UI layer.
- **Child output is a VT stream, not log lines.** `runInteractive` gives captured tools a
  PTY and sends its unmodified bytes through `TerminalSink`. `src/tui/terminal-session.ts`
  owns the pinned `libghostty-vt` adapter and projects its cell grid into OpenTUI. Keep ANSI,
  cursor movement, Unicode width and scrollback there. `exec.ts` must not parse terminal
  escapes, and the React pane must not reconstruct terminal state from strings.
- **OpenTUI selection copies through OSC52.** `home.tsx` keeps terminal rows selectable and
  copies each completed drag immediately; `clipboard.ts` also handles forwarded copy keys.
  Ghostty's native selection is unavailable while OpenTUI owns mouse reporting.
- **Mark a child `needsStdin: true` when it needs the USER's keyboard** — sudo, chsh,
  $EDITOR, the `curl | bash` installers. exec.ts then suspends any mounted UI around **that
  child alone** and gives the terminal straight back. Commands never call `withSuspendedUI`
  themselves: classifying at the command level was wrong, because `init` runs ten steps and
  only one wants a password. Getting the flag wrong is a hang, not a cosmetic bug.
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
- **Origin, and why it still matters.** The first version of this CLI was a bash script
  adapted from [dmmulroy's `dot`](https://github.com/dmmulroy/.dotfiles). None of that code
  remains — it was deleted wholesale in the TypeScript rewrite — but some of its *assumptions*
  survived the port unexamined. A Cloudflare WARP workaround for a product not installed here
  rode along for months, ported verbatim and defended in a comment, before anyone asked
  whether the premise was ever true.
  **When something appears to solve a problem you have never had, run `git log -S '<string>'`
  and find out when it arrived before assuming it earns its place.** Candidates that came in
  with the adaptation and have never been re-justified: the `FISH_TOOL_COMPLETIONS` list and
  the legacy-host SSH stanza (`ssh-rsa`, `diffie-hellman-group1-sha1` for `192.168.*`).
  The ESP/Xtensa Rust toolchain used to be on that list and has now been through exactly this
  exercise: it turned out to be genuinely used (`~/Projects/esp32-genset`) but never actually
  wired — `.zshrc` sourced a `~/.config/esp32/env.sh` that had never existed, so the `[ -f ]`
  guard swallowed it silently for months. Re-justifying a thing can end in wiring it up
  properly rather than deleting it; the point is that somebody checked.
- OrbStack re-adds its own `~/.ssh/config` Include and completions — don't fight it. Stow
  no longer needs to: a path that blocks stow but whose bytes already match ours is
  **reclaimed** (the link is taken over, content unchanged). Our completions come from
  `<tool> completion fish`, i.e. from OrbStack's own binaries, so they match by construction.
  If OrbStack re-adds its links, the next `dotfiles stow` simply reclaims them again.
- **Generated completions stay gitignored, and `dotfiles doctor` watches them for drift.**
  They are machine-generated, so git cannot tell you when a tool upgrade has made them
  stale. doctor re-runs `<tool> completion fish` and compares, warning when the stored copy
  no longer matches — the visibility that committing ~58KB of generated fish would have
  bought, without the chore of re-resolving a stow conflict after every tool update.
- **No `brew "fisher"`.** fisher self-installs as a fish *function* and is what actually
  manages `fish_plugins`; a brew copy is redundant and can shadow it. `dotfiles doctor`
  checks fisher via `fish -c 'type -q fisher'`, not via brew.
- **`brew bundle install` runs on the REAL terminal, not in the output pane.** sudo reads
  its password from the *controlling* terminal, and a captured child's controlling terminal
  is the PTY `exec.ts` opened for the pane — so a cask with a `pkg` payload printed
  "Password:" somewhere nobody could see or answer, and the install hung until sudo timed
  out. It surfaced as a bare "Homebrew failed". The install pass therefore sets
  `needsStdin` (`src/commands/packages.ts`); the read-only `check` pass does not, since it
  never escalates. When Bundle's verbose check names pending casks, `src/lib/sudo.ts`
  warms the ticket first and keeps it alive — macOS expires it after five minutes, which
  is far shorter than a fresh bundle install. Counting every declared cask here is wrong:
  one outdated formula must not trigger a password prompt for all casks in the Brewfile.
  Losing the pane for the install pass is the trade.
- **Package drift has two directions**, and they're checked in two different places:
  - *bundle → not installed*: `dotfiles check-packages` (a thin `brew bundle check`). It
    walks the Brewfile and never enumerates the system, so it sees only this direction.
  - *installed → not in bundle*: `dotfiles doctor` → **Packages**. This is the silent
    direction — an ad-hoc `brew install` works fine here for months and is simply absent on
    the next machine. the `untracked-packages` check diffs a throwaway `brew bundle dump`
    against the bundle (**to a temp file** — never over `packages/bundle`, which carries
    hand edits). Intentional exclusions go in `packages/bundle.ignore`, one glob per line.
