# xray on every harness — spec (2026-10-06)

xray stops being "a Claude Code mod" and becomes a mod for the agent harnesses on this box, one shared
core (`hooks/*.ts`, pure `Seg[]` lines) with a thin host adapter per harness. The public repo
freakinfrick/xray is reframed to match. Per-host specs: `omp/SPEC.md` (done), new ones per host below.

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

## Per host (from the 2026-10-06 survey, notes in the session scratchpad)

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
  genome the in-process hosts build. Each host's hook/plugin only translates its own events.
- **Tool-name maps** per host into the core's names (as `omp/ink.ts` `toCall`).
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
