/**
 * Secret Guard
 *
 * Catches an agent leaking or clobbering secrets, and the destructive accidents
 * that tend to come with them. Four layers:
 *
 * 1. Output redaction: every tool result (bash, grep, fff, web, codemode's nested
 *    calls) is scanned for known secret formats and masked before the model sees
 *    it. pi-cloak only masks `read`, by path; this masks by content, everywhere.
 *
 * 2. Secret files: a whole-file `write` over an existing secret file is blocked
 *    outright. The agent may have read it masked, and writing that back would
 *    replace real values with asterisks. `edit`, and creating a new one, ask first.
 *
 * 3. Risky bash: commands that touch secret files, dump the environment, reveal
 *    secrets (`gh auth token`, keychain lookups) or destroy work (`git reset --hard`,
 *    `git clean -f`, `rm -rf ~`) ask first, and are blocked when there is no UI.
 *
 * 4. 1Password: secrets may be injected (`op run`, `op inject -o`, `op read -o`),
 *    never printed where the agent reads them. Anything that would print one is
 *    blocked with the safe form in the reason, and `op` output is masked as a backstop.
 *
 * This catches habits and accidents, not a determined agent: `python -c` reading a
 * file is invisible to layer 3, and only known formats are caught by layer 1. An OS
 * sandbox is the real boundary (see Pi's examples/extensions/sandbox).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

export const REDACTED = "«secret masked by secret-guard»";

// High-confidence token formats. Each match is replaced whole.
const TOKEN_PATTERNS: RegExp[] = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, // OpenAI, Anthropic
	/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub
	/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
	/\bglpat-[A-Za-z0-9_-]{20,}\b/g, // GitLab
	/\bnpm_[A-Za-z0-9]{36}\b/g,
	/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key id
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
	/\bAIza[0-9A-Za-z_-]{35}\b/g, // Google
	/\b[rs]k_live_[0-9A-Za-z]{20,}\b/g, // Stripe
	/\bops_[A-Za-z0-9_-]{40,}/g, // 1Password service account
	/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
	/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
];

// `NAME=value` / `"name": "value"` where the name says secret and the value looks
// like one: long, no dots or spaces (so `process.env.X` and prose survive), and
// mixing letters and digits. Only the value is masked.
const ASSIGNMENT =
	/((?:[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CLIENT_?SECRET)[A-Za-z0-9_]*|"[A-Za-z]*(?:[Ss]ecret|[Tt]oken|[Pp]assword|[Aa]pi[Kk]ey|[Aa]ccess[Kk]ey)")\s*[:=]\s*["']?)([A-Za-z0-9_\-+/=]{16,})/gi;
const looksSecret = (value: string): boolean => /[A-Za-z]/.test(value) && /\d/.test(value);

export function redact(text: string): { text: string; count: number } {
	let count = 0;
	let out = text;
	for (const pattern of TOKEN_PATTERNS) {
		out = out.replace(pattern, () => {
			count++;
			return REDACTED;
		});
	}
	out = out.replace(ASSIGNMENT, (match, name: string, value: string) => {
		if (!looksSecret(value)) return match;
		count++;
		return name + REDACTED;
	});
	return { text: out, count };
}

const SECRET_NAMES: RegExp[] = [
	/^\.env(?:\..+)?$/,
	/^\.dev\.vars$/,
	/^\.(?:netrc|npmrc|pypirc|pgpass)$/,
	/^auth\.json$/,
	/^web-search\.json$/,
	/^credentials(?:\.json)?$/,
	/^secrets?\.(?:json|ya?ml|toml)$/,
	/\.(?:pem|key|p12|pfx|jks|keystore)$/,
	/^id_(?:rsa|ed25519|ecdsa|dsa)$/,
];
const NOT_SECRET = /\.(?:example|sample|template|defaults?|dist)(?:\.|$)/;
const SECRET_DIRS = [".ssh", ".aws", ".gnupg", ".config/op", ".kube"].map((d) => `${homedir()}/${d}/`);

const expandHome = (p: string): string =>
	p === "~" ? homedir() : p.startsWith("~/") ? homedir() + p.slice(1) : p.replace(/^\$HOME(?=\/|$)/, homedir());

export function isSecretPath(raw: string, cwd: string): boolean {
	const path = resolve(cwd, expandHome(raw.replace(/^@/, "")));
	const name = basename(path);
	if (NOT_SECRET.test(name)) return false;
	return SECRET_NAMES.some((re) => re.test(name)) || SECRET_DIRS.some((dir) => path.startsWith(dir));
}


// Leading words that change nothing about what the rest of the segment does.
const PREFIXES = new Set(["sudo", "command", "exec", "time", "nohup"]);
// Commands that can name a secret file without revealing or changing it.
const HARMLESS = new Set(["ls", "test", "[", "stat", "file", "realpath", "dirname", "basename"]);
const SHELLS = new Set(["bash", "sh", "zsh", "fish"]);

interface Segment {
	words: string[];
	/** The segment as written, redirections included. */
	raw: string;
	/** Inside `$(...)` or backticks: its output feeds another command, not the agent. */
	substituted: boolean;
	/** The command this segment's stdout is piped into, if any. */
	pipedTo?: string;
}

function segments(command: string): Segment[] {
	const pieces = command.split(/(&&|\|\||[;|&\n]|\$\(|`)/);
	const out: Segment[] = [];
	for (let i = 0; i < pieces.length; i += 2) {
		const raw = pieces[i]!;
		const before = pieces[i - 1];
		let words = (raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
			.map((w) => w.replace(/^\d*[<>]+&?/, "").replace(/^["']|["']$/g, ""))
			.filter(Boolean);
		let k = 0;
		while (k < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k]!) || PREFIXES.has(words[k]!))) k++;
		// `env FOO=1 cmd` runs cmd; a bare `env` (or with only flags) dumps the environment.
		if (words[k] === "env" && words.slice(k + 1).some((w) => !w.startsWith("-") && !w.includes("="))) {
			k++;
			while (k < words.length && (words[k]!.startsWith("-") || words[k]!.includes("="))) k++;
		}
		words = words.slice(k);
		const next = pieces[i + 1] === "|" ? (pieces[i + 2] ?? "").trim().split(/\s+/)[0] : undefined;
		if (words.length > 0) out.push({ words, raw, substituted: before === "$(" || before === "`", pipedTo: next || undefined });
	}
	return out;
}

const has = (words: string[], ...flags: string[]) => words.some((w) => flags.includes(w));
const shortFlag = (words: string[], letter: string) => words.some((w) => /^-[A-Za-z]+$/.test(w) && w.includes(letter));
const DANGEROUS_RM_TARGET = /^(?:\/|~\/?|\$HOME\/?|\/Users\/?|\/home\/?|\*|\.\.?\/?|\.git\/?)$/;

export type Verdict = { action: "block" | "ask"; reason: string };
const block = (reason: string): Verdict => ({ action: "block", reason });
const ask = (reason: string): Verdict => ({ action: "ask", reason });

/**
 * 1Password: secrets may be injected into a process or a file, never printed where
 * the agent reads them. `op run` masks its child's output by default, so it is fine;
 * everything that writes a secret to stdout is blocked, with the safe form in the reason.
 */
// Commands that would show piped input to the agent rather than consume it.
const DISPLAYS = new Set(["cat", "head", "tail", "less", "more", "tee", "echo", "printf", "xxd", "od", "base64", "jq", "grep", "rg", "sed", "awk", "cut", "tr", "sort", "uniq", "wc", "pbcopy"]);
// `field[type]=value` assignments for op item create/edit that carry a secret.
const SECRET_ASSIGNMENT = /^[^=]*(?:\[(?:password|concealed|otp)\]|pass|secret|token|credential|key)[^=]*=(.+)$/i;

function opVerdict({ words, raw, substituted, pipedTo }: Segment): Verdict | undefined {
	const args = words.slice(1);
	const [sub, sub2] = args;
	const outFile = has(args, "-o", "--out-file") || args.some((w) => w.startsWith("--out-file="));
	const discarded = /(?:^|\s)(?:1?>|&>)\s*\/dev\/null\b/.test(raw);
	const json = args.includes("--format=json") || args.some((w, i) => w === "--format" && args[i + 1] === "json");

	if (has(args, "--reveal", "--otp") && !discarded) {
		return block("prints revealed 1Password secrets (--reveal/--otp). Use `op run` or `op inject -o <file>` so the value never reaches the output");
	}
	if (sub === "run") {
		return has(args, "--no-masking") ? block("turns off op run's secret masking (--no-masking)") : undefined;
	}
	if (sub === "read" || sub === "inject" || (sub === "document" && sub2 === "get")) {
		if (outFile) return undefined;
		if (substituted || (pipedTo && !DISPLAYS.has(pipedTo))) {
			return ask(`injects a 1Password secret into ${pipedTo ? `\`${pipedTo}\`` : "a command line"}, where nothing masks it if that command echoes it. Prefer \`op run\` with op:// references`);
		}
		return block(`prints a 1Password secret to output the agent reads (op ${sub}). Use \`op run -- <cmd>\` with op:// references, or \`-o <file>\``);
	}
	if (sub === "item" && (sub2 === "create" || sub2 === "edit")) {
		// Default output conceals sensitive fields (that is what --reveal undoes); JSON does not.
		if (json && !discarded) {
			return block(`prints the item as JSON, secret values included (op item ${sub2} --format json). Drop --format json: the default output conceals secrets and still shows the item's ID`);
		}
		const generated = args.some((w) => w.startsWith("--generate-password") || w.startsWith("--ssh-generate-key"));
		const typed = args.filter((w) => !w.startsWith("-") && SECRET_ASSIGNMENT.exec(w)?.[1]).length > 0;
		if (typed) {
			return ask(`writes a secret typed into the command to your 1Password vault (op item ${sub2}), so the agent already has the value. Prefer --generate-password, or take it from its source with $(...)`);
		}
		return ask(`writes an item to your 1Password vault (op item ${sub2}${generated ? ", value generated by 1Password and never shown" : ""})`);
	}
	if (sub === "item" && sub2 === "get" && json) {
		return block("prints an item as JSON, which includes its concealed values. Read non-secret fields without --format json, or use `op run`");
	}
	if (sub === "signin" && has(args, "--raw")) return block("prints a 1Password session token (signin --raw)");
	if ((sub === "service-account" && sub2 === "create") || (sub === "connect" && (sub2 === "token" || sub2 === "server"))) {
		if (!discarded) return block(`creates a 1Password credential and prints it (op ${sub} ${sub2})`);
	}
	return undefined;
}

function segmentVerdict(segment: Segment, cwd: string): Verdict | undefined {
	const { words } = segment;
	const [cmd, sub] = words;
	const args = words.slice(1);

	// Look inside `bash -c '...'` and `eval ...`, which hide a whole command in one word.
	if (SHELLS.has(cmd!) && args[0] === "-c" && args[1]) return riskyBash(args[1], cwd);
	if (cmd === "eval") return riskyBash(args.join(" "), cwd);

	if (cmd === "op") {
		// `op run` masks only 1Password values; the child can still print other secrets.
		const child = sub === "run" ? args.slice(args.indexOf("--") + 1) : [];
		return opVerdict(segment) ?? (args.includes("--") && child.length ? riskyBash(child.join(" "), cwd) : undefined);
	}

	if (!HARMLESS.has(cmd!) && args.some((w) => isSecretPath(w, cwd))) {
		return ask(`touches a secret file (${args.find((w) => isSecretPath(w, cwd))})`);
	}
	if ((cmd === "env" || cmd === "printenv" || cmd === "set") && args.every((w) => w.startsWith("-"))) {
		return ask("dumps the environment");
	}
	if (cmd === "printenv" || (cmd === "export" && has(args, "-p")) || (cmd === "declare" && has(args, "-x", "-p"))) {
		return ask("prints environment variables");
	}
	if (/\$\{?[A-Za-z_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_?KEY)[A-Za-z_]*/i.test(words.join(" "))) {
		return ask("expands a secret-looking variable");
	}
	if (cmd === "security" && /^find-(?:generic|internet)-password$/.test(sub ?? "")) return ask("reads the macOS keychain");
	if (cmd === "gh" && sub === "auth" && has(args, "token")) return ask("prints the GitHub token");
	if (cmd === "gcloud" && args.some((w) => /print-(?:access|identity)-token/.test(w))) return ask("prints a cloud token");
	if (cmd === "aws" && sub === "configure" && has(args, "get", "export-credentials")) return ask("prints AWS credentials");

	if (cmd === "rm" && (shortFlag(args, "r") || has(args, "--recursive")) && args.some((w) => DANGEROUS_RM_TARGET.test(w))) {
		return ask("recursively deletes a home, root, parent or .git directory");
	}
	if (cmd === "git") {
		if (sub === "push" && (has(args, "--force", "-f") || args.some((w) => w.startsWith("+")))) return ask("force-pushes");
		if (sub === "reset" && has(args, "--hard")) return ask("discards uncommitted work (reset --hard)");
		if (sub === "clean" && (shortFlag(args, "f") || has(args, "--force"))) return ask("deletes untracked files (git clean)");
		if (sub === "checkout" && has(args, "--", ".")) return ask("discards working-tree changes (checkout)");
		if (sub === "restore" && !has(args, "--staged", "-S")) return ask("discards working-tree changes (restore)");
		if (sub === "branch" && has(args, "-D")) return ask("force-deletes a branch");
		if (sub === "stash" && has(args, "drop", "clear")) return ask("deletes stashed work");
	}
	if ((cmd === "chmod" || cmd === "chown") && shortFlag(args, "R") && args.some((w) => DANGEROUS_RM_TARGET.test(w))) {
		return ask("recursively changes permissions on a home or root directory");
	}
	return undefined;
}

/** What to do with a bash command: block it, ask the user, or (undefined) let it run. A block wins. */
export function riskyBash(command: string, cwd: string): Verdict | undefined {
	let first: Verdict | undefined;
	for (const segment of segments(command)) {
		const verdict = segmentVerdict(segment, cwd);
		if (verdict?.action === "block") return verdict;
		first ??= verdict;
	}
	return first;
}

// 1Password values have no fixed format, so known-format redaction misses them.
// When a command ran `op`, also mask concealed fields in its JSON and labelled
// secret lines in its human-readable output.
const OP_SECRET_TYPES = new Set(["CONCEALED", "OTP", "SSHKEY", "CREDIT_CARD_NUMBER"]);
const OP_SECRET_LINE =
	/^(\s*(?:password|credential|secret|token|private key|one-time password|otp|pin|api key|key|secret key|notesPlain)\s*:\s+)(?!\[use )(\S.*)$/gim;

function maskOpFields(value: unknown, tally: { count: number }): unknown {
	if (Array.isArray(value)) return value.map((v) => maskOpFields(v, tally));
	if (!value || typeof value !== "object") return value;
	const obj = value as Record<string, unknown>;
	const secret = OP_SECRET_TYPES.has(String(obj.type)) || obj.purpose === "PASSWORD";
	return Object.fromEntries(
		Object.entries(obj).map(([k, v]) => {
			if (secret && k === "value" && typeof v === "string" && v) {
				tally.count++;
				return [k, REDACTED];
			}
			return [k, maskOpFields(v, tally)];
		}),
	);
}

export function redactOpOutput(text: string): { text: string; count: number } {
	const tally = { count: 0 };
	try {
		const masked = maskOpFields(JSON.parse(text), tally);
		if (tally.count > 0) return { text: JSON.stringify(masked, null, 2), count: tally.count };
	} catch {
		// not JSON: fall through to the human-readable form
	}
	const out = text.replace(OP_SECRET_LINE, (_m, label: string) => {
		tally.count++;
		return label + REDACTED;
	});
	return { text: out, count: tally.count };
}

const usesOp = (command: unknown): boolean =>
	typeof command === "string" && /(?:^|[\s;|&(`])op\s/.test(command);

function redactOutput(value: unknown, tally: { count: number }, op: boolean): unknown {
	if (typeof value === "string") {
		let text = value;
		if (op) {
			const o = redactOpOutput(text);
			tally.count += o.count;
			text = o.text;
		}
		const r = redact(text);
		tally.count += r.count;
		return r.text;
	}
	if (Array.isArray(value)) return value.map((v) => redactOutput(v, tally, op));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactOutput(v, tally, op)]));
	}
	return value;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		let verdict: Verdict | undefined;

		if (event.toolName === "write" || event.toolName === "edit") {
			const path = typeof event.input.path === "string" ? event.input.path : "";
			if (path && isSecretPath(path, ctx.cwd)) {
				const exists = existsSync(resolve(ctx.cwd, expandHome(path)));
				verdict =
					event.toolName === "write" && exists
						? block(`rewrites the whole secret file ${path}; it may hold masked values, so writing it back could destroy the real ones. Use a targeted edit, or ask the user`)
						: ask(`${event.toolName === "edit" ? "edits" : "creates"} the secret file ${path}`);
			}
		} else if (event.toolName === "bash" && typeof event.input.command === "string") {
			verdict = riskyBash(event.input.command, ctx.cwd);
		}

		if (!verdict) return undefined;
		if (verdict.action === "block") return { block: true, reason: `BLOCKED by secret-guard: this ${verdict.reason}.` };
		if (!ctx.hasUI) return { block: true, reason: `BLOCKED by secret-guard (no UI to confirm): this ${verdict.reason}.` };

		const detail = event.toolName === "bash" ? String(event.input.command) : String(event.input.path);
		const ok = await ctx.ui.confirm(`secret-guard: this ${verdict.reason}`, `${detail}\n\nAllow it?`);
		return ok ? undefined : { block: true, reason: `BLOCKED by the user via secret-guard: this ${verdict.reason}. Ask the user how to proceed.` };
	});

	pi.on("tool_result", async (event, ctx) => {
		const op = event.toolName === "bash" && usesOp((event.input as { command?: unknown } | undefined)?.command);
		const tally = { count: 0 };
		const content = redactOutput(event.content, tally, op) as typeof event.content;
		const structured = "structuredContent" in event ? redactOutput(event.structuredContent, tally, op) : undefined;
		if (tally.count === 0) return undefined;

		if (ctx.hasUI) ctx.ui.notify(`secret-guard masked ${tally.count} secret(s) in ${event.toolName} output`, "warning");
		return structured === undefined ? { content } : { content, structuredContent: structured };
	});
}
