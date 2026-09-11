# pi-config

My personal [pi](https://github.com/earendil-works/pi) configuration.

> Inspired by [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config).
> This repo is **not** meant to be cloned over `~/.pi/agent` directly.
> Copy the pieces you want, or use the install script.
>
> 🔒 Secret scanning + push protection are enabled on this repo.
> Real keys live only in local `~/.pi/agent/` and are never committed —
> see [Secrets policy](#secrets-policy).

## Layout

```
pi-config/
├── agents/        # scout / planner / researcher / worker definitions
├── extensions/    # TUI extensions (single .ts or directory with package.json)
├── skills/        # agent skills (SKILL.md + scripts)
├── settings.json.example   # settings template (NO secrets)
├── models.json.example     # model routing template (NO api keys)
├── web-search.json.example # search provider template (NO api keys)
└── install.sh     # sync script: repo -> ~/.pi/agent
```

## Install / sync

```bash
./install.sh            # copy agents/extensions/skills into ~/.pi/agent
./install.sh --dry-run  # preview only
```

After syncing, restart pi or run `/reload`.

Directory extensions with a `package.json` need deps installed once:

```bash
cd ~/.pi/agent/extensions/browser && npm install
```

## Secrets policy

- Real `settings.json` / `models.json` / `web-search.json` / `auth.json`
  live **only** in `~/.pi/agent/` and are **never** committed here.
- This repo keeps only `*.example` templates. Copy and fill locally:

```bash
cp settings.json.example ~/.pi/agent/settings.json
cp models.json.example ~/.pi/agent/models.json
cp web-search.json.example ~/.pi/web-search.json
```

## Contents

### Agents

- `scout` — read-only codebase recon (model: DDDD/muse-spark-1.3-contributor)
- `planner` — implementation plans, no edits
- `researcher` — web research briefs
- `worker` — general executor, can dispatch scout/researcher

### Extensions

Mostly from upstream, plus three homegrown ones (marked 🌟):

- `ask-user-question.ts` — interactive question popup (single/multi-select, rich layout)
- `bash-guard/` — hooks that intercept risky bash commands (`rm`/`sudo`/`curl|sh`/`git reset --hard`…) with a Run/Abort prompt; strict for subagents
- `browser/` — Playwright headless Chromium the agent can drive (goto/eval/console/network/click/screenshot); for real frontend debugging instead of guessing from source
- `command-v-image-paste.ts` 🌟 — macOS/Ghostty `Cmd+V` image paste: compresses clipboard PNGs via `sips` (long edge 1600px, ~150–250KB) so big screenshots don't freeze the editor
- `herdr-agent-state.ts` 🌟 — reports agent lifecycle over a Unix socket when running inside Herdr terminal (`HERDR_ENV`/`HERDR_SOCKET_PATH`/`HERDR_PANE_ID`)
- `otty-integration.ts` 🌟 — reports idle/processing state + task-complete badge to Otty terminal via `otty-cli` IPC socket
- `web-fetch/` — fetch a URL and get clean markdown (Readability + Turndown, PDF support, Jina fallback)

### Skills

Same four as upstream (kept because they earn their place):

- `analyze-sessions/` — Python scripts to query past pi sessions: cost rollups by day/project/model, prompt-pattern mining, full-text search, single-session rendering
- `pdf-reader/` — read PDFs (papers, lecture notes) with text extraction + page rendering for formulas/diagrams
- `web-debug/` — playbook: always debug frontend issues with real `browser_*` tools (auth/401/CORS/JWT/blank screen…) before reading source
- `youtube-transcript/` — fetch a YouTube video's title + transcript as JSON (via `yt-dlp`)

### Model routing (`models.json.example`)

Two OpenAI-compatible providers (`DDDD`, `anyrouter`) with `gpt-5.6-luna/sol`, `grok-4.6`, `muse-spark`, `gpt-6-astra`, `gemini-3.8-flash-high`. Web search defaults to Tavily with Exa fallback.
