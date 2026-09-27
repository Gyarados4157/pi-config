import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withLaunchSurface } from "../pi-extension/subagents/spawn.ts";
import { requireLayout } from "../pi-extension/subagents/herdr.ts";

describe("subagent launch reliability", () => {
  it("cleans a newly created surface when setup fails", async () => {
    const closed: string[] = [];
    await assert.rejects(
      withLaunchSurface(
        "p1",
        true,
        async () => {
          throw new Error("setup failed");
        },
        async (surface) => {
          closed.push(surface);
        },
      ),
      /setup failed/,
    );
    assert.deepEqual(closed, ["p1"]);
  });

  it("does not close a surface after a successful launch", async () => {
    const closed: string[] = [];
    const result = await withLaunchSurface(
      "p2",
      true,
      async () => "ready",
      async (surface) => {
        closed.push(surface);
      },
    );
    assert.equal(result, "ready");
    assert.deepEqual(closed, []);
  });

  it("refuses to split when Herdr topology cannot be read", () => {
    assert.throws(
      () => requireLayout(() => undefined, "p1"),
      /refusing to split without topology confirmation/,
    );
    const layout = { panes: [{ pane_id: "p1" }] };
    assert.equal(requireLayout(() => layout, "p1"), layout);
    assert.throws(
      () => requireLayout(() => layout, "p2"),
      /does not contain source pane/,
    );
  });
});
