"""xray feed: hermes' turn, tool and request events as JSONL for the xray TUI widget.

Only in the TUI's gateway process (``hermes --tui``); the widget (~/.hermes/tui-widgets/xray.mjs) tails
``$HERMES_HOME/xray/live/<TUI node pid>.jsonl``. Lines follow xray's hooks/events.ts schema with hermes'
own tool names and args; the widget maps them (mods/xray/hermes/calls.ts). Spec: mods/xray/hermes/SPEC.md.
Every hook swallows its errors and returns None: pre_tool_call is fail-closed and a dict there is a directive.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time

_MAX_TEXT = 6000  # chars of a tool result kept: the tail, where test summaries and errors land
_lock = threading.Lock()
_path: str | None = None


def _is_tui() -> bool:
    main = sys.modules.get("__main__")
    spec = getattr(main, "__spec__", None)
    return getattr(spec, "name", "") == "tui_gateway.entry" or "tui_gateway.entry" in sys.modules


def _tui_pid() -> int:
    # The node TUI spawns the gateway directly; walk up anyway in case a wrapper sits between.
    pid = os.getppid()
    for _ in range(4):
        try:
            with open(f"/proc/{pid}/comm") as f:
                if f.read().strip() in ("node", "bun"):
                    return pid
            with open(f"/proc/{pid}/status") as f:
                pid = next(int(l.split()[1]) for l in f if l.startswith("PPid:"))
        except Exception:
            break
    return os.getppid()


def _feed() -> str:
    global _path
    if _path is None:
        home = os.environ.get("HERMES_HOME", "").strip() or os.path.join(os.path.expanduser("~"), ".hermes")
        live = os.path.join(home, "xray", "live")
        os.makedirs(live, exist_ok=True)
        _path = os.path.join(live, f"{_tui_pid()}.jsonl")
    return _path


def _write(kind: str, t: float | None = None, **fields) -> None:
    try:
        line = {"t": int((t if t is not None else time.time()) * 1000), "kind": kind}
        line.update({k: v for k, v in fields.items() if v is not None})
        data = json.dumps(line, default=str, ensure_ascii=False) + "\n"
        with _lock, open(_feed(), "a", encoding="utf-8") as f:
            f.write(data)
    except Exception:
        pass


def _args(args) -> dict:
    if not isinstance(args, dict):
        return {}
    # Big string args (file contents, patches, code) are not drawn; keep the keys the map reads.
    return {k: (v[:400] if isinstance(v, str) else v) for k, v in args.items() if k not in ("content", "old_string", "new_string", "code")}


def _text(result) -> str:
    s = result if isinstance(result, str) else json.dumps(result, default=str, ensure_ascii=False)
    if len(s) <= _MAX_TEXT:
        return s
    # Too long for whole JSON: keep the output's tail as plain text (calls.ts reads either).
    try:
        d = json.loads(s)
        if isinstance(d, dict) and isinstance(d.get("output"), str):
            return d["output"][-_MAX_TEXT:]
    except Exception:
        pass
    return s[-_MAX_TEXT:]


def _turn_start(session_id=None, user_message=None, parent_session_id=None, **_):
    msg = user_message if isinstance(user_message, str) else ""
    _write("turn_start", sid=session_id, parent=parent_session_id or "", prompt=msg[:400])


def _turn_end(session_id=None, **_):
    _write("turn_end", sid=session_id)


def _stopped(**_):
    _write("turn_end")


def _tool_start(tool_name=None, args=None, session_id=None, tool_call_id=None, **_):
    _write("start", sid=session_id, id=tool_call_id, tool=tool_name, args=_args(args))
    return None


def _tool_end(tool_name=None, args=None, result=None, session_id=None, tool_call_id=None, status=None, **_):
    _write("end", sid=session_id, id=tool_call_id, tool=tool_name, args=_args(args), ok=status != "error", text=_text(result))


def _usage(session_id=None, usage=None, started_at=None, first_chunk_at=None, ended_at=None, **_):
    u = usage if isinstance(usage, dict) else {}

    def ms(v):
        return int(v * 1000) if isinstance(v, (int, float)) else None

    _write("usage", ended_at, sid=session_id, usage={
        "input": u.get("input_tokens", 0), "output": u.get("output_tokens", 0),
        "cacheRead": u.get("cache_read_tokens", 0), "cacheWrite": u.get("cache_write_tokens", 0),
        "startedAt": ms(started_at), "firstAt": ms(first_chunk_at),
    })


def register(ctx):
    if not _is_tui() or os.environ.get("CLAUDE_HUMAN_MODS") == "off":
        return
    ctx.register_hook("pre_llm_call", _turn_start)
    ctx.register_hook("pre_tool_call", _tool_start)
    ctx.register_hook("post_tool_call", _tool_end)
    ctx.register_hook("post_api_request", _usage)
    # on_session_end fires once per turn (run_conversation), interrupted ones too; /stop also says so.
    ctx.register_hook("on_session_end", _turn_end)
    ctx.register_hook("agent_loop_stopped", _stopped)
