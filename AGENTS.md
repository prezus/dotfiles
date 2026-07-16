# AGENTS.md

Instructions for AI coding agents (and humans) working in this dotfiles repo.

## What this repo is

Machine setup for our dev environment, modeled on the `dot` + GNU Stow pattern. It also
**deploys our AI Agent Skills** so every agent we use can discover them. The skills
*themselves* live in [prezus/skills](https://github.com/prezus/skills) — this repo only
installs them.

## Structure

```
dot                 # CLI entrypoint: init / update / doctor / skills (bash)
home/               # stowed into $HOME with `stow -t "$HOME" home`
  .config/<tool>/   # per-tool config (fish, git, nvim, …)
  .local/bin/       # personal scripts, on PATH
packages/
  bundle            # Brewfile — install with `brew bundle --file=packages/bundle`
  bundle.work       # (optional) work-only extras
INSTALL.md          # setup steps + the spec `dot` implements
AGENTS.md           # this file
README.md
```

## Conventions

- **Stow is the linker.** Anything under `home/` mirrors its path in `$HOME`. To add a
  config, create it at `home/<path>` and re-run `stow -t "$HOME" home`. Never write to
  `$HOME` directly for tracked config.
- **Packages live in `packages/bundle`.** Regenerate with
  `brew bundle dump --file=packages/bundle --force`. Keep it sorted by section
  (tap → brew → cask → mas). Prune machine-specific entries before committing shared changes.
- **Skills are not committed here — by decision.** `~/.agents/skills` and `~/.claude/skills`
  are symlinks created by `dot skills install` (see INSTALL.md), pointing at
  `~/Projects/skills/skills`. The [prezus/skills](https://github.com/prezus/skills) repo is
  the single source of truth; dotfiles installs from it and drives syncs via
  `dot skills update`. Do not copy skill files into this repo.
- **Secrets never get committed.** See `.gitignore`; it blocks keys, `.env`, and
  `*secret*`/`*credentials*`. Use `git add -f` only when you're certain a match is safe.

## Safe-change checklist

- [ ] New config under `home/`, linked via stow (not written to `$HOME`)
- [ ] Package changes reflected in `packages/bundle`
- [ ] No secrets staged (`git status` before commit)
- [ ] `dot doctor` passes (once implemented)
