// This repo's own git hooks (.githooks/): gitleaks over every commit and push,
// because the repo is public. Git never runs hooks from a fresh clone, so each
// clone opts in with a LOCAL core.hooksPath — never a global one.
import { DOTFILES_DIR } from "./env.ts"
import { probe } from "./exec.ts"

export const HOOKS_PATH = ".githooks"

const git = (...args: string[]) => probe(["git", "-C", DOTFILES_DIR, ...args])

export async function hooksWired(): Promise<boolean> {
  const current = await git("config", "--local", "--get", "core.hooksPath")
  return current.stdout.trim() === HOOKS_PATH
}

export async function wireHooks(): Promise<boolean> {
  return (await git("config", "--local", "core.hooksPath", HOOKS_PATH)).ok
}
