# xray — under-the-hood Claude Code mod (spec)

Human-facing Claude Code mod (function-hook plugin, CC >= 2.1.287) that replaces
claude-toons (removed 2026-10-02). Shows what Claude is doing and how the task
stands, as structural infographics with a strong look. Toons-like spirit, less
animated, but animated in its own way.

## Decisions (user, 2026-10-02)

- **1a — surfaces:** slim view by default, full panel on demand.
  - working → `Spinner` slot (under the spinner, as toons drew; exists only while a turn runs)
  - idle → `AbovePrompt` strip (context gauge + last-turn summary)
  - `/xray` → `Pane` (full panel; opened by the command so it seats at any width)
  - Default chosen by agent (easy to undo): spinner slot for working, since `AbovePrompt` alone
    would miss the toons placement the user pointed at.
- **2a — look:** 3 cell-faithful mockups on one page, user picks. Brief: like toons, more
  structural/infographic, less animated but uniquely animated. Library of ready-made templates
  + mix + fresh on-the-fly creations is liked (as toons' Scenes setting).
  Mockups: `~/claude/.explainers/2026-10-02-xray-styles.html`. Round 1 feedback below.

- **3b — narration:** yes. Small model, at most once a minute, triggered on task start and
  failure (toons' rule). Hidden/off via `/xray`. Measurements never come from the model.
- **Conductor panes off:** collaborators and arbiters never run it. Mechanism:
  `_mint_session` (`~/.claude/skills/conductor/conductor.py:243`, used by workers :707 and the
  arbiter :2397) adds `CLAUDE_HUMAN_MODS=off` to its env prefix; the mod reads
  `$.env.get("CLAUDE_HUMAN_MODS")` at `session.start` and does nothing when `off`.
  Not keyed on `HERDR_PANE_ID` — the human's own panes are herdr panes too.

## Round 1 feedback (2026-10-02)

- Name: the working view is an **xray-spinner** (user renamed from "info-spinner").
- S1 Pixel Works: rejected, too cartoony, too little information.
- S2 Blueprint: density liked, but you can't see **what is left on the model's plate**
  (queued tool calls from the current response, open to-dos, background agents/shells, headroom).
- S3 Mural: nice design, but **too rigid and reductive**.
- Xray-spinners vary **per task**: routine tasks use ready-made templates; complex tasks
  *may* (not always) get a custom xray-spinner made for that task.

## Round 2 decisions (2026-10-02)

- **1a — custom xray-spinner = recipe over the shared widget kit.** A recipe names widgets,
  layout and labels; every widget binds to a measured source. Never model-drawn code.
- **2a — to-do nudge:** one line added to Claude's instructions (`prompt.compose`) asking it to
  keep a to-do list on multi-step tasks, so the plate (queued calls, open to-dos, background
  work, headroom) reflects declared work.
- **3a — round 2 mockups:** kit gallery + 3 templates (tests loop, refactor, research) +
  1 custom: `~/claude/.explainers/2026-10-02-xray-spinners.html`.
- **Design discipline = `~/japan-theorem`** (portable framework, `the-japan-theorem-v1.3.md`
  lines 475-637). Applies to my design calls and to the runtime recipe generator:
  - D3: one named visual POSITION; every template and custom recipe derives from it.
  - D1/D2: judge first, MODE audit after; keep or drop the mode only on an object property.
  - D9: every widget choice carries `resolved_by` OBJECT | LEDGER | USER | NOISE.
  - C8/D2 gate: **custom only when the generator names a measured task property no template
    serves**; otherwise a template.
- **Palette:** round 1 drew on Tokyo Night (`#1a1b26`), not the user's terminal. Real terminal:
  herdr forest (`#12160f` bg) and forest-light (`#f2e8cf`). The mod draws on the terminal's
  default background (Raster `0x01000000`); widget colors map to forest accents
  (`~/.config/herdr/config.toml [theme.custom]`) and must read on both.

## Round 2 feedback (2026-10-02)

- Nothing kept. All four too dense: **unglanceable**.
- Info should be **containerized**: grouped into distinct containers, each in a fixed place.
- **Tone telemetry down** in the spinner (token rate, timelines, cache, budgets). Detail moves
  to the on-demand `/xray` panel.
- D4 revision log: round 2 dropped box frames ("cost rows, carry no reading"). Trigger: user
  feedback. Revision: containers come back; the frame's job is to make each question
  findable at a glance, which is a reading. Implication: glanceability beats density.

## Round 3 pick (2026-10-02)

- **A · cards.** User: "extremely more glanceable, as it gives the eyes visual bounds for info
  parsing." Mockup: `~/claude/.explainers/2026-10-02-xray-spinners-r3.html`.
- Layout: three rounded cards under the spinner (4 rows): **now** (plain-words action +
  » narration), **left** (queued · to-do, next item; context warning only past 70%),
  **task** (per template: tests run bar, file squares, questions, agents + goal).
- Card border color is quiet (dim) unless state matters: red failing, green done, peach warning.
- Between turns: one line above the prompt: how the turn ended + what is still owed.

## Round 4 picks (2026-10-02, after the v1 explainer)

- User, verbatim: "xray v2 picks: F, P, A, C, L; also we can add 2 rows for height, 1 row so
  cards have more room to avoid truncation, and 1 row to provide telemetry".
  - F: fix rough edges (no-summary test run counted as 1 test; narration muted a minute after a
    failed model call; idle line "running…" when a turn ends mid run).
  - P: `/xray` detail panel. A: agents + goal card. C: custom recipes. L: taste ledger.
  - V (verify v1 live) not picked; left card and colors stay unverified until seen in use.
- Height: cards grow 4 → 6 rows. One extra content row so long text wraps instead of being cut;
  one row of telemetry.
- D4 revision log: round 2 said "tone telemetry down in the spinner". Trigger: user pick, round 4.
  Revision: one telemetry row is glanceable and stays; anything beyond it lives in the panel.
- Command split (agent default, easy to undo): bare `/xray` opens the panel; `/xray on|off` shows
  or hides the cards.
- Telemetry row (user pick): one full-width strip under the cards, 4 numbers:
  `ctx 41% · 38 tok/s · cache 92% · turn 1m 12s`. Spend and the rest go to the panel.
- Custom recipes (user pick): mockup page with 3-4 example custom layouts first; recipe code
  only after a pick. Build order: F → taller cards + strip → agents card → panel → C mockups →
  C → L.

## Round 5 picks (2026-10-02, custom-card mockups)

- User, verbatim: "recipe writer 1a — keep all; make "left" say "to-do" instead, and have each task
  as a "box" "package" within that are grey until they are complete, then they are colored
  according to the task, each to-do task gets a unique color".
- Custom cards: all four kept (A batch k/N + ETA, B bench trend, C git bisect, D long build vs last
  run). Recipe writer = small model, validated by the mod, ready-made card on any miss.
- Left card → **to-do** card, named chips `[■ read spec] [◉ draw cards] [□ commit]`: grey while
  pending, its own color in progress / done, one unique color per to-do (follow-up pick: chips over
  package boxes and a square row).
- Queued steps, running agents, context warning → a tag in the to-do card's top border.
- Go given for: to-do card → custom cards → taste ledger.

## Round 6 pick (2026-10-02, whimsy + colored blocky glyphs)

- User direction: "add more whimsy into the designs, and more aesthetic by leveraging the colored
  blocky glyphs". Tension named: round 1 rejected Pixel Works as too cartoony; every direction kept
  all round-5 values.
- Mockup page offered r5 / A Inlay / B Bunting (pill titles, running border dash, border progress
  lane) / C Grove (firefly, growing to-dos), per element, on forest + forest-light.
- User, verbatim: "xray r6 picks: A" — **A · Inlay for every element.** Whimsy lives inside the
  widgets; frames stay round 5:
  - now: running step as an inverse tile ` ◆ `, a 1 Hz pulse glyph `▂▄▆█` after the elapsed time,
    spare 3rd row = step trail (`▆` per step: green ok, red failed, cyan live blinking ▆/▄) + counts.
  - to-do: chips as solid patches: done = inverse in its hue, in progress = `▐◉▌` + name in its
    hue, pending = dim inverse (grey patch).
  - tests: 16-cell eighth-precision bar, split cell green on red (`color` + `backgroundColor`);
    row 3 = run history, one `▁…█` per run (pass fraction, green/red) + "36 → 39 passing".
  - bisect: marks as inverse tiles ✓/✗, live `▒/▓`; row 3 = range bar "6 of 13" — **needs a new
    measured value: commit count at bisect start.**
  - telemetry: `ctx` eighth gauge (8 cells), tok/s sparkline over requests, `cache` gauge, turn.
  - idle line: card title as an inverse tone tile; owed to-dos as inverse tiles in their hue.
  - panel: requests wait `▒` + eighth-precision generate bar; step marks as inverse tiles; gauges
    in eighths.
- Render risks to check live: `dimColor`+`inverse` (grey patch) in Konsole; eighth glyphs and
  fg-on-bg split cells in both schemes. Animation only at the 1 s tick.
- Go given 2026-10-02 (reply "1a"). **Built 2026-10-02** (3425627): `hooks/glyphs.ts` (eighth bars,
  sparkline, tiles, 1 Hz frame), `Seg.inv`/`Seg.bg`, `Card.spare` (step trail / run history take the
  3rd row only when wrapping leaves it free, so long narration still wraps), bisect `range` window +
  `span` from the first "revisions left" seen (added to the kept recipe), `LastTurn` gains `title`
  and colored `owed`. Checked: tsc, validate, 38 tests.
- Live-checked 2026-10-02 (fresh Haiku session in tmux, node --test fix turn, 190 cols): step trail
  `▆▆▆… 9 done · 3 failed`, split-cell tests bar, run history row, ctx/cache gauges + tok/s
  sparkline, grey pending patch and running `◆` tile (SGR 7 seen), idle line tiles. Not seen live:
  bisect tiles/range window, batch/build bars, panel (unit-tested). Not seen in Konsole itself
  (tmux capture only): how dim+inverse and the eighth glyphs look on forest/forest-light.

## Later

- Taste ledger (D5): picks sent from the mockup pages and later ratings become ledger entries
  that the recipe generator reads and is bound by.

## Data (all measured, no model)

- `ui.render` Spinner `e.props.mode`: thinking / requesting / responding / tool-input / tool-use
- `turn.step` stream: per-request timing, token rate
- `tool.call` wrapped with `next`: duration, ok/fail, files touched, commands
- `$.session.usage({ breakdown })`: context fill by category, cache read/creation
- TodoWrite / task tools + subagents: progress, current item, fork tree

## Rendering

v1 draws with `Box`/`Text` (Ink), not `Raster`: colors are ANSI names (`green`, `red`,
`yellow`, `cyan`, `magenta`) so they follow the terminal palette (herdr forest and
forest-light write matching Konsole schemes). Each card is four text rows so the title sits in
the top border (Ink boxes cannot title a border). Under 72 columns only now + task show.

## Home

Permanent: `~/claude/mods/xray`, loaded via `env.CLAUDE_CODE_PLUGIN_DIRS` in
`~/.claude/settings.json`. Session dev-mods folder only for hot-reload while building.

## Status

- **v1 built 2026-10-02** (branch `feat/xray`, fast-forwarded into the live trunk) (1a scope): cards, 4 templates, between-turns
  line, Haiku narration, to-do nudge, `/xray on|off`, conductor off-switch. Live via
  `CLAUDE_CODE_PLUGIN_DIRS`. Checked: validate, tsc, 12 tests, live Haiku session fixing a
  failing test (tests card went running → 2/3 fail → all pass; idle line correct).
- **v2 built 2026-10-02** (round 4 picks): F fixes (uncounted runs say passed/failed, stopped
  runs, narration retry, bun summaries, nudge only with a to-do tool), cards 6 rows (3 text rows
  with wrap + telemetry line from `turn.step` usage), agents + goal card (`agent.spawn`, subagent
  `tool.call`/`turn.complete`), `/xray` panel (requests timeline, steps, context + rate-limit
  gauges, spend). Checked: tsc, validate, 25 tests; live Haiku session in tmux (agents card
  start → step → done, tests 1/3 → all pass, telemetry, idle line, panel with 6 requests).
- **Plugin dirs do not hot-reload:** `CLAUDE_CODE_PLUGIN_DIRS` loads at session start; a running
  session keeps the old module. Live checks need a fresh session.
- **Round 5 built 2026-10-02:** to-do card (chips, one hue per to-do from 10 ANSI hues without
  red, plate tags in the border); custom cards in `hooks/custom.ts` (signals bisect > bench >
  batch > build, sticky per turn; sources measured; kept mockup recipes as `DEFAULTS`; Haiku
  writes a recipe once per signal per turn, `checkRecipe` keeps it to the kit; userConfig
  `customCards` on/off); batch follows a background job's `.output` file via `$.fs`; taste ledger
  in `hooks/ledger.ts` (`SEED` rules + `/xray rate good|bad <note>` in `$.store`, a recipe rated
  bad for that card is refused, panel lists the last 3).
- Known limits: a foreground command's output is only seen when it ends (no streaming event), so
  batch progress needs a background job or repeated reads; on forest-light the bright hues barely
  differ from the normal ones, so about 5 to-do hues read as distinct there (10 on forest).
- Live-checked 2026-10-02 (fresh Haiku sessions in tmux, git bisect over 13 commits): chips fill
  ■/◉/□, bisect card found the planted commit, idle line, panel says "layout written for this
  task" once a written recipe passed `checkRecipe` (no typed numbers in the title, every kept
  value present). A bisect step run as one combined command (`… && git bisect good || git bisect
  bad`) is read as its first verb.

## Round 7 — device class (2026-10-02, user "do d5")

- xray draws the session's device class from the `device` mod (`~/claude/mods/device`,
  `$.device.class()`), whose own status line is off on this box so xray owns the drawing.
- Placement (agent default, easy to undo): a leading glyph on the idle `AbovePrompt` strip,
  `📱` mobile / `🖥` desktop / `⌂` local, nothing for unknown. No extra row (mobile has 42).
- Read at render time, so the device mod's `session.start` has run. Guarded: with the device
  mod absent, the strip draws as before.
- **Not a declared `dependencies` entry** (measured 2026-10-02): with `"dependencies": ["device"]`
  in plugin.json, xray does not load at all where device is absent (`/xray` unknown under a
  settings file listing xray alone; loads again with the entry removed). The noun is typed
  locally (`DeviceNoun` in register.tsx) and the call is wrapped in try/catch.
- Built + checked: validate, tsc, 41 tests (glyph map; strip mounted with a stand-in device
  plugin → 📱; without → no glyph, strip intact); live `/xray` loads with and without device.
- Opsec: class only (the device mod never exposes more).
- Mobile reference for later rounds: `~/claude/mods/mobile/README.md` (47×42 Termius capture).
- Mobile strip tail (2026-10-02, user 1a, after a brief 1b): the idle strip's `still owed` tail
  was cut mid-word at 47 cols (capture 2, `mods/mobile/`). On `mobile` the strip drops that tail
  (glyph + last turn + headline only). Other classes unchanged. Owed to-dos stay visible in the
  to-do card while a turn runs; the `/xray` panel does NOT list them (the 1a option text
  claimed it did; wrong).
- Owed to-dos in the panel (2026-10-02, user "keep going" after the above): the `/xray` panel
  gains a `still owed · N` section after `steps`: every open to-do of the shown turn, at most 8,
  in its own hue, `◆` for the one in progress; `nothing ✓` when none are open, and no section
  before any to-do list exists. Pure data in `panel.ts`, so it reads the same on every surface.
- Panel fits the phone (2026-10-02, user go on 1a): `panel()` lays out by the width it is
  given (`e.props.bodyColumns` − the 2-col padding), not by device class, so any narrow pane
  benefits; at ≥ 60 cols the panel is unchanged. Under 60: request bars shrink (min 8 cells)
  and trailing extras (tok/s, cache %) drop when they would not fit; step text shrinks to the
  width; session rows drop their dim tail when it would not fit. Rows: when the surface
  measures < 30 rows (phone with keyboard up ≈ 21), at most 3 requests, 3 steps, 4 owed,
  1 ledger entry. Measured basis: `~/claude/mods/mobile/README.md` (47 × 42, keyboard ≈ 21).

## Round 8 — compact narrow layout (2026-10-03, user "go but 1b")

- Picks: **1b** strip, no frames (over the recommended one-card 1a); **2a** switch by width,
  not device class; **3a** keyboard up → two-row ticker. Mockups were drawn in-session (≤ 41 cols).
- Trigger: `e.viewport.columns < 60` → compact; ≥ 60 unchanged (2 or 3 cards). Rows: compact
  draws the **strip** when `e.viewport.rows` ≥ 30 or unknown, the **ticker** when < 30
  (phone keyboard up ≈ 21). Spinner viewport rows not yet measured: check before relying on it.
- Width: every row `truncate-end`, text ≤ columns − 3 (2 padding + never fill the last column,
  capture 3). Parts drop right to left when they do not fit; never cut mid-word.
- Strip, fixed 4 rows (fixed so the spinner area does not jump):
  1. now: running step as the round-6 inverse tile `◆` + tool, elapsed turn clock, 1 Hz pulse,
     step subject. `◆ Bash 46s ▂▄▆  find arch registry`
  2. narration `» …` (same 30 s TTL as the cards); else dim `last: <finished step>`.
  3. progress: the task card's first row when its template is not plain progress (tests bar,
     bisect range, custom card); else the step trail (last steps that fit) + `5 done` / `· 1
     failed`. Then to-do squares if they fit: one per to-do in its hue (done inverse, in
     progress `◉`, pending dim `□`) + `k/N`. `▆▆▆▆▆▄ 5 done      to-do ■■◉□ 2/4`
  4. telemetry, trimmed: `ctx` gauge + %, tok/s (no sparkline), cache %.
     Turn clock lives in row 1. `ctx ▌······· 6%  108 t/s  cache 92%`
- Ticker, 2 rows: row 1 as above; row 2 = trail count · squares k/N · ctx % · tok/s.
  `▆▆▆▆▆▄ 5 · ■■◉□ 2/4 · ctx 6% · 108 t/s`
- Colors, glyphs, tones: round 6 unchanged. Context warning (≥ 70%) colors the ctx part.
- Checks: tests at 47×42 (4 rows, every row ≤ 44 cells), 47×21 (2 rows), 47×unknown rows
  (strip), 100 cols (cards unchanged, existing tests green); tsc; live phone capture 6 in
  `~/claude/mods/mobile/README.md`.
- **Built 2026-10-03** (`compact()` in `cards.ts`, pure data; `NARROW`/`SHORT` in `register.tsx`).
  Deviation, agent call: row 1 keeps the now card's head as is (step elapsed `· 12s` + pulse); the
  turn clock went to the end of row 4, the first part dropped when short, so two clocks never share
  a row. Ticker row 2 has no clock. Checked: validate, tsc, 49 tests (strip 4 rows ≤ 44 cells,
  word-cut narration, ticker parts drop whole from the right, mounted 47×42 / 47×21 / 100).
  Open: live phone capture 6; whether a height-only change (keyboard up) re-draws by the 1 s tick
  (`RenderViewport.rows` says height alone re-draws nothing).
- Phone capture 6 (2026-10-03, `IMG_2470/2471` via Taildrop, not kept): strip fit at 47 cols;
  keyboard up switched to the ticker live, so the height change DOES re-draw by the 1 s tick.

## Round 9 — compact rows in a card (2026-10-03, user "1a but …")

- User, verbatim: "it would be nice if the info was bound in a card" → pick **1a**: the status
  in the top edge, 4 rows, same height as the strip. Then: "i dont like the odd alignment of the
  "done" stepper and the ctx stepper its visually cluttery".
- Card `columns − 3` wide: top edge `╭─ ◇ deciding the next step · 8s ──╮`; body: narration, then
  `steps` gauge + `k done` (+ failed) + to-do squares; bottom edge `╰─ ctx  gauge %  t/s  turn  cache ─╯`
  (cache drops first). Edges hold ≤ width − 6, body ≤ width − 4, cut at a word or whole parts.
- Gauges aligned (user): steps = one `█` per step (red failed, cyan live) padded with the ctx
  bar's dim `░` track to 8 cells; `│ steps ` and `╰─ ctx  ` both put the bar at column 8.
- Keyboard up: same card, body folded to one row, bare bottom edge (3 rows).
- Edge color = the now card's tone; red when the last step failed and nothing runs (agent d2).
- Checked: validate, tsc, 50 tests (gauge column + 8 cells, frame widths, fold, mounted 47×42 /
  47×21 / 100); text render at 44 cols eyeballed in-session.
- Follow-up (2026-10-03, user "fix the gap and 121s"): the narrow ctx gauge draws whole cells only,
  one cell at any use (Termius drew the `▎` eighth near-blank, capture 6); step and test-run
  elapsed past a minute read `2m 01s` like the turn clock; so do `/xray` panel request and step
  times (tenths kept under 10 s). 53 tests.

## Round 10 — the card grows one row (2026-10-03)

- User, verbatim: "lets adjust the card so it can grow an extra row to avoid truncation of the
  status texts both with leyboard up and down".
- The narrow card may grow by **one** body row (5 rows keyboard down, 4 up). The status (top edge)
  takes it first: cut at a word, the rest on the spare row indented 2; else the narration wraps
  into it. When the status took it, the narration is cut with `…` as before. Anything still past
  the spare row ends in `…`.
- Step text: `sayStep` now keeps a Bash description up to 72 chars (was 40). `nowCard(…, sayMax)`
  shows 40 by default, so the wide cards are unchanged; the narrow card passes 72.
- Reload notice (asked the same turn): `xray: reloaded (N hooks: …)` is printed by Claude Code
  whenever the mod's files change; there is no setting to silence it. It shows only on turns
  that edit the mod.
- Checked: validate, tsc, 55 tests (status wrap keyboard up/down, narration wrap, one-row cap,
  40/72 step text); text render at 44 cols eyeballed.

## Round 11 — status as a highlighted band (2026-10-03)

- User, verbatim: "lets make the status line "highlighted" with the status box color and its text
  will be "negative" so it visually pops, we can scoot it over to the left 1 char longer for
  nicer alignments".
- Top edge: `╭` + band ` status ` (inverse, the card's tone color; quiet = dim inverse, a grey
  patch) + live pulse in its own color + `─…╮`. The band starts right after the corner (one
  column left of the old `╭─ text`), so its text sits in column 2 like the body rows'.
- The band is one tone: the live `◆` tile, timer and spacing fold into plain text. Band text
  ≤ width − 8. Overflow (round 10's spare row) is a band row of its own: `│` + band + `│`.
- Checked: validate, tsc, 55 tests (band text, overflow band, pulse apart, mounted band at 47×42);
  text render at 44 cols eyeballed. Not yet seen on the phone.
- Capture 7: inverse + magenta drew as black on green in Termius. The band is now an explicit
  `backgroundColor` (tone color; quiet = gray) with `color: black`; test asserts it.
- Capture 8: the background-color band renders right on the phone.

## Round 12 — effort in shorthand (2026-10-03)

- User, verbatim: "Can we also add the "effort" in shorthand somewhere to both mobile and desktop xray?"
- Source: `turn.step`'s `e.effort` (main agent only), kept on the turn as the last request's.
- Shorthand after Claude Code's own `◐ medium`: `○ low` `◐ med` `● high` `◉ xhigh` `◉ max`; a
  numeric budget reads `◐ <n>`; no effort (model without one) draws nothing. Dim.
- Where (agent call, easy to move): desktop = last part of the telemetry row; phone = bottom edge
  after t/s (drops before the turn clock and cache when short); keyboard up = end of the folded row.
- Checked: validate, tsc, 56 tests. Not yet seen live.

## Round 13 — to-dos that fire; the wide cards in the phone's look (2026-10-03)

- User, verbatim: "i dont think the xray to-do list is firing as easily as i would like"; "also the
  desktop version should be similar to the design of the mobile version"; "also the "steps" in the
  "now" box is redundant, and the colorered stepper should go in the progress card".
- Root cause of the to-dos: Claude Code 2.1.287 gives the task tools (TaskCreate/TaskUpdate) only
  to older models (Opus/Sonnet 4.x, Haiku 4.5) unless `CLAUDE_CODE_ENABLE_TODO_TOOLS` is set.
  Opus 5.5 sessions had no to-do tool, so the nudge (gated on one) never ran and no list existed.
  Every interactive session since 10-02 had 0 to-do calls; only Haiku test runs had them.
  Fix: `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` in `~/.claude/settings.json` env (tools appear live).
- Desktop, user pick "three cards, phone look": the now card's head is its top edge's band (tone
  background, black text, live pulse after it), its body the narration alone; the step trail left
  the now card; the progress card's row 1 is the phone's step gauge (█ on ░, red failed, cyan
  live), row 2 the to-do squares, row 3 the one in progress; telemetry is one bottom edge
  `╰─ ctx … turn … ─╯` closing all cards (the loose telemetry line is gone, 5 rows not 6).
- Shared with the phone card: `band()`, `stepGauge()`, `squares()`; the phone's progress row is now
  always the task card's row 1.
- Checked: validate, tsc, 58 tests. Not yet seen live.

## Round 14 — the now card shows step text whole (2026-10-03)

- User, verbatim: "the status card now has more room and last: ... doesnt need to get truncated".
- The 40-char cut on the wide cards dates from the one-row now card. Step text (kept to 72 chars at
  the source) now goes in whole on every surface: the band clips the head to its width, the body
  wraps `last:` over its three rows. `nowCard`'s `sayMax` parameter is gone.
- Checked: `mods/check.sh xray` (validate, tsc, 58 tests). Not yet seen live.

## Round 15 — directions for a 10x (2026-10-03, offered, not picked)

- User, verbatim: "how can we level up the xray mod 10x with high leverage design moves / aesthetic
  upgrades / animations / character developemnt"; then "go" (live-check rounds 13+14, then mockups).
- Live check (fresh Haiku session in tmux, 190 cols, failing node --test fix): round 13 as built
  (band head, narration body, one bottom edge closing all cards, tests card + run history).
  Round 14 never showed: `last:` appears only when narration is null (`cards.ts:50`), and narration
  covered the whole 20 s turn with a stale "planning" line while the model ran, edited, passed.
  Haiku wrote its to-do list as text ("Step 3/5") without the tool, so the to-do card stayed empty.
- Mockups: `~/claude/.explainers/2026-10-03-xray-round15.html`, both themes, wide + phone. Ranked:
  1 filmstrip (step gauge cells colored by kind: read ▌ / edit / run / agent / failed / run passed),
  2 motion budget (calm = still; only the card that needs you walks its border at 1 Hz; no
  permission/question event exists in `types/index.d.ts`, a stall is the stand-in),
  3 one-shot transitions (~6 fps for 500 ms after an event; would revise round 6's 1 s-tick rule),
  4 character = memory ($.store per-project history) + voice (persona contract, facts only) +
  measured mood (exploring / focused / stuck / closing / thinking), narration and `last:` share the
  body, 5 glyph grammar as tokens (today ● = done and high effort, ◉ = in progress and xhigh).
- Suggested build order if several are picked: 5 → 1 → 4 → 2 → 3.
- **Picks (2026-10-03, sent from the page):** "everything; need to maximize whitespace, text
  wrapping and smart use of horizontal vs vertical space and subcolumns / rows". All five
  directions kept; the layout requirement is new and gets its own mockup (round 16) before any code.

## Round 16 — all five, laid out (2026-10-03, offered)

- Mockup: `~/claude/.explainers/2026-10-03-xray-round16.html`; drawn by a measuring script
  (`.explainers/xray-r16-src/gen16.py`, exact widths), live-check content, 190 / 120 / 44 cols.
- Layout rules proposed: (1) widths follow content, empty cards fold; (2) 1-col gutter + inner
  padding, a spare row becomes a blank between groups; (3) prose wraps at words, chips flow to the
  next row, `…` only on narration when rows run out; (4) subcolumns for glyph groups, full-width
  rows for prose; (5) 190 → 3 cards, 120 → 2 (to-dos fold into the task card), < 60 → 1 card with
  steps | to-dos on one row; (6) one tray bottom edge kept (round 13), each card's telemetry under it.
- Open question: height B (6 rows when ≥ 40 rows, else 5; recommended) vs A (always 5).
- Decided defaults listed on the page (filmstrip kinds, mood rules, voice contract, 50-event memory,
  motion triggers, 500 ms burst revising round 6, glyph-collision fix, "Step k/N" to-dos).
- Build order on go: layout engine → tokens → filmstrip → character → motion + transitions.
- **Pick (2026-10-03, from the page):** "xray r16: go; B" — build all five with the layout rules,
  height B (6 rows when the terminal has ≥ 40 rows, else 5). Order: layout engine → tokens →
  filmstrip → character → motion + transitions.
- **Built 2026-10-03** (`feat/mods`, 804b53d → 4137ca1, one commit per step): `hooks/layout.ts` draws
  the wide cards as exact-width rows (rules 1–6; Ink flex boxes gone from the wide path); `MARK`/`EMPH`
  tokens in `glyphs.ts`; `Step.kind` + `filmstrip()`; `mood()`, narrator voice + `checkVoice()`,
  `hooks/memory.ts` (store key `history:<cwd>`, 50 events), `planFromText()` for "Step k/N";
  walking border / ctx gauge, landing cells, chip flash (`Todo.doneAt`), tone fade (`Memo`), `burst()`.
- Differences from the page, each forced by an earlier rule: mood glyphs ◇ exploring and … thinking
  (the page drew ◎ ◌, but circles belong to effort); in-progress chips are `◆ name` while done/pending
  keep their round-5 patches; the band's pulse is now the live step's own cell (the only calm motion);
  "stuck" is 3 failing runs or 3 failed steps (the page's "3 edits to one file between failures" left
  out); the 140-column split and the 55% prose hold-back are agent defaults.
- Checked: `mods/check.sh xray` (validate, tsc, 72 tests). Live in tmux (Haiku, 190×50 and 120×50):
  tray, gaps, filmstrip with landing cells, failing card walking, mood focused → closing, to-dos
  folded into the task card at 120. A live check found the now card hoarding width at 120; fixed in
  4137ca1. Not yet seen: the phone (Termius), forest-light, a recalled memory line (needs a second
  session in one project), the chip flash and tone fade by eye (unit-tested only).
