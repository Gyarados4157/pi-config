import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  advanceStatusState,
  capStatusLines,
  formatStatusAggregate,
  formatTransitionLine,
  loadStatusConfig,
} from "./status.ts";
import { observeRunningSubagent } from "./watch.ts";
import { runningSubagents } from "./registry.ts";
import { clearStatusInterval, setStatusInterval } from "./runtime.ts";

/**
 * Background supervision: every second, poll each running child's activity
 * file, advance its status state machine, and steer the parent session when a
 * non-interactive child stalls or recovers. Interactive children only update
 * the widget — waking the orchestrator would burn a turn on a no-op ping
 * while the user is working in the child's pane.
 *
 * Returns a stop function. Safe to call start multiple times (idempotent).
 */
export function createStatusSupervisor(params: {
  updateWidget: () => void;
  statusEnabled?: () => boolean;
  lineLimit?: () => number;
}): { start: (pi: ExtensionAPI) => void; stop: () => void } {
  let interval: ReturnType<typeof setInterval> | null = null;
  const config = loadStatusConfig();

  function stop(): void {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    clearStatusInterval();
  }

  function start(pi: ExtensionAPI): void {
    if (!(params.statusEnabled?.() ?? config.enabled) || interval) return;

    interval = setInterval(() => {
      if (runningSubagents.size === 0) {
        stop();
        return;
      }

      const transitionLines: string[] = [];
      const now = Date.now();
      let shouldRefreshWidget = false;

      for (const running of runningSubagents.values()) {
        observeRunningSubagent(running, now);
        const { nextState, snapshot, transition } = advanceStatusState(running.statusState, now);
        if (nextState.currentKind !== running.statusState.currentKind) {
          shouldRefreshWidget = true;
        }
        running.statusState = nextState;

        if (transition && !running.interactive) {
          transitionLines.push(formatTransitionLine(running.name, snapshot, transition));
        }
      }

      if (shouldRefreshWidget) params.updateWidget();

      if (transitionLines.length > 0) {
        const lineLimit = params.lineLimit?.() ?? config.lineLimit;
        const capped = capStatusLines(transitionLines, lineLimit);
        pi.sendMessage(
          {
            customType: "subagent_status",
            content: formatStatusAggregate(transitionLines, lineLimit),
            display: true,
            details: { lines: capped.visibleLines, overflow: capped.overflow },
          },
          { triggerTurn: true, deliverAs: "steer" },
        );
      }
    }, 1000);

    setStatusInterval(interval);
  }

  return { start, stop };
}
