# xray

A Claude Code mod: glanceable cards under the spinner showing what Claude is doing, what is left
on its plate, and how the task stands, plus a session genome (every step of the session, one
colored cell each).

![xray demo: a 322k-token session's genome, then a new task with its to-dos](docs/demo.gif)

## What it shows

- **Working:** three cards under the spinner: now (status, narration, last step), to-do (one chip
  per item), and a task card (tests, refactor, research, or a custom layout), with telemetry
  (turn time, context, token rate, cache) in the bottom edge.
- **Between turns:** one strip above the prompt: the last turn, what is still owed, the session
  span, and the genome flush right.
- **`/xray`:** the detail panel: the whole genome with its key, turns by name, files touched.
- Under 60 columns (a phone) the cards fold into one.

## Install

Function-hook plugin, Claude Code ≥ 2.1.287. Point Claude Code at this folder:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/xray" } }
```

in `~/.claude/settings.json`, then start a new session.

## Commands and settings

- `/xray` opens or closes the panel; `/xray on|off` shows or hides the cards;
  `/xray cache on|off` the cache countdown; `/xray rate good|bad <note>` rates a custom card.
- `narration` (on/off): a one-line » from Haiku at task start and on the first failure, at most
  once a minute.
- `customCards` (on/off): Haiku lays out a task card for work the kept layouts don't cover.
- `CLAUDE_HUMAN_MODS=off` in the environment turns xray off (used for unattended agent panes).

## Development

`claude plugin validate .` and `claude plugin test` from this folder. Design history and every
round of feedback: `SPEC.md`.
