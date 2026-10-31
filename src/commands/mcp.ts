// `dotfiles mcp` — give every agent the same remote MCP servers.
//
// The manifest is Pi's tracked `home/.pi/agent/mcp.json`: Pi reads it through
// stow, and this command mirrors its servers into Claude Code (user scope) and
// Codex, whose MCP config lives in untracked files that also hold sign-in state
// (`~/.claude.json`, `~/.codex/`).
//
// The repo is PUBLIC, so the rules are strict:
//   - Only a server that is a bare `url` is mirrored. One that carries
//     `headers`, `oauth`, `env` or a `command` is refused: copying it would put
//     whatever it holds into another client's config, and a header is where a
//     key would end up. Servers here sign in with OAuth, in each client.
//   - Sign-in is never automated past starting it. Tokens stay in each client.
//   - Status comes from asking the client about one server by name and keeping
//     only its URL and state, never from reading or printing a client's config.
import { Either, Schema } from "effect"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { HOME_DIR } from "../lib/env.ts"
import { commandExists, probe, runInteractiveCode } from "../lib/exec.ts"
import { printError, printInfo, printSuccess, printWarning } from "../lib/ui.ts"

export const MANIFEST_PATH = join(HOME_DIR, ".pi", "agent", "mcp.json")

/** A server every client gets: a name and a streamable-HTTP URL, nothing else. */
export type McpServer = { readonly name: string; readonly url: string }

/** Keys a mirrored entry may have. Anything else might carry a credential. */
const SAFE_KEYS = new Set(["url", "description", "type", "enabled", "exposure", "toolExposure", "timeout"])

const ManifestJson = Schema.parseJson(
  Schema.Struct({
    mcpServers: Schema.Record({ key: Schema.String, value: Schema.Record({ key: Schema.String, value: Schema.Unknown }) }),
  }),
)
/** The fields a mirrored entry is read for; its other keys were vetted against SAFE_KEYS. */
const MirroredEntry = Schema.Struct({ url: Schema.String, enabled: Schema.optional(Schema.Boolean) })

export type Manifest = {
  readonly servers: readonly McpServer[]
  /** Entries left out, with the reason: not a bare URL, or disabled. */
  readonly refused: readonly { readonly name: string; readonly reason: string }[]
}

/** Pure, so the public-repo rules are testable without a file. */
export function parseManifest(text: string): Either.Either<Manifest, string> {
  const decoded = Schema.decodeUnknownEither(ManifestJson)(text)
  if (Either.isLeft(decoded)) return Either.left(`${MANIFEST_PATH} is not valid MCP JSON`)

  const servers: McpServer[] = []
  const refused: { name: string; reason: string }[] = []
  for (const [name, entry] of Object.entries(decoded.right.mcpServers)) {
    const extra = Object.keys(entry).filter((key) => !SAFE_KEYS.has(key))
    if (extra.length > 0) {
      refused.push({ name, reason: `has ${extra.join(", ")} (only bare-URL servers are mirrored)` })
      continue
    }
    const fields = Schema.decodeUnknownEither(MirroredEntry)(entry)
    if (Either.isLeft(fields)) {
      refused.push({ name, reason: "no url" })
      continue
    }
    if (fields.right.enabled === false) {
      refused.push({ name, reason: "disabled" })
      continue
    }
    if (!fields.right.url.startsWith("https://")) {
      refused.push({ name, reason: "url is not https" })
      continue
    }
    servers.push({ name, url: fields.right.url })
  }
  return Either.right({ servers, refused })
}

export async function readManifest(): Promise<Either.Either<Manifest, string>> {
  let text: string
  try {
    text = await readFile(MANIFEST_PATH, "utf8")
  } catch {
    return Either.left(`${MANIFEST_PATH} missing (dotfiles stow)`)
  }
  return parseManifest(text)
}

// ─── clients ────────────────────────────────────────────────────────

/** What a client reports for one server name. */
export type Found = { readonly url: string; readonly signedIn: boolean | undefined }

export type ServerState =
  | { readonly kind: "missing" }
  | { readonly kind: "other-url"; readonly url: string }
  | { readonly kind: "present"; readonly signedIn: boolean | undefined }

/** Pure: the manifest's server against what the client has under that name. */
export function classify(server: McpServer, found: Found | undefined): ServerState {
  if (found === undefined) return { kind: "missing" }
  if (found.url !== server.url) return { kind: "other-url", url: found.url }
  return { kind: "present", signedIn: found.signedIn }
}

type Client = {
  readonly bin: string
  readonly label: string
  /** The client's entry under this name, or undefined when it has none. */
  readonly find: (name: string) => Promise<Found | undefined>
  /** Add, removing the client's entry under this name first when `replace`. */
  readonly add: (server: McpServer, replace: boolean) => Promise<boolean>
  readonly signInHint: (server: McpServer) => string
}

/** One labelled line of `claude mcp get <name>`, e.g. `  URL: https://…`. */
const field = (text: string, label: string): string | undefined =>
  text.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, "m"))?.[1]?.trim()

const claude: Client = {
  bin: "claude",
  label: "Claude Code",
  find: async (name) => {
    const got = await probe(["claude", "mcp", "get", name])
    // A same-named project or local entry is not ours; only user scope counts.
    if (!got.ok || !/^\s*Scope:\s*User/m.test(got.stdout)) return undefined
    const status = field(got.stdout, "Status") ?? ""
    return {
      url: field(got.stdout, "URL") ?? "",
      signedIn: /connected/i.test(status) ? true : /auth/i.test(status) ? false : undefined,
    }
  },
  add: async ({ name, url }, replace) => {
    if (replace && (await runInteractiveCode(["claude", "mcp", "remove", "--scope", "user", name])) !== 0) return false
    return (await runInteractiveCode(["claude", "mcp", "add", "--transport", "http", "--scope", "user", name, url])) === 0
  },
  signInHint: () => "sign in from Claude Code: /mcp",
}

const CodexServerJson = Schema.parseJson(
  Schema.Struct({ transport: Schema.Struct({ url: Schema.optional(Schema.NullOr(Schema.String)) }) }),
)
const CodexListJson = Schema.parseJson(
  Schema.Array(Schema.Struct({ name: Schema.String, auth_status: Schema.optional(Schema.NullOr(Schema.String)) })),
)

const codex: Client = {
  bin: "codex",
  label: "Codex",
  find: async (name) => {
    const got = await probe(["codex", "mcp", "get", name, "--json"])
    const server = Schema.decodeUnknownEither(CodexServerJson)(got.stdout)
    if (!got.ok || Either.isLeft(server)) return undefined
    const list = Schema.decodeUnknownEither(CodexListJson)((await probe(["codex", "mcp", "list", "--json"])).stdout)
    const auth = Either.isRight(list) ? list.right.find((s) => s.name === name)?.auth_status : undefined
    return {
      url: server.right.transport.url ?? "",
      // `not_logged_in` is the one answer that means "sign in"; others mean a
      // credential is configured. Unknown when the list could not be read.
      signedIn: auth === undefined || auth === null ? undefined : auth !== "not_logged_in",
    }
  },
  // `codex mcp add` starts the OAuth sign-in itself and waits for the browser,
  // so it needs the real terminal.
  add: async ({ name, url }, replace) => {
    if (replace && (await runInteractiveCode(["codex", "mcp", "remove", name])) !== 0) return false
    return (await runInteractiveCode(["codex", "mcp", "add", name, "--url", url], { needsStdin: true })) === 0
  },
  signInHint: ({ name }) => `codex mcp login ${name}`,
}

export const CLIENTS: readonly Client[] = [claude, codex]

/** One line per client and server, for `status` and doctor. */
export type Row = { readonly client: string; readonly server: McpServer; readonly state: ServerState | "no-client" }

export async function inspect(servers: readonly McpServer[]): Promise<Row[]> {
  return Promise.all(
    CLIENTS.flatMap((client) =>
      servers.map(async (server): Promise<Row> => {
        if (!(await commandExists(client.bin))) return { client: client.label, server, state: "no-client" }
        return { client: client.label, server, state: classify(server, await client.find(server.name)) }
      }),
    ),
  )
}

/** A row as a line of text, and whether it needs attention. */
export type RowReport = { readonly ok: boolean; readonly text: string }

export function describeRow(row: Row): RowReport {
  const where = `${row.client} · ${row.server.name}`
  if (row.state === "no-client") return { ok: true, text: `${where} — client not installed, skipped` }
  switch (row.state.kind) {
    case "missing":
      return { ok: false, text: `${where} — missing (dotfiles mcp install)` }
    case "other-url":
      return { ok: false, text: `${where} — points at ${row.state.url}, manifest says ${row.server.url} (dotfiles mcp install)` }
    case "present":
      return row.state.signedIn === false
        ? { ok: false, text: `${where} — added, needs sign-in` }
        : { ok: true, text: `${where} — ${row.state.signedIn ? "signed in" : "added"}` }
  }
}

// ─── command ────────────────────────────────────────────────────────

async function install(manifest: Manifest): Promise<number> {
  let failed = 0
  for (const client of CLIENTS) {
    if (!(await commandExists(client.bin))) {
      printInfo(`${client.label} not installed — skipped`)
      continue
    }
    for (const server of manifest.servers) {
      const state = classify(server, await client.find(server.name))
      if (state.kind === "present") {
        if (state.signedIn === false) printWarning(`${client.label} · ${server.name} — needs sign-in: ${client.signInHint(server)}`)
        else printSuccess(`${client.label} · ${server.name} — already set up`)
        continue
      }
      // The manifest is the source: a different URL under our name is replaced.
      const ok = await client.add(server, state.kind === "other-url")
      if (!ok) {
        failed++
        printError(`${client.label} · ${server.name} — add failed`)
        continue
      }
      printSuccess(`${client.label} · ${server.name} — added (${server.url})`)
      const after = classify(server, await client.find(server.name))
      if (after.kind === "present" && after.signedIn !== true) printInfo(`  then ${client.signInHint(server)}`)
    }
  }
  return failed === 0 ? 0 : 1
}

async function status(manifest: Manifest): Promise<number> {
  const rows = await inspect(manifest.servers)
  let issues = 0
  for (const row of rows) {
    const { ok, text } = describeRow(row)
    if (ok) printSuccess(text)
    else {
      issues++
      printWarning(text)
    }
  }
  printInfo("Pi reads the manifest directly through stow: pi mcp list")
  return issues === 0 ? 0 : 1
}

export async function mcp(args: string[]): Promise<number> {
  const [sub = "status"] = args
  if (sub !== "install" && sub !== "status") {
    printError(`usage: dotfiles mcp [install|status]  (got ${sub})`)
    return 1
  }
  const manifest = await readManifest()
  if (Either.isLeft(manifest)) {
    printError(manifest.left)
    return 1
  }
  for (const { name, reason } of manifest.right.refused) printWarning(`${name} not mirrored — ${reason}`)
  if (manifest.right.servers.length === 0) {
    printInfo("no servers to mirror")
    return 0
  }
  return sub === "install" ? install(manifest.right) : status(manifest.right)
}
