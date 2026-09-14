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
bin/unquarantine*      # standalone macOS cleaner and opt-in installer
config/unquarantine.conf # cleaner settings
LaunchAgents/         # launchd template; installer generates absolute paths
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
./dotfiles init                        # brew → rust → packages → bun → Plannotator → stow → mise → Pi → ssh → fish → skills
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

## Opt-in macOS quarantine cleaner

`bin/unquarantine` (macOS 13+, system Bash 3.2) removes **only** the
`com.apple.quarantine` extended attribute. It preserves other attributes, including
Finder tags and download-origin metadata. This deliberately bypasses the associated
macOS quarantine/Gatekeeper checks for matching downloads: an extension is **not**
a safety assessment. Keep the default `conf cfg` allowlist narrow. No part of
`init`, `update`, or `stow` enables the agent automatically.

Edit the trusted shell configuration in [`config/unquarantine.conf`](config/unquarantine.conf):

```bash
EXTENSIONS="conf cfg"
WATCH_DIRS="$HOME/Downloads"
RECURSIVE=false
MAX_DEPTH=3
LOG_FILE="$HOME/.local/state/unquarantine.log" # empty disables logging
DRY_RUN=false
```

Missing config uses these defaults. Environment variables override config, even
when empty: `EXTENSIONS="yml toml" bin/unquarantine --dry-run`. Extension tokens
are letters, digits, `_` or `-`, without a leading dot; matching is case-insensitive.
`WATCH_DIRS` requires absolute paths or literal `~/`, which is expanded without
`eval`. Relative watch paths are rejected so launchd's working directory cannot
change their meaning. Scalar values are whitespace-separated.
For directory names (or a home directory) containing whitespace, use a Bash array
in the config, e.g. `WATCH_DIRS=("$HOME/Downloads" "$HOME/Other downloads")`.
An exported scalar `WATCH_DIRS` overrides that entire array.

```sh
bin/unquarantine --dry-run               # preview without writing logs/state
bin/unquarantine --status                # effective config, health, quarantine count
bin/unquarantine "$HOME/Downloads/a.conf" # direct file or directory arguments
bin/unquarantine --all "$HOME/Downloads/a.txt" # bypass extension filter only
./dotfiles unquarantine                  # interactive install / status / uninstall menu
./dotfiles unquarantine install          # explicit opt-in; generates and loads agent
./dotfiles unquarantine status
./dotfiles unquarantine uninstall
```

The dashboard's quarantine entry opens the same action menu. Piped/noninteractive
use requires an explicit action.

The CLI-owned worker link is `~/.local/bin/unquarantine`; it resolves back to the
repo's `bin/` and reads the canonical repo config. The generated agent is
`~/Library/LaunchAgents/local.unquarantine.plist`, not a stow-managed file.
[`LaunchAgents/local.unquarantine.plist`](LaunchAgents/local.unquarantine.plist) is
only a template: the installer XML-escapes absolute paths and validates it with
`plutil`. Reinstallation boots out the old agent before bootstrapping its replacement.
Uninstall removes only the owned worker link and plist, retaining config and logs.
Unrelated files at those destinations cause a refusal instead of being overwritten.
If the repo moves, uninstall from its old location first, then reinstall.

Changes to `WATCH_DIRS` require reinstalling to regenerate `WatchPaths`. Other
config changes apply on the next sweep. Any of the six settings exported during
installation are also captured as agent environment overrides; reinstall without
those exports to return to config-driven values.

### Scheduling and safeguards

- `WatchPaths` watches top-level changes only, **not recursive subdirectory
  activity**. `ThrottleInterval=2` limits event churn. The approved
  `StartInterval=60` fallback retries files skipped as too young and picks up
  nested changes on the next periodic sweep when `RECURSIVE=true`. launchd may
  coalesce/delay runs, so 60 seconds is not a strict completion deadline.
- Non-recursive scans use `find -maxdepth 1`; recursive scans use `MAX_DEPTH`
  (top-level files are depth 1). No symlinks are followed in a scan. Regular
  files and directories ending in `.crdownload`, `.download`, `.part`, or
  `.partial` are skipped, as are files modified less than two seconds ago.
- Both watched directories **and explicit paths, even with `--all`**, must
  resolve strictly inside `$HOME`. `/`, `$HOME` itself and symlink escapes are
  refused. Direct symlinks are skipped. Missing directories warn and do not
  fail the sweep. `--all` requires explicit paths and does not disable the
  confinement, age, or in-progress-download safeguards.
- NUL-delimited `find` results are saved before processing, so failed enumeration
  cannot cause a partial cleanup of that root. Bash's NUL read loop preserves
  spaces, newlines and quotes; logged paths are shell-escaped. Ancestors are
  rechecked before xattr access. This is a typo/download safeguard, **not a
  sandbox against hostile concurrent renames or hard links**.
- Exit codes: `0` success/no work/missing directory; `1` config, confinement,
  directory access or operational failure; `2` invalid usage.

### Full Disk Access and diagnosis

The job explicitly executes **`/bin/bash`**. If macOS denies Downloads access,
open **System Settings → Privacy & Security → Full Disk Access**, add `/bin/bash`
(use ⌘⇧G in the file chooser), and enable it. This is a **broad grant to Bash
scripts**, not just this cleaner; only grant it if that tradeoff is acceptable.
The installer prints this instruction and checks directory enumeration before
loading. Terminal permission does not imply the same access from launchd.

After the first minute, check `dotfiles unquarantine status`. It shows both the
last sweep's timestamp and per-root `OK`/`FAILED`/`MISSING` read health, then a fresh
read check and count (including matching files too young to clean). An unknown
last run means no sweep has recorded health yet. Dry runs and status checks never
replace the last-sweep record. Missing roots and an empty watch list are not
successful directory reads.

Read failures print an explicit FDA warning and persist `FAILED` health. Worker
actions/warnings default to `~/.local/state/unquarantine.log`; launchd stderr goes
to `~/.local/state/unquarantine.err`; read health is stored separately in
`~/.local/state/unquarantine.status`, even when logging is disabled. These files
are local runtime state, not committed. Logs are append-only; rotate/remove them
manually if needed. Early startup/config failures appear in stderr rather than
replacing the previous successful health record, so check its timestamp too.

### Tests

Run `/bin/bash tests/unquarantine.test.sh` or `bun run test`. The macOS integration
uses real synthetic quarantine attributes inside a temporary HOME, checks the
allowlist, quotes/newlines, download age, partial directories, symlink escapes,
other-xattr retention and idempotency, then exercises install/reinstall/uninstall
with a stub `launchctl`. It never changes real Downloads or loads a real agent.
A simulated directory-access denial verifies failure visibility and read-health
reporting. Real launchd/TCC behavior still requires the opt-in first-run check
above. The integration skips on Linux.
