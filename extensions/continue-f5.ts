import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * F5 continues the current session's unfinished work.
 *
 * Not a retry. Oh My Pi's equivalent is `/goal` continuation:
 * `sendHiddenMessage` + goal-continuation.md ("NEVER narrate that you are
 * continuing — execute"). Earendil Pi has no `session_stop { continue }` and
 * no `agent.continue()` on the extension API, so the portable form is a
 * display:false custom message that *stays* in the LLM context.
 *
 * `sendUserMessage("continue")` is the crude version (visible user turn).
 * Stripping the sentinel (pi-retry) is the other wrong version (regenerate
 * last request, no "keep working" instruction).
 */

const CONTINUE_TYPE = "pi-continue-f5";

const CONTINUE_PROMPT = [
	"Continue the unfinished work in this session.",
	"The previous turn stopped (timeout, terminated, or idle). Do not wait for a new task.",
	"Do not redefine success around a smaller or already-completed subset.",
	"If the work is not done, keep working.",
	"NEVER narrate that you are continuing — execute.",
].join(" ");

function continueSession(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Agent is busy — F5 only works when idle", "warning");
		return;
	}
	pi.sendMessage(
		{
			customType: CONTINUE_TYPE,
			content: [{ type: "text", text: CONTINUE_PROMPT }],
			display: false,
		},
		{ triggerTurn: true },
	);
	ctx.ui.notify("Continuing session", "info");
}

export default function (pi: ExtensionAPI) {
	pi.registerShortcut("f5", {
		description: "Continue this session's unfinished work",
		handler: (ctx) => continueSession(pi, ctx),
	});

	pi.registerCommand("continue", {
		description: "Continue this session's unfinished work (hidden, no transcript line)",
		handler: async (_args, ctx) => continueSession(pi, ctx),
	});
}
