# dotfiles

Machine setup for our dev environment — packages, shell/tool config, and the install that
makes our **AI Agent Skills** discoverable by every coding agent we use (Claude Code,
Codex, Cursor, OpenCode, Pi). Modeled on the `dot` + [GNU Stow](https://www.gnu.org/software/stow/)
pattern.

The skills themselves live in [prezus/skills](https://github.com/prezus/skills); this repo
only **deploys** them.

## Structure

```
dot                 # CLI: init / update / doctor / skills / stow   (bash)
home/               # stowed into $HOME via `stow -t "$HOME" home`
  .config/<tool>/   # per-tool config (fish, git, nvim, …)
  .local/bin/       # personal scripts, on PATH
packages/
  bundle            # Brewfile snapshot — `brew bundle --file=packages/bundle`
INSTALL.md          # setup steps + the spec `dot` implements
AGENTS.md           # repo conventions for agents/humans
```

## Quick start

```sh
git clone https://github.com/prezus/dotfiles.git ~/Projects/dotfiles
cd ~/Projects/dotfiles

brew bundle --file=packages/bundle   # install packages
./dot stow                           # symlink home/ into $HOME
./dot skills                         # wire the skills symlinks (see INSTALL.md)
```

(`./dot init` will chain all three once implemented.)

## Packages

`packages/bundle` is a full `brew bundle dump` of this machine (taps, formulae, casks).
Refresh it with:

```sh
brew bundle dump --file=packages/bundle --force
```

Prune machine-specific entries before committing shared changes. An optional
`packages/bundle.work` can hold work-only extras.

## Skills install model: one directory, all agents

No single path is read by all five agents, but four read a shared path natively and the
fifth follows symlinks — so the whole fan-out is **two symlinks over one canonical dir**:

```
~/.agents/skills  ->  ~/Projects/skills/skills   # Codex, Cursor, OpenCode, Pi (native)
~/.claude/skills  ->  ~/.agents/skills           # Claude Code (only reads ~/.claude/skills)
```

| Agent       | `~/.agents/skills` | `~/.claude/skills` |
|-------------|:---:|:---:|
| Pi          | ✅ native | — |
| Codex       | ✅ native | — |
| Cursor 2.4+ | ✅ native | ✅ |
| OpenCode    | ✅ native | ✅ |
| Claude Code | ❌ | ✅ native |

These symlinks are created by `dot skills`, **not** stowed (they cross into `prezus/skills`
and chain through each other, which stow doesn't model cleanly). Unlike dmmulroy's dotfiles
— which commit resolved skill files into `home/.agents/skills/` — we keep skills only in
`prezus/skills` and symlink to them, so there's a single source of truth and no duplication.
Because agents read through the symlinks, a `git pull` in `prezus/skills` after a vendor
sync is live immediately — no reinstall.

See [INSTALL.md](./INSTALL.md) for exact steps and the `dot skills` spec (including how it
must back up the existing real `~/.claude/skills` before replacing it).
