# Install & `dotfiles skills` spec

How skills get onto a machine, and the exact behaviour the `dotfiles skills` subcommands must
implement. The scripts are written by hand — this is their spec and acceptance criteria.

## Decision: skills repo stays separate; dotfiles installs from it

Skills live in the separate [prezus/skills](https://github.com/prezus/skills) repo (our own
skills + vendored ones, all committed there). This repo does **not** store skill files. It
**installs from** `prezus/skills` by symlink and drives updates through `dotfiles skills`. One
source of truth, no duplication; a committed vendor-sync in `prezus/skills` is live
everywhere instantly because agents read through the symlinks.

## Prerequisites

- `git`, `stow`, `node`/`npx` (via Homebrew — see `packages/bundle`)
- [prezus/skills](https://github.com/prezus/skills) cloned to `~/Projects/skills`
  (override with `SKILLS_REPO`)

## Target state

```
~/.agents/skills  ->  ~/Projects/skills/skills   # Codex, Cursor, OpenCode, Pi (native)
~/.claude/skills  ->  ~/.agents/skills           # Claude Code (only reads ~/.claude/skills)
```

## `dotfiles skills install` — spec

Idempotent; safe to re-run. Must:

1. **Verify the source.** `$SKILLS_SRC` (`~/Projects/skills/skills`) must be a directory;
   if not, print how to clone `prezus/skills` and exit non-zero.
2. **Link `~/.agents/skills` → `$SKILLS_SRC`.** If already correct → no-op. If a wrong
   symlink → replace. If a real directory → back it up to `~/.agents/skills.bak.<ts>` first.
   Never silently delete.
3. **Link `~/.claude/skills` → `~/.agents/skills`.**
   ⚠️ **This machine already has a real `~/.claude/skills` directory.** Do not clobber it.
   If it's a non-empty real dir, either move its contents into `$SKILLS_SRC` (preserving any
   existing personal skills into the canonical set) or back it up to
   `~/.claude/skills.bak.<ts>`, then replace with the symlink. Pick one policy, encode it,
   and print what it did.
4. **Verify.** Print both resolved targets and `ls -1 ~/.agents/skills | wc -l`. Exit zero
   only if both links resolve to `$SKILLS_SRC`.

## `dotfiles skills update` — spec

Re-syncs the vendored skills in `prezus/skills`, then hands off to a human. Must:

1. `cd "$SKILLS_REPO"`.
2. Run the vendoring sync per `prezus/skills/VENDORING.md`: clone upstream at a ref into
   `repos/` (gitignored) → flatten the shipped set into `skills/` → update
   `vendor-manifest.json` (pinned commit, date, skill list). Accept a ref override, e.g.
   `MATT_SKILLS_REF=<sha> dotfiles skills update`.
3. **Stop for human review.** Show `git -C "$SKILLS_REPO" diff --stat` and instruct the user
   to read the diff and commit. **Never auto-commit.**
4. No reinstall afterward — the symlinks already point at `skills/`, so a committed sync is
   immediately live in all agents.

## `dotfiles skills status` — spec

Read-only. Print:
- resolved target of `~/.agents/skills` and `~/.claude/skills` (flag if either is missing or
  points somewhere other than `$SKILLS_SRC`)
- skill count (`ls -1 "$SKILLS_SRC" | wc -l`)
- `pinnedCommit` + `vendoredOn` from `"$SKILLS_REPO"/vendor-manifest.json`

## GNU Stow (other dotfiles)

Non-skill config lives under `home/` and is linked with `dotfiles stow` (`stow -t "$HOME" home`).
The skills symlinks are handled by `dotfiles skills`, **not** stow — they cross into
`prezus/skills` and chain through each other, which stow doesn't model cleanly.

## Verifying discovery per agent

- **Claude Code:** `/` menu lists the skills, or `~/.claude/skills` resolves to `$SKILLS_SRC`.
- **Codex / Cursor / OpenCode / Pi:** each reads `~/.agents/skills` — open one and confirm a
  known skill (`tdd`, `code-review`) is available.
- Symlink support for the four native readers is a filesystem inference, not a documented
  guarantee — validate once on your installed versions after first install.
