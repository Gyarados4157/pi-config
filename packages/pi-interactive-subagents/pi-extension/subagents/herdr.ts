/**
 * Herdr surface layer.
 *
 * Panes use Herdr public IDs (e.g. `w1:p2`). Splits target the parent pi
 * pane (`$HERDR_PANE_ID`) with `--no-focus`, so spawn never steals the
 * user's keyboard.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  planSurfaceGrid,
  planSurfaceSplitAuto,
  splitRatio,
  type LayoutPane,
  type LayoutSnapshot,
} from "./layout.ts";

const execFileAsync = promisify(execFile);
const HERDR_MAX_BUFFER = 4 * 1024 * 1024;

const commandAvailability = new Map<string, boolean>();

function hasCommand(command: string): boolean {
  if (commandAvailability.has(command)) return commandAvailability.get(command)!;
  let available = false;
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    available = true;
  } catch {
    available = false;
  }
  commandAvailability.set(command, available);
  return available;
}

export function isHerdrAvailable(): boolean {
  return (
    process.env.HERDR_ENV === "1" &&
    typeof process.env.HERDR_PANE_ID === "string" &&
    process.env.HERDR_PANE_ID.length > 0 &&
    hasCommand("herdr")
  );
}

export function herdrSetupHint(): string {
  return "Start pi inside a Herdr pane (`herdr`, then `pi`).";
}

function requireHerdr(): void {
  if (!isHerdrAvailable()) {
    throw new Error(`Herdr is required for subagents. ${herdrSetupHint()}`);
  }
}

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

type HerdrSplitResponse = {
  result?: { pane?: { pane_id?: unknown } };
};

/**
 * Subagent panes created by this extension instance.
 *
 * Panes never reuse ids (herdr closes an id for good), so entries for closed
 * panes are harmless — they simply never match a live layout again.
 */
const ownSurfaces = new Set<string>();

/**
 * Hints that identify the panes a session owns.
 *
 * A Herdr tab can hold a single pane from each of several pi sessions, plus
 * other sessions' subagent panes and plain shells. Herdr reports no "spawned
 * by" flag, so ownership is inferred from the two things the spawn path
 * already sets on every pane it creates: the pane label (`pane rename` to the
 * subagent's display name) and the pane's reported agent session file. Panes
 * that match neither are left alone.
 */
export interface SurfaceOwnership {
  /** Subagent display names this session has spawned. */
  names?: Iterable<string>;
  /** Subagent session files this session has spawned. */
  sessionFiles?: Iterable<string>;
}

type PaneIndex = {
  labels: Map<string, string>;
  sessions: Map<string, string>;
  complete: boolean;
};

/**
 * Read pane labels and reported agent sessions in one call.
 *
 * `pane layout` carries geometry but no labels; `pane list` carries labels and
 * agent sessions but no geometry. Ownership needs both, so the two are joined
 * on the pane id.
 */
function readPaneIndex(): PaneIndex {
  const labels = new Map<string, string>();
  const sessions = new Map<string, string>();
  try {
    const stdout = execFileSync("herdr", ["pane", "list"], {
      encoding: "utf8",
      maxBuffer: HERDR_MAX_BUFFER,
    });
    const parsed = JSON.parse(stdout) as {
      result?: {
        panes?: Array<{ pane_id?: unknown; label?: unknown; agent_session?: { value?: unknown } }>;
      };
    };
    if (!Array.isArray(parsed.result?.panes)) {
      throw new Error("Invalid Herdr pane list response");
    }
    for (const pane of parsed.result.panes) {
      if (typeof pane.pane_id !== "string") continue;
      if (typeof pane.label === "string" && pane.label.trim()) {
        labels.set(pane.pane_id, pane.label.trim());
      }
      const value = pane.agent_session?.value;
      if (typeof value === "string" && value.trim()) {
        sessions.set(pane.pane_id, value.trim());
      }
    }
  } catch {
    return { labels, sessions, complete: false };
  }
  return { labels, sessions, complete: true };
}

/**
 * Which panes in the caller's layout are this session's own subagent panes.
 *
 * Everything else in the tab is off limits as a split source: splitting a
 * stranger's pane would carve the new subagent out of another session's space.
 */
function ownedWorkerPanes(
  layout: LayoutSnapshot | undefined,
  mainPaneId: string,
  ownership?: SurfaceOwnership,
): Set<string> {
  const owned = new Set<string>();
  if (!layout) return owned;

  const names = new Set(
    [...(ownership?.names ?? [])].map((name) => name.trim()).filter((name) => name !== ""),
  );
  const sessionFiles = new Set(
    [...(ownership?.sessionFiles ?? [])].map((file) => file.trim()).filter((file) => file !== ""),
  );

  const candidates = layout.panes.filter(
    (pane): pane is LayoutPane & { pane_id: string } =>
      typeof pane.pane_id === "string" && pane.pane_id !== mainPaneId,
  );
  if (candidates.length === 0) return owned;

  const needsIndex =
    candidates.some((pane) => !ownSurfaces.has(pane.pane_id)) &&
    (names.size > 0 || sessionFiles.size > 0);
  const index = needsIndex ? readPaneIndex() : undefined;
  if (index && !index.complete) {
    throw new Error("Herdr pane list unavailable; refusing to split without ownership confirmation");
  }

  for (const pane of candidates) {
    if (ownSurfaces.has(pane.pane_id)) {
      owned.add(pane.pane_id);
      continue;
    }
    if (!index) continue;
    const label = index.labels.get(pane.pane_id);
    if (label !== undefined && names.has(label)) {
      owned.add(pane.pane_id);
      continue;
    }
    const session = index.sessions.get(pane.pane_id);
    if (session !== undefined && sessionFiles.has(session)) {
      owned.add(pane.pane_id);
    }
  }
  return owned;
}

export function requireLayout(
  read: () => LayoutSnapshot | undefined,
  source: string,
): LayoutSnapshot {
  const layout = read();
  if (!layout) {
    throw new Error(`Herdr layout unavailable for ${source}; refusing to split without topology confirmation`);
  }
  if (!layout.panes.some((pane) => pane.pane_id === source)) {
    throw new Error(`Herdr layout does not contain source pane ${source}; refusing to split`);
  }
  return layout;
}

function readLayout(paneId: string): LayoutSnapshot | undefined {
  try {
    // Never read the focused pane's layout: another Herdr tab/client may own
    // focus. The caller pane is the topology root for every subagent split.
    const stdout = execFileSync("herdr", ["pane", "layout", "--pane", paneId], {
      encoding: "utf8",
      maxBuffer: HERDR_MAX_BUFFER,
    });
    const parsed = JSON.parse(stdout) as {
      result?: { layout?: LayoutSnapshot };
    };
    const layout = parsed.result?.layout;
    return layout && Array.isArray(layout.panes) && layout.panes.length > 0 ? layout : undefined;
  } catch {
    return undefined;
  }
}

export function createSurface(name: string, ownership?: SurfaceOwnership): string {
  requireHerdr();
  const main = process.env.HERDR_PANE_ID;
  if (!main) throw new Error("No Herdr source pane is available");
  const layout = requireLayout(() => readLayout(main), main);
  const ownedPaneIds = ownedWorkerPanes(layout, main, ownership);
  const plan = planSurfaceGrid({ mainPaneId: main, layout, ownedPaneIds });
  return createSurfaceSplitWithRatio(name, plan.direction, plan.source, plan.ratio);
}

export function createSurfaceSplitAuto(name: string, fromSurface?: string): string {
  requireHerdr();
  const source = fromSurface ?? process.env.HERDR_PANE_ID;
  if (!source) throw new Error("No Herdr source pane is available");
  const layout = requireLayout(() => readLayout(source), source);
  const plan = planSurfaceSplitAuto({ source, layout });
  return createSurfaceSplitWithRatio(name, plan.direction, plan.source, plan.ratio);
}

export function createSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  requireHerdr();
  if (direction === "left" || direction === "up") {
    throw new Error(`Herdr only supports right/down splits; received ${direction}`);
  }

  const source = fromSurface ?? process.env.HERDR_PANE_ID;
  if (!source) throw new Error("No Herdr source pane is available");

  return createSurfaceSplitWithRatio(name, direction, source, splitRatio());
}

function createSurfaceSplitWithRatio(
  name: string,
  direction: "right" | "down",
  source: string,
  ratio: number,
): string {
  const stdout = execFileSync(
    "herdr",
    [
      "pane",
      "split",
      "--pane",
      source,
      "--direction",
      direction,
      "--ratio",
      String(ratio),
      "--cwd",
      process.cwd(),
      "--no-focus",
    ],
    { encoding: "utf8", maxBuffer: HERDR_MAX_BUFFER },
  );

  let response: HerdrSplitResponse;
  try {
    response = JSON.parse(stdout) as HerdrSplitResponse;
  } catch {
    throw new Error(`Unexpected Herdr pane split output: ${stdout.trim()}`);
  }
  const paneId = response.result?.pane?.pane_id;
  if (typeof paneId !== "string" || paneId.length === 0) {
    throw new Error(`Herdr pane split did not return a pane id: ${stdout.trim()}`);
  }

  if (name.trim()) {
    try {
      execFileSync("herdr", ["pane", "rename", paneId, name], {
        encoding: "utf8",
        maxBuffer: HERDR_MAX_BUFFER,
      });
    } catch {
      // Label is cosmetic; the pane already exists.
    }
  }
  // Every pane this extension creates is ours, whichever helper made it.
  ownSurfaces.add(paneId);
  return paneId;
}

export function sendCommand(surface: string, command: string): void {
  requireHerdr();
  execFileSync("herdr", ["pane", "send-text", surface, command], {
    encoding: "utf8",
    maxBuffer: HERDR_MAX_BUFFER,
  });
  execFileSync("herdr", ["pane", "send-keys", surface, "enter"], {
    encoding: "utf8",
    maxBuffer: HERDR_MAX_BUFFER,
  });
}

export function sendLongCommand(
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string {
  const scriptPath =
    options?.scriptPath ??
    join(
      tmpdir(),
      "pi-subagent-scripts",
      `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sh`,
    );
  mkdirSync(dirname(scriptPath), { recursive: true });

  const scriptParts = ["#!/bin/bash"];
  if (options?.scriptPreamble) scriptParts.push(options.scriptPreamble.trimEnd());
  scriptParts.push(command);
  writeFileSync(scriptPath, scriptParts.join("\n") + "\n", { mode: 0o755 });
  sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
  return scriptPath;
}

export function unwrapPaneRead(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return stdout;
  try {
    const parsed = JSON.parse(trimmed) as {
      result?: { text?: unknown; content?: unknown };
      text?: unknown;
    };
    const text = parsed.result?.text ?? parsed.result?.content ?? parsed.text;
    if (typeof text === "string") return text;
  } catch {
    // Not JSON after all — return the raw capture.
  }
  return stdout;
}

export function readScreen(surface: string, lines = 50): string {
  requireHerdr();
  return unwrapPaneRead(
    execFileSync(
      "herdr",
      [
        "pane",
        "read",
        surface,
        "--source",
        "recent-unwrapped",
        "--lines",
        String(Math.max(1, lines)),
      ],
      { encoding: "utf8", maxBuffer: HERDR_MAX_BUFFER },
    ),
  );
}

export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  requireHerdr();
  const { stdout } = await execFileAsync(
    "herdr",
    [
      "pane",
      "read",
      surface,
      "--source",
      "recent-unwrapped",
      "--lines",
      String(Math.max(1, lines)),
    ],
    { encoding: "utf8", maxBuffer: HERDR_MAX_BUFFER },
  );
  return unwrapPaneRead(stdout);
}

export function closeSurface(surface: string): void {
  requireHerdr();
  try {
    execFileSync(
      "herdr",
      ["pane", "release-agent", surface, "--source", "herdr:pi", "--agent", "pi"],
      { encoding: "utf8", maxBuffer: HERDR_MAX_BUFFER },
    );
  } catch {
    // Pane may not be an agent pane, or herdr already released it.
  }
  try {
    execFileSync("herdr", ["pane", "close", surface], {
      encoding: "utf8",
      maxBuffer: HERDR_MAX_BUFFER,
    });
  } catch {
    // Already gone, or herdr refused because the user closed it.
  }
}

export interface PollResult {
  reason: "done" | "sentinel" | "error";
  exitCode: number;
  errorMessage?: string;
}

function interpretExitSidecar(data: unknown): PollResult {
  if (typeof data === "object" && data !== null && "type" in data && (data as { type?: unknown }).type === "error") {
    const candidate = "errorMessage" in data ? (data as { errorMessage?: unknown }).errorMessage : undefined;
    const errorMessage =
      typeof candidate === "string" && candidate.trim() !== ""
        ? candidate
        : "Subagent exited with stopReason=error (no errorMessage in sidecar).";
    return { reason: "error", exitCode: 1, errorMessage };
  }
  return { reason: "done", exitCode: 0 };
}

export const __pollForExitTest__ = { interpretExitSidecar };

export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    interval: number;
    sessionFile?: string;
    sentinelFile?: string;
    onTick?: (elapsed: number) => void;
  },
): Promise<PollResult> {
  const start = Date.now();

  for (;;) {
    if (signal.aborted) throw new Error("Aborted while waiting for subagent to finish");

    if (options.sessionFile) {
      try {
        const exitFile = `${options.sessionFile}.exit`;
        if (existsSync(exitFile)) {
          const data = JSON.parse(readFileSync(exitFile, "utf-8"));
          rmSync(exitFile, { force: true });
          return interpretExitSidecar(data);
        }
      } catch {}
    }

    if (options.sentinelFile) {
      try {
        if (existsSync(options.sentinelFile)) {
          return { reason: "sentinel", exitCode: 0 };
        }
      } catch {}
    }

    try {
      const screen = await readScreenAsync(surface, 5);
      const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
      if (match) {
        return { reason: "sentinel", exitCode: Number.parseInt(match[1], 10) };
      }
    } catch {
      if (options.sessionFile) {
        try {
          const exitFile = `${options.sessionFile}.exit`;
          if (existsSync(exitFile)) {
            const data = JSON.parse(readFileSync(exitFile, "utf-8"));
            rmSync(exitFile, { force: true });
            return interpretExitSidecar(data);
          }
        } catch {}
      }
    }

    options.onTick?.(Math.floor((Date.now() - start) / 1000));
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, options.interval);
      function onAbort() {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
