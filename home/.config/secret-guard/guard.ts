/**
 * Secret Guard: the rules, shared by every agent.
 *
 * Pi (~/.pi/agent/extensions/secret-guard.ts) and OpenCode
 * (~/.config/opencode/plugins/secret-guard/) are thin adapters over this file, so a
 * rule added here guards both. It has no agent imports and no side effects.
 *
 * - riskyBash(): commands to refuse or ask about before they run.
 * - isSecretPath(): files whose contents are secrets.
 * - maskText() / maskDeep(): what to hide in anything headed for the model, by
 *   known token format and by the real values `learn.ts` recorded (known.ts).
 *
 * This catches habits and accidents, not a determined agent: `python -c` reading a
 * file is invisible to riskyBash, and an encoded secret passes every mask. An OS
 * sandbox is the real boundary.
 */

import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import type { KnownValues } from "./known.ts";

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

export const expandHome = (p: string): string =>
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
	// Secret managers, whose whole job here is to print the value.
	if (cmd === "aws" && sub === "secretsmanager" && has(args, "get-secret-value")) return ask("prints a secret from AWS Secrets Manager");
	if (cmd === "aws" && sub === "ssm" && has(args, "--with-decryption")) return ask("prints decrypted SSM parameters");
	if (cmd === "gcloud" && sub === "secrets" && has(args, "access")) return ask("prints a secret from Google Secret Manager");
	if (cmd === "az" && sub === "keyvault" && has(args, "secret") && has(args, "show", "download")) return ask("prints a secret from Azure Key Vault");
	if (cmd === "vault" && (sub === "read" || (sub === "kv" && has(args, "get")))) return ask("prints a secret from Vault");
	// `describe` shows only sizes; an output format shows the base64 values.
	if (cmd === "kubectl" && has(args, "secret", "secrets") && args.some((w) => /^(?:-o|--output)/.test(w))) {
		return ask("prints Kubernetes secret data");
	}
	// Another terminal's screen may show anything the user ran there.
	if (cmd === "rex" && (sub === "capture" || (sub === "block" && has(args, "capture", "stream")))) {
		return ask("reads another terminal's screen and scrollback, which may show secrets the user ran there");
	}

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

export const usesOp = (command: unknown): boolean =>
	typeof command === "string" && /(?:^|[\s;|&(`])op\s/.test(command);

export type MaskOptions = {
	/** Values recorded by `learn.ts` and the agent's own secret env vars. */
	known?: KnownValues;
	/** The text is `op` output, so its labelled and concealed fields are secrets too. */
	op?: boolean;
};

/** Every mask in one pass: 1Password fields, known token formats, then known values. */
export function maskText(text: string, options: MaskOptions = {}): { text: string; count: number } {
	let count = 0;
	let out = text;
	if (options.op) {
		const o = redactOpOutput(out);
		count += o.count;
		out = o.text;
	}
	const r = redact(out);
	count += r.count;
	out = r.text;
	if (options.known) {
		const k = options.known.mask(out);
		count += k.count;
		out = k.text;
	}
	return { text: out, count };
}

// Provider payloads carry opaque blobs the provider verifies byte for byte: a
// reasoning signature, encrypted reasoning, base64 media. Masking inside one
// breaks the request, and a token-shaped match there is chance, not a leak (the
// first audit's four "GitHub tokens" were exactly this). `encrypted` and
// `providerMetadata` are OpenCode's names for the same blobs.
const OPAQUE_KEYS = new Set(["signature", "thinkingSignature", "thoughtSignature", "thought_signature", "encrypted_content", "encryptedContent", "encrypted", "providerMetadata"]);
const isMedia = (obj: Record<string, unknown>): boolean =>
	"media_type" in obj || "mimeType" in obj || "mime_type" in obj || obj.type === "base64";
// Only JSON-shaped objects are rebuilt. A class instance or a Uint8Array (OpenCode's
// media assets and image bytes) would lose its prototype and come back corrupt.
const isPlain = (v: object): boolean => {
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
};

/** maskText over every string in a JSON-like value. Returns the same object when nothing matched. */
export function maskDeep<T>(value: T, options: MaskOptions = {}): { value: T; count: number } {
	let count = 0;
	const walk = (v: unknown): unknown => {
		if (typeof v === "string") {
			const m = maskText(v, options);
			count += m.count;
			return m.count > 0 ? m.text : v;
		}
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === "object" && isPlain(v)) {
			const obj = v as Record<string, unknown>;
			const media = isMedia(obj);
			return Object.fromEntries(
				Object.entries(obj).map(([k, x]) => [k, OPAQUE_KEYS.has(k) || (media && k === "data") ? x : walk(x)]),
			);
		}
		return v;
	};
	const masked = walk(value);
	return { value: count > 0 ? (masked as T) : value, count };
}

/**
 * Masks a stream line by line, for output shown as it arrives. A secret split
 * across two chunks is still whole within its line; only a partial last line is
 * held back. A private key spans lines, so everything from its BEGIN line to its
 * END line is held and masked as one block.
 */
export function createLineMasker(options: MaskOptions = {}) {
	let pending = "";
	let inKey = false;
	let count = 0;
	const BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
	const END = /-----END [A-Z ]*PRIVATE KEY-----/;

	const take = (final: boolean): string => {
		let out = "";
		for (;;) {
			if (inKey) {
				const end = END.exec(pending);
				if (!end) {
					if (!final) return out;
					count++;
					pending = "";
					return out + REDACTED;
				}
				const block = pending.slice(0, end.index + end[0].length);
				pending = pending.slice(block.length);
				const m = maskText(block, options);
				count += m.count;
				out += m.text;
				inKey = false;
				continue;
			}
			const begin = BEGIN.exec(pending);
			// \r too: a progress bar redraws its line without ever ending it.
			const newline = Math.max(pending.lastIndexOf("\n"), pending.lastIndexOf("\r"));
			if (begin && (newline < 0 || begin.index <= newline || final)) {
				const before = pending.slice(0, begin.index);
				const m = maskText(before, options);
				count += m.count;
				out += m.text;
				pending = pending.slice(begin.index);
				inKey = true;
				continue;
			}
			const cut = final ? pending.length : newline + 1;
			const m = maskText(pending.slice(0, cut), options);
			count += m.count;
			pending = pending.slice(cut);
			return out + m.text;
		}
	};

	return {
		/** Feed a chunk; returns what can be shown now. */
		push: (chunk: string): string => {
			pending += chunk;
			return take(false);
		},
		/** Call at the end; returns whatever was held back. */
		flush: (): string => take(true),
		get count() {
			return count;
		},
	};
}
