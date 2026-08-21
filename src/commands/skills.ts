// `dotfiles skills` — install FROM the separate prezus/skills repo.
//
// INSTALL.md is the SPEC for this file, with numbered acceptance criteria.
// Two behaviours there are load-bearing and must not drift:
//   - install never silently deletes: a real dir is backed up to .bak.<ts>
//   - update NEVER auto-commits; it stops for human review of the diff
import { Result } from "better-result"
import { Schema } from "effect"
import { join } from "node:path"
import { HOME, SKILLS_REPO, SKILLS_SRC } from "../lib/env.ts"
import { runInteractiveCode } from "../lib/exec.ts"
import { countSubdirectories, isDirectory, link, pathExists, readlinkSafe } from "../lib/fs.ts"
import { printError, printInfo, printRaw, printSuccess, printWarning } from "../lib/ui.ts"
import { VendorManifestJson } from "../lib/vendor-manifest.ts"

const AGENTS_LINK = join(HOME, ".agents", "skills")
const CLAUDE_LINK = join(HOME, ".claude", "skills")
const PI_LINK = join(HOME, ".pi", "agent", "skills")
const PI_DIR = join(HOME, ".pi", "agent")

/** Report what a link did, keeping the "never silently delete" promise visible. */
async function reportLink(linkPath: string, target: string): Promise<void> {
  const outcome = await link(linkPath, target)
  switch (outcome.action) {
    case "already-linked":
      printSuccess(`${linkPath} → already linked`)
      break
    case "backed-up":
      printWarning(`backed up existing ${linkPath} → ${outcome.backup}`)
      printSuccess(`${linkPath} → ${target}`)
      break
    default:
      printSuccess(`${linkPath} → ${target}`)
  }
}

async function install(): Promise<number> {
  if (!(await isDirectory(SKILLS_SRC))) {
    printInfo(`Cloning prezus/skills → ${SKILLS_REPO} (public, HTTPS)...`)
    const code = await runInteractiveCode([
      "git",
      "clone",
      "https://github.com/prezus/skills.git",
      SKILLS_REPO,
    ])
    if (code !== 0) {
      printError("failed to clone prezus/skills")
      return 1
    }
  }

  await reportLink(AGENTS_LINK, SKILLS_SRC)
  await reportLink(CLAUDE_LINK, AGENTS_LINK)
  // Pi reads the same canonical pool — link it too, but only if Pi is set up here.
  if (await isDirectory(PI_DIR)) await reportLink(PI_LINK, AGENTS_LINK)

  await status()

  // INSTALL.md §4: exit zero only if both links resolve to $SKILLS_SRC.
  const agents = await readlinkSafe(AGENTS_LINK)
  const claude = await readlinkSafe(CLAUDE_LINK)
  return agents === SKILLS_SRC && claude === AGENTS_LINK ? 0 : 1
}

async function update(): Promise<number> {
  const script = join(SKILLS_REPO, "scripts", "sync-vendored.sh")
  if (!(await pathExists(script))) {
    printWarning(`No sync script at ${script} — follow ${SKILLS_REPO}/VENDORING.md manually.`)
    return 1
  }

  printInfo("Syncing vendored skills (all vendors @ pinnedRef; set VENDOR=/REF= to scope)...")
  const code = await runInteractiveCode([script], {
    cwd: SKILLS_REPO,
    extraEnv: { VENDOR: process.env.VENDOR ?? "", REF: process.env.REF ?? "" },
  })
  if (code !== 0) printWarning("sync-vendored.sh reported a problem")

  // INSTALL.md §3: stop for human review. Never auto-commit.
  printInfo("Review the diff, then commit:")
  await runInteractiveCode(["git", "-C", SKILLS_REPO, "--no-pager", "diff", "--stat"])
  return code
}

async function verify(): Promise<number> {
  const script = join(SKILLS_REPO, "scripts", "verify-vendored.sh")
  if (!(await pathExists(script))) {
    printWarning(`No verify script at ${script}`)
    return 1
  }
  return await runInteractiveCode([script], { cwd: SKILLS_REPO })
}

async function status(): Promise<number> {
  const count = await countSubdirectories(SKILLS_SRC)
  printInfo(`skills source: ${SKILLS_SRC} (${count} skills)`)

  const show = async (label: string, path: string) => {
    printRaw(`  ${label} → ${(await readlinkSafe(path)) ?? "(not linked)"}`)
  }
  await show("~/.agents/skills", AGENTS_LINK)
  await show("~/.claude/skills", CLAUDE_LINK)
  if (await isDirectory(PI_DIR)) await show("~/.pi/agent/skills", PI_LINK)

  // Native JSON read — this was a `node -e "require(...)"` shell-out in bash.
  const manifest = Bun.file(join(SKILLS_REPO, "vendor-manifest.json"))
  if (await manifest.exists()) {
    const parsed = await Result.tryPromise(async () =>
      Schema.decodeUnknownSync(VendorManifestJson)(await manifest.text()),
    )
    Result.match(parsed, {
      ok: (data) => {
        for (const v of data.vendors) {
          printRaw(`  vendored: ${v.source} @ ${v.pinnedCommit.slice(0, 10)} (${v.vendoredOn})`)
        }
      },
      err: () => printWarning("  vendor-manifest.json is unreadable"),
    })
  }
  return 0
}

export async function skills(argv: string[] = []): Promise<number> {
  const sub = argv[0] ?? "status"
  switch (sub) {
    case "install":
      return await install()
    case "update":
      return await update()
    case "status":
      return await status()
    case "verify":
      return await verify()
    default:
      printError(`usage: dotfiles skills {install|update|status|verify}`)
      return 1
  }
}
