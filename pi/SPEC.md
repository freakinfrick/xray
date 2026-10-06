# xray for pi — spec

xray in pi 0.87.1 (`~/bin/pi`, upstream pi-coding-agent; omp is its fork). Parent spec: `../SPEC.md`,
hosts contract `../HOSTS.md`. pi and omp share one extension API, so they share one adapter:
`../pifamily/xray.ts` exports `xray(pi, host)`; `./index.ts` and `../omp/index.ts` pass what differs.
Everything else (look, what it shows, `/xray`) is omp's spec (`../omp/SPEC.md`, d1–d12).

## What differs from omp (the Host)

- **Turn end on `agent_settled`.** pi's `agent_end` has no `willContinue` and can be followed by a retry,
  a compaction or queued work; `agent_settled` is the real end. `agent_start` with a turn open reuses it.
- **Timer:** pi has no `ctx.setInterval`. A plain 1 s timer, cleared on `session_shutdown` (quit,
  `/reload`, `/new`, `/resume`, fork; pi re-runs the factory after each).
- **Band colour:** pi's theme has no `getColorHex`. The band's background is the token's foreground
  escape moved to the background layer (`38;2;…`/`38;5;…` → `48;…`), in `../pifamily/ink.ts`; omp keeps
  its hex.
- **One token swapped:** pi's dark theme makes `mdLinkUrl` dim grey, so read cells looked like other
  cells; pi takes `mdLink` (the blue) for it (`Host.tokens`, `retoken`).
- **Tools:** pi's `find` → Glob, `ls` → LS ("listing src"); both the read kind. pi turns them on with
  `--tools …,find,ls` (its default set is read, bash, edit, write).
- **Context usage may be null** (after a compaction): read as unknown, not 0%.
- **Store:** `~/.pi/agent/xray/genomes.json`. No intent on tool calls, no `session_switch`, no
  subagents: the core's own step words always.
- **Where the card sits:** pi draws its spinner in the editor's top border, so the `aboveEditor` card
  sits directly above the spinner line, not under it. Kept: below the editor would move the input box
  on every turn start and end.
- **Symlink install:** pi's loader (jiti) resolves imports from the symlinked path, where `../pifamily`
  does not exist, so `index.ts` loads the adapter from its own real path (`realpathSync`).

## Built and seen (2026-10-06, pi 0.87.1, `pi-deepseek`, DeepSeek V4.1 Flash)

Installed `~/.pi/agent/extensions/xray` → this folder. `/reload` picks up edits. Live in tmux + xterm
on :10: working card with the genome inside (band in pi's accent, facts left, genome right),
idle genome strip above the editor, `/xray` panel in the rounded overlay box (requests, steps, files,
turns), `find`/`ls` turn drawn as a looked turn `( )`. After `/reload` the panel's last-turn sections
are empty until the next turn (the factory re-runs; the genome survives through the store).

Verified: `mods/check.sh xray` (pifamily/ink.test.ts covers the band, `retoken`, `find`/`ls`).

## Out of scope (v1)

As omp: to-do card (pi has none of its own either), task tools, cache countdown, narration, custom
cards, moments.
