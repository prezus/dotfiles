import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { IS_DARWIN } from "../lib/platform.ts"

const roots: string[] = []
const overlay = IS_DARWIN ? "home-darwin" : "home-linux"
const platform = IS_DARWIN ? "darwin" : "linux"

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("stow command", () => {
  it("migrates a folded home-only directory into the shared and platform layout", async () => {
    const root = await mkdtemp(join(tmpdir(), "dotfiles-stow-command-"))
    roots.push(root)
    const repo = join(root, "repo")
    const target = join(root, "target")
    await Promise.all([
      mkdir(join(repo, "home", ".config", "git"), { recursive: true }),
      mkdir(join(repo, overlay, ".config", "git"), { recursive: true }),
      mkdir(target, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(repo, "home", ".config", "git", "ignore"), "shared\n"),
      writeFile(join(repo, overlay, ".config", "git", "platform"), `${platform}\n`),
    ])

    const oldLayout = Bun.spawn(
      ["stow", "-S", "-d", repo, "-t", target, "home"],
      { stdout: "pipe", stderr: "pipe" },
    )
    expect(await oldLayout.exited).toBe(0)

    const commandModule = fileURLToPath(new URL("./stow.ts", import.meta.url))
    const migration = Bun.spawn(
      [
        "bun",
        "-e",
        `const { stow } = await import(${JSON.stringify(commandModule)}); process.exit(await stow([]))`,
      ],
      {
        env: { ...process.env, DOTFILES_DIR: repo, HOME: target },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(migration.stdout).text(),
      new Response(migration.stderr).text(),
      migration.exited,
    ])

    expect(`${stdout}\n${stderr}`).not.toContain("invalid target")
    expect(code).toBe(0)
    expect(await readFile(join(target, ".config", "git", "ignore"), "utf8")).toBe("shared\n")
    expect(await readFile(join(target, ".config", "git", "platform"), "utf8")).toBe(`${platform}\n`)
  })
})
