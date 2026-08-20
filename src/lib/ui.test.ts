// The confirm() gate. `interpretAnswer` is split out of it precisely so the
// y/n/empty grid is reachable without a terminal — the read itself is one
// `readSync` line and a comment explaining why it is not a stream.
//
// NOT covered here: the ReadableStream lock that this replaced. Reproducing it
// needs a real TTY plus a mounted-and-destroyed OpenTUI renderer, which is a
// subprocess-under-a-pty test for a single-user repo with no CI. The guard that
// matters is the comment on readLineSync; this file pins the behaviour around it.
import { describe, expect, test } from "bun:test"
import { confirm, interpretAnswer } from "./ui.ts"

describe("interpretAnswer", () => {
  test("accepts the yes spellings, case-insensitively", () => {
    for (const raw of ["y", "Y", "yes", "YES", " y \n", "y\r\n"]) {
      expect(interpretAnswer(raw, false)).toBe(true)
    }
  })

  test("treats anything else as no", () => {
    for (const raw of ["n", "no", "q", "yep", "1", "yy"]) {
      expect(interpretAnswer(raw, false)).toBe(false)
    }
  })

  test("empty input takes the default — bare Enter accepts the prompt's suggestion", () => {
    expect(interpretAnswer("", false)).toBe(false)
    expect(interpretAnswer("", true)).toBe(true)
    expect(interpretAnswer("\n", true)).toBe(true)
  })

  test("a failed read takes the default, never yes-by-accident", () => {
    // null is EAGAIN/EOF. Destructive gates pass defaultYes=false, so a broken
    // stdin declines rather than proceeding.
    expect(interpretAnswer(null, false)).toBe(false)
    expect(interpretAnswer(null, true)).toBe(true)
  })

  test("an explicit no overrides a yes default", () => {
    expect(interpretAnswer("n", true)).toBe(false)
  })
})

describe("confirm", () => {
  test("returns the default without reading when stdin is not a tty", async () => {
    // bun test runs with stdin piped, so this is the real non-interactive path:
    // it must answer from the default instead of blocking on a read nobody can
    // satisfy — the hang the bash original would not have survived.
    expect(process.stdin.isTTY).toBeFalsy()
    expect(await confirm("Uninstall these?", false)).toBe(false)
    expect(await confirm("Continue?", true)).toBe(true)
  })
})
