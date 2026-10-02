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
- Status: picks recorded; **no build until an explicit go.**

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
