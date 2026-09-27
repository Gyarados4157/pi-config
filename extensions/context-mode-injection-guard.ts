/**
 * Strip context-mode's hollow per-turn "compaction recovery" shell.
 *
 * context-mode's Pi adapter injects buildAutoInjection() on every
 * before_agent_start and wraps it as <session_state source="compaction">.
 * When the only recovered field is <session_mode>, the block is noise and
 * looks like a real compaction. This runs on the chained `context` hook
 * after packages, so it still works if an upgrade restores the wrapper.
 */
const HOLLOW_STATE =
	/<session_state\s+source="(?:compaction|memory)">\s*<session_mode>[^<]*<\/session_mode>\s*<\/session_state>/gi;

const ACTIVE_MEMORY = /<active_memory>[\s\S]*?<\/active_memory>/gi;

const ROUTING_ANCHOR =
	/^context-mode active\. Hierarchy: ctx_batch_execute > ctx_execute > ctx_execute_file > ctx_search\./;

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && "text" in part) {
				return String((part as { text?: unknown }).text ?? "");
			}
			return "";
		})
		.join("\n");
}

function stripHollow(content: unknown): { content: unknown; empty: boolean } | null {
	const text = textOf(content);
	const hasShell =
		HOLLOW_STATE.test(text) ||
		text.includes('source="compaction"') ||
		text.includes("<active_memory>") ||
		ROUTING_ANCHOR.test(text);
	HOLLOW_STATE.lastIndex = 0;
	ROUTING_ANCHOR.lastIndex = 0;
	if (!hasShell) return null;
	const next = text
		.replace(HOLLOW_STATE, "")
		.replace(ACTIVE_MEMORY, "")
		.replace(/context-mode active\. Hierarchy:[^\n]*/g, "")
		.trim();
	if (!next || ROUTING_ANCHOR.test(next)) {
		return { content: next, empty: !next };
	}
	if (typeof content === "string") return { content: next, empty: false };
	return { content: [{ type: "text", text: next }], empty: false };
}

export default function contextModeInjectionGuard(pi: {
	on: (event: string, handler: (...args: never[]) => unknown) => void;
}) {
	pi.on("context", ((event: { messages?: unknown[] }) => {
		const messages = event.messages;
		if (!Array.isArray(messages) || messages.length === 0) return;
		const kept: unknown[] = [];
		let changed = false;
		for (const msg of messages) {
			if (!msg || typeof msg !== "object") {
				kept.push(msg);
				continue;
			}
			const rec = msg as { role?: string; content?: unknown };
			if (rec.role !== "user") {
				kept.push(msg);
				continue;
			}
			const stripped = stripHollow(rec.content);
			if (!stripped) {
				kept.push(msg);
				continue;
			}
			changed = true;
			if (stripped.empty) continue;
			kept.push({ ...rec, content: stripped.content });
		}
		if (changed) return { messages: kept };
		return;
	}) as never);
}
