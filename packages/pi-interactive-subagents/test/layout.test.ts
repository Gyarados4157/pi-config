import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planSurfaceGrid, planSurfaceSplitAuto } from "../pi-extension/subagents/layout.ts";

function layout(panes: Array<{ pane_id: string; width: number; height: number }>, width = 163) {
  return {
    area: { width, height: 40 },
    panes: panes.map(({ pane_id, width: w, height: h }) => ({
      pane_id,
      rect: { x: 0, y: 0, width: w, height: h },
    })),
  };
}

/** Pane ids this session spawned; everything else in the tab belongs to someone else. */
function owned(...paneIds: string[]) {
  return new Set(paneIds);
}

describe("layout.ts", () => {
  it("keeps the first worker zone beside a 100-column main pane", () => {
    const plan = planSurfaceGrid({
      mainPaneId: "main",
      layout: layout([{ pane_id: "main", width: 163, height: 40 }]),
    });

    assert.equal(plan.source, "main");
    assert.equal(plan.direction, "right");
    assert.ok(Math.abs(plan.ratio - 100 / 163) < 0.0001);
  });

  it("opens the worker zone into two columns for the second worker", () => {
    const plan = planSurfaceGrid({
      mainPaneId: "main",
      layout: layout([
        { pane_id: "main", width: 100, height: 40 },
        { pane_id: "worker-a", width: 80, height: 40 },
      ]),
      ownedPaneIds: owned("worker-a"),
    });

    assert.deepEqual(plan, { source: "worker-a", direction: "right", ratio: 0.5 });
  });

  it("stacks later workers in the tallest worker cell", () => {
    const plan = planSurfaceGrid({
      mainPaneId: "main",
      layout: layout([
        { pane_id: "main", width: 100, height: 40 },
        { pane_id: "worker-a", width: 31, height: 20 },
        { pane_id: "worker-b", width: 32, height: 40 },
        { pane_id: "worker-c", width: 31, height: 20 },
      ]),
      ownedPaneIds: owned("worker-a", "worker-b", "worker-c"),
    });

    assert.deepEqual(plan, { source: "worker-b", direction: "down", ratio: 0.5 });
  });

  it("avoids creating unreadable two-column workers on a narrow screen", () => {
    const plan = planSurfaceGrid({
      mainPaneId: "main",
      layout: layout([
        { pane_id: "main", width: 100, height: 40 },
        { pane_id: "worker-a", width: 44, height: 40 },
      ], 144),
      ownedPaneIds: owned("worker-a"),
    });

    assert.deepEqual(plan, { source: "worker-a", direction: "down", ratio: 0.5 });
  });

  it("opens another column when the tallest worker is wide", () => {
    const plan = planSurfaceGrid({
      mainPaneId: "main",
      layout: layout([
        { pane_id: "main", width: 100, height: 40 },
        { pane_id: "worker-a", width: 31, height: 18 },
        { pane_id: "worker-b", width: 64, height: 22 },
        { pane_id: "worker-c", width: 31, height: 18 },
      ]),
      ownedPaneIds: owned("worker-a", "worker-b", "worker-c"),
    });

    assert.deepEqual(plan, { source: "worker-b", direction: "right", ratio: 0.5 });
  });

  it("stacks a second-level subagent instead of squeezing it into a sliver", () => {
    // A subagent that spawns children plans against its own pane, which the
    // parent split already narrowed to one worker column. Asking it to keep
    // the parent's 60-column floor is impossible, so it must stack.
    const plan = planSurfaceGrid({
      mainPaneId: "worker",
      layout: layout([{ pane_id: "worker", width: 40, height: 54 }], 40),
      ownedPaneIds: owned(),
    });

    assert.deepEqual(plan, { source: "worker", direction: "down", ratio: 0.5 });
  });

  it("splits a wide-and-short narrow pane sideways", () => {
    const plan = planSurfaceGrid({
      mainPaneId: "worker",
      layout: layout([{ pane_id: "worker", width: 70, height: 10 }], 70),
      ownedPaneIds: owned(),
    });

    assert.deepEqual(plan, { source: "worker", direction: "right", ratio: 0.5 });
  });

  it("shares the width evenly when the pane cannot hold the parent's columns", () => {
    const plan = planSurfaceGrid({
      mainPaneId: "worker",
      layout: layout([{ pane_id: "worker", width: 90, height: 54 }], 90),
      ownedPaneIds: owned(),
    });

    assert.deepEqual(plan, { source: "worker", direction: "right", ratio: 0.5 });
  });

  it("keeps the parent's columns as soon as the pane has room for both", () => {
    const plan = planSurfaceGrid({
      mainPaneId: "worker",
      layout: layout([{ pane_id: "worker", width: 120, height: 54 }], 120),
      ownedPaneIds: owned(),
    });

    assert.equal(plan.direction, "right");
    assert.ok(Math.abs(plan.ratio - 80 / 120) < 0.0001, `got ${plan.ratio}`);
  });

  it("never splits a pane that belongs to another session", () => {
    // A shared tab: our idle main pane plus panes owned by other pi sessions,
    // including one much larger than ours. The new subagent must come off the
    // main pane rather than carve up somebody else's space.
    const plan = planSurfaceGrid({
      mainPaneId: "main",
      layout: layout([
        { pane_id: "main", width: 56, height: 54 },
        { pane_id: "other-session", width: 57, height: 27 },
        { pane_id: "other-worker", width: 57, height: 27 },
        { pane_id: "neighbour", width: 56, height: 54 },
      ]),
      ownedPaneIds: owned(),
    });

    assert.equal(plan.source, "main");
  });

  it("tiles only owned panes when the tab is shared with other sessions", () => {
    const plan = planSurfaceGrid({
      mainPaneId: "main",
      layout: layout([
        { pane_id: "main", width: 56, height: 54 },
        { pane_id: "mine-a", width: 56, height: 27 },
        { pane_id: "other-worker", width: 57, height: 54 },
      ]),
      ownedPaneIds: owned("mine-a"),
    });

    assert.equal(plan.source, "mine-a");
  });

  it("measures the first-worker ratio against the main pane, not the tab", () => {
    // A shared tab is wider than our pane; the ratio herdr applies is relative
    // to the pane being split, so the tab width must not leak in.
    const shared = layout(
      [
        { pane_id: "other", width: 57, height: 54 },
        { pane_id: "main", width: 113, height: 54 },
      ],
      226,
    );
    const plan = planSurfaceGrid({ mainPaneId: "main", layout: shared, ownedPaneIds: owned() });

    assert.equal(plan.source, "main");
    assert.equal(plan.direction, "right");
    // 113 wide, main keeps 100 but never squeezes the worker below 40 -> 73.
    assert.ok(Math.abs(plan.ratio - 73 / 113) < 0.0001, `got ${plan.ratio}`);
  });

  it("ignores the tab area when it disagrees with the pane widths", () => {
    const panes = layout([{ pane_id: "main", width: 163, height: 40 }], 200);
    const plan = planSurfaceGrid({ mainPaneId: "main", layout: panes });

    assert.equal(plan.source, "main");
    assert.equal(plan.direction, "right");
    assert.ok(Math.abs(plan.ratio - 100 / 163) < 0.0001);
  });

  it("honors a forced split direction for explicit splits", () => {
    const panes = layout([{ pane_id: "main", width: 163, height: 40 }]);
    const plan = planSurfaceSplitAuto({ source: "main", layout: panes, forcedDirection: "down" });

    assert.deepEqual(plan, { source: "main", direction: "down", ratio: 0.75 });
  });
});
