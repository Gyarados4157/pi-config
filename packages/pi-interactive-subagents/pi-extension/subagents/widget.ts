import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  classifyStatus,
  type StatusSnapshot,
  type SubagentStatusState,
} from "./status.ts";
import type { RunningSubagent } from "./types.ts";
import { clearWidgetInterval, setWidgetInterval } from "./runtime.ts";

const ACCENT = "\x1b[38;2;77;163;255m";
const RST = "\x1b[0m";
const ICON_YELLOW = "\x1b[38;2;214;181;94m";
const ICON_RED = "\x1b[38;2;224;108;117m";
const ICON_DIM = "\x1b[38;2;128;128;128m";

export type WidgetAgent = Pick<RunningSubagent, "name" | "agent" | "startTime" | "cli" | "statusState">;

export function formatElapsedMMSS(startTime: number, now = Date.now()): string {
  const seconds = Math.floor((now - startTime) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function widgetIcon(kind: StatusSnapshot["kind"]): string {
  switch (kind) {
    case "active":
    case "running":
      return `${ICON_YELLOW}⟳${RST}`;
    case "stalled":
      return `${ICON_RED}⟳${RST}`;
    case "waiting":
    case "starting":
    default:
      return `${ICON_DIM}○${RST}`;
  }
}

export function borderLine(left: string, right: string, width: number): string {
  if (width <= 0) return "";
  if (width === 1) return `${ACCENT}│${RST}`;

  const contentWidth = Math.max(0, width - 2);
  const rightVis = visibleWidth(right);
  if (rightVis >= contentWidth) {
    const truncRight = truncateToWidth(right, contentWidth);
    const rightPad = Math.max(0, contentWidth - visibleWidth(truncRight));
    return `${ACCENT}│${RST}${truncRight}${" ".repeat(rightPad)}${ACCENT}│${RST}`;
  }

  const maxLeft = Math.max(0, contentWidth - rightVis);
  const truncLeft = truncateToWidth(left, maxLeft);
  const leftVis = visibleWidth(truncLeft);
  const pad = Math.max(0, contentWidth - leftVis - rightVis);
  return `${ACCENT}│${RST}${truncLeft}${" ".repeat(pad)}${right}${ACCENT}│${RST}`;
}

export function borderTop(title: string, info: string, width: number): string {
  if (width <= 0) return "";
  if (width === 1) return `${ACCENT}╭${RST}`;

  const inner = Math.max(0, width - 2);
  const titlePart = `─ ${title} `;
  const infoPart = ` ${info} ─`;
  const fillLen = Math.max(0, inner - titlePart.length - infoPart.length);
  const content = `${titlePart}${"─".repeat(fillLen)}${infoPart}`.slice(0, inner).padEnd(inner, "─");
  return `${ACCENT}╭${content}╮${RST}`;
}

export function borderBottom(width: number): string {
  if (width <= 0) return "";
  if (width === 1) return `${ACCENT}╰${RST}`;
  return `${ACCENT}╰${"─".repeat(Math.max(0, width - 2))}╯${RST}`;
}

export function formatWidgetRightLabel(snapshot: StatusSnapshot): string {
  if (snapshot.kind === "starting") return " starting… ";
  if (snapshot.kind === "running") return ` running ${snapshot.elapsedText} `;
  if (snapshot.kind === "active") {
    const label = snapshot.activityLabel ?? snapshot.activeScope;
    const duration = snapshot.activeDurationText ? ` ${snapshot.activeDurationText}` : "";
    return label ? ` active · ${label}${duration} ` : " active ";
  }
  if (snapshot.kind === "waiting") {
    const duration = snapshot.waitingDurationText ? ` ${snapshot.waitingDurationText}` : "";
    const detail = snapshot.statusLabel ? ` · ${snapshot.statusLabel}` : "";
    return ` waiting${duration}${detail} `;
  }

  const detail = snapshot.statusLabel ? ` · ${snapshot.statusLabel}` : "";
  const duration = snapshot.snapshotProblemText ? ` ${snapshot.snapshotProblemText}` : "";
  return ` stalled${detail}${duration} `;
}

export function renderSubagentWidgetLines(
  agents: readonly WidgetAgent[],
  width: number,
  options: { statusEnabled?: boolean; now?: number } = {},
): string[] {
  const now = options.now ?? Date.now();
  const lines = [borderTop("Subagents", `${agents.length} running`, width)];

  for (const agent of agents) {
    const elapsed = formatElapsedMMSS(agent.startTime, now);
    const agentTag = agent.agent ? ` (${agent.agent})` : "";
    const snapshot = classifyStatus(agent.statusState, now);
    const icon = widgetIcon(snapshot.kind);
    const left = ` ${icon} ${elapsed}  ${agent.name}${agentTag} `;
    const right = options.statusEnabled
      ? formatWidgetRightLabel(snapshot)
      : agent.cli === "claude"
        ? " running… "
        : " starting… ";
    lines.push(borderLine(left, right, width));
  }

  lines.push(borderBottom(width));
  return lines;
}

export interface WidgetController {
  update(): void;
  start(): void;
  stop(): void;
}

export function createWidgetController(params: {
  getContext: () => ExtensionContext | null;
  getAgents: () => readonly WidgetAgent[];
  statusEnabled: () => boolean;
}): WidgetController {
  let interval: ReturnType<typeof setInterval> | null = null;

  function stop(): void {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    clearWidgetInterval();
  }

  function update(): void {
    const context = params.getContext();
    if (!context?.hasUI) return;

    const agents = params.getAgents();
    if (agents.length === 0) {
      context.ui.setWidget("subagent-status", undefined);
      stop();
      return;
    }

    context.ui.setWidget(
      "subagent-status",
      (_tui: any, _theme: any) => ({
        invalidate() {},
        render(width: number) {
          return renderSubagentWidgetLines(agents, width, {
            statusEnabled: params.statusEnabled(),
          });
        },
      }),
      { placement: "aboveEditor" },
    );
  }

  function start(): void {
    if (interval) return;
    update();
    interval = setInterval(update, 1000);
    setWidgetInterval(interval);
  }

  return { update, start, stop };
}
