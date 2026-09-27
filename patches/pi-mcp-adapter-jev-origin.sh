#!/usr/bin/env bash
# Point pi-mcp-adapter's built-in Jev (TypeSafe) integration at a self-hosted
# gateway instead of the upstream-pinned https://api.typesafe.ai.
#
# Why: pi-mcp-adapter hard-codes the TypeSafe origin in jev-key-store.ts and
# jev-client.ts additionally rejects any other origin in `fixedOriginFetch`.
# There is no config knob (README: "Requests use pinned model jev-1.13.0 at the
# fixed origin https://api.typesafe.ai"). This script rewrites the origin
# constant (and the derived keyring account label) so `settings.jev` semantic
# search works against the local gateway.
#
# The patch lives inside node_modules and is therefore LOST whenever the
# package is reinstalled/updated. Re-run this script after any
# `pi install` / package update of pi-mcp-adapter. It is idempotent.
#
# Usage:
#   pi-mcp-adapter-jev-origin.sh [origin]      apply (default: https://cpa.alphafox.app)
#   pi-mcp-adapter-jev-origin.sh --status      report current state
#   pi-mcp-adapter-jev-origin.sh --revert      restore the newest backup
#
# After applying: run `/reload` in pi. If the origin changed, re-store the key:
#   security find-generic-password -s pi-mcp-jev-typesafe -a jev-mcp -w \
#     | node ~/.pi/agent/npm/node_modules/pi-mcp-adapter/cli.js key set typesafe

set -euo pipefail

DEFAULT_ORIGIN="https://cpa.alphafox.app"
PKG="$HOME/.pi/agent/npm/node_modules/pi-mcp-adapter"
TS_FILE="$PKG/jev-key-store.ts"
JS_FILE="$PKG/dist/jev-key-store.js"
BACKUP_ROOT="$HOME/.config-backups"

usage() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; }

current_origin() {
  # Read the origin constant out of the runtime module (pi loads the .ts).
  [ -f "$TS_FILE" ] || { echo ""; return; }
  sed -n 's/^export const TYPESAFE_API_ORIGIN = "\(.*\)";$/\1/p' "$TS_FILE" | head -1
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --status)
    [ -d "$PKG" ] || { echo "pi-mcp-adapter not installed at $PKG"; exit 1; }
    cur="$(current_origin)"
    echo "package:        $PKG"
    echo "runtime origin: ${cur:-<unreadable>}"
    echo "cli (dist) origin: $(sed -n 's/^export const TYPESAFE_API_ORIGIN = "\(.*\)";$/\1/p' "$JS_FILE" 2>/dev/null | head -1)"
    if [ "$cur" = "https://api.typesafe.ai" ]; then
      echo "state:          UNPATCHED (upstream pinned origin)"
    else
      echo "state:          patched"
    fi
    exit 0
    ;;
  --revert)
    latest="$(ls -1d "$BACKUP_ROOT"/pi-mcp-adapter-jev-origin-* 2>/dev/null | sort | tail -1 || true)"
    [ -n "$latest" ] || { echo "no backup found under $BACKUP_ROOT"; exit 1; }
    [ -f "$latest/jev-key-store.ts.orig" ] && cp "$latest/jev-key-store.ts.orig" "$TS_FILE"
    [ -f "$latest/jev-key-store.js.orig" ] && cp "$latest/jev-key-store.js.orig" "$JS_FILE"
    echo "reverted from $latest"
    echo "run /reload in pi; the stored key may need re-storing under the upstream account label."
    exit 0
    ;;
esac

ORIGIN="${1:-$DEFAULT_ORIGIN}"
case "$ORIGIN" in
  https://*) ;;
  *) echo "origin must start with https:// (got: $ORIGIN)" >&2; exit 1 ;;
esac

[ -d "$PKG" ] || { echo "pi-mcp-adapter not installed at $PKG" >&2; exit 1; }

cur="$(current_origin)"
if [ "$cur" = "$ORIGIN" ]; then
  echo "already patched: runtime origin is $ORIGIN — nothing to do."
  exit 0
fi

BK="$BACKUP_ROOT/pi-mcp-adapter-jev-origin-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
cp "$TS_FILE" "$BK/jev-key-store.ts.orig"
[ -f "$JS_FILE" ] && cp "$JS_FILE" "$BK/jev-key-store.js.orig"

patch_file() {
  local f="$1" origin="$2"
  python3 - "$f" "$origin" <<'PY'
import re, sys
path, origin = sys.argv[1], sys.argv[2]
src = open(path).read()
out = re.sub(r'(export const TYPESAFE_API_ORIGIN = ")[^"]*(";)', r'\g<1>' + origin + r'\g<2>', src)
out = re.sub(r'(export const JEV_KEYRING_ACCOUNT = "typesafe@sha256\()[^)]*(\)";)',
             r'\g<1>' + origin + r'\g<2>', out)
if out == src:
    print(f"  no change: {path}")
else:
    open(path, "w").write(out)
    print(f"  patched:   {path}")
PY
}

echo "backup: $BK"
patch_file "$TS_FILE" "$ORIGIN"
[ -f "$JS_FILE" ] && patch_file "$JS_FILE" "$ORIGIN"
echo
echo "done. origin -> $ORIGIN"
echo "next: run /reload in pi; if the origin changed, re-store the key (see header)."
