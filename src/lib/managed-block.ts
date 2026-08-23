// An idempotent marker-delimited block inside a file someone else owns.
//
// Generalised out of commands/ssh.ts, which needed it for ~/.ssh/config. The
// second use is Omarchy's ghostty/foot configs: `omarchy refresh config` rewrites
// those from the package default, and they carry a load-bearing theme include we
// must not replace. So we don't own the file — we append one include line to it
// and re-apply after a refresh.
export type Markers = { begin: string; end: string }

export const markersFor = (name: string): Markers => ({
  begin: `# >>> dotfiles managed ${name} >>>`,
  end: `# <<< dotfiles managed ${name} <<<`,
})

/** Pure, so idempotency is testable without touching a real config. */
export function stripManagedBlock(config: string, markers: readonly Markers[]): string {
  const out: string[] = []
  let closing: string | null = null

  for (const line of config.split("\n")) {
    if (closing !== null) {
      if (line === closing) closing = null
      continue
    }
    const opened = markers.find((m) => m.begin === line)
    if (opened) {
      closing = opened.end
      continue
    }
    out.push(line)
  }
  return out.join("\n")
}

/** Strip then append — the whole update, as one pure function. */
export function applyManagedBlock(
  config: string,
  body: readonly string[],
  markers: Markers,
  legacy: readonly Markers[] = [],
): string {
  const stripped = stripManagedBlock(config, [markers, ...legacy])
  const trimmed = stripped.replace(/\n+$/, "")
  const prefix = trimmed === "" ? "" : trimmed + "\n"
  const block = [markers.begin, ...body, markers.end].join("\n")
  return `${prefix}${block}\n`
}
