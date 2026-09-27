#!/usr/bin/env bash
# Sync this repo into ~/.pi/agent (one-way: the repo is the source of truth).
#
#   ./install.sh                 copy agents/ extensions/ skills/ packages/ + seed configs
#   ./install.sh --dry-run       show what would change, write nothing
#   ./install.sh --no-packages   skip `pi install` of the npm packages
#   ./install.sh --prune         also delete files under agents/ extensions/ skills/
#                                that are not in this repo (destructive; off by default)
#
# Secrets are never copied from here: settings.json / models.json / web-search.json
# are seeded from *.example only when the target does not exist yet, and every
# seeded file has placeholder keys that you must fill in yourself.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
DEST="${PI_AGENT_DIR:-$HOME/.pi/agent}"
PI_HOME="$(dirname "$DEST")"

DRY=""
DO_PACKAGES=1
PRUNE=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --no-packages) DO_PACKAGES=0 ;;
    --prune) PRUNE=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# npm packages declared in settings.json.example (keep the two lists in sync).
NPM_PACKAGES=(
  pi-one-ui
  @fradser/pi-btw
  pi-mcp-adapter
  pi-gpt-search
  context-mode
  @cortexkit/pi-magic-context
  @ogulcancelik/pi-herdr
  pi-rtk-optimizer
  @narumitw/pi-goal@0.54.5
)

RSYNC_EXCLUDES=(
  --exclude=node_modules/
  --exclude=.venv/
  --exclude=__pycache__/
  --exclude=.profile/
  --exclude=.git/
  --exclude=.memory/
  --exclude='*.log'
  --exclude=.DS_Store
)

DELETE_FLAG=()
[[ "$PRUNE" == 1 ]] && DELETE_FLAG=(--delete)

sync_dir() {
  local src="$REPO/$1" dst="$DEST/$1"
  if [[ -n "$DRY" ]]; then
    echo "--- [dry-run] $src -> $dst"
    mkdir -p "$dst"
    rsync -a --dry-run --itemize-changes "${DELETE_FLAG[@]}" "${RSYNC_EXCLUDES[@]}" "$src/" "$dst/"
  else
    mkdir -p "$dst"
    rsync -a "${DELETE_FLAG[@]}" "${RSYNC_EXCLUDES[@]}" "$src/" "$dst/"
    echo "synced:  $dst"
  fi
}

seed() { # repo-file target hint
  local src="$REPO/$1" dst="$2" hint="$3"
  if [[ -e "$dst" ]]; then
    echo "keep:    $dst already exists (template: $1)"
    return
  fi
  if [[ -n "$DRY" ]]; then
    echo "--- [dry-run] cp $src -> $dst"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  [[ "$dst" == *.json ]] && chmod 600 "$dst" || true
  echo "seeded:  $dst  ($hint)"
}

echo "repo: $REPO"
echo "dest: $DEST"
echo

sync_dir agents
sync_dir extensions

# A skill that exists locally as a symlink would block rsync from writing the real
# directory (tdd used to point at ~/.local/share/agent-rules/skills/tdd).
for d in "$REPO"/skills/*/; do
  name="$(basename "$d")"
  if [[ -L "$DEST/skills/$name" ]]; then
    if [[ -n "$DRY" ]]; then
      echo "--- [dry-run] rm $DEST/skills/$name (symlink -> real dir)"
    else
      rm -f "$DEST/skills/$name"
      echo "unlinked: $DEST/skills/$name (was a symlink)"
    fi
  fi
done

sync_dir skills
sync_dir packages/pi-interactive-subagents

# extensions/bash-guard imports shell-quote, which is not provided by pi.
if [[ -z "$DRY" && -f "$DEST/extensions/bash-guard/package.json" ]]; then
  echo "deps:    npm install in extensions/bash-guard"
  (cd "$DEST/extensions/bash-guard" && npm install --silent --no-audit --no-fund) \
    || echo "warn:    npm install failed in $DEST/extensions/bash-guard — run it manually"
fi

echo
seed settings.json.example "$DEST/settings.json" "package list + model defaults"
seed models.json.example "$DEST/models.json" "fill in apiKey per provider"
seed web-search.json.example "$PI_HOME/web-search.json" "fill in tavilyApiKey (or use exa only)"
seed mcp.json.example "$DEST/mcp.json" "MCP servers; see README for the global ~/.config/mcp layer"

echo
if [[ "$DO_PACKAGES" == 1 ]]; then
  if ! command -v pi >/dev/null 2>&1; then
    echo "warn:    'pi' is not on PATH — install pi first, then re-run ./install.sh"
  elif [[ -n "$DRY" ]]; then
    for p in "${NPM_PACKAGES[@]}"; do echo "--- [dry-run] pi install npm:$p"; done
  else
    failed=()
    for p in "${NPM_PACKAGES[@]}"; do
      printf 'install: npm:%s ... ' "$p"
      if out="$(pi install "npm:$p" 2>&1)"; then
        echo "ok"
      else
        echo "FAILED"
        printf '%s\n' "$out" | sed 's/^/         /' | tail -3
        failed+=("npm:$p")
      fi
    done
    if (( ${#failed[@]} )); then
      echo
      echo "These failed — install them by hand: ${failed[*]}"
    fi
  fi
fi

echo
echo "next steps:"
echo "  1. fill in the api keys in $DEST/models.json and $PI_HOME/web-search.json"
echo "  2. (optional) Tavily key: https://tavily.com — or drop it and search via exa"
echo "  3. restart pi, then run /reload and \`pi list\` to confirm"
echo
echo "not synced (by design): auth.json, sessions/, mcp-cache.json, scratch/, git/"
