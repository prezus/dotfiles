// The guard's promises, checked against fake secrets assembled at runtime (so the
// repo's own gitleaks hook does not flag this file).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REDACTED, createLineMasker, maskDeep, maskText, riskyBash } from "./guard.ts";
import { digest, loadKnown, tokensOf, type ValuesFile } from "./known.ts";
import { envSecrets } from "./learn.ts";

const githubToken = "ghp" + "_" + "a1B2c3D4e5".repeat(4);
// No known format: only masking by value can catch it.
const password = "horse" + "Battery" + "47staple";

function knownFrom(values: string[], env: NodeJS.ProcessEnv = {}) {
	const salt = "test-salt";
	const tokens = values.flatMap(tokensOf);
	const data: ValuesFile = {
		version: 1,
		salt,
		lengths: [...new Set(tokens.map((t) => t.length))],
		hashes: tokens.map((t) => digest(salt, t)),
		learnedAt: "",
	};
	const file = join(mkdtempSync(join(tmpdir(), "secret-guard-")), "values.json");
	writeFileSync(file, JSON.stringify(data));
	return loadKnown({ file, env });
}

describe("masking", () => {
	test("a known token format is masked without learning anything", () => {
		const m = maskText(`token: ${githubToken}`);
		expect(m.text).not.toContain(githubToken);
		expect(m.count).toBe(1);
	});

	test("a shapeless password is masked once learned, wherever it appears", () => {
		const known = knownFrom([password]);
		for (const text of [`login ${password}`, `"pw":"${password}"`, `it was ${password}.`, `postgres://me:${password}@db`]) {
			const m = maskText(text, { known });
			expect(m.text).not.toContain(password);
			expect(m.count).toBe(1);
		}
		expect(maskText("horseBattery is not the password", { known }).count).toBe(0);
	});

	test("the agent's secret env vars are masked; paths and op:// references are not secrets", () => {
		const known = loadKnown({ file: "/nonexistent", env: { DB_PASSWORD: password, SSH_AUTH_SOCK: "/tmp/agent.sock", API_TOKEN: "op://vault/item/field" } });
		expect(maskText(`using ${password}`, { known }).count).toBe(1);
		expect(known.size).toBe(1);
	});

	test("opaque provider blobs are left byte-for-byte intact", () => {
		const payload = {
			messages: [
				{ type: "thinking", signature: `sig${githubToken}` },
				{ type: "image", source: { type: "base64", media_type: "image/png", data: githubToken } },
				{ type: "text", text: `leaked ${githubToken}` },
			],
		};
		const m = maskDeep(payload);
		expect(m.count).toBe(1);
		expect(m.value.messages[0]).toEqual(payload.messages[0]);
		expect(m.value.messages[1]).toEqual(payload.messages[1]);
		expect(JSON.stringify(m.value.messages[2])).toContain(REDACTED);
	});

	test("class instances and byte arrays survive a masked rebuild", () => {
		class Asset {
			constructor(readonly data: Uint8Array) {}
		}
		const asset = new Asset(new Uint8Array([1, 2, 3]));
		const m = maskDeep({ parts: [{ type: "text", text: `leaked ${githubToken}` }, { type: "media", media: asset }] });
		expect(m.count).toBe(1);
		expect(m.value.parts[1]!.media).toBe(asset);
	});

	test("an unchanged payload comes back as the same object", () => {
		const payload = { a: ["nothing here"] };
		expect(maskDeep(payload).value).toBe(payload);
	});
});

describe("streamed output", () => {
	const stream = (chunks: string[], known = knownFrom([password])) => {
		const masker = createLineMasker({ known });
		const out = chunks.map((c) => masker.push(c)).join("") + masker.flush();
		return { out, count: masker.count };
	};

	test("a secret split across chunks is still masked", () => {
		const half = password.length / 2;
		const r = stream([`pw=${password.slice(0, half)}`, `${password.slice(half)}\nnext line\n`]);
		expect(r.out).not.toContain(password);
		expect(r.out).toContain("next line\n");
		expect(r.count).toBe(1);
	});

	test("a private key spanning chunks is masked as one block", () => {
		const label = "OPENSSH PRIVATE" + " KEY";
		const key = [`-----BEGIN ${label}-----`, "b3Blbn" + "NzaC1rZXktdjEAAAAA", `-----END ${label}-----`].join("\n");
		const r = stream(["before\n", key.slice(0, 50), key.slice(50), "\nafter\n"]);
		expect(r.out).toBe(`before\n${REDACTED}\nafter\n`);
	});

	test("ordinary output passes through unchanged", () => {
		const chunks = ["building…\r", "50%\r100%\n", "done"];
		expect(stream(chunks).out).toBe(chunks.join(""));
	});
});

describe("commands", () => {
	const verdict = (cmd: string) => riskyBash(cmd, "/tmp")?.action;

	test("printing a 1Password secret is blocked; injecting one is allowed", () => {
		expect(verdict("op read op://vault/item/password")).toBe("block");
		expect(verdict("op run -- ./deploy.sh")).toBeUndefined();
		expect(verdict("op read -o /tmp/x op://vault/item/password")).toBeUndefined();
	});

	test("secret managers and other terminals' screens ask first", () => {
		expect(verdict("aws secretsmanager get-secret-value --secret-id prod")).toBe("ask");
		expect(verdict("kubectl get secret db -o yaml")).toBe("ask");
		expect(verdict("kubectl describe secret db")).toBeUndefined();
		expect(verdict("rex capture -b block:123")).toBe("ask");
		expect(verdict("rex session rename x")).toBeUndefined();
	});
});

describe("learning from .env files", () => {
	test("takes secret-named values and URL passwords, skips config and references", () => {
		const text = [
			"NODE_ENV=production",
			`DB_PASSWORD="${password}"`,
			`DATABASE_URL=postgres://app:${password}x@db:5432/app`,
			"API_KEY=op://vault/item/key",
			"export SHORT_TOKEN=abc",
		].join("\n");
		expect(envSecrets(text)).toEqual([password, `${password}x`]);
	});
});
