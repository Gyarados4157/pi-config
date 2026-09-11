# pi-config

My personal [pi](https://github.com/earendil-works/pi) configuration.

> Inspired by [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config).
> This repo is **not** meant to be cloned over `~/.pi/agent` directly.
> Copy the pieces you want, or use the install script.

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

- `ask-user-question.ts` — interactive question popup
- `bash-guard/` — dangerous-command guardrail
- `browser/` — Playwright headless Chromium for frontend debugging
- `command-v-image-paste.ts` — macOS/Ghostty image paste optimization
- `herdr-agent-state.ts` — Herdr terminal state reporting
- `otty-integration.ts` — Otty status badge / completion notice
- `web-fetch/` — URL to clean markdown (+PDF)

### Skills

- `analyze-sessions/` — cost/prompt/session mining over past sessions
- `pdf-reader/` — PDF text + visual reading
- `web-debug/` — frontend runtime debugging playbook
- `youtube-transcript/` — YouTube title + transcript as JSON
