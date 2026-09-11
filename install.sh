#!/usr/bin/env bash
# Sync pi-config repo -> ~/.pi/agent (one-way, repo is source of truth).
# Usage: ./install.sh [--dry-run]
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.pi/agent"
DRY=""

if [[ "${1:-}" == "--dry-run" ]]; then DRY="1"; fi

sync_dir() {
  local src="$REPO/$1" dst="$DEST/$1"
  mkdir -p "$dst"
  if [[ -n "$DRY" ]]; then
    echo "--- [dry-run] $src -> $dst ---"
    rsync -a --dry-run --itemize-changes \
      --exclude='node_modules/' --exclude='.venv/' --exclude='__pycache__/' \
      --exclude='.profile/' --exclude='*.log' \
      "$src/" "$dst/"
  else
    rsync -a --delete \
      --exclude='node_modules/' --exclude='.venv/' --exclude='__pycache__/' \
      --exclude='.profile/' --exclude='*.log' \
      "$src/" "$dst/"
    echo "synced $1"
  fi
}

sync_dir agents
sync_dir extensions
sync_dir skills

if [[ -n "$DRY" ]]; then
  echo "dry-run done, nothing written."
else
  echo "done. Restart pi or run /reload."
  echo "NOTE: settings.json / models.json / web-search.json / auth.json are NOT synced (local secrets)."
fi
