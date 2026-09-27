import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	Text,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

interface AskOption {
	label: string;
	value: string;
	description?: string;
}

interface DisplayOption extends AskOption {
	id: string;
	index?: number;
	isOther?: boolean;
	isSubmit?: boolean;
}

interface TextAnswer {
	type: "text";
	label: string;
	value: string;
}

interface OptionAnswer {
	type: "option";
	label: string;
	value: string;
	index: number;
}

interface OtherAnswer {
	type: "other";
	label: string;
	value: string;
}

type AskAnswer = TextAnswer | OptionAnswer | OtherAnswer;
type AskUserQuestionStatus = "answered" | "cancelled" | "unavailable";
type AskUserQuestionMode = "text" | "single-select" | "multi-select";

interface AskUserQuestionResultDetails {
	status: AskUserQuestionStatus;
	question: string;
	context?: string;
	mode: AskUserQuestionMode;
	answers: AskAnswer[];
	message?: string;
}

// Field descriptions are inlined into the tool schema every turn — keep them short.
const OptionSchema = Type.Object({
	label: Type.String({ description: 'Shown to the user. Put the recommended choice first with " (Recommended)".' }),
	value: Type.Optional(Type.String({ description: "Returned value; defaults to label." })),
	description: Type.Optional(Type.String({ description: "Optional extra line under the option." })),
});

const AskUserQuestionParams = Type.Object({
	question: Type.String({ description: "One question. One tool call." }),
	details: Type.Optional(Type.String({ description: "Optional extra context under the question." })),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			description: "Choices. Omit or [] for free text. Other is always available.",
		}),
	),
	multiSelect: Type.Optional(Type.Boolean({ description: "Allow several answers to this same question." })),
});

function normalizeOptions(
	options: Array<{ label: string; value?: string; description?: string }> | undefined,
): AskOption[] {
	return (options || [])
		.map((option) => ({
			label: option.label.trim(),
			value: option.value?.trim() || option.label.trim(),
			description: option.description?.trim() || undefined,
		}))
		.filter((option) => option.label.length > 0);
}

function getOtherLabel(options: AskOption[]): string {
	return options.some((option) => option.label.toLowerCase() === "other") ? "Other (custom)" : "Other";
}

function createEditorTheme(theme: any): EditorTheme {
	return {
		borderColor: (s) => theme.fg("accent", s),
		selectList: {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		},
	};
}

function addWrapped(lines: string[], text: string, width: number, indent = ""): void {
	const contentWidth = Math.max(1, width - indent.length);
	for (const line of wrapTextWithAnsi(text, contentWidth)) {
		lines.push(truncateToWidth(`${indent}${line}`, width));
	}
}

function formatAnswerForModel(answer: AskAnswer): string {
	switch (answer.type) {
		case "text":
			return answer.label;
		case "other":
			return `Other: ${answer.label}`;
		case "option":
			return `${answer.index}. ${answer.label}`;
	}
}

function sortAnswers(answers: AskAnswer[]): AskAnswer[] {
	const rank = (answer: AskAnswer) => {
		if (answer.type === "option") return answer.index;
		if (answer.type === "other") return Number.MAX_SAFE_INTEGER - 1;
		return Number.MAX_SAFE_INTEGER;
	};
	return [...answers].sort((a, b) => rank(a) - rank(b));
}

function buildStructuredResult(
	status: AskUserQuestionStatus,
	question: string,
	mode: AskUserQuestionMode,
	answers: AskAnswer[],
	context?: string,
	message?: string,
): AskUserQuestionResultDetails {
	return { status, question, context, mode, answers, message };
}

function cancelledResult(question: string, mode: AskUserQuestionMode, context?: string) {
	const message = "User cancelled the question";
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult("cancelled", question, mode, [], context, message),
	};
}

function unavailableResult(question: string, mode: AskUserQuestionMode, message: string, context?: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: buildStructuredResult("unavailable", question, mode, [], context, message),
	};
}

function buildResult(question: string, context: string | undefined, mode: AskUserQuestionMode, answers: AskAnswer[]) {
	let text: string;
	if (mode === "text") {
		const answer = answers[0];
		text = answer.label.trim().length > 0 ? `User answered: ${answer.label}` : "User submitted an empty response";
	} else if (mode === "single-select") {
		text = `User selected: ${formatAnswerForModel(answers[0])}`;
	} else {
		text = `User selected:\n${answers.map((answer) => `- ${formatAnswerForModel(answer)}`).join("\n")}`;
	}
	return {
		content: [{ type: "text" as const, text }],
		details: buildStructuredResult("answered", question, mode, answers, context),
	};
}

function pushQuestionChrome(
	lines: string[],
	theme: any,
	width: number,
	question: string,
	context: string | undefined,
): void {
	const add = (text: string) => lines.push(truncateToWidth(text, width));
	add(theme.fg("accent", "─".repeat(width)));
	addWrapped(lines, theme.fg("text", ` ${question}`), width);
	if (context) {
		lines.push("");
		addWrapped(lines, theme.fg("muted", ` ${context}`), width);
	}
	lines.push("");
}

function makeWidthCache() {
	let cachedLines: string[] | undefined;
	let cachedWidth = -1;
	return {
		get(width: number) {
			if (cachedLines && cachedWidth === width) return cachedLines;
			return undefined;
		},
		set(width: number, lines: string[]) {
			cachedLines = lines;
			cachedWidth = width;
			return lines;
		},
		invalidate() {
			cachedLines = undefined;
		},
	};
}

async function askSingleChoice(
	ctx: any,
	question: string,
	context: string | undefined,
	options: AskOption[],
): Promise<AskAnswer | null> {
	const otherLabel = getOtherLabel(options);
	const allOptions: DisplayOption[] = [
		...options.map((option, index) => ({ ...option, id: `option:${index}`, index: index + 1 })),
		{ id: "other", label: otherLabel, value: "__other__", isOther: true },
	];

	return ctx.ui.custom<AskAnswer | null>((tui: any, theme: any, _kb: any, done: (result: AskAnswer | null) => void) => {
		let optionIndex = 0;
		let editMode = false;
		const cache = makeWidthCache();
		const editor = new Editor(tui, createEditorTheme(theme));

		editor.onSubmit = (value) => {
			const trimmed = value.trim();
			if (!trimmed) return;
			done({ type: "other", label: trimmed, value: trimmed });
		};

		const refresh = () => {
			cache.invalidate();
			tui.requestRender();
		};

		return {
			invalidate: () => cache.invalidate(),
			handleInput(data: string) {
				if (editMode) {
					if (matchesKey(data, Key.escape)) {
						editMode = false;
						editor.setText("");
						refresh();
						return;
					}
					editor.handleInput(data);
					refresh();
					return;
				}
				if (matchesKey(data, Key.up)) {
					optionIndex = Math.max(0, optionIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.enter)) {
					const selected = allOptions[optionIndex];
					if (selected.isOther) {
						editMode = true;
						editor.setText("");
						refresh();
						return;
					}
					done({ type: "option", label: selected.label, value: selected.value, index: selected.index! });
					return;
				}
				if (matchesKey(data, Key.escape)) done(null);
			},
			render(width: number) {
				const hit = cache.get(width);
				if (hit) return hit;
				const lines: string[] = [];
				const add = (text: string) => lines.push(truncateToWidth(text, width));
				pushQuestionChrome(lines, theme, width, question, context);
				for (let i = 0; i < allOptions.length; i++) {
					const option = allOptions[i];
					const selected = i === optionIndex;
					const prefix = selected ? theme.fg("accent", "> ") : "  ";
					const label = option.isOther ? option.label : `${option.index}. ${option.label}`;
					add(`${prefix}${selected ? theme.fg("accent", label) : theme.fg("text", label)}`);
					if (option.description) addWrapped(lines, theme.fg("muted", option.description), width, "     ");
				}
				if (editMode) {
					lines.push("");
					add(theme.fg("muted", " Write your custom answer:"));
					for (const line of editor.render(Math.max(1, width - 2))) add(` ${line}`);
					lines.push("");
					add(theme.fg("dim", " Enter to submit • Esc to go back"));
				} else {
					lines.push("");
					add(theme.fg("dim", " ↑↓ navigate • Enter select • Esc cancel"));
				}
				add(theme.fg("accent", "─".repeat(width)));
				return cache.set(width, lines);
			},
		};
	});
}

async function askMultiChoice(
	ctx: any,
	question: string,
	context: string | undefined,
	options: AskOption[],
): Promise<AskAnswer[] | null> {
	const otherLabel = getOtherLabel(options);
	const allItems: DisplayOption[] = [
		...options.map((option, index) => ({ ...option, id: `option:${index}`, index: index + 1 })),
		{ id: "other", label: otherLabel, value: "__other__", isOther: true },
		{ id: "submit", label: "Submit", value: "__submit__", isSubmit: true },
	];

	return ctx.ui.custom<AskAnswer[] | null>((tui: any, theme: any, _kb: any, done: (result: AskAnswer[] | null) => void) => {
		let optionIndex = 0;
		let editMode = false;
		const cache = makeWidthCache();
		const selected = new Map<string, AskAnswer>();
		const editor = new Editor(tui, createEditorTheme(theme));

		editor.onSubmit = (value) => {
			const trimmed = value.trim();
			if (!trimmed) return;
			selected.set("other", { type: "other", label: trimmed, value: trimmed });
			editMode = false;
			refresh();
		};

		const refresh = () => {
			cache.invalidate();
			tui.requestRender();
		};

		function toggleOption(item: DisplayOption) {
			if (selected.has(item.id)) selected.delete(item.id);
			else {
				selected.set(item.id, { type: "option", label: item.label, value: item.value, index: item.index! });
			}
			refresh();
		}

		return {
			invalidate: () => cache.invalidate(),
			handleInput(data: string) {
				if (editMode) {
					if (matchesKey(data, Key.escape)) {
						editMode = false;
						editor.setText(selected.get("other")?.label || "");
						refresh();
						return;
					}
					editor.handleInput(data);
					refresh();
					return;
				}
				if (matchesKey(data, Key.up)) {
					optionIndex = Math.max(0, optionIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					optionIndex = Math.min(allItems.length - 1, optionIndex + 1);
					refresh();
					return;
				}
				const current = allItems[optionIndex];
				if (matchesKey(data, Key.space)) {
					if (current.isSubmit) return;
					if (current.isOther) {
						if (selected.has("other")) {
							selected.delete("other");
							refresh();
						} else {
							editMode = true;
							editor.setText("");
							refresh();
						}
						return;
					}
					toggleOption(current);
					return;
				}
				if (matchesKey(data, Key.enter)) {
					if (current.isSubmit) {
						if (selected.size > 0) done(sortAnswers(Array.from(selected.values())));
						return;
					}
					if (current.isOther) {
						editMode = true;
						editor.setText(selected.get("other")?.label || "");
						refresh();
						return;
					}
					toggleOption(current);
					return;
				}
				if (matchesKey(data, Key.escape)) done(null);
			},
			render(width: number) {
				const hit = cache.get(width);
				if (hit) return hit;
				const lines: string[] = [];
				const add = (text: string) => lines.push(truncateToWidth(text, width));
				pushQuestionChrome(lines, theme, width, question, context);
				for (let i = 0; i < allItems.length; i++) {
					const item = allItems[i];
					const isFocused = i === optionIndex;
					const prefix = isFocused ? theme.fg("accent", "> ") : "  ";
					if (item.isSubmit) {
						const label = selected.size > 0 ? `✓ ${item.label} (${selected.size} selected)` : `○ ${item.label}`;
						const styled = isFocused
							? theme.fg("accent", label)
							: theme.fg(selected.size > 0 ? "success" : "dim", label);
						add(`${prefix}${styled}`);
						continue;
					}
					if (item.isOther) {
						const other = selected.get("other");
						const marker = other ? "[x]" : "[ ]";
						const suffix = other ? ` — ${other.label}` : "";
						const text = `${marker} ${item.label}${suffix}`;
						add(`${prefix}${isFocused ? theme.fg("accent", text) : theme.fg(other ? "success" : "text", text)}`);
						continue;
					}
					const checked = selected.has(item.id);
					const label = `${checked ? "[x]" : "[ ]"} ${item.index}. ${item.label}`;
					add(`${prefix}${isFocused ? theme.fg("accent", label) : theme.fg(checked ? "success" : "text", label)}`);
					if (item.description) addWrapped(lines, theme.fg("muted", item.description), width, "     ");
				}
				if (editMode) {
					lines.push("");
					add(theme.fg("muted", " Write your custom answer:"));
					for (const line of editor.render(Math.max(1, width - 2))) add(` ${line}`);
					lines.push("");
					add(theme.fg("dim", " Enter to save • Esc to go back"));
				} else {
					lines.push("");
					if (selected.size === 0) add(theme.fg("warning", " Select at least one answer before submitting."));
					add(theme.fg("dim", " ↑↓ navigate • Space toggle • Enter edit/submit • Esc cancel"));
				}
				add(theme.fg("accent", "─".repeat(width)));
				return cache.set(width, lines);
			},
		};
	});
}

const SHARED_UI_LOCK_KEY = "__piSharedUiLock";
function getSharedUiLock() {
	const g = globalThis as any;
	if (!g[SHARED_UI_LOCK_KEY]) {
		let chain: Promise<void> = Promise.resolve();
		g[SHARED_UI_LOCK_KEY] = {
			withLock<T>(fn: () => T | Promise<T>): Promise<T> {
				const prev = chain;
				let release: () => void;
				chain = new Promise<void>((r) => {
					release = r;
				});
				return prev.then(fn).finally(() => release!());
			},
		};
	}
	return g[SHARED_UI_LOCK_KEY] as { withLock<T>(fn: () => T | Promise<T>): Promise<T> };
}

export default function askUserQuestion(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user_question",
		label: "ask_user_question",
		description:
			"Ask the user one question and wait. Use for ambiguous requirements, preferences, or decisions that change implementation.",
		promptSnippet: "Ask one clarifying question before continuing; do not guess.",
		promptGuidelines: [
			"One question per call. Several questions → several calls.",
			'Options: put the recommended choice first with " (Recommended)". Other is always available.',
			"multiSelect only when several answers to the same question are valid.",
		],
		parameters: AskUserQuestionParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const options = normalizeOptions(params.options);
			const context = params.details?.trim() || undefined;
			const mode: AskUserQuestionMode =
				options.length === 0 ? "text" : params.multiSelect ? "multi-select" : "single-select";

			if (signal?.aborted) return cancelledResult(params.question, mode, context);
			if (!ctx.hasUI) {
				return unavailableResult(params.question, mode, "ask_user_question requires interactive mode UI", context);
			}

			return getSharedUiLock().withLock(async () => {
				if (mode === "text") {
					const editorTitle = context ? `${params.question}\n\n${context}` : params.question;
					const answer = await ctx.ui.editor(editorTitle);
					if (answer === undefined) return cancelledResult(params.question, mode, context);
					return buildResult(params.question, context, mode, [
						{ type: "text", label: answer.trim(), value: answer.trim() },
					]);
				}
				if (mode === "single-select") {
					const answer = await askSingleChoice(ctx, params.question, context, options);
					if (!answer) return cancelledResult(params.question, mode, context);
					return buildResult(params.question, context, mode, [answer]);
				}
				const answers = await askMultiChoice(ctx, params.question, context, options);
				if (!answers) return cancelledResult(params.question, mode, context);
				return buildResult(params.question, context, mode, answers);
			});
		},

		renderCall(args, theme) {
			const options = normalizeOptions(
				args.options as Array<{ label: string; value?: string; description?: string }> | undefined,
			);
			let text = theme.fg("toolTitle", theme.bold("ask_user_question ")) + theme.fg("muted", args.question);
			if (args.multiSelect) text += theme.fg("dim", " [multi-select]");
			if (options.length > 0) {
				const labels = [...options.map((option) => option.label), getOtherLabel(options)].join(", ");
				text += `\n${theme.fg("dim", `  Options: ${labels}`)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as AskUserQuestionResultDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.status === "cancelled") {
				return new Text(theme.fg("warning", details.message || "Cancelled"), 0, 0);
			}
			if (details.status === "unavailable") {
				return new Text(theme.fg("warning", details.message || "ask_user_question unavailable"), 0, 0);
			}
			const lines = details.answers.map((answer) => {
				if (answer.type === "text") {
					return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.label || "(empty response)")}`;
				}
				if (answer.type === "other") {
					return `${theme.fg("success", "✓ ")}${theme.fg("muted", "Other: ")}${theme.fg("accent", answer.label)}`;
				}
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", `${answer.index}. ${answer.label}`)}`;
			});
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
