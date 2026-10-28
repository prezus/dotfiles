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
/** Where Pi clones `git:` packages: `<gitDir>/<host>/<owner>/<repo>`. */
const DEFAULT_GIT_DIR = join(HOME, ".pi", "agent", "git")
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
/** A git ref Pi treats as pinned: a full commit SHA or a release tag. A branch is not. */
const PINNED_GIT_REF = /^(?:[0-9a-f]{40}|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/
const RELEASE_TAG = /^v?\d+\.\d+\.\d+$/

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

/**
 * One git-hosted Pi package declared in the tracked settings. Pi clones and
 * checks these out itself, so this side only pins, checks, and asks Pi to
 * reconcile; it never touches the clone.
 */
export type PiGitPackage = {
  readonly source: string
  /** `host/owner/repo`, which is also the clone's path under the git dir. */
  readonly repo: string
  readonly ref: string | undefined
}

/** A declared git package, the commit its ref names, and the commit checked out. */
export type PiGitPackageStatus = PiGitPackage & {
  readonly pinnedCommit: string | undefined
  readonly installedCommit: string | undefined
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
  readonly gitPackages: readonly PiGitPackage[]
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
  readonly gitDir?: string
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

/** Parse a `git:host/owner/repo[@ref]` Pi package source. */
export function parseGitPackageSource(source: string): PiGitPackage | undefined {
  if (!source.startsWith("git:")) return undefined
  const spec = source.slice("git:".length)
  const separator = spec.lastIndexOf("@")
  const hasRef = separator > spec.lastIndexOf("/")
  const repo = hasRef ? spec.slice(0, separator) : spec
  const ref = hasRef ? spec.slice(separator + 1) : undefined
  if (repo.split("/").filter(Boolean).length !== 3 || ref === "") return undefined
  return { source, repo, ref }
}

function parseSettings(text: string): PiResult<ParsedSettings> {
  const decoded = Schema.decodeUnknownEither(PiSettingsJson)(text)
  if (Either.isLeft(decoded)) {
    return { _tag: "err", error: new PiSettingsError("Pi settings do not match the managed format") }
  }

  const settings = decoded.right
  const plugins: PiPlugin[] = []
  const gitPackages: PiGitPackage[] = []
  for (const entry of settings.packages) {
    const plugin = parseNpmPackageSource(entry)
    if (plugin) {
      plugins.push(plugin)
      continue
    }
    const gitPackage = parseGitPackageSource(entry)
    if (gitPackage) {
      gitPackages.push(gitPackage)
      continue
    }
    return {
      _tag: "err",
      error: new PiSettingsError(`dotfiles pi supports npm: and git:host/owner/repo packages only: ${entry}`),
    }
  }
  return { _tag: "ok", value: { rawText: text, plugins, gitPackages } }
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

async function commitOf(clone: string, rev: string, runtime: PiPluginRuntime): Promise<string | undefined> {
  const result = await runtime.probe(["git", "-C", clone, "rev-parse", "--verify", "--quiet", `${rev}^{commit}`])
  const commit = result.stdout.trim()
  return result.ok && commit !== "" ? commit : undefined
}

/**
 * Read declared git packages and pair them with Pi's checkout. The pinned
 * commit is resolved inside the clone, so a tag Pi has not fetched yet reads
 * as off-pin rather than reaching for the network.
 */
export async function readPiGitPackageStatuses(
  options: PiPluginOptions = {},
): Promise<PiResult<readonly PiGitPackageStatus[]>> {
  const runtime = options.runtime ?? defaultRuntime
  const settings = await loadSettings(options.settingsPath ?? DEFAULT_SETTINGS_PATH, runtime)
  if (settings._tag === "err") return settings
  const gitDir = options.gitDir ?? DEFAULT_GIT_DIR
  const statuses = await Promise.all(
    settings.value.gitPackages.map(async (pkg) => {
      const clone = join(gitDir, pkg.repo)
      return {
        ...pkg,
        pinnedCommit: pkg.ref ? await commitOf(clone, pkg.ref, runtime) : undefined,
        installedCommit: await commitOf(clone, "HEAD", runtime),
      }
    }),
  )
  return { _tag: "ok", value: statuses }
}

function exactPinError(plugin: PiPlugin): string | undefined {
  if (!plugin.version || !EXACT_VERSION.test(plugin.version)) {
    return `${plugin.name} is not pinned to an exact version (${plugin.source})`
  }
  return undefined
}

function gitPinError(pkg: PiGitPackage): string | undefined {
  if (!pkg.ref || !PINNED_GIT_REF.test(pkg.ref)) {
    return `${pkg.repo} is not pinned to a release tag or full commit (${pkg.source})`
  }
  return undefined
}

/** Every reason a git package is not checked out at its pin, or undefined. */
function gitDriftError(status: PiGitPackageStatus): string | undefined {
  const pinProblem = gitPinError(status)
  if (pinProblem) return pinProblem
  if (!status.installedCommit) return `${status.repo}@${status.ref} is not installed`
  if (status.installedCommit !== status.pinnedCommit) {
    return `${status.repo}: declared ${status.ref}, checked out ${status.installedCommit.slice(0, 10)}`
  }
  return undefined
}

async function verify(options: PiPluginOptions): Promise<number> {
  const statuses = await readPiPluginStatuses(options)
  if (statuses._tag === "err") {
    printError(statuses.error.message)
    return 1
  }

  const gitStatuses = await readPiGitPackageStatuses(options)
  if (gitStatuses._tag === "err") {
    printError(gitStatuses.error.message)
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
  for (const status of gitStatuses.value) {
    const problem = gitDriftError(status)
    if (problem) problems.push(problem)
  }

  if (problems.length > 0) {
    for (const problem of problems) printWarning(problem)
    return 1
  }
  const total = statuses.value.length + gitStatuses.value.length
  printSuccess(`${total} Pi plugin(s) installed at their exact pins`)
  return 0
}

async function status(options: PiPluginOptions): Promise<number> {
  const statuses = await readPiPluginStatuses(options)
  if (statuses._tag === "err") {
    printError(statuses.error.message)
    return 1
  }
  const gitStatuses = await readPiGitPackageStatuses(options)
  if (gitStatuses._tag === "err") {
    printError(gitStatuses.error.message)
    return 1
  }
  for (const plugin of statuses.value) {
    const declared = plugin.version ?? "floating"
    const installed = plugin.installedVersion ?? "missing"
    const marker = plugin.version === plugin.installedVersion ? "✓" : "!"
    printRaw(`  ${marker} ${plugin.name}  declared ${declared} · installed ${installed}`)
  }
  for (const pkg of gitStatuses.value) {
    const declared = pkg.ref ?? "floating"
    const installed = pkg.installedCommit?.slice(0, 10) ?? "missing"
    const marker = gitDriftError(pkg) === undefined ? "✓" : "!"
    printRaw(`  ${marker} ${pkg.repo}  declared ${declared} · checked out ${installed}`)
  }
  const npmOk = statuses.value.every(
    (plugin) => exactPinError(plugin) === undefined && plugin.version === plugin.installedVersion,
  )
  const gitOk = gitStatuses.value.every((pkg) => gitDriftError(pkg) === undefined)
  return npmOk && gitOk ? 0 : 1
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
  const unpinnedGit = settings.value.gitPackages.map(gitPinError).filter((e) => e !== undefined)
  if (unpinnedGit.length > 0) {
    for (const problem of unpinnedGit) printError(problem)
    return 1
  }

  if (specs.length > 0) {
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
  }

  const code = await reconcileGitPackages(settings.value.gitPackages, runtime)
  if (code !== 0) return code
  return await verify(options)
}

/** Ask Pi to clone or check out each git package at the ref the settings name. */
async function reconcileGitPackages(packages: readonly PiGitPackage[], runtime: PiPluginRuntime): Promise<number> {
  if (packages.length === 0) return 0
  if (!(await runtime.commandExists("pi"))) {
    printError("Pi is required to install git Pi packages")
    return 1
  }
  for (const pkg of packages) {
    printInfo(`Reconciling ${pkg.repo} at ${pkg.ref} with Pi`)
    const code = await runtime.runInteractiveCode(["pi", "update", "--extension", pkg.source])
    if (code !== 0) {
      printError(`Pi could not install ${pkg.source}`)
      return code
    }
  }
  return 0
}

async function latestVersion(name: string, runtime: PiPluginRuntime): Promise<string | undefined> {
  const result = await runtime.probe(["bun", "pm", "view", name, "version", "--json"])
  if (!result.ok) return undefined
  const decoded = Schema.decodeUnknownEither(RegistryVersionJson)(result.stdout)
  return Either.isRight(decoded) && EXACT_VERSION.test(decoded.right) ? decoded.right : undefined
}

/** The newest `vX.Y.Z` release tag upstream, or undefined when it cannot be read. */
async function latestReleaseTag(repo: string, runtime: PiPluginRuntime): Promise<string | undefined> {
  const result = await runtime.probe(["git", "ls-remote", "--tags", "--refs", `https://${repo}`])
  if (!result.ok) return undefined
  const tags = result.stdout
    .split("\n")
    .map((line) => line.split("refs/tags/")[1]?.trim() ?? "")
    .filter((tag) => RELEASE_TAG.test(tag))
  const parts = (tag: string) => tag.replace(/^v/, "").split(".").map(Number)
  tags.sort((a, b) => {
    const [x, y] = [parts(a), parts(b)]
    return (x[0]! - y[0]!) || (x[1]! - y[1]!) || (x[2]! - y[2]!)
  })
  return tags.at(-1)
}

/** Replace whole package sources in the settings text, keeping its formatting. */
function settingsWithSources(settings: ParsedSettings, replacements: ReadonlyMap<string, string>): PiResult<string> {
  let text = settings.rawText
  for (const [from, to] of replacements) {
    const needle = JSON.stringify(from)
    const occurrences = text.split(needle).length - 1
    if (occurrences !== 1) {
      return {
        _tag: "err",
        error: new PiSettingsError(`Expected one declaration for ${from}, found ${occurrences}`),
      }
    }
    text = text.replace(needle, JSON.stringify(to))
  }
  return { _tag: "ok", value: text.endsWith("\n") ? text : `${text}\n` }
}

type UpdateCandidate = {
  readonly label: string
  readonly from: string
  readonly to: string
  readonly source: string
  readonly nextSource: string
}

async function update(argv: readonly string[], options: PiPluginOptions): Promise<number> {
  const runtime = options.runtime ?? defaultRuntime
  const settingsPath = options.settingsPath ?? DEFAULT_SETTINGS_PATH
  const settings = await loadSettings(settingsPath, runtime)
  if (settings._tag === "err") {
    printError(settings.error.message)
    return 1
  }

  const available: UpdateCandidate[] = []
  for (const plugin of settings.value.plugins) {
    const latest = await latestVersion(plugin.name, runtime)
    if (!latest) {
      printWarning(`Could not look up ${plugin.name}`)
      continue
    }
    if (latest !== plugin.version) {
      const nextSource = `npm:${plugin.name}@${latest}`
      available.push({ label: plugin.name, from: plugin.version ?? "floating", to: latest, source: plugin.source, nextSource })
    }
  }
  for (const pkg of settings.value.gitPackages) {
    const latest = await latestReleaseTag(pkg.repo, runtime)
    if (!latest) {
      printWarning(`Could not look up release tags for ${pkg.repo}`)
      continue
    }
    if (latest !== pkg.ref) {
      const from = pkg.ref && /^[0-9a-f]{40}$/.test(pkg.ref) ? pkg.ref.slice(0, 10) : (pkg.ref ?? "floating")
      available.push({ label: pkg.repo, from, to: latest, source: pkg.source, nextSource: `git:${pkg.repo}@${latest}` })
    }
  }
  if (available.length === 0) {
    printSuccess("Pi plugins are up to date")
    return 0
  }

  const updateAll = argv.includes("--all")
  const selected = new Map<string, string>()
  for (const candidate of available) {
    const change = `${candidate.label}: ${candidate.from} → ${candidate.to}`
    if (updateAll) {
      printInfo(change)
      selected.set(candidate.source, candidate.nextSource)
    } else if (isInteractive() && (await confirm(`Update ${change}?`, false))) {
      selected.set(candidate.source, candidate.nextSource)
    } else {
      printInfo(`${change} (not selected)`)
    }
  }
  if (selected.size === 0) {
    printInfo("No Pi plugin updates selected")
    return 0
  }

  const nextSettings = settingsWithSources(settings.value, selected)
  if (nextSettings._tag === "err") {
    printError(nextSettings.error.message)
    return 1
  }
  const next = parseSettings(nextSettings.value)
  if (next._tag === "err") {
    printError(next.error.message)
    return 1
  }

  // npm packages install BEFORE the pins move, so a failed install changes nothing.
  if (settings.value.plugins.some((plugin) => selected.has(plugin.source))) {
    const specs = pinnedSpecs(next.value.plugins)
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
  }

  try {
    await runtime.writeFile(settingsPath, nextSettings.value)
  } catch (cause) {
    printError(`Plugins installed, but the tracked settings could not be updated: ${String(cause)}`)
    return 1
  }

  // Pi reconciles git packages from the settings file, so these pins have to
  // move first; a failure puts the original file back.
  const movedGit = next.value.gitPackages.filter((pkg) => [...selected.values()].includes(pkg.source))
  const gitCode = await reconcileGitPackages(movedGit, runtime)
  if (gitCode !== 0) {
    await runtime.writeFile(settingsPath, settings.value.rawText)
    printError("Git package update failed; tracked pins were restored (run `dotfiles pi install` to realign)")
    return gitCode
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
