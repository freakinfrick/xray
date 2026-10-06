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

- **Working:** one `now` card in an `aboveEditor` widget, directly under omp's spinner, full width
  like omp's tool cards: the current step as a colored band (the core's step words, d7), fact rows
  (tests, files), a gauge row (cache hit rate, tok/s, turn time; d8), the live genome row under it.
  A failing run turns it `error`.
- **Idle:** the same widget key collapses to the genome alone (d8).
- **Genome:** a cell per tool call colored by kind, turns in kind brackets `( )` `[ ]` `{ }` as in
  the parent. (Planned for the session name too; dropped, see d6.)
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

## Built (2026-10-06, live-checked in omp 18.3.5 on DeepSeek V4.1 Flash)

Changes from the plan, each from a live capture:

- d6 **No genome in the session name.** omp strips ESC from session names: the coloured genome showed
  as raw `[0;34m▌` codes in the session line and the `/resume` list. A plain-glyph genome there would be
  colourless clutter on a line always on screen; the strip under it carries the genome.
- d7 **The band says what, not why.** omp's working line already shows each call's intent (`i`); the
  band shows the core's own step words (`editing calc.py`, `running the tests`). The intent only
  speaks for tools the core has no words for (`eval`, `hub`, …).
- d8 **No context gauge, no folder.** omp's status line shows both; the card's gauge row keeps cache
  hit rate, tok/s and turn time; the idle strip is the genome alone.
- d9 **`/xray` in omp's overlay chrome:** rounded box in `borderAccent`, `xray` in the top edge, "any
  key closes" in the bottom, rows padded so no chat shows through, capped to the terminal height.
- Core change: `spinnerRows(..., withTodo = true)`; `false` draws the now card alone at full width.
- Genome store: `~/.omp/agent/xray/genomes.json` (40 sessions, as the parent). Survives `/resume`.
- Installed: `~/.omp/agent/extensions/xray` → this folder.

Verified: `mods/check.sh xray` (validate, tsc, tests incl. `omp/ink.test.ts`), `tsc -p omp`; live in
tmux + xterm on :10: working card, idle strip, resume, `/xray`, 50-column fold, unflagged load.

## Out of scope (v1)

To-do card, task tools, cache countdown, narration, custom cards, moments/celebrations
(revisit after v1 is seen live).

## Verify

No hot reload: restart with `omp -c`. Unit tests for the adapter + kind table under bun;
done = screenshot of a real omp session (DISPLAY=:10.0 import), working and idle states.
