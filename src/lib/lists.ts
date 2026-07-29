// Parsers for the plain-text package manifests in packages/.
// These replace `while read` loops with inline comment-stripping in bash.

export type RustEntry = { kind: "toolchain" | "component" | "target" | "esp"; value: string }

/** packages/rust.txt — `<kind> <value>` per line, `#` comments. */
export function parseRustList(text: string): RustEntry[] {
  const entries: RustEntry[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue
    const [kind, ...rest] = line.split(/\s+/)
    const value = rest.join(" ")
    if (!kind || !value) continue
    if (kind === "toolchain" || kind === "component" || kind === "target" || kind === "esp") {
      entries.push({ kind, value })
    }
  }
  return entries
}

/** packages/bun-global.txt — one package per line, inline `#` comments stripped. */
export function parseSimpleList(text: string): string[] {
  const items: string[] = []
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0]?.trim() ?? ""
    if (line !== "") items.push(line)
  }
  return items
}
