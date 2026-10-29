/**
 * Masking by real value, for secrets with no recognisable format: a password
 * is just text, so only knowing the value itself catches it.
 *
 * Two sources:
 * - values.json, written by `learn.ts` from .env files and op:// references. It
 *   holds salted SHA-256 hashes, never the values, so the file is not itself a
 *   copy of every secret. It is 0600 in ~/.local/state, outside every repo.
 * - The agent's own environment: variables named like secrets, held in memory
 *   only, for the life of the process.
 *
 * Matching works on tokens, the runs of text between separators. Checking a
 * large provider request then costs one hash per candidate token, not one per
 * position. A secret that contains separators is learned as each of its long
 * tokens, so masking those breaks the secret even where a short piece survives.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { REDACTED } from "./guard.ts";

export const STATE_DIR = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "secret-guard");
export const VALUES_FILE = join(STATE_DIR, "values.json");
/** Shorter tokens are too likely to be ordinary words to mask by value. */
export const MIN_LENGTH = 8;

// Not `/` or `+`: base64 secrets contain them, and splitting there would leave
// most of a key as short, unmasked pieces.
const TOKEN = /[^\s"'`=:,;()[\]{}<>|&@\\]+/g;
// Sentence punctuation that may trail a token without being part of it.
const TRAILING = /[.!?]+$/;

export const tokensOf = (text: string): string[] => (text.match(TOKEN) ?? []).filter((t) => t.length >= MIN_LENGTH);

export const digest = (salt: string, token: string): string => createHash("sha256").update(salt).update(token).digest("hex");

export type ValuesFile = { version: 1; salt: string; lengths: number[]; hashes: string[]; learnedAt: string };

const SECRET_ENV = /SECRET|TOKEN|PASSW|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|SIGNING_?KEY/i;

/** Tokens of the env values whose names say secret. Paths (SSH_AUTH_SOCK-style) are not secrets. */
export function envTokens(env: NodeJS.ProcessEnv): Set<string> {
	const out = new Set<string>();
	for (const [name, value] of Object.entries(env)) {
		if (!value || !SECRET_ENV.test(name) || value.startsWith("/") || value.startsWith("op://")) continue;
		for (const t of tokensOf(value)) out.add(t);
	}
	return out;
}

export interface KnownValues {
	mask(text: string): { text: string; count: number };
	/** How many hashed values and in-memory tokens are being matched. */
	readonly size: number;
}

type Learned = { salt: string; lengths: Set<number>; hashes: Set<string>; mtime: number };

function readLearned(file: string): Learned | undefined {
	try {
		const mtime = statSync(file).mtimeMs;
		const data = JSON.parse(readFileSync(file, "utf8")) as ValuesFile;
		if (data.version !== 1) return undefined;
		return { salt: data.salt, lengths: new Set(data.lengths), hashes: new Set(data.hashes), mtime };
	} catch {
		return undefined;
	}
}

// Provider requests resend the whole conversation every turn, so the same long
// strings come back again and again.
const CACHE_LIMIT = 2000;
const CACHE_MIN = 256;
// A long-lived agent like Pi picks up a fresh `learn` without a restart.
const RECHECK_MS = 30_000;

export function loadKnown(options: { env?: NodeJS.ProcessEnv; file?: string } = {}): KnownValues {
	const file = options.file ?? VALUES_FILE;
	const plain = envTokens(options.env ?? process.env);
	let learned = readLearned(file);
	let checkedAt = Date.now();
	const cache = new Map<string, { text: string; count: number }>();

	const refresh = () => {
		const now = Date.now();
		if (now - checkedAt < RECHECK_MS) return;
		checkedAt = now;
		let mtime: number | undefined;
		try {
			mtime = statSync(file).mtimeMs;
		} catch {
			mtime = undefined;
		}
		if (mtime === learned?.mtime) return;
		learned = readLearned(file);
		cache.clear();
	};

	const isKnown = (token: string): boolean => {
		if (plain.has(token)) return true;
		return !!learned && learned.lengths.has(token.length) && learned.hashes.has(digest(learned.salt, token));
	};

	const scan = (text: string): { text: string; count: number } => {
		let count = 0;
		const out = text.replace(TOKEN, (token) => {
			if (token.length < MIN_LENGTH) return token;
			if (isKnown(token)) {
				count++;
				return REDACTED;
			}
			const trail = TRAILING.exec(token)?.[0];
			const bare = trail ? token.slice(0, -trail.length) : token;
			if (trail && bare.length >= MIN_LENGTH && isKnown(bare)) {
				count++;
				return REDACTED + trail;
			}
			return token;
		});
		return { text: out, count };
	};

	return {
		mask(text) {
			refresh();
			if (plain.size === 0 && !learned?.hashes.size) return { text, count: 0 };
			if (text.length < CACHE_MIN) return scan(text);
			const hit = cache.get(text);
			if (hit) return hit;
			const result = scan(text);
			if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
			cache.set(text, result);
			return result;
		},
		get size() {
			return plain.size + (learned?.hashes.size ?? 0);
		},
	};
}
