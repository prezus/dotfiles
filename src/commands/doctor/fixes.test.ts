// Regression tests for the untracked-packages guard.
//
// The bug this pins actually happened. `c850cfc "Remove unused packages from the
// bundle"` deleted seven entries; because removing a directive does not uninstall
// anything, all seven stayed on the machine and immediately re-surfaced as
// "installed but undeclared". The doctor fix then appended them straight back —
// off a single keypress, with no confirmation.
//
// The cause was that the guard only consulted `git diff` and `git diff --cached`,
// both of which compare the working tree against HEAD. Once a removal is
// committed it appears in neither, so the guard saw nothing deliberate.
//
// These tests build real git repos in temp dirs rather than mocking git, because
// the whole bug lived in which git query was asked.
import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { probe } from "../../lib/exec.ts"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

/** A git repo whose packages/bundle has the given history, newest state last. */
async function repoWithBundleHistory(states: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dotfiles-fixes-"))
  dirs.push(dir)
  const git = async (...args: string[]) => {
    const res = await probe(["git", ...args], { cwd: dir })
    if (!res.ok) throw new Error(`git ${args.join(" ")} failed`)
  }
  await git("init", "-q")
  await git("config", "user.email", "test@example.com")
  await git("config", "user.name", "test")
  // A temp repo still inherits ~/.gitconfig, where this repo's own `commit.
  // gpgsign = true` lives. That sends every commit below through op-ssh-sign,
  // which blocks on a 1Password approval nobody is there to give — so the suite
  // passed or hung depending on whether 1Password happened to be unlocked.
  await git("config", "commit.gpgsign", "false")
  await git("config", "tag.gpgsign", "false")
  await Bun.write(join(dir, "packages", ".keep"), "")
  for (const [i, state] of states.entries()) {
    await Bun.write(join(dir, "packages", "bundle"), state)
    await git("add", "-A")
    await git("commit", "-q", "-m", `state ${i}`)
  }
  return dir
}

/**
 * The guard, reimplemented against an arbitrary repo.
 *
 * removedBundleLines() is module-private and hardcodes PACKAGES_DIR, so it
 * cannot be pointed at a fixture. This mirrors its two sources exactly; if the
 * real one changes, this must too — the assertions below are the contract.
 */
async function removedIn(dir: string): Promise<Set<string>> {
  const bundlePath = join(dir, "packages", "bundle")
  const directive = /^[-+](brew|cask|tap|go|cargo) /
  const normalize = (line: string): string => line.slice(1).replace(/,.*$/, "").trim()
  const removed = new Set<string>()

  for (const args of [
    ["diff", "--", bundlePath],
    ["diff", "--cached", "--", bundlePath],
  ]) {
    const res = await probe(["git", ...args], { cwd: dir })
    if (!res.ok) continue
    for (const line of res.stdout.split("\n")) {
      if (line.startsWith("---") || !line.startsWith("-") || !directive.test(line)) continue
      removed.add(normalize(line))
    }
  }

  const history = await probe(["git", "log", "-p", "--format=", "--", bundlePath], { cwd: dir })
  if (history.ok) {
    const everPresent = new Set<string>()
    for (const line of history.stdout.split("\n")) {
      if (line.startsWith("+++") || !line.startsWith("+") || !directive.test(line)) continue
      everPresent.add(normalize(line))
    }
    const current = new Set(
      (await Bun.file(bundlePath).text())
        .split("\n")
        .filter((l) => /^(brew|cask|tap|go|cargo) /.test(l))
        .map((l) => l.replace(/,.*$/, "").trim()),
    )
    for (const line of everPresent) if (!current.has(line)) removed.add(line)
  }
  return removed
}

describe("removed-directive guard", () => {
  it("sees a removal that was already COMMITTED — the c850cfc regression", async () => {
    const dir = await repoWithBundleHistory([
      'brew "git"\nbrew "ghidra"\ncask "inkscape"\n',
      'brew "git"\n', // ghidra + inkscape removed, and committed
    ])
    const removed = await removedIn(dir)
    expect(removed.has('brew "ghidra"')).toBe(true)
    expect(removed.has('cask "inkscape"')).toBe(true)
    // Still-declared entries must never count as removed, or the fix would
    // refuse to append anything at all.
    expect(removed.has('brew "git"')).toBe(false)
  })

  it("still sees an UNCOMMITTED removal (the case that already worked)", async () => {
    const dir = await repoWithBundleHistory(['brew "git"\nbrew "yazi"\n'])
    await Bun.write(join(dir, "packages", "bundle"), 'brew "git"\n')
    const removed = await removedIn(dir)
    expect(removed.has('brew "yazi"')).toBe(true)
  })

  it("does not resurrect a directive that was removed and later re-added", async () => {
    const dir = await repoWithBundleHistory([
      'brew "git"\nbrew "broot"\n',
      'brew "git"\n', // removed
      'brew "git"\nbrew "broot"\n', // deliberately brought back
    ])
    const removed = await removedIn(dir)
    // It is in the manifest today, so it is declared — not a pending removal.
    expect(removed.has('brew "broot"')).toBe(false)
  })

  it("normalizes trailing options, matching normalizeBundle", async () => {
    const dir = await repoWithBundleHistory([
      'tap "foo/bar", trusted: true\nbrew "git"\n',
      'brew "git"\n',
    ])
    const removed = await removedIn(dir)
    expect(removed.has('tap "foo/bar"')).toBe(true)
  })

  it("returns empty rather than throwing outside a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dotfiles-fixes-nogit-"))
    dirs.push(dir)
    await Bun.write(join(dir, "packages", "bundle"), 'brew "git"\n')
    expect((await removedIn(dir)).size).toBe(0)
  })
})
