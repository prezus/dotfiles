/**
 * Records which values the agents' guards must mask, without storing them.
 *
 *   bun ~/.config/secret-guard/learn.ts [dir ...]   learn (default dir: ~/Projects)
 *   bun ~/.config/secret-guard/learn.ts status      what is learned, and when
 *
 * Sources:
 * - .env files under each dir: values whose names say secret, and the password
 *   inside a connection URL (postgres://user:PASSWORD@host).
 * - 1Password: each op:// reference listed in ~/.local/state/secret-guard/op-refs,
 *   one per line. `op read` runs here, in your terminal, and may prompt.
 *
 * Prints counts and file names, never a value. Re-run after rotating a secret: each
 * run replaces values.json with a fresh salt.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { MIN_LENGTH, STATE_DIR, VALUES_FILE, digest, tokensOf, type ValuesFile } from "./known.ts";

const OP_REFS = join(STATE_DIR, "op-refs");
const ENV_FILE = /^(?:\.env(?:\..+)?|\.dev\.vars)$/;
const NOT_SECRET = /\.(?:example|sample|template|defaults?|dist)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "target", "vendor", ".venv", "venv", ".next", ".cache"]);
const MAX_DEPTH = 6;
const SECRET_KEY = /SECRET|TOKEN|PASSW|PWD|API_?KEY|ACCESS_?KEY|PRIVATE|CREDENTIAL|SIGNING|ENCRYPTION|SALT|WEBHOOK|DSN|AUTH_|_AUTH\b/i;

function findEnvFiles(dir: string, depth = 0, out: string[] = []): string[] {
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		const path = join(dir, e.name);
		if (e.isDirectory() && depth < MAX_DEPTH && !SKIP_DIRS.has(e.name)) findEnvFiles(path, depth + 1, out);
		else if (e.isFile() && ENV_FILE.test(e.name) && !NOT_SECRET.test(e.name)) out.push(path);
	}
	return out;
}

const unquote = (v: string): string => {
	const t = v.trim();
	const q = t[0];
	if ((q === '"' || q === "'") && t.endsWith(q) && t.length > 1) return t.slice(1, -1);
	return t.replace(/\s+#.*$/, "");
};

/** The secret values in one .env file's text. */
export function envSecrets(text: string): string[] {
	const out: string[] = [];
	for (const line of text.split("\n")) {
		const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line);
		if (!m) continue;
		const [, key, raw] = m;
		const value = unquote(raw!);
		// References are pointers to secrets, not secrets.
		if (!value || value.startsWith("op://") || /^\$\{?[A-Za-z_]/.test(value)) continue;
		try {
			const url = new URL(value);
			if (url.password) out.push(decodeURIComponent(url.password));
		} catch {
			// not a URL
		}
		if (SECRET_KEY.test(key!) && value.length >= MIN_LENGTH) out.push(value);
	}
	return out;
}

function opSecrets(): { values: string[]; refs: number; failed: number } {
	if (!existsSync(OP_REFS)) return { values: [], refs: 0, failed: 0 };
	const refs = readFileSync(OP_REFS, "utf8")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("op://"));
	const values: string[] = [];
	let failed = 0;
	for (const ref of refs) {
		const r = spawnSync("op", ["read", "--no-newline", ref], { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
		if (r.status === 0 && r.stdout) values.push(r.stdout);
		else failed++;
	}
	return { values, refs: refs.length, failed };
}

function learn(dirs: string[]): void {
	const files = dirs.flatMap((d) => findEnvFiles(d));
	const fromEnv = files.flatMap((f) => {
		try {
			return envSecrets(readFileSync(f, "utf8"));
		} catch {
			return [];
		}
	});
	const op = opSecrets();

	const salt = randomBytes(16).toString("hex");
	const hashes = new Set<string>();
	const lengths = new Set<number>();
	let unmatchable = 0;
	for (const value of [...fromEnv, ...op.values]) {
		const tokens = tokensOf(value);
		if (tokens.length === 0) unmatchable++;
		for (const t of tokens) {
			hashes.add(digest(salt, t));
			lengths.add(t.length);
		}
	}

	const data: ValuesFile = { version: 1, salt, lengths: [...lengths], hashes: [...hashes], learnedAt: new Date().toISOString() };
	mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
	chmodSync(STATE_DIR, 0o700);
	const tmp = `${VALUES_FILE}.tmp`;
	writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
	renameSync(tmp, VALUES_FILE);

	const home = homedir();
	console.log(`Learned ${hashes.size} value token(s) from ${files.length} .env file(s) and ${op.refs - op.failed}/${op.refs} 1Password reference(s).`);
	for (const f of files) console.log(`  ${relative(home, f).startsWith("..") ? f : `~/${relative(home, f)}`}`);
	if (op.failed) console.log(`${op.failed} op:// reference(s) could not be read (see ${OP_REFS}).`);
	if (unmatchable) console.log(`${unmatchable} value(s) have no run of ${MIN_LENGTH}+ characters between separators and cannot be matched.`);
	if (!existsSync(OP_REFS)) console.log(`No 1Password references: list op:// paths in ${OP_REFS} to add them.`);
	console.log(`Wrote ${VALUES_FILE} (hashes only).`);
}

function status(): void {
	if (!existsSync(VALUES_FILE)) {
		console.log("Nothing learned yet. Run: bun ~/.config/secret-guard/learn.ts");
		return;
	}
	const data = JSON.parse(readFileSync(VALUES_FILE, "utf8")) as ValuesFile;
	const mode = (statSync(VALUES_FILE).mode & 0o777).toString(8);
	console.log(`${data.hashes.length} value token(s), learned ${data.learnedAt}, file mode ${mode}`);
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	if (args[0] === "status") status();
	else learn(args.length ? args : [join(homedir(), "Projects")]);
}
