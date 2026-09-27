import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSurface,
  sendLongCommand,
  shellEscape,
} from "./mux.ts";
import {
  countSessionEntryLines,
  getSessionId,
  readNameRegistry,
  readSubagentLoadout,
  resolveNameInRegistry,
} from "./session.ts";
import { getSubagentActivityFile } from "./activity.ts";
import { createStatusState } from "./status.ts";
import {
  applySandboxToParts,
  getArtifactDir,
  getShellReadyDelayMs,
  subagentOwnership,
  withLaunchSurface,
} from "./spawn.ts";
import { runningSubagents } from "./registry.ts";
import type { RunningSubagent, SubagentContext } from "./types.ts";

const SUBAGENTS_DIR = dirname(fileURLToPath(import.meta.url));

export function resolveResumeLaunchBehavior(): { autoExit: boolean; interactive: boolean } {
  // A resumed task is autonomous: it must run to completion and deliver a
  // result instead of parking the pane for manual input.
  return { autoExit: true, interactive: false };
}

export type ResumeLaunchResult =
  | {
      ok: true;
      running: RunningSubagent;
      sessionId: string;
      entryCountBefore: number;
    }
  | { ok: false; error: string };

/**
 * Reconstruct and launch a finished child session from its persisted loadout.
 * This module owns the filesystem/name-registry safety checks; the extension
 * entry point only decides how to present the returned result to pi.
 */
export async function launchResumedSubagent(
  name: string,
  message: string,
  ctx: SubagentContext,
): Promise<ResumeLaunchResult> {
  const parentArtifactDir = getArtifactDir(
    ctx.sessionManager.getSessionDir(),
    ctx.sessionManager.getSessionId(),
  );
  const entry = resolveNameInRegistry(parentArtifactDir, name);
  if (!entry) {
    const known = Object.keys(readNameRegistry(parentArtifactDir));
    return {
      ok: false,
      error:
        `No subagent named "${name}" in this session. ` +
        (known.length > 0
          ? `Known subagents: ${known.join(", ")}.`
          : "No subagents have been spawned in this session yet."),
    };
  }

  const sessionPath = entry.sessionFile;
  if (!sessionPath || !existsSync(sessionPath)) {
    return {
      ok: false,
      error:
        `Subagent "${name}" is registered but its session file is gone ` +
        `(${sessionPath}). It cannot be resumed. Spawn a fresh subagent instead.`,
    };
  }

  const loadout = readSubagentLoadout(sessionPath);
  if (!loadout) {
    return {
      ok: false,
      error:
        `Cannot safely resume "${name}": no sandbox snapshot found for this session ` +
        `(it predates sandboxed resume, or its .loadout.json sidecar was removed). ` +
        `Resuming would relaunch with all global extensions and the full toolset, so this is refused. ` +
        `Re-run the task as a fresh subagent instead.`,
    };
  }

  const resumedSessionId = entry.sessionId ?? getSessionId(sessionPath) ?? name;
  const entryCountBefore = countSessionEntryLines(sessionPath);
  const { autoExit, interactive } = resolveResumeLaunchBehavior();
  const startTime = Date.now();
  const id = Math.random().toString(16).slice(2, 10);

  const sessionId = ctx.sessionManager.getSessionId();
  const artifactDir = getArtifactDir(ctx.sessionManager.getSessionDir(), sessionId);

  const surface = createSurface(name, subagentOwnership(artifactDir));
  return withLaunchSurface(surface, true, async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, getShellReadyDelayMs()));

  const parts = ["pi", "--session", shellEscape(sessionPath)];
  const subagentDonePath = join(SUBAGENTS_DIR, "subagent-done.ts");
  parts.push("-e", shellEscape(subagentDonePath));

  const activityFile = getSubagentActivityFile(artifactDir, id);
  mkdirSync(dirname(activityFile), { recursive: true });
  applySandboxToParts(parts, loadout, { artifactDir, name });

  const resumeMsgTimestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const resumeMsgFile = join(
    artifactDir,
    "subagent-resume",
    `${name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "resume"}-${resumeMsgTimestamp}.md`,
  );
  mkdirSync(dirname(resumeMsgFile), { recursive: true });
  writeFileSync(resumeMsgFile, message, "utf8");
  parts.push(shellEscape(`@${resumeMsgFile}`));

  const envParts: string[] = [];
  const resumeAgentDir = loadout.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? null;
  if (resumeAgentDir) envParts.push(`PI_CODING_AGENT_DIR=${shellEscape(resumeAgentDir)}`);
  if (loadout.spawnable && loadout.spawnable.length > 0) {
    envParts.push(`PI_SUBAGENT_ALLOWED=${shellEscape(loadout.spawnable.join(","))}`);
  }
  if (loadout.agent) envParts.push(`PI_SUBAGENT_AGENT=${shellEscape(loadout.agent)}`);
  envParts.push(`PI_SUBAGENT_NAME=${shellEscape(name)}`);
  envParts.push(`PI_SUBAGENT_SESSION=${shellEscape(sessionPath)}`);
  envParts.push(`PI_SUBAGENT_ID=${shellEscape(id)}`);
  envParts.push(`PI_SUBAGENT_ACTIVITY_FILE=${shellEscape(activityFile)}`);
  if (autoExit) envParts.push("PI_SUBAGENT_AUTO_EXIT=1");
  const envPrefix = envParts.join(" ") + " ";
  const cdPrefix = loadout.cwd ? `cd ${shellEscape(loadout.cwd)} && ` : "";

  const command = `${cdPrefix}${envPrefix}${parts.join(" ")}; echo '__SUBAGENT_DONE_'$?'__'`;
  const launchScriptFile = join(
    artifactDir,
    "subagent-scripts",
    `${name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "resume"}-resume-${Date.now()}.sh`,
  );
  sendLongCommand(surface, command, {
    scriptPath: launchScriptFile,
    scriptPreamble: [
      `# Subagent resume script for ${name}`,
      `# Generated: ${new Date().toISOString()}`,
      `# Session: ${sessionPath}`,
      `# Surface: ${surface}`,
      `# Resume message file: ${resumeMsgFile}`,
    ].join("\n"),
  });

  const running: RunningSubagent = {
    id,
    name,
    task: message,
    surface,
    startTime,
    sessionFile: sessionPath,
    launchScriptFile,
    activityFile,
    interactive,
    statusState: createStatusState({ source: "pi", startTimeMs: startTime }),
  };
  runningSubagents.set(id, running);

  return { ok: true, running, sessionId: resumedSessionId, entryCountBefore };
  });
}
