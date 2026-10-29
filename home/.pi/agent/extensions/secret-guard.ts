/**
 * Secret Guard for Pi
 *
 * Catches an agent leaking or clobbering secrets, and the destructive accidents
 * that tend to come with them. The rules live in ~/.config/secret-guard/guard.ts,
 * shared with the Claude Code adapter; this file wires them into each
 * place Pi lets an extension see what is about to reach the model:
 *
 * 1. tool_call: risky commands (printing a secret, dumping the environment,
 *    reading another terminal's screen, destroying work) ask first, and are blocked
 *    when there is no UI. A whole-file `write` over an existing secret file is
 *    blocked outright: the agent may have read it masked, and writing that back
 *    would replace real values with the mask.
 *
 * 2. tool_result: every tool's output is masked before the model sees it.
 *
 * 3. user_bash: the user's own `!command` output is masked the same way, since it
 *    goes to the model too. `!!command` never reaches the model, so it is left alone.
 *
 * 4. input: secrets typed or pasted into a prompt are masked before it is sent.
 *
 * 5. before_provider_request: the whole outgoing request is masked one last time,
 *    whatever path a secret took into it. A hit here means an earlier layer missed
 *    something; the session file on disk may still hold the value.
 *
 * Masking is by known token format and by real value (learned with
 * `bun ~/.config/secret-guard/learn.ts`, plus this process's secret env vars).
 */

import { createLocalBashOperations, type BashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	createLineMasker,
	expandHome,
	isSecretPath,
	maskDeep,
	maskText,
	riskyBash,
	usesOp,
	type Verdict,
} from "../../../.config/secret-guard/guard.ts";
import { loadKnown } from "../../../.config/secret-guard/known.ts";

const known = loadKnown();

/** Runs the user's command locally, masking its output as it streams. */
function maskedOperations(onMasked: (count: number) => void): BashOperations {
	const local = createLocalBashOperations();
	return {
		exec: async (command, cwd, options) => {
			const masker = createLineMasker({ known, op: usesOp(command) });
			const decoder = new TextDecoder();
			const emit = (text: string) => {
				if (text) options.onData(Buffer.from(text));
			};
			try {
				return await local.exec(command, cwd, {
					...options,
					onData: (data) => emit(masker.push(decoder.decode(data, { stream: true }))),
				});
			} finally {
				emit(masker.push(decoder.decode()) + masker.flush());
				if (masker.count > 0) onMasked(masker.count);
			}
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		let verdict: Verdict | undefined;
		let detail = "";

		if (event.toolName === "write" || event.toolName === "edit") {
			const path = typeof event.input.path === "string" ? event.input.path : "";
			if (path && isSecretPath(path, ctx.cwd)) {
				detail = path;
				const exists = existsSync(resolve(ctx.cwd, expandHome(path)));
				verdict =
					event.toolName === "write" && exists
						? { action: "block", reason: `rewrites the whole secret file ${path}; it may hold masked values, so writing it back could destroy the real ones. Use a targeted edit, or ask the user` }
						: { action: "ask", reason: `${event.toolName === "edit" ? "edits" : "creates"} the secret file ${path}` };
			}
		} else if (event.toolName === "bash" && typeof event.input.command === "string") {
			verdict = riskyBash(event.input.command, ctx.cwd);
			detail = event.input.command;
		}

		if (!verdict) return undefined;
		if (verdict.action === "block") return { block: true, reason: `BLOCKED by secret-guard: this ${verdict.reason}.` };
		if (!ctx.hasUI) return { block: true, reason: `BLOCKED by secret-guard (no UI to confirm): this ${verdict.reason}.` };

		const ok = await ctx.ui.confirm(`secret-guard: this ${verdict.reason}`, `${detail}\n\nAllow it?`);
		return ok ? undefined : { block: true, reason: `BLOCKED by the user via secret-guard: this ${verdict.reason}. Ask the user how to proceed.` };
	});

	pi.on("tool_result", async (event, ctx) => {
		const op = event.toolName === "bash" && usesOp((event.input as { command?: unknown } | undefined)?.command);
		const content = maskDeep(event.content, { known, op });
		const structured = "structuredContent" in event ? maskDeep(event.structuredContent, { known, op }) : undefined;
		const count = content.count + (structured?.count ?? 0);
		if (count === 0) return undefined;

		if (ctx.hasUI) ctx.ui.notify(`secret-guard masked ${count} secret(s) in ${event.toolName} output`, "warning");
		return structured === undefined ? { content: content.value } : { content: content.value, structuredContent: structured.value };
	});

	pi.on("user_bash", (event, ctx) => {
		if (event.excludeFromContext) return undefined;
		return {
			operations: maskedOperations((count) => {
				if (ctx.hasUI) ctx.ui.notify(`secret-guard masked ${count} secret(s) in your command's output before the model saw it`, "warning");
			}),
		};
	});

	pi.on("input", (event, ctx) => {
		const masked = maskText(event.text, { known });
		if (masked.count === 0) return { action: "continue" };
		if (ctx.hasUI) ctx.ui.notify(`secret-guard masked ${masked.count} secret(s) in your message before sending it`, "warning");
		return { action: "transform", text: masked.text, images: event.images };
	});

	// Pi sends the request unmasked if this throws, so it must not.
	pi.on("before_provider_request", (event, ctx) => {
		try {
			const masked = maskDeep(event.payload, { known });
			if (masked.count === 0) return undefined;
			if (ctx.hasUI) ctx.ui.notify(`secret-guard masked ${masked.count} secret(s) in the outgoing request that no earlier check caught`, "warning");
			return masked.value;
		} catch (err) {
			if (ctx.hasUI) ctx.ui.notify(`secret-guard could not check the outgoing request: ${err instanceof Error ? err.message : err}`, "error");
			return undefined;
		}
	});
}
