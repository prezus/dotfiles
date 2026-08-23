# Hyprland (Linux)

Omarchy 4 configures Hyprland in **Lua**, not `.conf`. `~/.config/hypr/hyprland.lua`
requires `default.hypr.omarchy` first, then these user files — so anything here wins.

## What is tracked, and what is not

| File | Tracked | Why |
|---|---|---|
| `bindings.lua` | yes | mirrors the AeroSpace motion set |
| `looknfeel.lua` | yes | gaps/borders, same on any machine |
| `autostart.lua` | yes | same programs everywhere |
| `monitors.lua` | **no** | per-machine (this box runs `scale = 1.6`) |
| `input.lua` | **no** | per-machine keyboard/trackpad |

## Editing

- Rebinding an occupied key needs `hl.unbind("...")` **first** — Hyprland appends,
  it does not replace.
- Use `code:NN` for digits (`code:10` = 1), matching Omarchy's own loop, so bindings
  survive a non-US layout.
- Validate every change: `hyprctl reload && hyprctl configerrors`. Hyprland keeps
  running on the last good config, so an error is otherwise invisible —
  `dotfiles doctor` also surfaces it.
- See current bindings: `omarchy menu keybindings --print`.

## The ALT convention

`bindings.lua` mirrors `home-darwin/.config/aerospace/aerospace.toml`, which is the
source of truth for the motion set. ALT is deliberate: it is what AeroSpace uses
(macOS reserves CMD), and Omarchy's defaults are almost entirely SUPER — audited, the
only bare-ALT bindings Omarchy ships are `ALT+TAB`, `ALT+SHIFT+TAB`, `ALT+PRINT` and
the XF86 media keys. So the mirror costs **zero** unbinds.

One semantic gap, not papered over: AeroSpace's `move` can push a window *into* a
sibling container; Hyprland's `swapwindow` only exchanges it with the neighbour.

## `dotfiles stow` leaves a stale config error

Hyprland watches these files and auto-reloads. Stow **unlinks before it relinks**,
so the reload fires during the window where the file does not exist, and
`hyprctl configerrors` then reports `module 'hypr.bindings' not found` against a
symlink that is perfectly fine.

It is stale, not real. Run `hyprctl reload` after stowing and it clears. Check the
link resolves (`readlink -f bindings.lua`) before believing the error.

`omarchy refresh hyprland` / `omarchy refresh config hypr/bindings.lua` — it overwrites
the file with the package default, writing *through* the stow symlink into the repo.
Recover with `git -C ~/Projects/dotfiles checkout -- home-linux/.config/hypr/`.
