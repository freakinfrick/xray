"""xray feed: hermes' turn, tool and request events as JSONL for the xray TUI widget.

Since 0.22 every turn runs in the shared gateway process (``hermes gateway run``), not in a python child of
the node TUI. The widget (~/.hermes/tui-widgets/xray.mjs) still tails ``$HERMES_HOME/xray/live/<TUI node
pid>.jsonl``, so each event goes to the feeds of the TUIs viewing its session: session id -> the gateway's
live session -> its WebSocket peers' ports -> the pids owning those sockets (/proc). Only feeds that exist
get lines: the widget creates its own at load, so Desktop, classic CLI and widget-less TUIs get none. Lines follow xray's
hooks/events.ts schema with hermes' own tool names and args; the widget maps them (mods/xray/hermes/calls.ts).
Spec: mods/xray/hermes/SPEC.md. Every hook swallows its errors and returns None: pre_tool_call is
fail-closed and a dict there is a directive.
"""

from __future__ import annotations

import gc
import json
import os
import sys
import threading
import time
import weakref

_MAX_TEXT = 6000  # chars of a tool result kept: the tail, where test summaries and errors land
_RESCAN_S = 5.0  # gc scans for the gateway's session authorities, at most this often
_lock = threading.Lock()
_route_lock = threading.Lock()
_live_dir: str | None = None
_authorities: weakref.WeakSet = weakref.WeakSet()
_scanned_at = 0.0
_children: set[str] = set()  # delegate_task sessions: never fed (SPEC d2), the parent shows the call
_routes: dict[str, tuple[tuple[str, ...], tuple[int, ...]]] = {}  # sid -> (WS peers, their pids)


def _feed_dir() -> str:
    global _live_dir
    if _live_dir is None:
        home = os.environ.get("HERMES_HOME", "").strip() or os.path.join(os.path.expanduser("~"), ".hermes")
        _live_dir = os.path.join(home, "xray", "live")
        os.makedirs(_live_dir, exist_ok=True)
    return _live_dir


def _live_session(sid: str, rescan: bool):
    # The plugin API names no session's clients; the gateway's SessionAuthority holds them, reachable
    # from here only through gc. One scan per new authority (one per served profile), throttled.
    global _scanned_at
    for authority in list(_authorities):
        live = authority.sessions.get(sid)
        if live is not None:
            return live
    mod = sys.modules.get("gateway.session_authority")
    if not rescan or mod is None or time.monotonic() - _scanned_at < _RESCAN_S:
        return None
    _scanned_at = time.monotonic()
    for o in gc.get_objects():
        if isinstance(o, mod.SessionAuthority):
            _authorities.add(o)
    return next((a.sessions[sid] for a in list(_authorities) if sid in a.sessions), None)


def _peer_ports(live) -> tuple[str, ...]:
    fanout = live.event_stream.fanout
    return tuple(sorted(p for t in fanout.transports() if isinstance(p := getattr(t, "_peer", None), str)))


def _socket_inodes(ports: set[int]) -> set[str]:
    # The peer is the client's end: its local port in this namespace's TCP tables.
    inodes = set()
    for table in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            with open(table) as f:
                rows = f.readlines()[1:]
        except OSError:
            continue
        for row in rows:
            cols = row.split()
            if len(cols) > 9 and cols[3] == "01" and int(cols[1].rsplit(":", 1)[1], 16) in ports:
                inodes.add(f"socket:[{cols[9]}]")
    return inodes


def _socket_pids(peers: tuple[str, ...]) -> tuple[int, ...]:
    ports = {int(p.rsplit(":", 1)[1]) for p in peers if p.rsplit(":", 1)[-1].isdigit()}
    inodes = _socket_inodes(ports) if ports else set()
    if not inodes:
        return ()
    me, pids = os.getpid(), set()
    for name in os.listdir("/proc"):
        if not name.isdigit() or int(name) == me:
            continue
        try:
            fds = os.listdir(f"/proc/{name}/fd")
            if any(os.readlink(f"/proc/{name}/fd/{fd}") in inodes for fd in fds):
                pids.add(int(name))
        except OSError:
            continue
    return tuple(sorted(pids))


def _targets(sid: str | None, rescan: bool = False) -> tuple[int, ...]:
    """Pids of the clients viewing *sid* now; () for children and sessions nobody views."""
    if not sid or sid in _children:
        return ()
    with _route_lock:
        live = _live_session(sid, rescan)
        if live is None:
            return ()
        peers = _peer_ports(live)
        cached = _routes.get(sid)
        if cached and cached[0] == peers:
            return cached[1]
        pids = _socket_pids(peers)
        if len(_routes) > 64:
            _routes.clear()
        _routes[sid] = (peers, pids)
        return pids


def _write(kind: str, t: float | None = None, *, rescan: bool = False, **fields) -> None:
    try:
        pids = _targets(fields.get("sid"), rescan)
        if not pids:
            return
        line = {"t": int((t if t is not None else time.time()) * 1000), "kind": kind}
        line.update({k: v for k, v in fields.items() if v is not None})
        data = json.dumps(line, default=str, ensure_ascii=False) + "\n"
        with _lock:
            for pid in pids:
                try:  # no O_CREAT: a missing feed means no widget there (or it exited)
                    fd = os.open(os.path.join(_feed_dir(), f"{pid}.jsonl"), os.O_WRONLY | os.O_APPEND)
                except FileNotFoundError:
                    continue
                with os.fdopen(fd, "a", encoding="utf-8") as f:
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
    if parent_session_id and session_id:
        _children.add(session_id)
        return
    msg = user_message if isinstance(user_message, str) else ""
    _write("turn_start", sid=session_id, prompt=msg[:400], rescan=True)


def _turn_end(session_id=None, **_):
    _write("turn_end", sid=session_id)


def _stopped(session_key=None, **_):
    # /stop names the route key (agent:main:local:dm:<session id>), not the session id.
    _write("turn_end", sid=str(session_key or "").rsplit(":", 1)[-1] or None)


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
    if os.environ.get("CLAUDE_HUMAN_MODS") == "off":
        return
    ctx.register_hook("pre_llm_call", _turn_start)
    ctx.register_hook("pre_tool_call", _tool_start)
    ctx.register_hook("post_tool_call", _tool_end)
    ctx.register_hook("post_api_request", _usage)
    # on_session_end fires once per turn (run_conversation), interrupted ones too; /stop also says so.
    ctx.register_hook("on_session_end", _turn_end)
    ctx.register_hook("agent_loop_stopped", _stopped)
