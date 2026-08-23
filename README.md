# dotfiles

Machine setup for our dev environment — packages, shell/tool config, and the install that
makes our **AI Agent Skills** discoverable by every coding agent we use (Claude Code,
Codex, Cursor, OpenCode, Pi). Modeled on the `dotfiles` + [GNU Stow](https://www.gnu.org/software/stow/)
pattern.

Runs on **macOS** and on **Omarchy / Arch Linux**. One shared config tree plus a small
per-OS overlay; see [PLATFORMS](./AGENTS.md#platforms) for the rule about which is which.

The skills themselves live in [prezus/skills](https://github.com/prezus/skills); this repo
only **deploys** them.

## Structure

```
dotfiles              # bash shim — ensures bun exists, then runs src/cli.ts
src/                  # the CLI (TypeScript): init / update / doctor / skills / Pi plugins / stow
home/                 # SHARED — stowed into $HOME, correct on both platforms
  .config/<tool>/     # per-tool config (fish, git, nvim, mise, …)
  .local/bin/         # personal scripts, on PATH
home-darwin/          # macOS-only overlay (zsh, aerospace, ghostty)
home-linux/           # Linux-only overlay (hypr, omarchy, ghostty personal.conf)
packages/
  bundle              # Brewfile snapshot — macOS
  bundle.ignore       # installed on purpose, never tracked (drift-check excludes)
  arch.txt / aur.txt  # pacman / yay manifests — Linux
  arch.ignore         # same role as bundle.ignore, for pacman
  bun-global.txt      # JS-only global CLIs with no native package
  rust.txt            # rustup toolchains / components / targets
INSTALL.md            # setup steps + the spec `dotfiles` implements
AGENTS.md             # repo conventions for agents/humans
```

## Bootstrap (fresh machine)

Both repos are **public**, so no SSH/auth is needed to clone — SSH (via 1Password) is
only needed later to *push*.

### macOS

```sh
# 0. Prereqs the OS can't skip:
xcode-select --install                 # git + build tools
#    Install the 1Password app, sign in, and enable Settings → Developer → "Use the SSH agent"
#    (this is a GUI step; it's what makes git signing + pushes work later)

# 1. Clone over HTTPS (public) and run the installer
git clone https://github.com/prezus/dotfiles.git ~/Projects/dotfiles
cd ~/Projects/dotfiles
./dotfiles init                        # brew → rust → packages → bun → Vite+ → Plannotator → stow → Pi → ssh → fish → skills
#    (init clones prezus/skills itself, and installs the 1Password CLI/app via brew)

# 2. On an ALREADY-configured machine, first stow needs to adopt existing files:
./dotfiles stow --adopt                # then: git diff  (should be empty if they matched)

# 3. Switch remotes to SSH so pushes/signing go through 1Password
git remote set-url origin git@github.com:prezus/dotfiles.git
git -C ~/Projects/skills remote set-url origin git@github.com:prezus/skills.git
```

### Omarchy / Arch Linux

`init` step 1 installs `base-devel`, `git`, `stow` and `yay` — nothing else does, and the
stow step needs them. Install the 1Password app and enable its SSH agent (Settings →
Developer) for signing and pushes, same as on macOS.

```sh
git clone https://github.com/prezus/dotfiles.git ~/Projects/dotfiles
cd ~/Projects/dotfiles
./dotfiles init                        # pacman/yay → rust → bun → … → stow → … → omarchy includes
./dotfiles stow --adopt                # on a machine Omarchy has already configured
```

Two Omarchy-specific things worth knowing:

- **`omarchy refresh config <path>` reverts a tracked file.** `cp -f` follows the stow
  symlink, so it writes through into the repo — the link survives and `git checkout --`
  undoes it. `dotfiles doctor` flags the leftover `.bak.<ts>` files.
- **We do not own `~/.config/ghostty/config` or `foot.ini`.** They carry Omarchy's theme
  include; `dotfiles omarchy-includes` appends one line pointing at our stowed
  `personal.conf` instead. Re-run it after a refresh.

After `init`, `dotfiles` is on your PATH (via the stowed shell config), so later you can
just run `dotfiles update` / `dotfiles doctor` from anywhere.

**If the Homebrew step fails**, run the brew half on its own:

```sh
./dotfiles brew                        # install Homebrew, then brew bundle packages/bundle
```

Casks with a `pkg` payload ask for your admin password, so this step needs a terminal you
can type at. Run from a shell it has one; `init` inside the dashboard hands the screen over
for the same reason, and hands it back when brew is done.

## Packages

`packages/bundle` is a `brew bundle dump` of this machine (taps, formulae, casks) plus a
hand-added tail, so a re-dump overwrites hand edits — review the diff before committing.

```sh
brew bundle dump --file=packages/bundle --force
sed -i '' '/^vscode "/d' packages/bundle    # BSD sed (macOS). GNU sed: sed -i '/^vscode "/d'
```

Extensions come from VS Code Settings Sync and must never be committed.

On Linux the equivalent is `pacman -Qqen` / `-Qqem`, which `dotfiles doctor` diffs against
`packages/arch.txt` and `aur.txt` directly — no dump file, so there is nothing to strip and
no risk of overwriting hand edits.

Drift is checked in both directions, because neither command sees the other's:

- `dotfiles check-packages` — declared but not installed
- `dotfiles doctor` → Packages — installed but not declared

The second is the one that bites: an ad-hoc `brew install` works fine here and is simply
missing on the next machine. Things that should never be tracked (VS Code extensions,
Homebrew's `node`) go in `packages/bundle.ignore` with a comment explaining why —
`packages/arch.ignore` plays the same role on Linux, and is where this box's firmware,
bootloader and Omarchy-provided packages live.

## Pi plugins

`home/.pi/agent/settings.json` is the plugin manifest. Every npm source carries an exact
version; local installs under `~/.pi/agent/npm/` remain ignored runtime state.

```sh
dotfiles pi install                    # reconcile local installs to tracked pins
dotfiles pi status                     # compare declarations with installed versions
dotfiles pi update                     # review available updates one by one
dotfiles pi verify                     # fail on floating, missing, or mismatched plugins
```

`dotfiles update` offers Pi plugins as a default-off task. `--all` advances every available
plugin explicitly; normal interactive updates ask before changing each pin.

## Skills install model: one directory, all agents

No single path is read by all five agents, but four read a shared path natively and the
fifth follows symlinks — so the whole fan-out is **two symlinks over one canonical dir**:

```
~/.agents/skills  ->  ~/Projects/skills/skills   # Codex, Cursor, OpenCode, Pi (native)
~/.claude/skills  ->  ~/.agents/skills           # Claude Code (only reads ~/.claude/skills)
```

| Agent       | `~/.agents/skills` | `~/.claude/skills` |
|-------------|--------------------|--------------------|
| Pi          | native             | —                  |
| Codex       | native             | —                  |
| Cursor 2.4+ | native             | yes                |
| OpenCode    | native             | yes                |
| Claude Code | not read           | native             |

These symlinks are created by `dotfiles skills`, **not** stowed (they cross into `prezus/skills`
and chain through each other, which stow doesn't model cleanly). Unlike dmmulroy's dotfiles
— which commit resolved skill files into `home/.agents/skills/` — we keep skills only in
`prezus/skills` and symlink to them, so there's a single source of truth and no duplication.
Because agents read through the symlinks, a `git pull` in `prezus/skills` after a vendor
sync is live immediately — no reinstall.

See [INSTALL.md](./INSTALL.md) for exact steps and the `dotfiles skills` spec (including how it
must back up the existing real `~/.claude/skills` before replacing it).
