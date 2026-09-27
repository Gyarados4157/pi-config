# pi-interactive-subagents

This file loads when cwd is this package. Edits take effect on the next pi start (`/reload` is not enough): pi loads the `.ts` sources directly and there is no build step. The package is registered as a local package in `~/.pi/agent/settings.json`.

After changing this package, load the touched module with jiti to check the boundary, then run `node --test test/test.ts test/layout.test.ts test/reliability.test.ts`.

Layout policy sits in `pi-extension/subagents/layout.ts` as pure functions over a layout snapshot; `pi-extension/subagents/herdr.ts` reads Herdr and executes the plan they return. Keeping the CLI out of `layout.ts` is what lets the rules be tested without a running Herdr.

## What Herdr reports

`herdr pane layout --pane <id>` answers for the tab that pane lives in. The same command with no flag answers for the focused tab, which may belong to a different pi session, so reads pass the caller's pane id.

`--ratio` is the fraction the source pane keeps, measured against the source pane's own width. The tab is wider whenever it is shared, and a ratio derived from the tab width hands most of the main pane to the new worker: a 113-column pane in a 226-column tab keeps 73 columns at 0.646.

`herdr pane list` reports `label` (whatever `pane rename` set) and `agent_session`, with no geometry. `pane layout` reports geometry and neither of those. Ownership needs both, so the adapter joins them on the pane id.

For Herdr's own command surface, run `herdr --skill`.

## Ownership

A tab can hold a pane from each of several pi sessions, other sessions' subagent panes, and plain shells. Splitting a pane belonging to someone else carves the new subagent out of their space, so every split source must be a pane the spawning session created.

`planSurfaceGrid` takes `ownedPaneIds` for that, and an absent or empty set splits the main pane, which is always ours. The spawn paths pass `subagentOwnership(artifactDir)`: the name registry's names and session files, matched against pane labels and reported agent sessions. A new spawn path that omits it loses tiling and keeps correctness.

Ownership survives a pi restart because the marks live outside the process — the label set when the pane was created, and the registry on disk. Herdr never reuses a pane id, so the in-memory set can hold ids of panes that have since closed.

## The layout the rules produce

The first subagent splits the parent pane on the right and the parent keeps `PI_SUBAGENT_MAIN_COLS` columns (100 by default), so the session stays readable. Later subagents tile the worker zone that first split created: another column while one fits, otherwise stacking into the tallest cell. The parent pane is split once and never again.

Every session plans against its own pane — the top level against the parent pane, a subagent with children of its own against the pane it occupies — so nesting does not inherit the top-level column budget. A worker pane is narrow, and asking it to keep columns it does not have is what once produced a 4-column second-level subagent. The width of the pane being split picks the shape:

| Pane width | Split |
| --- | --- |
| under 80 | down, or right at 0.5 when the pane is wide and short |
| 80 to 100 | right at 0.5 |
| 100 and up | right; parent keeps its columns, worker keeps at least 40 |

## Verifying a layout change

Cases for the rules belong with the policy in `test/layout.test.ts`. The adapter has no unit tests, so check it against live panes.

1. Create a pane with the code under change, then read `herdr pane layout --pane $HERDR_PANE_ID` and confirm where the new pane landed, that it came off the intended source, and that every other pane kept its rect.
2. To model a subagent spawning children, repeat the call with `HERDR_PANE_ID` set to the pane the first call returned. Run it in a fresh process: the child's own in-memory set starts empty, as it does for a real second-level spawner.
3. Read the widths against the table above, then close every pane the check created and read the layout once more to confirm the rects returned unchanged.
