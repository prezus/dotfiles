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
| `agent/extensions/zed.ts` | yes | `/zed` command for opening the current project in Zed |
| `agent/extensions/subagent/config.json` | yes | spawn, concurrency, recursion, and scheduling limits |
| `agent/skills` | no — **symlink** | → `~/.agents/skills` (the [skills repo](https://github.com/prezus/skills) canonical pool) |
| `agent/auth.json` | no — **local** | OAuth/API secrets — never commit |
| `agent/sessions/` | no — **local** | per-machine runtime state |
| `agent/npm/` | no — **local** | npm packages pi installs (`pi install npm:…`) |
| `agent/git/` | no — **local** | git packages pi clones (`pi install git:…`) |

`auth.json` and `sessions/` stay as real files in `~/.pi/agent`; tracked settings,
themes, and extension config are symlinked from here, so `~/.pi/agent` remains a real
directory.

## Extensions

Run `/zed` from any Pi session to open `ctx.cwd` in Zed. It uses macOS `open`
on Darwin and the `zeditor` CLI supplied by the Arch package on Linux.

`agent/settings.json` is the package manifest. Every npm source has an exact version. Bun installs
those sources into the ignored `~/.pi/agent/npm/` runtime directory; `dotfiles pi install`
rebuilds that directory on a new machine.

```sh
dotfiles pi install
dotfiles pi status
dotfiles pi update
dotfiles pi verify
```

`update` looks up current registry releases and asks before changing each tracked pin.
`dotfiles update --all` is the explicit non-interactive path for advancing all pins.
`doctor` compares the manifest with each installed package's metadata rather than scraping
`pi list` output.

Pi packages execute with the user's full permissions. Review the exact published release
and its runtime dependencies before adding a pin. Registry signatures establish which
bytes the registry served; they do not establish that those bytes are trustworthy.

### Subagents

`pi-subagents` is capped at eight child launches per parent session, four per run, and two
active asynchronous runs. Nesting stops at one child level, parallel execution is limited
to two at once, schedules are disabled, and any spawn-budget grant requires confirmation.
The main agent uses Astra at medium thinking. Scout and researcher use Luna, which also
remains the subagent default; reviewer and worker use Astra at medium thinking; oracle
uses Astra at high thinking. The enforced subagent model scope allows Luna and Astra.
`pi-web-access` supplies the researcher's explicit web tools.

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
