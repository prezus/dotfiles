# Install & `dotfiles skills` spec

How skills get onto a machine, and the exact behaviour the `dotfiles skills` subcommands must
implement. The scripts are written by hand — this is their spec and acceptance criteria.

## Decision: skills repo stays separate; dotfiles installs from it

Skills live in the separate [prezus/skills](https://github.com/prezus/skills) repo (our own
skills + vendored ones, all committed there). This repo does **not** store skill files. It
**installs from** `prezus/skills` by symlink; updates arrive by pulling that repo. One
source of truth, no duplication; a committed vendor-sync in `prezus/skills` is live
everywhere instantly because agents read through the symlinks.

## Prerequisites

- `git`, `stow`, `node`/`npx` — via Homebrew (`packages/bundle`) on macOS, or pacman
  (`packages/arch.txt`) on Linux, where `dotfiles pacman` bootstraps them
- [prezus/skills](https://github.com/prezus/skills) cloned to `~/Projects/skills`
  (override with `SKILLS_REPO`)

## Target state — two layouts

Which one applies is decided by **whether another provider has already put skills there**,
not by the platform. The same logic would be right if a macOS tool ever did it.

**`linked`** — nobody else is here. One symlink per path, the cheapest arrangement:

```
~/.agents/skills  ->  ~/Projects/skills/skills   # Codex, Cursor, OpenCode, Pi (native)
~/.claude/skills  ->  ~/.agents/skills           # Claude Code (only reads ~/.claude/skills)
```

**`merged`** — someone else is here. On Omarchy, all three paths are **real directories**
containing symlinks into `/usr/share/omarchy/default/agents/skills/` (`omarchy`,
`diagnose-crash`). Those are pacman-managed and restored by every `omarchy update`; they
are never ours to delete. So the directory stays real and gets one link per skill:

```
~/.agents/skills/                                  (real directory)
├── omarchy         -> /usr/share/omarchy/...      # theirs, untouched
├── diagnose-crash  -> /usr/share/omarchy/...      # theirs, untouched
└── tdd             -> ~/Projects/skills/skills/tdd
```

## `dotfiles skills install` — spec

Idempotent; safe to re-run. Must:

1. **Verify the source.** `$SKILLS_SRC` (`~/Projects/skills/skills`) must be a directory;
   if not, clone `prezus/skills`, or print how to and exit non-zero.
2. **Detect the layout.** Inspect `~/.agents/skills`, `~/.claude/skills` and (when Pi is set
   up) `~/.pi/agent/skills`. An entry whose target resolves outside `$SKILLS_SRC` is
   *foreign*. Any foreign entry anywhere → `merged`; otherwise `linked`.
3. **`linked`:** link `~/.agents/skills` → `$SKILLS_SRC` and `~/.claude/skills` →
   `~/.agents/skills`. A wrong symlink is replaced; a real directory is backed up to
   `.bak.<ts>` first. Never silently delete.
4. **`merged`:** for each path, ensure it is a real directory holding one symlink per
   subdirectory of `$SKILLS_SRC`. Foreign entries are left exactly as they are, including
   when they occupy a name we also provide. Our own links whose skill no longer exists
   upstream are pruned.
5. **Verify.** Print the layout and, per path, `N ours · M from other providers`.

> **INVARIANT — `install` never removes an entry it did not create.** The only `unlink` is
> of a symlink that points into `$SKILLS_SRC` at a skill that no longer exists. This is
> covered by `src/lib/skills-layout.test.ts`, against a real foreign provider on disk.
>
> The earlier version of this spec said to back up a real directory and replace it with a
> symlink. On Omarchy that silently removed the `omarchy` and `diagnose-crash` skills from
> every agent — recoverable from the `.bak`, but broken until someone noticed.

## Syncing vendored skills — not a `dotfiles` command

This used to be `dotfiles skills update`, a wrapper around a sync script in the skills repo.
It was removed: the script never existed, so the command (and the "Vendored skills" choice in
`dotfiles update`) only ever failed. More to the point, a sync is an authoring task: it rewrites
files in `prezus/skills` and ends in a diff a person reviews and commits. `dotfiles update` is
per-machine maintenance, run everywhere, so offering a sync there invites an uncommitted,
half-reviewed sync on whichever machine happened to run it.

Syncing happens **in the skills repo**, following its `VENDORING.md` (and its own script, once
it has one). Every other machine receives a committed sync through `dotfiles update` → Repos,
which pulls `$SKILLS_REPO`; the symlinks already point at `skills/`, so nothing needs
reinstalling.

## `dotfiles skills status` — spec

Read-only. Print:
- resolved target of `~/.agents/skills` and `~/.claude/skills` (flag if either is missing or
  points somewhere other than `$SKILLS_SRC`)
- skill count (`ls -1 "$SKILLS_SRC" | wc -l`)
- `pinnedCommit` + `vendoredOn` from `"$SKILLS_REPO"/vendor-manifest.json`

## GNU Stow (other dotfiles)

Non-skill config lives under `home/` plus a per-OS overlay, linked with `dotfiles stow`
(`stow -t "$HOME" home home-<platform>`).
The skills symlinks are handled by `dotfiles skills`, **not** stow — they cross into
`prezus/skills` and chain through each other, which stow doesn't model cleanly.

## Verifying discovery per agent

- **Claude Code:** `/` menu lists the skills, or `~/.claude/skills` resolves to `$SKILLS_SRC`.
- **Codex / Cursor / OpenCode / Pi:** each reads `~/.agents/skills` — open one and confirm a
  known skill (`tdd`, `code-review`) is available.
- Symlink support for the four native readers is a filesystem inference, not a documented
  guarantee — validate once on your installed versions after first install.
