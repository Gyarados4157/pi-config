/**
 * Fail-fast guards for the two high-frequency tool mistakes:
 * - ctx_execute_file (and the mcp wrapper) on a path outside cwd, including /tmp
 * - web_search (Google CSE; use codex-search / codex-research)
 *
 * Playbook: ~/.pi/agent/skills/pi-ops/SKILL.md
 */
import { basename, isAbsolute, relative, resolve } from "node:path";

type ToolCallEvent = {
	toolName?: string;
	input?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function executeFilePath(event: ToolCallEvent): string | undefined {
	const input = asRecord(event.input) ?? {};
	const name = event.toolName ?? "";
	if (name === "ctx_execute_file") return str(input.path);
	if (name === "mcp" || name === "mcp__context_mode") {
		const tool = str(input.tool);
		if (tool !== "ctx_execute_file" && tool !== "context-mode_ctx_execute_file") {
			return undefined;
		}
		const args = asRecord(input.args) ?? {};
		return str(args.path);
	}
	return undefined;
}

function outsideCwd(filePath: string, cwd: string): boolean {
	const resolved = resolve(cwd, filePath);
	const rel = relative(cwd, resolved);
	return rel.startsWith("..") || isAbsolute(rel);
}

export default function piOpsGuard(pi: {
	on: (event: string, handler: (event: ToolCallEvent) => unknown) => void;
}) {
	pi.on("tool_call", (event) => {
		if (event.toolName === "web_search") {
			return {
				block: true,
				reason:
					"web_search is disabled (Google CSE is not configured). Use codex-search for a lookup or codex-research to open pages.",
			};
		}

		const filePath = executeFilePath(event);
		if (!filePath) return;
		const cwd = process.cwd();
		if (!outsideCwd(filePath, cwd)) return;
		const scratch = resolve(cwd, ".pi/scratch", basename(filePath));
		return {
			block: true,
			reason:
				`ctx_execute_file cannot read paths outside the project root (${cwd}), including /tmp. ` +
				`Copy the dump to ${scratch} and retry, or use ctx_execute. See the pi-ops skill.`,
		};
	});
}
