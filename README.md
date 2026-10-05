# xray

A Claude Code mod: two cards under the spinner showing what Claude is doing and what is left on
its to-do list, plus a session genome (every step of the session, one colored cell each).

![xray demo: an hour-old session's genome, then a new task with its to-do list](docs/demo.gif)

## What it shows

- **Working:** two framed cards under the spinner. Left, **now**: the current step as a colored
  band, a few fact rows (tests, files, the task at hand), the step and context gauges, and the
  folder in its bottom edge. A failing run turns it red. Right, **to-do** (heavy frame): one cell
  per item, done struck through, the live one as a colored patch, `■◆□□ 2/4` in its border.
- **The to-do list is xray's own.** xray answers `TaskCreate` / `TaskUpdate` / `TaskList` /
  `TaskGet` itself, so Claude Code's built-in list never opens; a system-prompt line asks Claude to
  keep one on any task of 3+ steps.
- **Between turns:** one strip above the prompt: context, prompt-cache countdown, what is still
  owed, and the genome.
- **Genome:** each step a cell colored by kind (read, edit, test, commit, agent, memory save…; shell
  commands sorted by what they actually do, so a `grep` reads as a read), turns
  in kind brackets: `( )` only looked, `[ ]` changed something, `{ }` used agents. It is also
  appended to the session's title, so `/resume` lists every session with its genome.
- **`/xray`:** the detail panel: the whole genome with its key, the last turn (red → green and
  the like), the folder and session age, each request's time and token rate, every step.
- Under 60 columns (a phone) the cards fold into one heavy card with the gauges in its edge.

## Install

Function-hook plugin, Claude Code ≥ 2.1.287. In `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/xray",
    "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"
  }
}
```

then start a new session. `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` matters on newer models: without it
Claude Code offers the task tools only to some older ones, and the to-do card stays empty.

## Commands and settings

- `/xray` opens or closes the panel; `/xray on|off` shows or hides the cards;
  `/xray cache on|off` the cache countdown; `/xray rate good|bad <note>` rates a custom task layout.
- `narration` (default off): a one-line » from Haiku at task start and on the first failure, at
  most once a minute, as the now card's last fact row.
- `customCards` (default on): for a git bisect, a benchmark loop, a k/N batch or a long rebuild,
  Haiku picks which measured fact the now card shows.
- `CLAUDE_HUMAN_MODS=off` in the environment turns xray off (used for unattended agent panes).

## Development

`claude plugin validate .` and `claude plugin test` from this folder. Design history and every
round of feedback: `SPEC.md`.
