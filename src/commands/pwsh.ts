// PowerShell modules from packages/pwsh.txt: install, upgrade, and report state.
//
// pwsh itself is a native package (brew "powershell"); its modules are not, and
// PSResourceGet keeps no manifest of what was asked for. Without this file a
// fresh machine has none of them, and nothing notices an ad-hoc Install-Module.
//
// Everything runs in CurrentUser scope (~/.local/share/powershell/Modules), so
// no step needs sudo. `-NonInteractive` turns any prompt (untrusted repository,
// licence acceptance) into an error. Without it, the child waits on a prompt that
// nobody sees in the output pane.
import { join } from "node:path"
import { PACKAGES_DIR } from "../lib/env.ts"
import { probe } from "../lib/exec.ts"
import { parseSimpleList } from "../lib/lists.ts"

export const PWSH_MANIFEST = join(PACKAGES_DIR, "pwsh.txt")

export async function readPwshManifest(): Promise<string[]> {
  const file = Bun.file(PWSH_MANIFEST)
  return (await file.exists()) ? parseSimpleList(await file.text()) : []
}

const pwsh = (script: string): string[] => [
  "pwsh",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  `$ErrorActionPreference = 'Stop'; ${script}`,
]

/** PowerShell single-quoted literal. Module names never contain quotes, but be safe. */
const quote = (s: string): string => `'${s.replaceAll("'", "''")}'`
const nameList = (names: readonly string[]): string => names.map(quote).join(",")

/** One command per module: a single unpublished name must not cost the rest. */
export const installCommand = (name: string): string[] =>
  pwsh(`Install-PSResource -Name ${quote(name)} -Scope CurrentUser -TrustRepository -AcceptLicense`)

/** Upgrades the declared modules; their dependencies follow the new versions. */
export const updateCommand = (names: readonly string[]): string[] =>
  pwsh(`Update-PSResource -Name ${nameList(names)} -Scope CurrentUser -TrustRepository -AcceptLicense`)

/**
 * Removes every version but the newest, for every user-scope module.
 *
 * Update-PSResource installs alongside the old version and never removes it.
 * Microsoft.Graph alone is ~40 modules, so each Graph release would otherwise
 * leave another full copy behind. Import-Module picks the newest version anyway,
 * so the old ones are only disk use.
 */
export const pruneCommand = (): string[] =>
  pwsh(
    "Get-InstalledPSResource -Scope CurrentUser | Group-Object Name | Where-Object Count -gt 1 | ForEach-Object { " +
      "$_.Group | Sort-Object Version -Descending | Select-Object -Skip 1 | ForEach-Object { " +
      'Uninstall-PSResource -Name $_.Name -Version "[$($_.Version)]" -Scope CurrentUser -SkipDependencyCheck; ' +
      'Write-Host "removed $($_.Name) $($_.Version)" } }',
  )

export type PwshModule = { name: string; versions: string[]; requires: string[] }

/**
 * User-scope modules, each with every installed version and the modules its
 * manifests require. Null when pwsh cannot answer.
 *
 * `requires` comes from the module manifests (RequiredModules), not from
 * Get-InstalledPSResource, whose Dependencies field is empty for installed
 * modules.
 */
export async function installedPwshModules(): Promise<PwshModule[] | null> {
  const res = await probe(
    pwsh(
      "$r = @(Get-InstalledPSResource -Scope CurrentUser); $req = @{}; " +
        "if ($r.Count -gt 0) { Get-Module -ListAvailable -Name @($r.Name | Select-Object -Unique) | " +
        "ForEach-Object { $req[$_.Name] += @($_.RequiredModules | ForEach-Object Name) } }; " +
        "@($r | Group-Object Name | ForEach-Object { [pscustomobject]@{ name = $_.Name; " +
        'versions = @($_.Group | ForEach-Object { "$($_.Version)" }); ' +
        "requires = @($req[$_.Name] | Where-Object { $_ } | Select-Object -Unique) } }) | " +
        "ConvertTo-Json -Depth 3 -Compress -AsArray",
    ),
  )
  if (!res.ok) return null
  try {
    return JSON.parse(res.stdout) as PwshModule[]
  } catch {
    return null
  }
}

/**
 * Declared modules not installed, and installed modules nobody declared.
 * A module that another installed module requires is never "untracked": it came
 * with its parent, and the parent is what the manifest names.
 */
export function pwshDrift(
  declared: readonly string[],
  installed: readonly PwshModule[],
): { missing: string[]; untracked: string[] } {
  const lower = (s: string) => s.toLowerCase()
  const have = new Set(installed.map((m) => lower(m.name)))
  const wanted = new Set(declared.map(lower))
  const required = new Set(installed.flatMap((m) => m.requires.map(lower)))
  return {
    missing: declared.filter((d) => !have.has(lower(d))),
    untracked: installed
      .map((m) => m.name)
      .filter((n) => !wanted.has(lower(n)) && !required.has(lower(n))),
  }
}
