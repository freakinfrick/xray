# xray for hermes (`hermes --tui`) — spec

Port of xray to Hermes Agent's full-screen Ink TUI (v0.21.5, fork `~/hermes-agent`). Parent: `../HOSTS.md`
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

    hermes python (gateway)                         hermes node TUI (Ink)
    plugin/__init__.py hooks ──append──▶ ~/.hermes/xray/live/<TUI pid>.jsonl ──fs.watch/tail──▶ xray.mjs

- `plugin/` (installed as `~/.hermes/plugins/xray`, listed in `plugins.enabled`): `pre_llm_call` →
  turn_start, `pre_tool_call` → start, `post_tool_call` → end, `post_api_request` → usage,
  `on_session_end` (fires once per turn, interrupted ones too) and `agent_loop_stopped` → turn_end.
  Registers only inside the TUI gateway (`tui_gateway.entry`), never in classic mode, and not under
  `CLAUDE_HUMAN_MODS=off`. Every hook swallows errors and returns None (`pre_tool_call` is fail-closed;
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

- d1 **Feed key = the TUI's pid.** The node TUI spawns the gateway directly; the plugin walks up
  `/proc` to the nearest `node` ancestor. Parallel hermes panes share `~/.hermes` and stay apart.
- d2 **Subagents dropped from the feed.** `delegate_task` children fire the same hooks in the same
  process; a turn_start with a `parent` marks that session id a child and its lines are skipped. The
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

## Build, install, verify

    ./build.sh                                  # hermes' esbuild → xray.mjs (commit the built file)
    ln -s $PWD/xray.mjs ~/.hermes/tui-widgets/xray.mjs
    ln -s $PWD/plugin   ~/.hermes/plugins/xray   # and add `- xray` under plugins.enabled in ~/.hermes/config.yaml

`mods/check.sh xray` type-checks `hermes/` (its own tsconfig, node built-ins typed in `env.d.ts`) and
runs `hermes.test.ts`. A rebuilt `xray.mjs` hot-loads when the widgets folder changes (`touch -h` the
symlink); plugin changes need a TUI restart. Live-checked 2026-10-06 in `hermes-deepseek --tui`
(DeepSeek V4.1 Flash), 120×40 and 56 columns: working card, idle strip, `/xray`, hot reload.
