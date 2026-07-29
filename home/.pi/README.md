# .pi

Global [Pi](https://github.com/earendil-works/pi) agent config, tracked here and
symlinked into `~/.pi` (via stow, or direct relative symlinks that stow adopts).

## What's tracked vs. local

`home/.pi/agent/*` is gitignored by default; only these are un-ignored (see the
repo `.gitignore`):

| Path | Tracked? | Why |
|------|----------|-----|
| `agent/settings.json` | yes | provider/model/theme config |
| `agent/themes/*.json` | yes | custom themes (e.g. `catppuccin-macchiato`) |
| `agent/skills` | no — **symlink** | → `~/.agents/skills` (the [skills repo](https://github.com/prezus/skills) canonical pool) |
| `agent/auth.json` | no — **local** | OAuth/API secrets — never commit |
| `agent/sessions/` | no — **local** | per-machine runtime state |
| `agent/npm/` | no — **local** | npm packages pi installs (`pi install npm:…`) |
| `agent/git/` | no — **local** | git packages pi clones (`pi install git:…`) |

`auth.json` and `sessions/` stay as real files in `~/.pi/agent`; only `settings.json`
and `themes/` are symlinked from here, so `~/.pi/agent` remains a real directory.

## Extensions

Pi packages are installed with `pi install <source>` (`npm:`, `git:`, `https:`, or a
local path), and the source is recorded in `agent/settings.json` — which **is** tracked
here, so the list is committed automatically.

**Pi owns the installs, not us.** User-scoped packages land in `~/.pi/agent/npm/` (npm
sources) and `~/.pi/agent/git/<host>/<path>` (git sources); project-scoped ones go to
`.pi/npm/` and `.pi/git/` inside that project. None of it is stowed or tracked.

So this is the fisher shape: `fish_plugins` is a manifest and `fisher update` restores.
For Pi the manifest is `settings.json` and the restore is `pi update --extensions`, which
`dotfiles update` runs. Pi auto-installs missing packages on startup only for **project**
settings, after the project is trusted — user-scoped packages are not documented to
self-heal, which is why the update step matters on a fresh machine.
`dotfiles doctor` reports the installed count, so a machine holding the list but not the
packages is visible rather than silent.

> **Security.** Pi's own docs are blunt about this: packages run with full system access,
> extensions execute arbitrary code, and skills can instruct the model to run executables.
> Because the list is committed and restored automatically on every machine, review a
> third-party package before `pi install` — it will follow you everywhere.

## Skills — consumed, not owned

Pi does **not** carry its own skills. It reads the same canonical pool every agent uses,
via `~/.pi/agent/skills -> ~/.agents/skills -> ~/Projects/skills/skills`. That link is
created by `dotfiles skills install` and checked by `dotfiles doctor`. To add, update, or
verify skills (including the Cloudflare set), work in the **skills repo**, not here —
`dotfiles skills {update,verify}`.

## Theme

`agent/settings.json` → `"theme": "catppuccin-macchiato"`, defined in
`agent/themes/catppuccin-macchiato.json`. Theme name = filename without `.json`.
Reload in Pi with `/reload` (or restart) after editing.
