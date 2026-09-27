/**
 * Pure pane-layout policy for Herdr surfaces.
 *
 * This module decides which existing pane to split and how much of it to
 * retain. It deliberately knows nothing about the Herdr CLI; herdr.ts is the
 * adapter that reads a layout and executes the returned plan.
 */

export type SplitDirection = "right" | "down";

export type LayoutPane = {
  pane_id?: unknown;
  rect?: {
    width?: unknown;
    height?: unknown;
    x?: unknown;
    y?: unknown;
  };
};

export type LayoutSnapshot = {
  area?: { width?: unknown; height?: unknown; x?: unknown; y?: unknown };
  panes: LayoutPane[];
};

export type PaneSize = { w: number; h: number };

export type SurfaceSplitPlan = {
  source: string;
  direction: SplitDirection;
  /** Fraction retained by the source pane. */
  ratio: number;
};

const DEFAULT_MAIN_PANE_COLS = 100;
const MIN_MAIN_PANE_COLS = 60;
const MIN_WORKER_PANE_COLS = 40;
const WORKER_SPLIT_RATIO = 0.5;
const WIDE_PANE_RATIO = 1.6;

function totalPaneWidth(layout: LayoutSnapshot): number {
  return layout.panes
    .map(paneSize)
    .filter((size): size is PaneSize => size !== undefined)
    .reduce((sum, size) => sum + size.w, 0);
}

/**
 * Size of the pane a split is measured against.
 *
 * `--ratio` is the fraction of the SOURCE pane's own width that the source
 * keeps, so the base has to be that pane's size — not the tab's, which is
 * larger whenever the tab is shared with another session's panes. Using the
 * tab width there is what made a shared tab hand most of the main pane to the
 * new worker.
 */
function sourcePaneSize(layout: LayoutSnapshot, mainPaneId: string): PaneSize | undefined {
  const main = layout.panes.find((pane) => pane.pane_id === mainPaneId);
  return paneSize(main ?? {});
}

export function paneSize(pane: LayoutPane): PaneSize | undefined {
  const w = Number(pane.rect?.width);
  const h = Number(pane.rect?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
  return { w, h };
}

export function mainPaneCols(raw = process.env.PI_SUBAGENT_MAIN_COLS): number {
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= MIN_MAIN_PANE_COLS) return parsed;
  }
  return DEFAULT_MAIN_PANE_COLS;
}

export function splitRatio(raw = process.env.PI_SUBAGENT_SPLIT_RATIO): number {
  if (raw !== undefined) {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) return parsed;
  }
  return 0.75;
}

function clampRatio(ratio: number): number {
  return Math.min(0.9, Math.max(0.4, ratio));
}

function adaptiveDirection(size: PaneSize | undefined): SplitDirection {
  if (!size) return "right";
  return size.w >= size.h * WIDE_PANE_RATIO ? "right" : "down";
}

/**
 * Plan the fixed main-pane + worker-grid arrangement.
 *
 * The first worker is carved out of the main pane. Once that worker zone
 * exists, subsequent workers split only worker panes, never the main pane.
 *
 * `ownedPaneIds` is the set of panes this session spawned. It is required for
 * tiling: a tab can contain other pi sessions, other sessions' subagent panes,
 * and plain shells, and none of those may be used as a split source. When the
 * set is absent or empty every split comes off the main pane, which is always
 * safe because that pane is unambiguously ours.
 *
 * Every session — the top-level one and each subagent that has children of its
 * own — is planned the same way against its own pane, so a nested spawn lays
 * out exactly like a top-level one. The parent-keeps-N-columns policy applies
 * only while the pane is wide enough to honour it; a pane too narrow for two
 * readable columns is stacked instead, and one too narrow to hand the parent
 * its columns is split evenly. That keeps a second-level subagent from being
 * squeezed into an unusable sliver.
 */
export function planSurfaceGrid(params: {
  mainPaneId: string;
  layout?: LayoutSnapshot;
  mainColumns?: number;
  fallbackRatio?: number;
  ownedPaneIds?: ReadonlySet<string>;
}): SurfaceSplitPlan {
  const { mainPaneId, layout, fallbackRatio = splitRatio(), ownedPaneIds } = params;
  if (!layout || layout.panes.length === 0) {
    return { source: mainPaneId, direction: "right", ratio: fallbackRatio };
  }

  const workers = layout.panes.filter(
    (pane) =>
      typeof pane.pane_id === "string" &&
      pane.pane_id !== mainPaneId &&
      paneSize(pane) !== undefined &&
      ownedPaneIds?.has(pane.pane_id) === true,
  ) as Array<LayoutPane & { pane_id: string }>;

  if (workers.length === 0) {
    const mainSize = sourcePaneSize(layout, mainPaneId);
    const width = mainSize?.w ?? totalPaneWidth(layout);
    const requestedMain = params.mainColumns ?? mainPaneCols();
    if (!(width > 0)) {
      return { source: mainPaneId, direction: "right", ratio: fallbackRatio };
    }
    // Too narrow for two readable columns: stack, so neither side is a sliver.
    if (width < MIN_WORKER_PANE_COLS * 2) {
      return { source: mainPaneId, direction: adaptiveDirection(mainSize), ratio: WORKER_SPLIT_RATIO };
    }
    // Too narrow to also give the parent its columns: share the width evenly.
    if (width < MIN_MAIN_PANE_COLS + MIN_WORKER_PANE_COLS) {
      return { source: mainPaneId, direction: "right", ratio: WORKER_SPLIT_RATIO };
    }
    const mainColumns = Math.min(
      requestedMain,
      Math.max(MIN_MAIN_PANE_COLS, width - MIN_WORKER_PANE_COLS),
    );
    return { source: mainPaneId, direction: "right", ratio: clampRatio(mainColumns / width) };
  }

  // Nth worker: split the tallest worker-zone pane. Wide -> right (opens
  // another column), narrow -> down (stacks). Source keeps 0.5 for an even
  // grid inside the worker zone.
  let target = workers[0]!;
  let targetHeight = paneSize(target)!.h;
  for (const worker of workers.slice(1)) {
    const height = paneSize(worker)!.h;
    if (height > targetHeight) {
      target = worker;
      targetHeight = height;
    }
  }

  const targetSize = paneSize(target)!;
  return {
    source: target.pane_id,
    direction: adaptiveDirection(targetSize),
    ratio: WORKER_SPLIT_RATIO,
  };
}

/** Plan an explicitly requested adaptive split from a particular source. */
export function planSurfaceSplitAuto(params: {
  source: string;
  layout?: LayoutSnapshot;
  fallbackRatio?: number;
  forcedDirection?: string;
}): SurfaceSplitPlan {
  const forced = params.forcedDirection?.toLowerCase() ?? process.env.PI_SUBAGENT_SPLIT_DIRECTION?.toLowerCase();
  if (forced === "right" || forced === "down") {
    return { source: params.source, direction: forced, ratio: params.fallbackRatio ?? splitRatio() };
  }
  const sourcePane = params.layout?.panes.find((pane) => pane.pane_id === params.source);
  return {
    source: params.source,
    direction: adaptiveDirection(paneSize(sourcePane ?? {})),
    ratio: params.fallbackRatio ?? splitRatio(),
  };
}
