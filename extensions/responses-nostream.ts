/**
 * OpenAI Responses over a NON-streaming upstream request.
 *
 * Why
 * ---
 * pi hardcodes `stream: true` in every built-in API adapter and exposes no
 * models.json field or environment variable to turn it off. Some proxies answer
 * the streaming Responses path badly while the same request with `stream: false`
 * returns a normal 200. Concretely, on CPA the Mirasim channel answers
 * `502 upstream_protocol_error` for `POST /v1/responses` with `stream: true`
 * (its codex -> openai-response streaming translation), but returns 200 with
 * `stream: false`, and streams fine on `/v1/chat/completions`.
 *
 * How
 * ---
 * `ProviderRequestOptions.fetch` is forwarded by the openai-responses adapter into
 * the OpenAI SDK client (`createClient(..., options?.fetch, ...)` ->
 * `new OpenAI({ fetch, ... })`), so it is the one seam that can change the wire
 * request without reimplementing message conversion, tool handling, usage
 * accounting, or cancellation. This extension registers a routing api tag; a model
 * whose `api` is that tag is streamed through the built-in `openAIResponsesApi()`
 * with a fetch that:
 *
 *   1. rewrites `stream: true` -> `false` on the outgoing request, and
 *   2. replays the returned complete Responses object as the SSE event sequence
 *      pi's `processResponsesStream` consumes.
 *
 * Only the event sequence matters: slots are created by `response.output_item.added`
 * and filled by `response.output_item.done`, which is where pi reads message text,
 * the reasoning signature (`JSON.stringify(item)`, including `encrypted_content`),
 * and tool-call arguments. Usage and stop reason come from the terminal event's
 * `response`. No per-token deltas are needed, so no synthetic text can drift from
 * the final item.
 *
 * Models that keep `api: "openai-responses"` are untouched and keep native
 * streaming: the composer only routes a model here when its `api` equals the tag.
 *
 * Trade-off
 * ---------
 * The whole answer arrives at once, so the TUI cannot render it incrementally.
 * This is the cost of avoiding the broken streaming path; prefer a working
 * streaming API (e.g. `openai-completions`) when one exists.
 *
 * Wire it up in ~/.pi/agent/models.json:
 *   { "id": "mira/gpt-6-astra", "api": "openai-responses-nostream", ... }
 *
 * Verify against any model whose endpoint streams correctly by temporarily
 * switching its `api` to the tag, then compare answer text, tool calls, thinking
 * signature, and usage against the native path. Set
 * PI_RESPONSES_NOSTREAM_DEBUG=1 to log shim decisions to stderr.
 */

import {
	openAIResponsesApi,
	type Api,
	type AssistantMessageEventStream,
	type FetchFunction,
	type Model,
	type SimpleStreamOptions,
	type StreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** models.json `api` value that routes a model through this shim. */
const ROUTING_API = "openai-responses-nostream";
/** The real wire API handed to the built-in adapter. */
const UPSTREAM_API = "openai-responses";
/** Providers whose models may carry the routing tag. */
const PROVIDERS = ["DDDD"];

const DEBUG = process.env.PI_RESPONSES_NOSTREAM_DEBUG === "1";

function debug(...args: unknown[]): void {
	if (DEBUG) console.error("[responses-nostream]", ...args);
}

type ResponsesItem = { type?: string; [key: string]: unknown };

type ResponsesBody = {
	id?: string;
	status?: string;
	output?: ResponsesItem[];
	usage?: unknown;
	error?: unknown;
	[key: string]: unknown;
};

function sseEvent(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Replay a complete Responses object as the SSE sequence `processResponsesStream`
 * expects. Exported for tests.
 */
export function synthesizeResponsesSse(body: ResponsesBody): string {
	const events: string[] = [];
	events.push(sseEvent({ type: "response.created", response: { id: body.id } }));

	const items = Array.isArray(body.output) ? body.output : [];
	items.forEach((item, output_index) => {
		events.push(sseEvent({ type: "response.output_item.added", output_index, item }));
		events.push(sseEvent({ type: "response.output_item.done", output_index, item }));
	});

	if (body.status === "failed") {
		events.push(sseEvent({ type: "response.failed", response: body }));
	} else if (body.status === "incomplete") {
		events.push(sseEvent({ type: "response.incomplete", response: body }));
	} else {
		events.push(sseEvent({ type: "response.completed", response: body }));
	}
	return events.join("");
}

/**
 * fetch that turns a streaming Responses request into a non-streaming one and
 * replays the JSON answer as SSE. Anything it does not recognise is passed
 * through untouched, so it is safe to install on a whole provider.
 */
const nonStreamingResponsesFetch: FetchFunction = async (input, init) => {
	const requestInit = init ?? {};
	const rawBody = typeof requestInit.body === "string" ? requestInit.body : undefined;

	let payload: Record<string, unknown> | undefined;
	if (rawBody !== undefined) {
		try {
			const parsed: unknown = JSON.parse(rawBody);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				payload = parsed as Record<string, unknown>;
			}
		} catch {
			payload = undefined;
		}
	}
	if (!payload || payload.stream !== true) {
		return fetch(input, init);
	}

	const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
	payload.stream = false;
	debug("non-streaming upstream request", url, "model:", payload.model, "reasoning:", JSON.stringify(payload.reasoning));

	const upstream = await fetch(url, {
		method: requestInit.method ?? "POST",
		headers: requestInit.headers,
		body: JSON.stringify(payload),
		signal: requestInit.signal ?? undefined,
	});
	if (!upstream.ok) {
		// Hand the error response back verbatim so the SDK raises its normal
		// APIError (status + parsed body) and pi formats the provider message.
		debug("upstream returned", upstream.status, "- passing through");
		return upstream;
	}

	let body: ResponsesBody;
	try {
		body = (await upstream.json()) as ResponsesBody;
	} catch (error) {
		debug("upstream body was not JSON - passing through:", String(error));
		return upstream;
	}

	debug(
		"synthesizing SSE:",
		Array.isArray(body.output) ? body.output.length : 0,
		"output items, status:",
		body.status,
	);
	return new Response(synthesizeResponsesSse(body), {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: { "content-type": "text/event-stream" },
	});
};

/**
 * Delegate to the built-in openai-responses adapter with the shim fetch.
 *
 * `composeModelProvider` funnels both `provider.stream` and `provider.streamSimple`
 * into an extension's `streamSimple`, and those two carry different option shapes:
 * the simple path passes a provider-neutral `reasoning` thinking level, the raw path
 * passes a provider-specific `reasoningEffort`. Route to the matching adapter entry
 * point so thinking level is not silently dropped.
 */
function streamNonStreamingResponses(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions | StreamOptions,
): AssistantMessageEventStream {
	// Hand the adapter the canonical api id so the recorded assistant message (and
	// any later session replay) carries a real, recognised wire API.
	const upstreamModel = { ...model, api: UPSTREAM_API } as Model<"openai-responses">;
	const shimmed = { ...options, fetch: nonStreamingResponsesFetch };
	const api = openAIResponsesApi();
	const isSimple = options === undefined || "reasoning" in options || !("reasoningEffort" in options);
	debug(
		"routing to",
		isSimple ? "streamSimple" : "stream",
		"reasoning:",
		(options as { reasoning?: unknown } | undefined)?.reasoning,
		"reasoningEffort:",
		(options as { reasoningEffort?: unknown } | undefined)?.reasoningEffort,
	);
	return isSimple
		? api.streamSimple(upstreamModel, context, shimmed)
		: api.stream(upstreamModel, context, shimmed);
}

export default function (pi: ExtensionAPI) {
	for (const provider of PROVIDERS) {
		pi.registerProvider(provider, {
			api: ROUTING_API,
			streamSimple: streamNonStreamingResponses,
		});
	}
}
