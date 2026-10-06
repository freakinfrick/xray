# xray for grok (Grok Build) — spec

Port of xray to Grok Build (grok 1.0.41, `~/grok-build`, binary `target/release/xai-grok-pager`). Parent
spec `../HOSTS.md`; pattern `../omp/SPEC.md`. Grok has no widget or overlay API: xray lives in grok's
**status-line row** (`[ui.status_line] type = "command"`), fed by **command hooks**. No `/xray` panel (decided).

## Shape

    grok ──hooks (every event)──▶ node dist/hook.mjs ──append──▶ ~/.grok/xray/<session>.jsonl
    grok ──status run (~300 ms in a turn)──▶ node dist/status.mjs ◀──replay── same file
                                              └─ stdout: ≤5 lines, the row under the prompt box

- `map.ts` (pure): grok envelope → core events (`../hooks/events.ts` schema), tool map, result text.
- `render.ts` (pure): replay → `spinnerRows(..., { withTodo: false, turns })` card or `genome.idle`, then
  grok's own ANSI emitter. `grok.test.ts` covers both under `claude plugin test`; `tsconfig.json` +
  `env.d.ts` type-check them (check.sh picks up every `*/tsconfig.json`).
- `hook.mjs`, `status.mjs`, `store.mjs`: the thin node entries (stdin, files, env). `build.sh` bundles them
  with the TS core into `dist/*.mjs` (esbuild from `~/hermes-agent/node_modules`, `ESBUILD=` overrides;
  `--if-stale` rebuilds only when a source is newer). `dist/` is git-ignored: the launchers and
  `install.sh` build it. Plain node 20 (nvm, on the PATH grok inherits) runs it: ~45 ms a hook, ~55 ms a
  status run.

## What it shows

- **Working:** the now card, five lines, under grok's prompt box: band (the core's step words), one fact
  row, the divider, the gauge row (turn time), the genome inside the card right of the facts. A long genome
  steps the card's body rows down (3 → 2 → 1) so it never passes 5 lines.
- **Idle:** the genome alone with the right-edge `genome` label (1–3 rows). A fresh session prints the label
  alone: an empty print removes the row and the transcript jumps.
- **Look:** grok's default theme GrokNight (`xai-grok-pager-render/src/theme/groknight.rs`): the core's tone
  names take its palette, every colour as xterm-256 (`38;5;n`), rounded `╭╮╰╯` frame as grok's prompt box.

## Decisions (agent, say "undo dN")

- d1 **The hooks' open turn is "working".** grok's stdin `turn.started_at_ms` never arrives mid-turn in
  1.0.41 (no `turn`/`prompt_id` in any run of the live probe), so stdin may only open a turn the hooks
  haven't. `Stop`, `StopFailure`, `StopCancelled` all close one; a grok killed mid-turn leaves the card up
  until the next prompt.
- d2 **No cache / tok/s gauges.** grok's status payload and its `updates.jsonl` carry session tokens once
  per turn, after `Stop` (probed: one `session_usage` change per turn, per-turn `usage` records only). A
  per-request gauge would be invented; a per-turn lump timed as one request read `tok/s 8989` live. The
  gauge row is turn time alone. Revisit if grok's payload starts moving mid-turn.
- d3 **One store for every GROK_HOME:** `~/.grok/xray/<session>.jsonl` (`XRAY_GROK_DIR` overrides), as the
  launchers share `~/.grok/sessions`; a resumed session keeps its genome. The file *is* the store (no
  genomes.json: a replay would double-count). 40 newest kept, pruned on `SessionStart`.
- d4 **Hook = every event, one command.** `UserPromptSubmit`→turn_start, `PreToolUse`→start,
  `PostToolUse`→end (ok = `exit_code === 0` for commands, as Claude Code marks them),
  `PostToolUseFailure`→end ok false, `Stop*`→turn_end. Events with `subagentType` are dropped (their Task
  cell stands for them). The hook prints nothing and exits 0 on every path: its stdout and exit 2 reach the
  model. Event names: `hook_event_name` (PascalCase); grok's `hookEventName` is snake_case (`pre_tool_use`).
- d5 **Tool map** (`map.ts toCall`): `run_terminal_command`→Bash (command only: grok's tool row shows the
  model's description), `read_file`→Read (`target_file`), `search_replace`→Edit, or Write when
  `old_string` is empty (creates the file), `grep`→Grep, `list_dir`→Glob, `web_search`, `web_fetch`,
  `task`/`spawn_subagent`→Task, `todo_write`→a dim to-do cell (grok pins its own list), anything else its
  name in words, kind other.
- d6 **Byte budget.** grok cuts a line at 1024 bytes *including escapes*. The emitter writes one escape per
  style change and a bare colour switch where nothing else changes; a line still over budget redraws
  narrower (×0.85). Tested at 40–300 columns, 0–60 turns.
- d7 `CLAUDE_HUMAN_MODS=off` (conductor panes): the launcher writes no status line, the hook and status
  command do nothing.

## Wiring

- `install.sh [GROK_HOME...]` writes `<home>/hooks/xray.json` (absolute `node '<here>/dist/hook.mjs'`) beside
  herdr's `herdr.json`. Installed: `~/.grok-deepseek`, `~/.grok-claude`. Not installed: `~/.grok`,
  `~/.grok-secondary`, `~/.grok-tertiary` (grok-local's homes) — run `./install.sh ~/.grok ...` with the
  grok-local status line.
- `~/dotfiles/launchpad/grok-deepseek` and `grok-claude` (same heredoc shape) append the
  `[ui.status_line]` block to the config they regenerate each launch, after `build.sh --if-stale`; path from
  `XRAY_GROK` (default the worktree `/tmp/xray-hosts/mods/xray/grok`, repoint to `~/claude/mods/xray/grok`
  after merge). `grok-local` is python (`write_config` f-string): not edited, a 6-line addition there.
- grok also runs `~/.claude/settings.json` hooks (`compat.claude.hooks`); untouched.

## Verify

`mods/check.sh xray` (grok tsc + `grok.test.ts`). Live: `grok-deepseek` in `tmux -L xray-grok` + xterm on
:10, a read/edit/test task in a scratch repo; captures in `/tmp/xray-hosts/.notes/grok-*.png` (working,
waiting-on-model, idle, a strip of the states).

## Out of scope

`/xray` panel (grok has no overlay; a side-pane viewer was declined), cache/tok gauges (d2), narration,
custom cards, grok themes other than GrokNight (the status command can't see the active one).
