# dotfiles

Machine setup for our dev environment — packages, shell/tool config, and the install that
makes our **AI Agent Skills** discoverable by every coding agent we use (Claude Code,
Codex, Cursor, OpenCode, Pi). Modeled on the `dotfiles` + [GNU Stow](https://www.gnu.org/software/stow/)
pattern.

The skills themselves live in [prezus/skills](https://github.com/prezus/skills); this repo
only **deploys** them.

## Structure

```
dotfiles              # bash shim — ensures bun exists, then runs src/cli.ts
src/                  # the CLI (TypeScript): init / update / doctor / skills / stow
home/                 # stowed into $HOME via `stow -t "$HOME" home`
  .config/<tool>/     # per-tool config (fish, git, nvim, …)
  .local/bin/         # personal scripts, on PATH
packages/
  bundle              # Brewfile snapshot — `brew bundle --file=packages/bundle`
  bundle.ignore       # installed on purpose, never tracked (drift-check excludes)
  bun-global.txt      # JS-only global CLIs with no brew formula
  rust.txt            # rustup toolchains / components / targets
INSTALL.md            # setup steps + the spec `dotfiles` implements
AGENTS.md             # repo conventions for agents/humans
```

## Bootstrap (fresh machine)

Both repos are **public**, so no SSH/auth is needed to clone — SSH (via 1Password) is
only needed later to *push*.

```sh
# 0. Prereqs the OS can't skip:
xcode-select --install                 # git + build tools
#    Install the 1Password app, sign in, and enable Settings → Developer → "Use the SSH agent"
#    (this is a GUI step; it's what makes git signing + pushes work later)

# 1. Clone over HTTPS (public) and run the installer
git clone https://github.com/prezus/dotfiles.git ~/Projects/dotfiles
cd ~/Projects/dotfiles
./dotfiles init                        # brew → rust → packages → bun → Vite+ → stow → ssh → fish → skills
#    (init clones prezus/skills itself, and installs the 1Password CLI/app via brew)

# 2. On an ALREADY-configured machine, first stow needs to adopt existing files:
./dotfiles stow --adopt                # then: git diff  (should be empty if they matched)

# 3. Switch remotes to SSH so pushes/signing go through 1Password
git remote set-url origin git@github.com:prezus/dotfiles.git
git -C ~/Projects/skills remote set-url origin git@github.com:prezus/skills.git
```

After `init`, `dotfiles` is on your PATH (via the stowed shell config), so later you can
just run `dotfiles update` / `dotfiles doctor` from anywhere.

## Packages

`packages/bundle` is a `brew bundle dump` of this machine (taps, formulae, casks) plus a
hand-added tail, so a re-dump overwrites hand edits — review the diff before committing.

```sh
brew bundle dump --file=packages/bundle --force
sed -i '' '/^vscode "/d' packages/bundle    # extensions come from Settings Sync — never commit them
```

Drift is checked in both directions, because neither command sees the other's:

- `dotfiles check-packages` — in the bundle but not installed
- `dotfiles doctor` → Packages — installed but not in the bundle

The second is the one that bites: an ad-hoc `brew install` works fine here and is simply
missing on the next machine. Things that should never be tracked (VS Code extensions,
Homebrew's `node`) go in `packages/bundle.ignore` with a comment explaining why.

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
