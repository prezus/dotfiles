// `dotfiles ssh` — maintain an idempotent managed block in ~/.ssh/config.
//
// The only command that becomes 100% native: bash used an awk state machine to
// strip the old block, then a heredoc to append a fresh one. Here it is a
// string splice.
//
// What it manages: the 1Password IdentityAgent (the socket path is identical on
// every macOS install — 2BUA8C4S2C is 1Password's team id) plus compatibility
// tweaks for legacy hosts. Everything OUTSIDE the markers is left untouched,
// including the OrbStack `Include`, which OrbStack re-adds and which must stay
// at the top. Enabling the agent itself is a GUI toggle and cannot be scripted.
import { chmod, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { HOME, OP_AGENT_SOCK } from "../lib/env.ts"
import { stripManagedBlock as strip } from "../lib/managed-block.ts"
import { isSocket } from "../lib/fs.ts"
import { printSuccess, printWarning } from "../lib/ui.ts"

// These two strings are a compatibility contract with every config this has
// ever written. Change them and the next run appends a second block instead of
// replacing the first.
const BEGIN = "# >>> dotfiles managed ssh >>>"
const END = "# <<< dotfiles managed ssh <<<"

// ...which is exactly what happened once already. This CLI used to be called
// `dot`, and the rename orphaned every block written under the old markers:
// the bash could no longer see them, so it appended a second `Host *` stanza
// beside the first. Recognise the old names so the stale block is adopted and
// removed rather than duplicated. Do not delete this list — a config written
// years ago is still a config we have to clean up.
const LEGACY_MARKERS: { begin: string; end: string }[] = [
  { begin: "# >>> dot managed ssh >>>", end: "# <<< dot managed ssh <<<" },
]

export function buildBlock(socketPath: string): string {
  return [
    BEGIN,
    "Host *",
    `    IdentityAgent "${socketPath}"`,
    "    PubkeyAcceptedAlgorithms +ssh-rsa",
    "    HostKeyAlgorithms +ssh-rsa",
    "    SetEnv TERM=xterm-256color",
    "",
    "Host 192.168.*",
    "    KexAlgorithms +diffie-hellman-group14-sha1,diffie-hellman-group1-sha1",
    END,
  ].join("\n")
}

/**
 * Remove any existing managed block. Pure, so the idempotency property is
 * testable without touching a real ~/.ssh/config.
 */
export function stripManagedBlock(config: string): string {
  return strip(config, [{ begin: BEGIN, end: END }, ...LEGACY_MARKERS])
}

/** Strip then append — the whole update, as one pure function. */
export function applyManagedBlock(config: string, socketPath: string): string {
  const stripped = stripManagedBlock(config)
  const body = stripped.replace(/\n+$/, "")
  const prefix = body === "" ? "" : body + "\n"
  return `${prefix}${buildBlock(socketPath)}\n`
}

export async function ssh(): Promise<number> {
  const sshDir = join(HOME, ".ssh")
  const configPath = join(sshDir, "config")

  await mkdir(sshDir, { recursive: true })
  await chmod(sshDir, 0o700)

  const file = Bun.file(configPath)
  const existing = (await file.exists()) ? await file.text() : ""

  await Bun.write(configPath, applyManagedBlock(existing, OP_AGENT_SOCK))
  await chmod(configPath, 0o600)

  printSuccess("SSH config maintained (1Password agent + legacy-host compat)")

  if (await isSocket(OP_AGENT_SOCK)) {
    printSuccess("1Password SSH agent socket present")
  } else {
    printWarning(
      "Agent socket missing — enable 1Password ▸ Settings ▸ Developer ▸ 'Use the SSH agent'",
    )
  }
  return 0
}
