/**
 * Process-global lifecycle contracts shared by the parent extension and the
 * child-side subagent-done extension.
 *
 * The symbols are intentional: pi may load the same extension through more
 * than one jiti module instance, and the child extension is a separate entry
 * point. Keeping the handshake here documents and tests the seam without
 * changing its process-global semantics.
 */

export const WIDGET_INTERVAL_KEY = Symbol.for("pi-subagents/widget-interval");
export const STATUS_INTERVAL_KEY = Symbol.for("pi-subagents/status-interval");
export const POLL_ABORT_KEY = Symbol.for("pi-subagents/poll-abort-controller");
export const RUNNING_CHILDREN_COUNT_KEY = Symbol.for("pi-subagents/running-children-count");

export type RunningChildrenCountReader = () => number;

type RuntimeGlobals = typeof globalThis & {
  [WIDGET_INTERVAL_KEY]?: ReturnType<typeof setInterval> | null;
  [STATUS_INTERVAL_KEY]?: ReturnType<typeof setInterval> | null;
  [POLL_ABORT_KEY]?: AbortController;
  [RUNNING_CHILDREN_COUNT_KEY]?: RunningChildrenCountReader;
};

const globals = globalThis as RuntimeGlobals;

/** Clear stale timers and abort polling left behind by a pi `/reload`. */
export function resetReloadableRuntime(): AbortController {
  if (globals[WIDGET_INTERVAL_KEY]) {
    clearInterval(globals[WIDGET_INTERVAL_KEY]!);
    globals[WIDGET_INTERVAL_KEY] = null;
  }
  if (globals[STATUS_INTERVAL_KEY]) {
    clearInterval(globals[STATUS_INTERVAL_KEY]!);
    globals[STATUS_INTERVAL_KEY] = null;
  }
  globals[POLL_ABORT_KEY]?.abort();
  const controller = new AbortController();
  globals[POLL_ABORT_KEY] = controller;
  return controller;
}

export function getModuleAbortSignal(): AbortSignal {
  const controller = globals[POLL_ABORT_KEY] ?? resetReloadableRuntime();
  return controller.signal;
}

export function ensureSessionAbortController(): AbortController {
  const current = globals[POLL_ABORT_KEY];
  if (current && !current.signal.aborted) return current;
  return resetReloadableRuntime();
}

export function abortModuleRuntime(): void {
  globals[POLL_ABORT_KEY]?.abort();
}

export function setWidgetInterval(handle: ReturnType<typeof setInterval> | null): void {
  globals[WIDGET_INTERVAL_KEY] = handle;
}

export function clearWidgetInterval(): void {
  const handle = globals[WIDGET_INTERVAL_KEY];
  if (handle) clearInterval(handle);
  globals[WIDGET_INTERVAL_KEY] = null;
}

export function setStatusInterval(handle: ReturnType<typeof setInterval> | null): void {
  globals[STATUS_INTERVAL_KEY] = handle;
}

export function clearStatusInterval(): void {
  const handle = globals[STATUS_INTERVAL_KEY];
  if (handle) clearInterval(handle);
  globals[STATUS_INTERVAL_KEY] = null;
}

export function publishRunningChildrenCount(reader: RunningChildrenCountReader): void {
  globals[RUNNING_CHILDREN_COUNT_KEY] = reader;
}

export function readRunningChildrenCount(): number {
  const reader = globals[RUNNING_CHILDREN_COUNT_KEY];
  if (typeof reader !== "function") return 0;
  try {
    const count = reader();
    return typeof count === "number" && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

export function clearPublishedRunningChildrenCount(): void {
  delete globals[RUNNING_CHILDREN_COUNT_KEY];
}
