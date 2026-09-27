import type { SessionStats } from "./session.ts";
import type { SubagentResult } from "./types.ts";

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function formatTokens(n: number): string {
  return n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`;
}

export function contextWindowFor(model: string | null | undefined): number | undefined {
  if (!model) return undefined;
  const normalized = model.toLowerCase();
  if (normalized.includes("claude")) return 200_000;
  if (normalized.includes("gpt-4.1") || normalized.includes("gpt-4o")) return 128_000;
  if (normalized.includes("gemini")) return 1_000_000;
  return undefined;
}

export function formatContextUsage(tokens: number, contextWindow: number | undefined): string {
  if (!contextWindow) return `${formatTokens(tokens)} ctx`;
  const pct = (tokens / contextWindow) * 100;
  const max = contextWindow >= 1_000_000
    ? `${(contextWindow / 1_000_000).toFixed(1)}M`
    : `${Math.round(contextWindow / 1000)}k`;
  return `${pct.toFixed(1)}%/${max}`;
}

export function formatUsageSegments(stats: SessionStats): string[] {
  const segments: string[] = [];
  if (stats.inputTokens) segments.push(`↑${formatTokens(stats.inputTokens)}`);
  if (stats.outputTokens) segments.push(`↓${formatTokens(stats.outputTokens)}`);
  if (stats.cacheReadTokens) segments.push(`R${formatTokens(stats.cacheReadTokens)}`);
  if (stats.cacheWriteTokens) segments.push(`W${formatTokens(stats.cacheWriteTokens)}`);
  if (stats.cost) segments.push(`$${stats.cost.toFixed(3)}`);
  return segments;
}

export function resolveResultPresentation(
  result: Pick<
    SubagentResult,
    "exitCode" | "elapsed" | "summary" | "sessionFile" | "sessionId" | "errorMessage"
  >,
  name: string,
): string {
  // Do not append a resume instruction to an automatic completion message.
  // `subagent_message` resumes a finished session, so putting that call in the
  // result steer creates an accidental completed → resume → completed loop.
  if (result.errorMessage) {
    return (
      `Sub-agent "${name}" failed after ${formatElapsed(result.elapsed)} ` +
      `(provider/agent error — auto-retry exhausted).\n\n` +
      `Error: ${result.errorMessage}\n\n` +
      `The subagent did not produce a result. Spawn a fresh subagent if the task needs to be retried.`
    );
  }

  return result.exitCode !== 0
    ? `Sub-agent "${name}" failed (exit code ${result.exitCode}).\n\n${result.summary}`
    : `Sub-agent "${name}" completed (${formatElapsed(result.elapsed)}).\n\n${result.summary}`;
}
