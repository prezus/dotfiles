# .pi

Global [Pi](https://github.com/earendil-works/pi) agent config, tracked here and
symlinked into `~/.pi` (via stow, or direct relative symlinks that stow adopts).

## What's tracked vs. local

`home/.pi/agent/*` is gitignored by default; only these are un-ignored (see the
repo `.gitignore`):

| Path | Tracked? | Why |
|------|----------|-----|
| `agent/settings.json` | ✅ | provider/model/theme config |
| `agent/themes/*.json` | ✅ | custom themes (e.g. `catppuccin-macchiato`) |
| `agent/skills` | ❌ **symlink** | → `~/.agents/skills` (the [skills repo](https://github.com/prezus/skills) canonical pool) |
| `agent/auth.json` | ❌ **local** | OAuth/API secrets — never commit |
| `agent/sessions/` | ❌ **local** | per-machine runtime state |
| `agent/node_modules/` | ❌ | dependencies |

`auth.json` and `sessions/` stay as real files in `~/.pi/agent`; only `settings.json`
and `themes/` are symlinked from here, so `~/.pi/agent` remains a real directory.

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
