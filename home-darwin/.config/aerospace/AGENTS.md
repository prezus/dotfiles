# AEROSPACE CONFIG

[AeroSpace](https://nikitabobko.github.io/AeroSpace) tiling window manager.
Single file: `aerospace.toml`. Close to the stock default; primary modifier is `alt`,
navigation is vim-style (`hjkl`), gaps are zeroed.

> **Agents:** AeroSpace reads `~/.config/aerospace/aerospace.toml` (this file, stowed)
> or `~/.aerospace.toml`. Missing keys fall back to AeroSpace's `default-config.toml`.
> After edits, reload with the service-mode `esc` binding (`alt-shift-;` then `esc`).

## WHERE TO LOOK

| Task | Location in `aerospace.toml` |
|------|------------------------------|
| Add/change a keybind | `[mode.main.binding]` |
| Window gaps / padding | `[gaps]` (currently all 0) + `accordion-padding` |
| Run something at login/startup | `after-login-command` / `after-startup-command` |
| Default layout / orientation | `default-root-container-layout` / `-orientation` |
| Service-mode actions (reload, reset, float) | `[mode.service.binding]` |

## KEY BINDINGS (current)

| Keys | Action |
|------|--------|
| `alt-h/j/k/l` | focus left/down/up/right |
| `alt-shift-h/j/k/l` | move window |
| `alt-1..9`, `alt-a..z` | switch to workspace |
| `alt-shift-<same>` | move window to workspace |
| `alt-slash` / `alt-comma` | tiles / accordion layout |
| `alt-shift-minus` / `alt-shift-equal` | resize −/+ 50 |
| `alt-tab` | last workspace (back-and-forth) |
| `alt-shift-tab` | move workspace to next monitor |
| `alt-shift-;` | enter **service** mode |
| service: `esc` | reload config + exit |
| service: `r` | flatten (reset) layout |
| service: `f` | toggle floating/tiling |
| service: `backspace` | close all windows but current |
| service: `alt-shift-h/j/k/l` | join with left/down/up/right |

## CONVENTIONS

- **`alt` is the primary modifier**; add `shift` to *move* rather than *focus*.
- **vim `hjkl`** for all directional commands.
- Workspaces are addressed by digit or single letter (`alt-<key>`).
- Normalization on: flatten containers + opposite-orientation nesting.

## ANTI-PATTERNS

- Editing `~/.aerospace.toml` directly (this repo's copy is the source; stow owns it).
- Reusing `alt-<letter>` for a command — those are all bound to workspaces.
- Non-zero gaps without intent — gaps are deliberately 0 here.

## NOTES

- Mostly the stock AeroSpace default (template comments retained); customizations are `start-at-login = true`, zeroed gaps, and `on-focused-monitor-changed = move-mouse monitor-lazy-center`.
- Commands reference: <https://nikitabobko.github.io/AeroSpace/commands>
