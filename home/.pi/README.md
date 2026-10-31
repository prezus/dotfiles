| `agent/mcp.json` | yes | user-level MCP servers (`executor`); no credentials in it |
| `agent/mcp-auth.json` | no — **local** | OAuth tokens from `pi mcp login` — never commit |
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
| `agent/extensions/secret-guard.ts` | yes | ours — see [Guards](#guards) |
| `agent/extensions/git-interceptor.ts`, `agent/extensions/pi-cloak/`, `agent/cloak.json` | yes | vendored from dmmulroy/.dotfiles — see [Guards](#guards) |
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

`agent/settings.json` is the package manifest. Every source is pinned: npm to an exact version,
git to a release tag or commit. Bun installs
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

## Guards

Three local extensions watch what the agent does. They catch accidents and habits, not a
determined agent; an OS sandbox (Pi's `examples/extensions/sandbox`) is the real boundary.
Their tool hooks also see the calls a codemode script makes.

- **`secret-guard.ts`** (ours). Masks known secret formats in *every* tool's output, and
  1Password's concealed fields in output from any command that ran `op`. Blocks a whole-file
  `write` over an existing secret file. Asks first before bash that touches secret files,
  dumps the environment, prints a token, or destroys work (`reset --hard`, `clean -f`,
  force-push, `rm -rf ~`); with no UI (print mode, subagents) "ask" means blocked.
  1Password secrets may be *injected* (`op run`, `-o <file>`, piped into a consumer) but never
  *printed*: `op read`/`inject` to stdout, `--reveal`, `--otp` and `--format json` are blocked.
  Vault writes ask first; prefer `--generate-password` so the agent never holds the value.
- **`git-interceptor.ts`** (dmmulroy). Blocks `--no-verify`, and sets `GIT_EDITOR=true` so git
  never opens an editor the agent cannot close.
- **`pi-cloak/` + `cloak.json`** (dmmulroy). Masks values in files the agent `read`s, by path
  (`.env*`, `auth.json`, …). `/cloak-status` shows what loaded.

Test a guard change against real commands before relying on it: the decisions are exported
(`riskyBash`, `redact`, `redactOpOutput`) and run under plain `bun`.

## Skills — consumed, not owned

Pi does **not** carry its own skills. It reads the same canonical pool every agent uses,
via `~/.pi/agent/skills -> ~/.agents/skills -> ~/Projects/skills/skills`. That link is
created by `dotfiles skills install` and checked by `dotfiles doctor`. To add, update, or
verify skills (including the Cloudflare set), work in the **skills repo**, not here.

## Theme

`agent/settings.json` → `"theme": "catppuccin-macchiato"`, defined in
`agent/themes/catppuccin-macchiato.json`. Theme name = filename without `.json`.
Reload in Pi with `/reload` (or restart) after editing.

## MCP

Pi 1.4 has MCP built in. `agent/mcp.json` lists user-level servers; edit it with
`pi mcp add|remove`, which write through the symlink into this repo. Servers default
to `codemode` exposure: codemode scripts can call their tools, but the tools are not
declared to the model up front.

This file is also the manifest for the other agents: `dotfiles mcp install` copies
each bare-URL entry into Claude Code (user scope) and Codex, and `dotfiles doctor`
reports any client that is missing one or needs sign-in. An entry with `headers`,
`oauth`, `env` or a `command` is never copied, so keep credentials out of it.

- **`executor`**: `https://executor.decepticon.io/mcp`, the gateway every agent uses
  for hosted tools (Outline, and Firecrawl once it runs). OAuth applies, so each machine signs in once with
  `pi mcp login executor`. Tokens go to `agent/mcp-auth.json`, which stays local.
  `pi mcp list` checks it.
