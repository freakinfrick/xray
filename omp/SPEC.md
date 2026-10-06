# xray for omp (oh-my-pi) — spec

Port of the Claude Code xray mod to an omp extension (omp v18.3.5). Parent spec: `../SPEC.md`.
API notes the port relies on: omp extension API checked against the v18.3.5 tag (upstream main
has drifted to 18.6.2, read the tag).

## Decisions (user, 2026-10-06)

1. **To-do: omp's own list stays.** omp's built-in `todo` tool already pins a list above the
   spinner. xray draws no to-do card, owns no task tools, adds no system-prompt line. No redundancy.
2. **Look: omp-native skin.** Rounded `╭╮╰╯` frames from `theme.boxRound`, colors only through
   `theme.fg(token)`, glyphs follow omp's `symbolPreset` (unicode / nerd / ascii). Feels built in.
3. **AI extras out of v1.** Narration and custom task cards (both model calls) are not ported.
   README gets a TODO entry: add later on omp's `smol` model role.

## What it shows

- **Working:** one `now` card in an `aboveEditor` widget, directly under omp's spinner: current step
  as a colored band (text from `tool_execution_start.intent`, else parsed args), fact rows (tests,
  files), step + context gauges and folder in the bottom edge, `xray` tag in the top edge. A failing
  run turns it `error`.
- **Idle:** the same widget key collapses to one strip: context %, folder, genome.
- **Genome:** a cell per tool call colored by kind, turns in kind brackets `( )` `[ ]` `{ }` as in
  the parent. Also written to the session name via `pi.setSessionName()` (omp's analogue of the
  `/resume` title).
- **`/xray`:** detail panel as a `ui.custom(..., { overlay: true })`: whole genome + key, last
  turn, folder and age, per-request time and token rate, every step. `/xray on|off` hides the widget.

## Defaults (decided by agent, say "undo dN")

- d1 **Shared core.** Code lives in `~/claude/mods/xray/omp/`, imports `../hooks/*` (pure `Seg[]`
  rendering, no `claude-code` imports). One source of truth. A Seg→ANSI adapter maps xray tones to
  theme tokens (ok→success, fail→error, warn→warning, live→accent, think/explore→muted variants).
  Symlinked into `~/.omp/agent/extensions/xray`. Ships in the freakinfrick/xray subtree mirror.
- d2 **Kind table** maps omp tools to genome kinds: read/grep/glob→read, edit/write→edit,
  bash→classified by command (reuses parent shell sorting), task→agent, todo→plan.
- d3 **Cache countdown dropped.** omp exposes no cache TTL (only `cache_warming_decision`), runs
  its own cache warmer, and mostly runs DeepSeek here, which has no short cache timeout.
- d4 Guard all UI with `ctx.agent.kind === "main" && ctx.hasUI` (factories rebind in subagents).
  Re-set the widget on `session_switch` (`/new`, `/resume`, fork wipe widgets). Timers via
  `ctx.setInterval`. `CLAUDE_HUMAN_MODS=off` disables it, as in the parent.
- d5 Phone fold (<60 cols) kept: card folds to the strip form.

## Out of scope (v1)

To-do card, task tools, cache countdown, narration, custom cards, moments/celebrations
(revisit after v1 is seen live).

## Verify

No hot reload: restart with `omp -c`. Unit tests for the adapter + kind table under bun;
done = screenshot of a real omp session (DISPLAY=:10.0 import), working and idle states.
