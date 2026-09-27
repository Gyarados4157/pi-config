import { sendCommand } from "./mux.ts";
import { forceStatusAfterInterrupt } from "./status.ts";
import { resolveRunningByName } from "./registry.ts";
import { observeRunningSubagent } from "./watch.ts";
import type { RunningSubagent } from "./types.ts";

/** Type a one-turn follow-up into a running child's live pane. */
export function steerSubagent(
  running: RunningSubagent,
  message: string,
  send: (surface: string, command: string) => void = sendCommand,
): { ok: true } | { error: string } {
  const flattened = message.replace(/\s*\n\s*/g, " ").trim();
  try {
    send(running.surface, flattened);
    return { ok: true };
  } catch (error: any) {
    return {
      error:
        `Failed to deliver message to subagent "${running.name}" via multiplexer: ` +
        `${error?.message ?? String(error)}`,
    };
  }
}

export interface SteerDependencies {
  send?: (surface: string, command: string) => void;
  updateWidget?: () => void;
}

export function handleSubagentSteer(
  params: { name?: string; message?: string },
  dependencies: SteerDependencies | ((surface: string, command: string) => void) = {},
) {
  const resolvedDependencies: SteerDependencies =
    typeof dependencies === "function" ? { send: dependencies } : dependencies;
  const message = params.message?.trim();
  if (!message) {
    const error = "`message` is required to steer a running subagent.";
    return { content: [{ type: "text" as const, text: error }], details: { error } };
  }

  const resolved = resolveRunningByName(params.name ?? "");
  if ("error" in resolved) {
    return {
      content: [{ type: "text" as const, text: resolved.error }],
      details: { error: resolved.error },
    };
  }

  const running = resolved.running;
  const now = Date.now();
  observeRunningSubagent(running, now);

  const result = steerSubagent(running, message, resolvedDependencies.send);
  if ("error" in result) {
    return {
      content: [{ type: "text" as const, text: result.error }],
      details: { error: result.error, id: running.id, name: running.name },
    };
  }

  running.statusState = forceStatusAfterInterrupt(running.statusState, now);
  resolvedDependencies.updateWidget?.();

  return {
    content: [{
      type: "text" as const,
      text:
        `Message delivered to running subagent "${running.name}". It picks this up at its next ` +
        `turn boundary. If it exits, its result still arrives as a steer message.`,
    }],
    details: { id: running.id, name: running.name, status: "steered" },
  };
}
