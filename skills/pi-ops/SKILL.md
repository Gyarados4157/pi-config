---
name: pi-ops
description: >
  Pi session and tool playbook. Reach on edit validation, missing/non-unique
  oldText, overlap, no-change, or then_run failure; ctx_execute_file outside project;
  web_search or deprecated web fails; user-requested handoff or
  an unrecoverable session runtime problem; bash times out on unbounded find; cua-driver is
  missing pid or window_id.
---

# pi-ops

Pick the branch that fired. Stop when that branch's done line is true. Do not run every branch.

## Edit recovery

Before every edit attempt, read the live target span and copy the smallest unique `oldText` verbatim; search results only locate the span. After any failure, classify the leading error before rebuilding from a fresh read; test output can contain unrelated matching/validation errors. Never replay a stale `oldText`.

| Result | Next action |
| --- | --- |
| Validation / invalid arguments | Rebuild `{path, edits: [{oldText, newText}]}` with an actual array of objects and string fields. Repair structure, not file contents; reading again cannot fix this error. |
| Could not find oldText | Immediately `read` the target span and copy its exact live text, including whitespace. Search output or a summary is a locator, not replacement source. |
| Multiple occurrences | `read` the matches and add the smallest distinguishing function/test name or neighboring lines. |
| Overlapping edits | Merge changes to the same region into one edit; all regions refer to the original file, not earlier replacements. |
| No changes made | Compare intended and current contents; if already correct, continue to verification instead of replaying the edit. |
| Successfully replaced, then `[then_run:failed]` | The file is already modified. Inspect the failing command and current file; do not replay the old edit. |
| Missing file / ENOENT | Resolve the path against the active cwd/worktree before retrying. |

For new edits, run verification in a separate bash/ctx_execute call. Preserve unique matching and overlap rejection; never guess the first match or silently repair malformed JSON.

Done: the corrected edit succeeded and separate verification passed, or the remaining blocker is reported. A reread alone is not completion.

## ctx_execute_file outside project

context-mode refuses any path outside the session cwd, including `/tmp`. Preflight each input/output path against the current session cwd; browser and other tool `filename` outputs belong in the same scratch directory.

1. `mkdir -p .pi/scratch` in the project (bash mutation).
2. Write or copy the dump there (`$PWD/.pi/scratch/<topic>.json`); pass the resolved path under `$PWD`, not a `/tmp` path.
3. Call `ctx_execute_file` on that project path.
4. If the bytes were never a file — only a pipeline — use `ctx_execute` instead.

Do not retry the same `/tmp/...` path. Parallel `ctx_*` writers can hit SQLite `disk I/O error`; keep those writes at concurrency 1.

Done: the file is under cwd, or you switched to `ctx_execute`.

## Search

`web_search` and the deprecated `web` tool are disabled for this workflow. Use `codex-search` for one lookup, `codex-research` to open and quote pages. For live browser behavior, read `~/.agents/skills/ego-browser/SKILL.md` and use ego-browser; use CUA only for native desktop/window operations. Docs you will query more than once: `ctx_fetch_and_index` then `ctx_search`.

Done: a supported lookup/browser path ran, or the answer is already in context.

## 交接

Use only when the Continuous work rule in global `AGENTS.md` calls for handoff. Write `.pi/scratch/handoff-<YYYY-MM-DD>.md` (or `artifacts/` if the project uses that), including current ownership, uncommitted changes, checks, and pending operations. Give the user a resume prompt; create a successor only with authorization, and transfer ownership before it starts to avoid duplicate work.

```markdown
# Handoff — <date>
## Goal
## Done
## In progress
## Decisions
## Files
## Next
```

Done: the file exists and the user has a new-session prompt.

## Bash timeout

Give `timeout` explicitly. Bound `find`/`rg` with a directory and `--max-depth` / `head`. Installs and compiles get a large timeout; they do not get an unbounded default.

Done: the rerun has a timeout and a bounded path.

## cua-driver

1. `list_windows` → take `pid` and `window_id`.
2. Window screenshot: `get_window_state`. Full desktop: `get_desktop_state` with empty args.
3. Leave `screenshot_out_file` empty (base64). Do not write `/tmp`.

Done: the call includes pid + window_id from `list_windows`, and no screenshot path.
