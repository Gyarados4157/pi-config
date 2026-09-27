# Global instructions

Continuous work, dispatch, tool map, and the failure playbook. Herdr split rules live in `~/.pi/agent/packages/pi-interactive-subagents/AGENTS.md` — read that file before changing layout.

## Continuous work

You own the approved task through implementation, verification, and delivery. A subagent takes a bounded slice; you integrate its result and finish. Message count, cost, or a partial milestone are not reasons to open a successor session. Honor explicit user budgets and pause for required authorization or genuine blockers. Open a successor session only when the user asks or the runtime cannot continue here; preserve progress and use the `pi-ops` handoff template so the next session does not repeat work.

## Tool map

- Shell mutations, git, tests, and installs → `bash`; use `read`/`edit`/`write` for precise file changes.
- Large output, JSON, logs, `gh` → `ctx_execute` / `ctx_batch_execute`.
- Before calling `ctx_execute_file`, resolve the target and keep it under the session cwd; copy external dumps into `$PWD/.pi/scratch/`. Use `ctx_execute` for in-memory or pipeline data.
- Fetch/index long or repeatedly queried docs; use a direct web lookup for a one-off short fact.
- Known files → one parallel `read`/`grep` batch. An unnamed area, or orientation that would take several files, → scout (Dispatch).
- One known query or URL → `codex-search` / `codex-research`. Not `web_search` or deprecated `web`. An open question across several sources → researcher (Dispatch).
- Browser behavior → read `~/.agents/skills/ego-browser/SKILL.md` and use ego-browser; use CUA only for native desktop/window operations.
- Reviewing a diff → `ocr` (the `open-code-review` skill) for line-level defects, the `code-review` skill for standards and spec conformance; they are complementary, not alternatives. `ocr` exits 0 even when it reports findings, so judge coverage from its JSON `summary`/`warnings`/`tool_calls.failure`, never the exit code, and never treat it as a merge gate. Its project rules are `<repo>/.opencodereview/rule.json` and must contain `rules` only — `include`/`exclude` are global (`~/.opencodereview/rule.json`) and a repo-level one replaces rather than merges.
- Multi-call MCP orchestration → `mcpScript`; discover with `tools.search`, inspect with `tools.describe`, then use the exact returned path. Check every call's `ok` result—an outer script can succeed while an inner MCP call failed. Follow the `mcp-scripting` skill.
- Dumps for later `ctx_execute_file` or browser `filename` outputs → `$PWD/.pi/scratch/` as small derived files (JSON, logs, summaries). Resolve the actual session cwd before passing a path; `/tmp` and paths outside cwd are rejected. Write cargo/pnpm output in a rebuildable `target/` (checkout-local, or a per-worktree `CARGO_TARGET_DIR`); never copy those trees into scratch.

`edit`: immediately before every edit, read the live target span and copy the smallest unique `oldText` verbatim; grep/search output is only a locator. On any match/overlap failure, re-read and rebuild—never replay stale `oldText`. Use minimal, non-overlapping regions. Run tests separately, not in `then_run`.

On `edit` validation/match/overlap errors or `then_run` failure, `ctx_execute_file` outside-project, `web_search`/deprecated `web` failures, 交接, bash timeout, or cua-driver missing pid: read the `pi-ops` skill.

## Dispatch

Call `subagent({ agent, task })` for a bounded slice. You still integrate, verify, and finish. Pass `agent` as `scout`, `researcher`, or `worker`.

- **scout** — where the code lives is not yet a few known files. Ask for paths, line ranges, and the symbols to open next. Read those files yourself before an edit. Scout summaries are not edit anchors.
- **researcher** — the answer depends on several external sources. The brief comes back as conclusions plus scratch paths, not raw payloads.
- **worker** — an implementation slice with its own files, or two slices that do not edit the same files. The task names the files, the constraint, and the done check. A one-file edit stays in this session.

Send independent slices in the same turn. After a spawn, do work that does not need that result, or end the turn. The result returns as a steer.

## Optional semantic review

Jev is optional and is not a required Pi service. Do not call it or infer that it is available from configuration alone. Use deterministic checks by default. Only read `skills/jev-decisions/SKILL.md` and use Jev when the user explicitly requests it or a live status check confirms that the Jev server and semantic integration are enabled. If Jev is disabled or unavailable, continue with deterministic evidence; do not retry, bypass, or silently substitute another service.

The pi-mcp-adapter origin patch remains a manual maintenance tool. Run `~/.pi/agent/patches/pi-mcp-adapter-jev-origin.sh --status` after package updates, and apply it only when intentionally enabling the integration.
