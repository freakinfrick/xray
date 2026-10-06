#!/usr/bin/env bash
# Bundle the widget and xray's core into one plain-ESM file hermes' TUI imports (~/.hermes/tui-widgets/).
# Hermes' own esbuild; explicit extensions so a stray .js emit beside a core .ts never wins.
set -euo pipefail
cd "$(dirname "$0")"
esbuild=${ESBUILD:-$HOME/hermes-agent/node_modules/.bin/esbuild}
"$esbuild" widget.ts --bundle --format=esm --platform=node --target=node20 \
  --resolve-extensions=.ts,.tsx,.mjs,.js --legal-comments=none --log-level=warning --outfile=xray.mjs
echo "built $(pwd)/xray.mjs ($(wc -c <xray.mjs) bytes)"
