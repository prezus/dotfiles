import { describe, expect, it } from "bun:test"
import {
  initialDoctorNav,
  initialHomeState,
  initialPickerState,
  reduceDoctorKey,
  reduceHomeKey,
  reduceOutputKey,
  reducePickerKey,
  type DoctorRow,
} from "./interaction.ts"

const doctorRows: DoctorRow[] = [
  { id: "brew", section: "Tooling" },
  { id: "git", section: "Tooling" },
  { id: "fish", section: "Shell" },
  { id: "login-shell", section: "Shell" },
]

describe("keyboard interaction", () => {
  it("navigates, folds and acts on the selected doctor row", () => {
    let nav = initialDoctorNav()
    for (let index = 0; index < 10; index++) nav = reduceDoctorKey(nav, { name: "down" }, doctorRows).nav
    expect(nav.cursor).toBe(3)
    expect(reduceDoctorKey(nav, { name: "return" }, doctorRows).intent).toEqual({ kind: "fix", id: "login-shell" })
    nav = reduceDoctorKey(nav, { name: "space" }, doctorRows).nav
    expect([...nav.collapsed]).toEqual(["Shell"])
    expect(reduceDoctorKey(nav, { name: "down" }, doctorRows.slice(0, 2)).nav.cursor).toBe(1)
    expect(reduceDoctorKey(nav, { name: "q" }, doctorRows).intent.kind).toBe("quit")
  })

  it("navigates the dashboard without letting first-letter jumps steal reserved keys", () => {
    const commands = ["init", "update", "doctor", "stow", "ssh", "skills", "rust"]
    let state = reduceHomeKey(initialHomeState(), { name: "d" }, commands).state
    expect(reduceHomeKey(state, { name: "return" }, commands).intent).toEqual({ kind: "run", command: "doctor" })
    state = reduceHomeKey(state, { name: "s" }, commands).state
    expect(commands[state.cursor]).toBe("stow")
    state = reduceHomeKey(state, { name: "s" }, commands).state
    expect(commands[state.cursor]).toBe("ssh")
    expect(reduceHomeKey(state, { name: "r" }, commands).intent.kind).toBe("refresh")
  })

  it("updates picker selection while keeping cancel distinct from confirming nothing", () => {
    const ids = ["repos", "brew", "extras"]
    const initial = initialPickerState(["repos"])
    let state = reducePickerKey(initial, { name: "down" }, ids).state
    state = reducePickerKey(state, { name: "space" }, ids).state
    expect([...state.selected].sort()).toEqual(["brew", "repos"])
    expect([...initial.selected]).toEqual(["repos"])
    expect(reducePickerKey(initialPickerState([]), { name: "q" }, ids).intent.kind).toBe("cancel")
    expect(reducePickerKey(initialPickerState([]), { name: "return" }, ids).intent.kind).toBe("confirm")
  })

  it("scrolls output within history and dismisses only after the command finishes", () => {
    const view = { maxOffset: 100, page: 10, busy: false }
    expect(reduceOutputKey({ offset: 0 }, { name: "pageup" }, view).state.offset).toBe(10)
    expect(reduceOutputKey({ offset: 0 }, { name: "home" }, view).state.offset).toBe(100)
    expect(reduceOutputKey({ offset: 100 }, { name: "end" }, view).state.offset).toBe(0)
    expect(reduceOutputKey({ offset: 0 }, { name: "q" }, view).intent.kind).toBe("dismiss")
    expect(reduceOutputKey({ offset: 0 }, { name: "q" }, { ...view, busy: true }).intent.kind).toBe("none")
  })
})
