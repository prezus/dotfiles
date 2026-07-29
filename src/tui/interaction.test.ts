// These cover the behaviour that was previously only reachable by a human
// pressing keys at a real terminal. It never needed one — it is
// (state, keypress) -> (state, intent), and hiding it inside a React component
// was what made it look untestable.
import { describe, expect, it } from "bun:test"
import {
  initialDoctorNav,
  initialHomeState,
  initialPickerState,
  reduceDoctorKey,
  reduceHomeKey,
  reducePickerKey,
  type DoctorNav,
  type DoctorRow,
} from "./interaction.ts"

const rows: DoctorRow[] = [
  { id: "brew", section: "Tooling" },
  { id: "git", section: "Tooling" },
  { id: "fish", section: "Shell" },
  { id: "login-shell", section: "Shell" },
]

describe("doctor navigation", () => {
  it("moves down with both arrow and vim keys", () => {
    let nav = initialDoctorNav()
    nav = reduceDoctorKey(nav, { name: "down" }, rows).nav
    expect(nav.cursor).toBe(1)
    nav = reduceDoctorKey(nav, { name: "j" }, rows).nav
    expect(nav.cursor).toBe(2)
  })

  it("moves up with both arrow and vim keys", () => {
    let nav: DoctorNav = { cursor: 3, collapsed: new Set<string>() }
    nav = reduceDoctorKey(nav, { name: "up" }, rows).nav
    expect(nav.cursor).toBe(2)
    nav = reduceDoctorKey(nav, { name: "k" }, rows).nav
    expect(nav.cursor).toBe(1)
  })

  it("stops at the bottom instead of running off the end", () => {
    let nav: DoctorNav = { cursor: 3, collapsed: new Set<string>() }
    for (let i = 0; i < 5; i++) nav = reduceDoctorKey(nav, { name: "down" }, rows).nav
    expect(nav.cursor).toBe(3)
  })

  it("stops at the top", () => {
    let nav = initialDoctorNav()
    for (let i = 0; i < 5; i++) nav = reduceDoctorKey(nav, { name: "up" }, rows).nav
    expect(nav.cursor).toBe(0)
  })

  it("survives an empty list without going negative", () => {
    const { nav } = reduceDoctorKey(initialDoctorNav(), { name: "down" }, [])
    expect(nav.cursor).toBe(0)
  })
})

describe("doctor intents", () => {
  it("q and ctrl-c both quit", () => {
    expect(reduceDoctorKey(initialDoctorNav(), { name: "q" }, rows).intent.kind).toBe("quit")
    expect(reduceDoctorKey(initialDoctorNav(), { name: "c", ctrl: true }, rows).intent.kind).toBe(
      "quit",
    )
  })

  it("a bare 'c' does NOT quit — only ctrl-c", () => {
    expect(reduceDoctorKey(initialDoctorNav(), { name: "c" }, rows).intent.kind).toBe("none")
  })

  it("enter targets the row under the cursor, by id", () => {
    const nav: DoctorNav = { cursor: 3, collapsed: new Set<string>() }
    const { intent } = reduceDoctorKey(nav, { name: "return" }, rows)
    expect(intent).toEqual({ kind: "fix", id: "login-shell" })
  })

  it("enter on an empty list does nothing rather than firing a fix", () => {
    expect(reduceDoctorKey(initialDoctorNav(), { name: "return" }, []).intent.kind).toBe("none")
  })

  it("r re-runs", () => {
    expect(reduceDoctorKey(initialDoctorNav(), { name: "r" }, rows).intent.kind).toBe("rerun")
  })

  it("ignores keys it does not handle", () => {
    for (const name of ["x", "1", "tab", "backspace"]) {
      const { intent } = reduceDoctorKey(initialDoctorNav(), { name }, rows)
      expect(intent.kind).toBe("none")
    }
  })
})

describe("doctor section folding", () => {
  it("space folds the section of the selected row", () => {
    const { nav } = reduceDoctorKey(initialDoctorNav(), { name: "space" }, rows)
    expect([...nav.collapsed]).toEqual(["Tooling"])
  })

  it("space again unfolds it", () => {
    let nav = reduceDoctorKey(initialDoctorNav(), { name: "space" }, rows).nav
    nav = reduceDoctorKey(nav, { name: "space" }, rows).nav
    expect([...nav.collapsed]).toEqual([])
  })

  it("folds the section the cursor is in, not always the first", () => {
    const nav: DoctorNav = { cursor: 2, collapsed: new Set<string>() }
    const next = reduceDoctorKey(nav, { name: "space" }, rows).nav
    expect([...next.collapsed]).toEqual(["Shell"])
  })

  it("re-clamps the cursor when folding shortens the visible list", () => {
    // Cursor at the last row, then Shell folds away leaving only Tooling.
    const nav: DoctorNav = { cursor: 3, collapsed: new Set<string>() }
    const folded = reduceDoctorKey(nav, { name: "space" }, rows).nav
    const shorter = rows.filter((r) => r.section === "Tooling")
    const after = reduceDoctorKey(folded, { name: "down" }, shorter).nav
    expect(after.cursor).toBeLessThanOrEqual(shorter.length - 1)
  })

  it("does not mutate the previous collapsed set", () => {
    const nav = initialDoctorNav()
    const before = new Set(nav.collapsed)
    reduceDoctorKey(nav, { name: "space" }, rows)
    expect(nav.collapsed).toEqual(before)
  })
})

// ─── home dashboard ─────────────────────────────────────────────────

const homeCommands = ["init", "update", "doctor", "stow", "ssh", "skills"]

describe("home dashboard", () => {
  it("moves and clamps like the other views", () => {
    let state = initialHomeState()
    for (let i = 0; i < 20; i++) state = reduceHomeKey(state, { name: "down" }, homeCommands).state
    expect(state.cursor).toBe(homeCommands.length - 1)
    for (let i = 0; i < 20; i++) state = reduceHomeKey(state, { name: "up" }, homeCommands).state
    expect(state.cursor).toBe(0)
  })

  it("enter runs the command under the cursor, by name", () => {
    const state = { cursor: 2 }
    const { intent } = reduceHomeKey(state, { name: "return" }, homeCommands)
    expect(intent).toEqual({ kind: "run", command: "doctor" })
  })

  it("jumps to a command by first letter", () => {
    const { state } = reduceHomeKey(initialHomeState(), { name: "d" }, homeCommands)
    expect(homeCommands[state.cursor]).toBe("doctor")
  })

  it("cycles through commands sharing a first letter", () => {
    const cmds = ["stow", "ssh", "skills"]
    let state = initialHomeState() // on "stow"
    state = reduceHomeKey(state, { name: "s" }, cmds).state
    expect(cmds[state.cursor]).toBe("ssh")
    state = reduceHomeKey(state, { name: "s" }, cmds).state
    expect(cmds[state.cursor]).toBe("skills")
    state = reduceHomeKey(state, { name: "s" }, cmds).state
    expect(cmds[state.cursor]).toBe("stow") // wraps
  })

  it("does not move for a letter matching nothing", () => {
    const { state } = reduceHomeKey({ cursor: 3 }, { name: "z" }, homeCommands)
    expect(state.cursor).toBe(3)
  })

  it("q quits, r refreshes", () => {
    expect(reduceHomeKey(initialHomeState(), { name: "q" }, homeCommands).intent.kind).toBe("quit")
    expect(reduceHomeKey(initialHomeState(), { name: "r" }, homeCommands).intent.kind).toBe(
      "refresh",
    )
  })

  it("'r' refreshes rather than jumping to a command starting with r", () => {
    // Explicit ordering guard: the refresh binding must win over letter-jump,
    // or adding a command like `rust` would silently break it.
    const withRust = [...homeCommands, "rust", "retry-failed"]
    const { intent, state } = reduceHomeKey(initialHomeState(), { name: "r" }, withRust)
    expect(intent.kind).toBe("refresh")
    expect(state.cursor).toBe(0)
  })

  it("enter on an empty command list does nothing", () => {
    expect(reduceHomeKey(initialHomeState(), { name: "return" }, []).intent.kind).toBe("none")
  })
})

// ─── update picker ──────────────────────────────────────────────────

const ids = ["repos", "brew", "extras", "stow", "skills"]

describe("update picker", () => {
  it("starts with the defaults selected", () => {
    const state = initialPickerState(["repos", "brew"])
    expect([...state.selected].sort()).toEqual(["brew", "repos"])
  })

  it("space toggles the row under the cursor", () => {
    let state = initialPickerState([])
    state = reducePickerKey(state, { name: "space" }, ids).state
    expect([...state.selected]).toEqual(["repos"])
    state = reducePickerKey(state, { name: "space" }, ids).state
    expect([...state.selected]).toEqual([])
  })

  it("toggles the right row after moving", () => {
    let state = initialPickerState([])
    state = reducePickerKey(state, { name: "down" }, ids).state
    state = reducePickerKey(state, { name: "down" }, ids).state
    state = reducePickerKey(state, { name: "space" }, ids).state
    expect([...state.selected]).toEqual(["extras"])
  })

  it("'a' selects all when some are unselected", () => {
    const state = reducePickerKey(initialPickerState(["repos"]), { name: "a" }, ids).state
    expect([...state.selected].sort()).toEqual([...ids].sort())
  })

  it("'a' clears all when everything is already selected", () => {
    const state = reducePickerKey(initialPickerState(ids), { name: "a" }, ids).state
    expect([...state.selected]).toEqual([])
  })

  it("enter confirms with the current selection", () => {
    const { intent } = reducePickerKey(initialPickerState(["brew"]), { name: "return" }, ids)
    expect(intent.kind).toBe("confirm")
    if (intent.kind !== "confirm") throw new Error("unreachable")
    expect([...intent.selected]).toEqual(["brew"])
  })

  it("enter can confirm an EMPTY selection — that is a valid 'do nothing'", () => {
    const { intent } = reducePickerKey(initialPickerState([]), { name: "return" }, ids)
    expect(intent.kind).toBe("confirm")
    if (intent.kind !== "confirm") throw new Error("unreachable")
    expect(intent.selected.size).toBe(0)
  })

  it("q, escape and ctrl-c all cancel", () => {
    for (const key of [{ name: "q" }, { name: "escape" }, { name: "c", ctrl: true }]) {
      expect(reducePickerKey(initialPickerState(ids), key, ids).intent.kind).toBe("cancel")
    }
  })

  it("cancel is distinct from confirming nothing", () => {
    // update() treats null as "user backed out" and an empty set as "ran
    // nothing" — conflating them would silently skip a requested update.
    const cancelled = reducePickerKey(initialPickerState([]), { name: "q" }, ids).intent
    const confirmed = reducePickerKey(initialPickerState([]), { name: "return" }, ids).intent
    expect(cancelled.kind).toBe("cancel")
    expect(confirmed.kind).toBe("confirm")
  })

  it("does not mutate the previous selection set", () => {
    const state = initialPickerState(["repos"])
    const before = new Set(state.selected)
    reducePickerKey(state, { name: "space" }, ids)
    expect(state.selected).toEqual(before)
  })
})
