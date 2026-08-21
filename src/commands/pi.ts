// `dotfiles pi` — reconcile and deliberately update Pi extensions.
//
// The stowed settings file is the manifest. Pi's package directory is runtime
// state, so this command rebuilds it from that manifest rather than tracking it.
import { Either, Schema } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { HOME, HOME_DIR } from "../lib/env.ts"
import { commandExists, probe, runInteractiveCode, type RunResult } from "../lib/exec.ts"
import { confirm, isInteractive, printError, printInfo, printRaw, printSuccess, printWarning } from "../lib/ui.ts"

const DEFAULT_SETTINGS_PATH = join(HOME_DIR, ".pi", "agent", "settings.json")
const DEFAULT_NPM_DIR = join(HOME, ".pi", "agent", "npm")
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** One npm-hosted Pi package declared in the tracked settings. */
export type PiPlugin = {
  readonly source: string
  readonly name: string
  readonly version: string | undefined
}

/** A declared Pi package and the version currently present on disk. */
export type PiPluginStatus = PiPlugin & {
  readonly installedVersion: string | undefined
}

/** Expected failure while reading or parsing the tracked Pi settings. */
export class PiSettingsError extends Error {
  readonly _tag = "PiSettingsError" as const

  constructor(message: string) {
    super(message)
  }
}

const PiSettingsJson = Schema.parseJson(
  Schema.Struct({
    lastChangelogVersion: Schema.optional(Schema.String),
    theme: Schema.optional(Schema.String),
    defaultProvider: Schema.optional(Schema.String),
    defaultModel: Schema.optional(Schema.String),
    defaultThinkingLevel: Schema.optional(Schema.String),
    quietStartup: Schema.optional(Schema.Boolean),
    npmCommand: Schema.optional(Schema.Array(Schema.String)),
    packages: Schema.Array(Schema.String),
  }),
)
const InstalledPackageJson = Schema.parseJson(Schema.Struct({ version: Schema.String }))
const RegistryVersionJson = Schema.parseJson(Schema.String)

type ParsedSettings = {
  readonly rawText: string
  readonly plugins: readonly PiPlugin[]
}

type PiResult<T> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: PiSettingsError }

/** Process and filesystem operations used by Pi package management. */
export type PiPluginRuntime = {
  readonly commandExists: (bin: string) => Promise<boolean>
  readonly probe: (command: string[]) => Promise<RunResult>
  readonly runInteractiveCode: (command: string[], options?: { cwd?: string }) => Promise<number>
  readonly readFile: (path: string) => Promise<string>
  readonly writeFile: (path: string, contents: string) => Promise<void>
  readonly mkdir: (path: string) => Promise<void>
}

const defaultRuntime: PiPluginRuntime = {
  commandExists,
  probe,
  runInteractiveCode,
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, contents) => writeFile(path, contents, "utf8"),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
}

/** Paths and process operations that may be replaced by integration tests. */
export type PiPluginOptions = {
  readonly settingsPath?: string
  readonly npmDir?: string
  readonly runtime?: PiPluginRuntime
}

/** Parse an npm Pi package source into its package name and optional version. */
export function parseNpmPackageSource(source: string): PiPlugin | undefined {
  if (!source.startsWith("npm:")) return undefined
  const spec = source.slice("npm:".length)
  if (spec === "") return undefined

  const separator = spec.lastIndexOf("@")
  const hasVersion = separator > 0
  const name = hasVersion ? spec.slice(0, separator) : spec
  const version = hasVersion ? spec.slice(separator + 1) : undefined
  if (name === "" || version === "") return undefined
  return { source, name, version }
}

function parseSettings(text: string): PiResult<ParsedSettings> {
  const decoded = Schema.decodeUnknownEither(PiSettingsJson)(text)
  if (Either.isLeft(decoded)) {
    return { _tag: "err", error: new PiSettingsError("Pi settings do not match the managed format") }
  }

  const settings = decoded.right
  const plugins: PiPlugin[] = []
  for (const entry of settings.packages) {
    const plugin = parseNpmPackageSource(entry)
    if (!plugin) {
      return {
        _tag: "err",
        error: new PiSettingsError(`dotfiles pi currently supports npm packages only: ${entry}`),
      }
    }
    plugins.push(plugin)
  }
  return { _tag: "ok", value: { rawText: text, plugins } }
}

async function loadSettings(path: string, runtime: PiPluginRuntime): Promise<PiResult<ParsedSettings>> {
  try {
    return parseSettings(await runtime.readFile(path))
  } catch {
    return { _tag: "err", error: new PiSettingsError(`Cannot read Pi settings: ${path}`) }
  }
}

async function installedVersion(
  npmDir: string,
  packageName: string,
  runtime: PiPluginRuntime,
): Promise<string | undefined> {
  try {
    const text = await runtime.readFile(join(npmDir, "node_modules", packageName, "package.json"))
    const decoded = Schema.decodeUnknownEither(InstalledPackageJson)(text)
    return Either.isRight(decoded) ? decoded.right.version : undefined
  } catch {
    return undefined
  }
}

/** Read declared plugins and pair them with their locally installed versions. */
export async function readPiPluginStatuses(
  options: PiPluginOptions = {},
): Promise<PiResult<readonly PiPluginStatus[]>> {
  const runtime = options.runtime ?? defaultRuntime
  const settings = await loadSettings(options.settingsPath ?? DEFAULT_SETTINGS_PATH, runtime)
  if (settings._tag === "err") return settings
  const npmDir = options.npmDir ?? DEFAULT_NPM_DIR
  const statuses = await Promise.all(
    settings.value.plugins.map(async (plugin) => ({
      ...plugin,
      installedVersion: await installedVersion(npmDir, plugin.name, runtime),
    })),
  )
  return { _tag: "ok", value: statuses }
}

function exactPinError(plugin: PiPlugin): string | undefined {
  if (!plugin.version || !EXACT_VERSION.test(plugin.version)) {
    return `${plugin.name} is not pinned to an exact version (${plugin.source})`
  }
  return undefined
}

async function verify(options: PiPluginOptions): Promise<number> {
  const statuses = await readPiPluginStatuses(options)
  if (statuses._tag === "err") {
    printError(statuses.error.message)
    return 1
  }

  const problems: string[] = []
  for (const status of statuses.value) {
    const pinProblem = exactPinError(status)
    if (pinProblem) problems.push(pinProblem)
    else if (!status.installedVersion) problems.push(`${status.name}@${status.version} is not installed`)
    else if (status.installedVersion !== status.version) {
      problems.push(`${status.name}: declared ${status.version}, installed ${status.installedVersion}`)
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) printWarning(problem)
    return 1
  }
  printSuccess(`${statuses.value.length} Pi plugin(s) installed at their exact pins`)
  return 0
}

async function status(options: PiPluginOptions): Promise<number> {
  const statuses = await readPiPluginStatuses(options)
  if (statuses._tag === "err") {
    printError(statuses.error.message)
    return 1
  }
  for (const plugin of statuses.value) {
    const declared = plugin.version ?? "floating"
    const installed = plugin.installedVersion ?? "missing"
    const marker = plugin.version === plugin.installedVersion ? "✓" : "!"
    printRaw(`  ${marker} ${plugin.name}  declared ${declared} · installed ${installed}`)
  }
  return statuses.value.every(
    (plugin) => exactPinError(plugin) === undefined && plugin.version === plugin.installedVersion,
  )
    ? 0
    : 1
}

function pinnedSpecs(plugins: readonly PiPlugin[]): string[] | undefined {
  const specs: string[] = []
  for (const plugin of plugins) {
    if (exactPinError(plugin)) return undefined
    specs.push(`${plugin.name}@${plugin.version}`)
  }
  return specs
}

async function install(options: PiPluginOptions): Promise<number> {
  const runtime = options.runtime ?? defaultRuntime
  const settings = await loadSettings(options.settingsPath ?? DEFAULT_SETTINGS_PATH, runtime)
  if (settings._tag === "err") {
    printError(settings.error.message)
    return 1
  }
  const specs = pinnedSpecs(settings.value.plugins)
  if (!specs) {
    printError("Every Pi npm package must have an exact version before installation")
    return 1
  }
  if (!(await runtime.commandExists("bun"))) {
    printError("Bun is required to install Pi plugins")
    return 1
  }

  const npmDir = options.npmDir ?? DEFAULT_NPM_DIR
  await runtime.mkdir(npmDir)
  printInfo(`Installing ${specs.length} pinned Pi plugin(s) with Bun`)
  const code = await runtime.runInteractiveCode(["bun", "add", "--exact", ...specs], { cwd: npmDir })
  if (code !== 0) {
    printError("Pi plugin installation failed")
    return code
  }
  return await verify(options)
}

async function latestVersion(name: string, runtime: PiPluginRuntime): Promise<string | undefined> {
  const result = await runtime.probe(["bun", "pm", "view", name, "version", "--json"])
  if (!result.ok) return undefined
  const decoded = Schema.decodeUnknownEither(RegistryVersionJson)(result.stdout)
  return Either.isRight(decoded) && EXACT_VERSION.test(decoded.right) ? decoded.right : undefined
}

function settingsWithVersions(
  settings: ParsedSettings,
  versions: ReadonlyMap<string, string>,
): PiResult<string> {
  let text = settings.rawText
  for (const plugin of settings.plugins) {
    const version = versions.get(plugin.name)
    if (!version) continue
    const needle = JSON.stringify(plugin.source)
    const occurrences = text.split(needle).length - 1
    if (occurrences !== 1) {
      return {
        _tag: "err",
        error: new PiSettingsError(`Expected one declaration for ${plugin.name}, found ${occurrences}`),
      }
    }
    text = text.replace(needle, JSON.stringify(`npm:${plugin.name}@${version}`))
  }
  return { _tag: "ok", value: text.endsWith("\n") ? text : `${text}\n` }
}

async function update(argv: readonly string[], options: PiPluginOptions): Promise<number> {
  const runtime = options.runtime ?? defaultRuntime
  const settingsPath = options.settingsPath ?? DEFAULT_SETTINGS_PATH
  const settings = await loadSettings(settingsPath, runtime)
  if (settings._tag === "err") {
    printError(settings.error.message)
    return 1
  }

  const available: Array<{ plugin: PiPlugin; latest: string }> = []
  for (const plugin of settings.value.plugins) {
    const latest = await latestVersion(plugin.name, runtime)
    if (!latest) {
      printWarning(`Could not look up ${plugin.name}`)
      continue
    }
    if (latest !== plugin.version) available.push({ plugin, latest })
  }
  if (available.length === 0) {
    printSuccess("Pi plugins are up to date")
    return 0
  }

  const updateAll = argv.includes("--all")
  const selected = new Map<string, string>()
  for (const candidate of available) {
    const change = `${candidate.plugin.name}: ${candidate.plugin.version ?? "floating"} → ${candidate.latest}`
    if (updateAll) {
      printInfo(change)
      selected.set(candidate.plugin.name, candidate.latest)
    } else if (isInteractive() && (await confirm(`Update ${change}?`, false))) {
      selected.set(candidate.plugin.name, candidate.latest)
    } else {
      printInfo(`${change} (not selected)`)
    }
  }
  if (selected.size === 0) {
    printInfo("No Pi plugin updates selected")
    return 0
  }

  const nextSettings = settingsWithVersions(settings.value, selected)
  if (nextSettings._tag === "err") {
    printError(nextSettings.error.message)
    return 1
  }
  const nextPackages = settings.value.plugins.map((plugin) => {
    const version = selected.get(plugin.name) ?? plugin.version
    return { ...plugin, version, source: version ? `npm:${plugin.name}@${version}` : plugin.source }
  })
  const specs = pinnedSpecs(nextPackages)
  if (!specs) {
    printError("Every Pi npm package must have an exact version before updating")
    return 1
  }

  const npmDir = options.npmDir ?? DEFAULT_NPM_DIR
  await runtime.mkdir(npmDir)
  const code = await runtime.runInteractiveCode(["bun", "add", "--exact", ...specs], { cwd: npmDir })
  if (code !== 0) {
    printError("Pi plugin update failed; tracked pins were not changed")
    return code
  }

  try {
    await runtime.writeFile(settingsPath, nextSettings.value)
  } catch (cause) {
    printError(`Plugins installed, but the tracked settings could not be updated: ${String(cause)}`)
    return 1
  }
  printSuccess(`Updated ${selected.size} Pi plugin pin(s)`)
  return 0
}

/** Manage Pi plugins declared in the stowed settings file. */
export async function piPlugins(argv: string[] = [], options: PiPluginOptions = {}): Promise<number> {
  const [subcommand = "status", ...rest] = argv
  switch (subcommand) {
    case "install":
      return await install(options)
    case "status":
      return await status(options)
    case "update":
      return await update(rest, options)
    case "verify":
      return await verify(options)
    default:
      printError("usage: dotfiles pi {install|status|update [--all]|verify}")
      return 1
  }
}
