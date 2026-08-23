// `dotfiles keys` — see what your keyboard actually sends, on either machine.
//
// This exists because comparing a Mac's keymap to a Linux box's is otherwise
// guesswork. `event.code` is defined to be the physical key regardless of
// layout, and `event.key` is what the layout resolved it to, so the pair
// answers both "which key did I hit" and "what did the system make of it" — and
// it answers them the same way on both platforms, which is what makes a
// cross-machine diff possible at all.
//
// Two sources, because neither alone is sufficient. The browser sees what
// applications see, which is the right layer for comparing machines, but a
// compositor keybinding is consumed before the browser is told anything: press
// SUPER+C under Hyprland and the page hears silence. `--raw` reads
// /dev/input/event* instead, below the compositor, where that press is visible.
// Linux only — the macOS equivalent needs a CGEventTap and an Input Monitoring
// grant, which is a different piece of work.
import { mkdir, open } from "node:fs/promises"
import { join } from "node:path"
import { Result, TaggedError } from "better-result"
import { Schema } from "effect"
import { KEYMAPS_DIR } from "../lib/env.ts"
import { run } from "../lib/exec.ts"
import { describe, type Chord } from "../lib/keyboard/chord.ts"
import { listKeyboards, streamKeyPresses } from "../lib/keyboard/evdev.ts"
import { visualizerPage } from "../lib/keyboard/page.ts"
import { ACTIONS, diff, ProfileJson, type Profile } from "../lib/keyboard/profile.ts"
import { IS_DARWIN, IS_LINUX, PLATFORM } from "../lib/platform.ts"
import {
  GREEN,
  RED,
  RESET,
  YELLOW,
  getLogSink,
  printError,
  printInfo,
  printRaw,
  printSuccess,
  printWarning,
} from "../lib/ui.ts"

/** Flags, parsed the way every other command here parses them. */
type Options = {
  readonly raw: boolean
  readonly open: boolean
  readonly port: number
  readonly device: string | null
  readonly group: string | null
}

function parseOptions(argv: readonly string[]): Options {
  const value = (flag: string): string | null => {
    const found = argv.find((a) => a.startsWith(flag + "="))
    return found === undefined ? null : found.slice(flag.length + 1)
  }
  const port = value("--port")
  return {
    raw: argv.includes("--raw"),
    open: !argv.includes("--no-open"),
    // 0 lets the kernel pick a free port, so a second run never collides with
    // a first one someone forgot to stop.
    port: port === null ? 0 : Number(port),
    device: value("--device"),
    group: value("--group"),
  }
}

/** Open a URL in the user's browser, through exec so PATH threading applies. */
async function openBrowser(url: string): Promise<void> {
  const opener = IS_DARWIN ? "open" : "xdg-open"
  const result = await run([opener, url])
  if (Result.isError(result) || !result.value.ok) {
    printWarning(`could not launch a browser — open ${url} yourself`)
  }
}

/** Pick the device to read, preferring an explicit --device. */
async function resolveDevice(requested: string | null): Promise<string | null> {
  if (requested !== null) return requested
  const keyboards = await listKeyboards()
  const first = keyboards[0]
  if (first === undefined) return null
  if (keyboards.length > 1) {
    printInfo(`${keyboards.length} keyboards found; reading ${first.name}`)
    printRaw("  --device=<path> to choose another, `dotfiles keys devices` to list them")
  }
  return first.path
}

/** `dotfiles keys devices` — what --raw could read. */
async function devices(): Promise<number> {
  if (!IS_LINUX) {
    printInfo("evdev devices are Linux-only")
    return 0
  }
  const keyboards = await listKeyboards()
  if (keyboards.length === 0) {
    printWarning("no keyboards found under /dev/input/by-id")
    return 0
  }
  for (const device of keyboards) {
    printRaw(`  ${device.name}`)
    printRaw(`    ${device.path}`)
  }
  return 0
}

/**
 * Serve the visualizer until interrupted, or until a capture is submitted.
 *
 * @param options - Parsed flags.
 * @param recordAs - Machine name when recording a profile, null when just looking.
 * @returns Process exit code.
 */
async function serve(options: Options, recordAs: string | null): Promise<number> {
  if (options.raw && !IS_LINUX) {
    printError("--raw is Linux-only (macOS needs a CGEventTap; not built yet)")
    return 1
  }

  const device = options.raw ? await resolveDevice(options.device) : null
  if (options.raw && device === null) {
    printError("no keyboard found under /dev/input/by-id")
    return 1
  }
  if (device !== null && !(await checkReadable(device))) return 1

  const mode = options.raw ? "raw" : "dom"
  const page = visualizerPage(mode, PLATFORM === "darwin" ? "darwin" : "linux")
  const controller = new AbortController()
  let exitCode = 0

  const server = Bun.serve({
    port: options.port,
    idleTimeout: 0,
    fetch(request, self) {
      const url = new URL(request.url)
      if (url.pathname === "/ws") {
        return self.upgrade(request) ? undefined : new Response("upgrade failed", { status: 400 })
      }
      if (url.pathname === "/record" && request.method === "POST") {
        return handleRecord(request, recordAs)
      }
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })
    },
    websocket: {
      open(socket) {
        if (device === null) return
        void streamDevice(device, socket, controller.signal)
      },
      message() {
        // The page never sends; a no-op handler is required by the type.
      },
    },
  })

  async function handleRecord(request: Request, machine: string | null): Promise<Response> {
    if (machine === null) return new Response("not recording", { status: 400 })
    const body = await request.text()
    const written = await writeProfile(machine, body)
    if (Result.isError(written)) {
      printError(written.error.message)
      exitCode = 1
    } else {
      printSuccess(`captured ${written.value.entries.length} actions → ${profilePath(machine)}`)
      printRaw(`  compare with: dotfiles keys diff ${machine} <other>`)
    }
    // The capture is the whole job; nothing is left to serve.
    setTimeout(() => stop(), 100)
    return new Response("ok")
  }

  const url = `http://localhost:${server.port}/${recordAs === null ? "" : "?record=1"}${
    recordAs !== null && options.group !== null ? `&group=${options.group}` : ""
  }`

  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    controller.abort()
    void server.stop(true)
  }

  printInfo(mode === "raw" ? `reading ${device}` : "reading browser key events")
  printRaw(`  ${url}`)
  printRaw("  ctrl-c to stop")
  if (options.open) await openBrowser(url)

  process.on("SIGINT", stop)
  await new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (stopped) {
        clearInterval(poll)
        resolve()
      }
    }, 100)
  })
  return exitCode
}

/** Push evdev presses down a WebSocket until the signal aborts. */
async function streamDevice(
  device: string,
  socket: { send: (data: string) => number; close: () => void },
  signal: AbortSignal,
): Promise<void> {
  const streamed = await streamKeyPresses(device, signal, (press) => {
    socket.send(JSON.stringify(press))
  })
  if (Result.isError(streamed)) {
    reportDeviceFailure(streamed.error.message)
    socket.close()
  }
}

/** Explain a device failure, with the group hint only when it is the likely cause. */
function reportDeviceFailure(message: string): void {
  printError(message)
  if (message.includes("EACCES")) {
    printRaw("  /dev/input is owned by group `input` — check membership: id -nG")
  }
}

/**
 * Confirm the device can actually be read, before anything is served.
 *
 * Without this the failure surfaces only once a browser connects the WebSocket,
 * which is a confusing place to learn that a path was wrong.
 */
async function checkReadable(device: string): Promise<boolean> {
  // Caught rather than carried as a Result: this is the boundary where an fs
  // exception becomes a message, and there is nothing above it to decide.
  try {
    const handle = await open(device, "r")
    await handle.close()
    return true
  } catch (cause) {
    reportDeviceFailure(cause instanceof Error ? cause.message : String(cause))
    return false
  }
}

function profilePath(machine: string): string {
  return join(KEYMAPS_DIR, `${machine}.json`)
}

/** What the page POSTs back: one entry per action it walked. */
const CaptureJson = Schema.parseJson(
  Schema.Array(Schema.Struct({ action: Schema.String, chord: Schema.NullOr(Schema.String) })),
)

/** A profile could not be read, or a capture could not be stored. */
class ProfileFailure extends TaggedError("ProfileFailure")<{
  path: string
  message: string
}>() {}

async function writeProfile(
  machine: string,
  body: string,
): Promise<Result<Profile, ProfileFailure>> {
  const decoded = Schema.decodeUnknownEither(CaptureJson)(body)
  if (decoded._tag === "Left") {
    return Result.err(
      new ProfileFailure({
        path: profilePath(machine),
        message: "the browser sent a capture this version cannot read",
      }),
    )
  }

  const profile: Profile = {
    machine,
    platform: PLATFORM === "darwin" ? "darwin" : "linux",
    // Stamped here rather than in the domain module: capture time is an
    // observation about this run, not a property of the keymap.
    capturedAt: new Date().toISOString(),
    // SAFETY: Chord is a branded string and the page produces canonical order
    // from the same table src/lib/keyboard/chord.ts uses. A hand-typed entry
    // from the manual box is trusted the same way a hand-edited profile is.
    entries: decoded.right.map((e) => ({ action: e.action, chord: e.chord as Chord | null })),
  }

  await mkdir(KEYMAPS_DIR, { recursive: true })
  await Bun.write(profilePath(machine), JSON.stringify(profile, null, 2) + "\n")
  return Result.ok(profile)
}

/** Read a stored profile by machine name, or by path if one was given. */
async function readProfile(nameOrPath: string): Promise<Result<Profile, ProfileFailure>> {
  const path = nameOrPath.includes("/") ? nameOrPath : profilePath(nameOrPath)
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return Result.err(new ProfileFailure({ path, message: `no profile at ${path}` }))
  }

  const decoded = Schema.decodeUnknownEither(ProfileJson)(await file.text())
  if (decoded._tag === "Left") {
    return Result.err(new ProfileFailure({ path, message: `${path} is not a keymap profile` }))
  }

  const parsed = decoded.right
  return Result.ok({
    machine: parsed.machine,
    platform: parsed.platform,
    capturedAt: parsed.capturedAt,
    // SAFETY: as in writeProfile — stored chords were canonical when written.
    entries: parsed.entries.map((e) => ({ action: e.action, chord: e.chord as Chord | null })),
  })
}

/** `dotfiles keys diff a b` — where two machines disagree. */
async function diffCommand(left: string | undefined, right: string | undefined): Promise<number> {
  if (left === undefined || right === undefined) {
    printError("usage: dotfiles keys diff <machine-a> <machine-b>")
    return 1
  }

  const a = await readProfile(left)
  const b = await readProfile(right)
  if (Result.isError(a)) {
    printError(a.error.message)
    return 1
  }
  if (Result.isError(b)) {
    printError(b.error.message)
    return 1
  }

  const rows = diff(a.value, b.value)
  const width = Math.max(...rows.map((r) => r.prompt.length)) + 2
  const render = (chord: Chord | null, platform: "darwin" | "linux"): string =>
    chord === null ? "—" : describe(chord, platform)

  let differing = 0
  let compared = 0
  for (const row of rows) {
    if (row.verdict === "neither") continue
    compared++
    const mark = row.verdict === "same" ? `${GREEN}=${RESET}` : `${RED}≠${RESET}`
    if (row.verdict !== "same") differing++
    const label = row.prompt.padEnd(width)
    const l = render(row.left, a.value.platform).padEnd(14)
    const r = render(row.right, b.value.platform)
    printRaw(`  ${mark} ${label}${l}${r}`)
  }

  const header = `${a.value.machine} (${a.value.platform}) vs ${b.value.machine} (${b.value.platform})`
  printRaw("")
  if (differing === 0) printSuccess(`${header} — no differences`)
  else printWarning(`${header} — ${YELLOW}${differing}${RESET} of ${compared} differ`)
  return 0
}

/**
 * Entry point for `dotfiles keys`.
 *
 * @param argv - Arguments after the command name.
 * @returns Process exit code.
 */
export async function keys(argv: string[] = []): Promise<number> {
  // The dashboard invokes every command as `run([])` while OpenTUI owns the
  // screen. A server that blocks until ctrl-c would fight it for the terminal.
  if (getLogSink() !== null) {
    printInfo("run `dotfiles keys` from a shell — it serves a page until interrupted")
    return 0
  }

  const [sub, ...rest] = argv
  const options = parseOptions(argv)

  switch (sub) {
    case undefined:
      return await serve(options, null)
    case "devices":
      return await devices()
    case "record": {
      const machine = rest.find((a) => !a.startsWith("--"))
      if (machine === undefined) {
        printError(`usage: dotfiles keys record <machine-name> [--group=<${groupNames()}>]`)
        return 1
      }
      return await serve(options, machine)
    }
    case "diff": {
      const [left, right] = rest.filter((a) => !a.startsWith("--"))
      return await diffCommand(left, right)
    }
    default:
      if (sub.startsWith("--")) return await serve(options, null)
      printError("usage: dotfiles keys [devices|record <name>|diff <a> <b>] [--raw]")
      return 1
  }
}

function groupNames(): string {
  return [...new Set(ACTIONS.map((a) => a.group))].join("|")
}
