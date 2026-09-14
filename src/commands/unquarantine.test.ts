import { expect, test } from "bun:test"
import { join } from "node:path"
import { DOTFILES_DIR } from "../lib/env.ts"
import { IS_DARWIN } from "../lib/platform.ts"

test.skipIf(!IS_DARWIN)("unquarantine: real xattrs and isolated launchd install/uninstall", async () => {
  const child = Bun.spawn(["/bin/bash", join(DOTFILES_DIR, "tests", "unquarantine.test.sh")], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect({ code, stderr: code === 0 ? "" : stderr, stdout: code === 0 ? "" : stdout }).toEqual({
    code: 0,
    stderr: "",
    stdout: "",
  })
}, 30_000)
