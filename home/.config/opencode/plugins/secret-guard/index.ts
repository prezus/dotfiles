/**
 * Secret Guard for OpenCode (v2 plugin API)
 *
 * The rules live in ~/.config/secret-guard/guard.ts, shared with the Pi adapter;
 * this file wires them into each place OpenCode lets a plugin see what is about
 * to run or reach the model:
 *
 * 1. tool execute.before: risky shell commands ask first, through OpenCode's own
 *    permission prompt (action `secret-guard`). With nobody present to answer, an
 *    ask is denied; `--auto` approves it. A whole-file `write` over an existing
 *    secret file is refused outright, as in Pi: writing back a masked read would
 *    replace the real values with the mask.
 *
 * 2. tool execute.after: every tool's result is masked before the model sees it.
 *
 * 3. session prompt: secrets typed or pasted into a prompt are masked before it is
 *    admitted, so they never reach the stored session either.
 *
 * 4. session context/compaction/generate/title: the assembled model request is
 *    masked one last time. This is the only layer that sees a user's `!command`
 *    output and background-shell notices, and it is the last one for the Claude
 *    Agent provider, whose HTTP request is made by the `claude` subprocess.
 *
 * The Claude Agent provider runs Claude Code with its own tools and hooks off and
 * OpenCode's tools served over MCP, so every hook above applies to it unchanged.
 */

import { Plugin } from "@opencode/plugin";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expandHome, isSecretPath, maskDeep, maskText, riskyBash, usesOp, type Verdict } from "../../../secret-guard/guard.ts";
import { loadKnown } from "../../../secret-guard/known.ts";

const known = loadKnown();
const ACTION = "secret-guard";

const str = (input: unknown, key: string): string | undefined => {
	const v = (input as Record<string, unknown> | undefined)?.[key];
	return typeof v === "string" ? v : undefined;
};

// Both patch dialects name their files in headers: `*** Update File: x` and `+++ b/x`.
const PATCH_PATH = /^(?:\*\*\* (?:Add|Update|Delete) File: |\*\*\* Move to: |(?:\+\+\+|---) (?:[ab]\/)?)(.+)$/gm;
const patchPaths = (text: string): string[] => [...text.matchAll(PATCH_PATH)].map((m) => m[1]!.trim()).filter((p) => p !== "/dev/null");

function fileVerdict(tool: string, input: unknown, cwd: string): { verdict: Verdict; detail: string } | undefined {
	const paths = tool === "patch" ? patchPaths(str(input, "patchText") ?? "") : [str(input, "path")].filter((p) => p !== undefined);
	const path = paths.find((p) => isSecretPath(p, cwd));
	if (!path) return undefined;
	const exists = existsSync(resolve(cwd, expandHome(path)));
	if (tool === "write" && exists) {
		return {
			detail: path,
			verdict: { action: "block", reason: `rewrites the whole secret file ${path}; it may hold masked values, so writing it back could destroy the real ones. Use a targeted edit, or ask the user` },
		};
	}
	return { detail: path, verdict: { action: "ask", reason: `${exists ? "edits" : "creates"} the secret file ${path}` } };
}

export default Plugin.define({
	id: "dotfiles.secret-guard",
	async setup(ctx) {
		const root = ctx.location.directory;

		await ctx.tool.hook("execute.before", async (event) => {
			let found: { verdict: Verdict; detail: string } | undefined;
			if (event.tool === "shell") {
				const command = str(event.input, "command") ?? "";
				const verdict = riskyBash(command, resolve(root, str(event.input, "workdir") ?? "."));
				found = verdict && { verdict, detail: command };
			} else if (event.tool === "write" || event.tool === "edit" || event.tool === "patch") {
				found = fileVerdict(event.tool, event.input, root);
			}
			if (!found) return;
			// A thrown error rejects this one call; the model sees the message.
			if (found.verdict.action === "block") throw new Error(`BLOCKED by secret-guard: this ${found.verdict.reason}.`);
			// No `save`, so "always" stores nothing and the next risky call asks again.
			await ctx.permission.assert({
				sessionID: event.sessionID,
				agent: event.agent,
				source: { type: "tool", messageID: event.messageID, id: event.id },
				action: ACTION,
				resources: [found.detail],
				metadata: { reason: `secret-guard: this ${found.verdict.reason}` },
			});
		});

		// A `*` allow rule (or no rule) would otherwise let the assert above pass silently.
		// An explicit deny never reaches this hook, so it still wins.
		await ctx.permission.hook("evaluate", (event) => {
			if (event.action !== ACTION) return;
			if (event.effect === "allow") event.effect = "ask";
			event.message = String(event.metadata?.reason ?? "secret-guard: this command may expose a secret");
		});

		await ctx.tool.hook("execute.after", (event) => {
			if (event.status !== "completed") return;
			const op = event.tool === "shell" && usesOp(str(event.input, "command"));
			const masked = maskDeep({ content: event.result.content, output: event.result.output }, { known, op });
			if (masked.count > 0) event.result = { ...event.result, ...masked.value };
		});

		await ctx.session.hook("prompt", (event) => {
			const masked = maskText(event.prompt.text, { known });
			if (masked.count > 0) event.prompt.text = masked.text;
		});

		// Fails open, as Pi does: a bug here must not stop every request. A hit means an
		// earlier layer missed something, and the stored session may still hold the value.
		const lastCheck = (event: { system: unknown[]; messages: unknown[] }) => {
			try {
				const masked = maskDeep({ system: event.system, messages: event.messages }, { known });
				if (masked.count === 0) return;
				event.system = masked.value.system;
				event.messages = masked.value.messages;
				console.warn(`secret-guard masked ${masked.count} secret(s) in an outgoing request that no earlier check caught`);
			} catch (err) {
				console.error("secret-guard could not check the outgoing request:", err);
			}
		};
		for (const kind of ["context", "compaction", "generate", "title"] as const) {
			await ctx.session.hook(kind, lastCheck as (event: unknown) => void);
		}
	},
});
