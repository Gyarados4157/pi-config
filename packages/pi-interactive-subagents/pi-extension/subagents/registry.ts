import type { RunningSubagent } from "./types.ts";

/** Active child processes for the current extension instance. */
export const runningSubagents = new Map<string, RunningSubagent>();

/** Names claimed synchronously while parallel spawns are still launching. */
export const reservedNames = new Set<string>();

export function uniqueRunningName(base: string, registryNames?: Set<string>): string {
  const taken = new Set(Array.from(runningSubagents.values()).map((running) => running.name));
  for (const reserved of reservedNames) taken.add(reserved);
  if (registryNames) for (const name of registryNames) taken.add(name);
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

export function resolveRunningByName(name: string): { running: RunningSubagent } | { error: string } {
  const requestedName = name.trim();
  if (!requestedName) return { error: "Provide the exact display name of a running subagent." };

  const matches = Array.from(runningSubagents.values()).filter(
    (running) => running.name === requestedName,
  );
  if (matches.length === 1) return { running: matches[0]! };
  if (matches.length === 0) {
    const names = Array.from(runningSubagents.values()).map((running) => running.name);
    const hint = names.length
      ? ` Currently running: ${[...new Set(names)].join(", ")}.`
      : " No subagents are currently running.";
    return { error: `No running subagent named "${requestedName}".${hint}` };
  }

  const candidates = matches.map((running) => `${running.name} [${running.id}]`).join(", ");
  return { error: `Ambiguous subagent name "${requestedName}". Matches: ${candidates}` };
}
