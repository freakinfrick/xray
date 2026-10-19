# xray for hermes (`hermes --tui`) — spec

Port of xray to Hermes Agent's full-screen Ink TUI (v0.22.2, fork `~/hermes-agent`; first written on v0.21.5). Parent: `../HOSTS.md`
(decision 2: TUI mode only, no patch to the hermes fork). Pattern: `../omp/SPEC.md`.

## What it shows

- **Working:** the now card docked above hermes' bottom status bar (ambient widget, `dock-bottom`), full
  width: the step band, fact rows (tests, files), the gauge row (cache hit rate, tok/s, turn time) and the
  session genome inside the card, right of the facts (core `spinnerRows(..., { withTodo: false, turns })`).
  Under 60 columns it folds to the compact rows plus a one-row genome, as omp.
- **Idle:** the genome alone, `genome` at the right edge (`genome.idle`).
- **`/xray`:** detail panel as a modal widget: hermes' own `Overlay` + `Dialog` (rounded, primary border,
  `xray` title, "any key closes"): genome + key, here, requests, steps, files, turns. Capped to the screen.
- **`/xray-card`:** shows or hides the card (an ambient app's id is its own toggle).

## How it is wired

    shared gateway (`hermes gateway run`)               hermes node TUI (Ink), one per pane
    plugin/__init__.py hooks ──append──▶ ~/.hermes/xray/live/<TUI pid>.jsonl ──fs.watch/tail──▶ xray.mjs
          │ session id → live session → WS peer port → pid owning that socket (/proc)

- `plugin/` (installed as `~/.hermes/plugins/xray`, listed in `plugins.enabled`): `pre_llm_call` →
  turn_start, `pre_tool_call` → start, `post_tool_call` → end, `post_api_request` → usage,
  `on_session_end` (fires once per turn, interrupted ones too) and `agent_loop_stopped` → turn_end.
  Since 0.22 every turn (TUI, classic, `-q`) runs in the one shared gateway, so the plugin loads there and
  routes each line to the TUIs viewing its session (d1). It appends only to a feed that already exists:
  the widget creates its own at load, so classic mode, Desktop and widget-less TUIs get nothing.
  `CLAUDE_HUMAN_MODS=off` in a TUI's env stops its widget, and with it that TUI's feed. Every hook swallows errors and returns None (`pre_tool_call` is fail-closed;
  a dict there is a directive). Big args (file contents, patches, code) are dropped; results keep their
  last 6000 chars.
- `widget.ts` → `xray.mjs` (installed as `~/.hermes/tui-widgets/xray.mjs`): registers `xray` (modal) and
  `xray-card` (ambient), opens the card at load, tails its own pid's feed by byte offset (directory
  watch + 1 s timer, which also moves elapsed times while a turn runs), saves each finished turn to
  `~/.hermes/xray/genomes.json` (40 sessions, as omp). Deletes its feed on exit; feeds of dead pids
  are pruned at load.
- Pure, gate-tested pieces: `calls.ts` (tool map, result text, feed line → core Event), `feed.ts`
  (session and subagent handling over `../hooks/events`), `ink.ts` (Seg → Ink `<Text>` props through
  the skin), `panel.ts` (the panel's rows). Tests: `hermes.test.ts`.

## Decisions (agent, say "undo dN")

- d1 **Feed key = the TUI's pid, found through its socket.** 0.22's TUI spawns no python child: it
  talks to the shared gateway over a loopback WebSocket. The plugin API names no session's clients, so
  the plugin finds the gateway's `SessionAuthority` objects through `gc` (once, rescans throttled to 5 s),
  takes the hook's `session_id` → `authority.sessions[sid].event_stream.fanout` → each `WSTransport._peer`
  (`127.0.0.1:<client port>`) → the `/proc/net/tcp` inode → the pid holding it. Cached per session and
  re-resolved when the peer set changes (reconnect, a second window on one session: each gets the lines).
  Private gateway internals: a hermes update can move them, and then the card goes quiet (no crash; every
  hook swallows). Verified on 0.22.2 with two parallel panes on one gateway: feeds stay apart.
- d2 **Subagents dropped from the feed.** `delegate_task` children fire the same hooks in the same
  process; a turn_start with a `parent` marks that session id a child and the plugin drops its lines
  (they have no viewer of their own anyway; `feed.ts` keeps its own child filter for old feeds). The
  main turn shows the delegate call itself (agent kind). A parentless turn_start with a new session id
  (`/new`, `/resume`) saves the old record and loads the new one.
- d3 **Tool map in TS, not python.** The plugin writes hermes' names and raw args (`tool`, `args`, plus
  `sid`/`parent`); `calls.ts` maps them into the core's names before `events.apply`. One table, beside
  omp's `toCall`, under the gate. So the JSONL is the events.ts schema in hermes' dialect: same kinds and
  fields, host tool names. Map: terminal→Bash, read_file→Read, write_file→Write, patch→Edit,
  search_files→Grep (target=files: Glob), web_search→WebSearch, web_extract/browser_navigate→WebFetch,
  delegate_task→Task, execute_code→script, todo_list/memory→bookkeeping (dim), rest→other.
- d4 **Skin colours.** green→ok, red→error, yellow→warn, cyan→accent, magenta→label, gray→muted,
  plain text→text (Ink's default reads as the TUI's gold). blue→`shellDollar`: the default skin is all
  golds and its one blue is the shell prompt's `$`; with `primary` reads were the same gold as agents.
- d5 **No context gauge, folder or cost:** hermes' status bar shows them.
- d6 **Hot reload keeps the folded feed** (`globalThis.__xrayHermes.tail`): re-reading the file onto
  the stored record added its finished turns twice (seen live, fixed). A reload re-shows a hidden card.

## Limits

- `/resume` of an earlier session shows its stored genome from the first prompt on (hermes fires no
  plugin hook when the TUI opens a session).
- No `responding`/`thinking` mode: no plugin hook marks the first streamed token cheaply; the band
  says "waiting on the model" until a tool starts.
- Classic prompt_toolkit mode: nothing (HOSTS.md decision 2).
- **Gateway and TUI must see each other's `/proc`.** The plugin reads the TUI's socket fds; a TUI
  launched inside a sandbox (bwrap, another pid/user namespace) against a gateway started outside it,
  or the reverse, gets no feed and an idle card. Restart the gateway from the same side as the TUI.

## Build, install, verify

    ./build.sh                                  # hermes' esbuild → xray.mjs (git-ignored: build after clone)
    ln -s $PWD/xray.mjs ~/.hermes/tui-widgets/xray.mjs
    ln -s $PWD/plugin   ~/.hermes/plugins/xray   # and add `- xray` under plugins.enabled in ~/.hermes/config.yaml

`mods/check.sh xray` type-checks `hermes/` (its own tsconfig, node built-ins typed in `env.d.ts`) and
runs `hermes.test.ts`. A rebuilt `xray.mjs` hot-loads when the widgets folder changes (`touch -h` the
symlink); plugin changes need a **gateway** restart (it runs with `--idle-exit`: quit every TUI, or stop
`hermes gateway run`). Live-checked 2026-10-06 in `hermes-deepseek --tui` (DeepSeek V4.1 Flash), 120×40 and
56 columns: working card, idle strip, `/xray`, hot reload. Re-checked 2026-10-19 on 0.22.2 against a fake
OpenAI-compatible server in an isolated `HERMES_HOME`: working card, idle genome, `/xray`, `/new`, 56 columns,
two panes on one gateway.
