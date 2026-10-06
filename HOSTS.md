# xray on every harness — spec (2026-10-06)

xray is a mod for several agent harnesses, not only Claude Code: one shared core (`hooks/*.ts`, pure
`Seg[]` lines) with a thin host adapter per harness. Per-host specs: [`omp/SPEC.md`](omp/SPEC.md),
[`pi/SPEC.md`](pi/SPEC.md), [`hermes/SPEC.md`](hermes/SPEC.md), [`grok/SPEC.md`](grok/SPEC.md); dsh-tui's
adapter and its notes live in the dsh-tui repo. Claude Code's spec is `SPEC.md`.

## Status (2026-10-06)

All six hosts built. "Live" = run in the real harness against DeepSeek V4.1 Flash (tmux 120×40, screen
captured); every host's pure pieces are also under `../check.sh xray` in the parent mods repo (validate,
tsc per host folder, `claude plugin test`). Captures in `docs/hosts/` (tmux status row cropped off).

- **Claude Code** — built, live (genome rows enclosed under the two cards). Spec: `SPEC.md`.
  [working](docs/hosts/claude-working.png) · [idle](docs/hosts/claude-idle.png) · demo `docs/demo.gif`
  (recorded before the frame extended down).
- **omp** 18.3.5 — built, live (now on the shared `pifamily/` adapter). Spec: [`omp/SPEC.md`](omp/SPEC.md).
  [working](docs/hosts/omp-working.png) · [idle](docs/hosts/omp-idle.png) · [panel](docs/hosts/omp-panel.png)
  · demo `docs/omp-demo.gif`. The panel capture predates the turns-width fix (shows `+1 turn`; fixed and
  pinned by a test, seen fixed on pi).
- **pi** 0.87.1 — built, live. Spec: [`pi/SPEC.md`](pi/SPEC.md).
  [working](docs/hosts/pi-working.png) · [idle](docs/hosts/pi-idle.png) · [panel](docs/hosts/pi-panel.png)
- **hermes** 0.21.5 `--tui` — built, live (incl. 56-column fold and hot reload). Spec:
  [`hermes/SPEC.md`](hermes/SPEC.md). [working](docs/hosts/hermes-working.png) ·
  [idle](docs/hosts/hermes-idle.png) · [panel](docs/hosts/hermes-panel.png)
- **grok** 1.0.41 — built, live with `grok-deepseek`; no panel by design. Spec: [`grok/SPEC.md`](grok/SPEC.md).
  [working](docs/hosts/grok-working.png) · [idle](docs/hosts/grok-idle.png)
- **dsh-tui** — built, live. Adapter in the dsh-tui repo (`xray.mjs`, `tui.mjs`; branch `feat/xray`, local),
  its tests `node --test xray.test.mjs` there, not under check.sh. [working](docs/hosts/dsh-working.png) ·
  [idle](docs/hosts/dsh-idle.png) · [panel](docs/hosts/dsh-panel.png)

### Open issues

- **core:** the fact cut prints `running……` (ellipsis on a word already ending in …); the panel's steps list
  shows the last 6, so an early failed step counts in the title but isn't listed; `hooks/panel.ts:115` lets a
  null context percent through (pi's adapter coerces it); `hermes/panel.ts` duplicates the omp/pi panel
  section builder, which belongs in `hooks/` for every single-card host.
- **omp/pi:** omp `agent_start` reusing a still-open turn after `willContinue` (d12) is reasoned, not seen
  under a real retry; pi closing the turn on `agent_settled` after Esc is inferred from pi's types; omp's glob
  case maps `a.path` as the pattern (param name unverified); omp PNGs predate the last retoken/turn-reuse
  edits (re-checked by text capture only).
- **hermes:** `/new` and `/resume` record swap and the subagent filter are unit-tested only; the hot-reload
  double-count fix was seen once, indirectly. `xray.mjs` is git-ignored (`hermes/.gitignore`) while
  `hermes/SPEC.md` says to commit the built file: an install needs `build.sh` either way.
- **grok:** no live cache/tok gauges (grok reports usage once per turn, d2); a grok killed mid-turn leaves the
  card up until the next prompt (d1); `grok-claude` wired but never run live; `grok-local` (python launcher)
  and `~/.grok`, `~/.grok-secondary`, `~/.grok-tertiary` have no xray. A 4-line card option (no divider when
  the gauge row is turn time only) would suit grok's row.
- **dsh-tui:** Ctrl-C mid-turn is reasoned, not live-tested; the 500 ms busy redraw re-renders the whole
  transcript (possible flicker on long ones, not measured).
- **build:** `hermes/build.sh` and `grok/build.sh` default to an esbuild inside a local hermes checkout
  (`ESBUILD=` overrides); without it grok's launchers silently omit the status line.

## Decisions (user, 2026-10-06)

1. **Hosts in scope:** claude (exists), omp (done today), pi, hermes, grok, dsh-tui.
   **Out:** codex and unreal (no surface inside their window; a side-pane log viewer was offered and
   declined), dsh's browser app (no terminal).
2. **Hermes:** its full-screen TUI mode only (`hermes --tui`, Ink widget SDK). Classic prompt_toolkit
   mode is not patched; xray simply doesn't show there.
3. **Genome inside the card.** Single-card hosts (omp, pi, hermes, dsh-tui, grok): the genome moves
   into the now card, in the empty space right of the fact rows, wrapping there; no separate row
   under the card. Claude Code (now card + to-do card): the genome stays below the cards as full-width
   horizontal rows; the cards' border extends down to enclose them (user, 2026-10-06: "still below,
   horizontal rows, card border just extends down to capture"). The now card's left edge and the
   to-do card's right edge run on down, one bottom edge closes the shape:

       ╭ now ──────────────╮ ┏━ to-do ■◆□□ 2/4 ━┓
       │ facts             │ ┃ cells            ┃
       ╰───────────────────╯ ┗━━━━━━━━━━━━━━━━━━┛   ← cards' own bottoms (or joined tees)
       │ [▌▌▌#▌▌][▌▌▌▌ …  genome rows, full width  ┃
       ╰──────────────────────────────────────────┛
4. **dsh-tui:** in. Our dsh fork's NDJSON event stream (`packages/dsh-headless-resume`) gains call
   ids, full args/results and usage first (~30 lines), then dsh-tui draws the card natively.
5. **Repo:** fold everything into the public freakinfrick/xray, README reframed as multi-harness.
   Pushing stays a separate go (inventory first); the private freakinfrick/xray-omp is retired then.

## Per host (plan, from the 2026-10-06 survey)

- **pi 0.87.1** — same extension API family as omp. One shared adapter `xray(pi, host)` + two small
  entry files. Fixes: no `ctx.setInterval` (plain timer, cleared on `session_shutdown`); no
  `getColorHex` (bg from `getFgAnsi` with `38;`→`48;`, works on both); close turns on
  `agent_settled` (pi's `agent_end` has no `willContinue`); null context usage; `find`/`ls` tools;
  genome store path per host. Card sits above pi's spinner (pi draws it in the editor border).
  Hot reload: `/reload`. Live test: `pi-deepseek`.
- **hermes (--tui)** — `~/.hermes/tui-widgets/xray.mjs` (hot-loads): ambient widget in `dock-bottom`
  for card/strip, modal widget for `/xray`. Core bundled with hermes' esbuild; Seg→Ink `<Text>`
  mapper (reuse `register.tsx`'s). Events: a small python plugin (`post_tool_call`,
  `post_api_request`, `on_session_*`) writes a JSONL per TUI process; the widget watches it. No
  hermes fork patch. Tool names from `hermes tools list`. Live test: `hermes-deepseek --tui`.
- **grok** — `$GROK_HOME/hooks/*.json` hooks (Claude-style events) write a JSONL; a
  `[ui.status_line] type="command"` renders card + genome (≤5 lines, ANSI, ~300 ms refresh, usage on
  stdin). No `/xray` panel (no overlay; viewer declined). Footgun: post-tool hook prints nothing,
  exits 0 (its stdout reaches the model). Note: grok also runs `~/.claude/settings.json` hooks.
  Live test: `grok-deepseek` (launcher regenerates its config each launch: the status-line block goes
  in the launcher's template).
- **dsh-tui** — card between the status line and the input row (`tui.mjs` render), events from the
  NDJSON line handler, `/xray` as a toggled full view (Ink has no overlays). Core loaded on node 24
  via a small import hook. Live test: `dsh-tui` with `~/.config/secrets/deepseek.env` sourced.

## Shared pieces

- **JSONL-fed hosts (hermes, grok):** one event schema + reducer in the core (`hooks/events.ts`):
  `{t, kind: start|end|usage|turn_start|turn_end, id, tool, input, ok, text}` → the same `Turn` /
  genome the in-process hosts build. The feeds are written in the host's dialect (its own tool names and
  args: hermes' plugin also adds `sid`/`parent`); each host's TS map (`hermes/calls.ts`, `grok/map.ts`)
  turns a line into a core event before `events.apply`. dsh-tui feeds the same reducer from its NDJSON.
- **Tool-name maps** per host into the core's names: `pifamily/ink.ts` `toCall` (omp, pi), `hermes/calls.ts`,
  `grok/map.ts`, dsh-tui's `xray.mjs`.
- **Look:** each host's own theme where it has one (omp/pi theme tokens; hermes/Ink and dsh-tui
  their palette; grok plain ANSI), native frame glyphs, no repeats of what the host already shows
  (its to-do list, folder, context % in its status line).

## Testing

DeepSeek endpoints for every live test (`*-deepseek` launchers / dsh-tui default), in an isolated
`tmux -L <sock>` with `env -i` + `DEEPSEEK_API_KEY`; screenshots of the real screen. Done per host =
`mods/check.sh xray` green + a live capture of working card, idle state, and `/xray` where it exists.

## Out of scope

codex, unreal, dsh browser app, hermes classic mode, a side-pane viewer, AI extras (narration,
custom cards) on new hosts.
