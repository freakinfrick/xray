#!/usr/bin/env bash
# Install xray's hooks into grok homes: writes <GROK_HOME>/hooks/xray.json beside herdr.json, pointing at
# this folder's bundle (absolute path: grok resolves a relative command against the json file).
# Usage: ./install.sh [GROK_HOME...]   (default ~/.grok-deepseek). The status line is the launcher's part.
set -euo pipefail
here="$(dirname "$(readlink -f "$0")")"
"$here/build.sh" --if-stale
homes=("$@")
[ ${#homes[@]} -eq 0 ] && homes=("$HOME/.grok-deepseek")
cmd="node '$here/dist/hook.mjs'"
for h in "${homes[@]}"; do
  mkdir -p "$h/hooks"
  python3 - "$h/hooks/xray.json" "$cmd" <<'PY'
import json, sys
path, cmd = sys.argv[1:]
hook = {"hooks": [{"type": "command", "command": cmd, "timeout": 5}]}
events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "StopFailure", "StopCancelled"]
json.dump({"hooks": {e: [hook] for e in events}}, open(path, "w"), indent=2)
PY
  echo "xray-grok: $h/hooks/xray.json"
done
