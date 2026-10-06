#!/usr/bin/env bash
# Bundle the grok entries with the shared core (../hooks, TypeScript) into dist/*.mjs that plain node runs.
# --if-stale: only when a source is newer than the bundle (the launchers call it at every start).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
ESBUILD="${ESBUILD:-$HOME/hermes-agent/node_modules/.bin/esbuild}"
if [ "${1:-}" = --if-stale ] && [ -f dist/status.mjs ] && [ -f dist/hook.mjs ] &&
  [ -z "$(find . ../hooks -maxdepth 1 \( -name '*.ts' -o -name '*.mjs' \) ! -name '*.test.ts' -newer dist/status.mjs -print -quit)" ]; then
  exit 0
fi
[ -x "$ESBUILD" ] || { echo "xray-grok: no esbuild at $ESBUILD (set ESBUILD)" >&2; exit 1; }
"$ESBUILD" hook.mjs status.mjs --bundle --platform=node --format=esm --target=node20 \
  --resolve-extensions=.ts,.mjs,.js --outdir=dist --out-extension:.js=.mjs --log-level=warning
