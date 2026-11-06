// The line vocabulary every card, strip, genome and port draws with: segments, widths, cuts, and the
// step-kind legend. A leaf: nothing here imports the cards, so the stable parts stop depending on the
// most-changed file.

import type { StepKind } from './track'

// inv: drawn inverse, the glyph in the terminal's background on `color` (a solid tile on both themes).
export type Seg = { t: string; color?: string; dim?: boolean; bold?: boolean; inv?: boolean; bg?: string; strike?: boolean }
export type Line = Seg[]

// One cell per step kind, colored by what it was (filmstrip and genome alike): reads blue, edits yellow,
// commands magenta, a test run that passed green, agents cyan.
export const KIND: Record<StepKind, { t: string; color?: string; dim?: boolean; bold?: boolean }> = {
  read: { t: '▌', color: 'blue' },
  edit: { t: '▌', color: 'yellow' },
  run: { t: '▌', color: 'magenta', dim: true }, // quieter than the rest: commands are many and mostly routine
  script: { t: '▌', color: '#ff5f00' }, // inline code the model wrote (python3 - <<EOF, node -e)
  orchestrate: { t: '▌', color: '#00d7af' }, // herdr, tmux, conductor: driving other sessions, agent's kin
  network: { t: '▌', color: '#af87ff' }, // curl, gh, ssh, git push/pull
  wait: { t: '▏', dim: true }, // sleep, until: time passing, drawn thin
  test: { t: '▌', color: 'green' },
  memory: { t: '§', color: '#ff69b4', bold: true }, // a memory saved: kept past this session, like a commit
  commit: { t: '#', color: 'magenta' }, // round 20a: a commit stays in the genome as its own mark
  agent: { t: '▌', color: 'cyan' },
  skill: { t: '▌', color: '#ffd7af' }, // round 22: a skill loaded
  mcp: { t: '▌', color: '#87afaf' }, // an MCP server's tool
  ask: { t: '?', color: 'white', bold: true }, // a question put to the person (AskUserQuestion)
  todo: { t: '▌', dim: true },
  other: { t: '▌', dim: true },
}

export const NARROW = 60 // columns: below this the cards fold to their compact rows (round 8)

export const cells = (l: Line) => l.reduce((a, s) => a + s.t.length, 0)

export function splitLine(line: Line, cut: number, skip: number): [Line, Line] {
  const head: Line = []
  const tail: Line = []
  let at = 0
  for (const s of line) {
    const end = at + s.t.length
    if (end <= cut) head.push(s)
    else if (at >= cut + skip) tail.push(s)
    else {
      if (cut > at) head.push({ ...s, t: s.t.slice(0, cut - at) })
      const rest = s.t.slice(Math.max(0, cut + skip - at))
      if (rest) tail.push({ ...s, t: rest })
    }
    at = end
  }
  return [head, tail]
}

// Whole parts, left to right, while they fit: the rightmost go first, nothing is cut mid-part.
export function fitParts(parts: (Line | undefined)[], width: number, sep: string): Line {
  const out: Line = []
  for (const p of parts) {
    if (!p) continue
    const next: Line = out.length ? [{ t: sep }, ...p] : p
    if (cells(out) + cells(next) > width) break
    out.push(...next)
  }
  return out
}

// A line cut at the last word that fits, with an ellipsis; a line that fits is kept as is.
export function clipLine(l: Line, width: number): Line {
  if (cells(l) <= width) return l
  const all = l.map(s => s.t).join('')
  const space = all.lastIndexOf(' ', width - 1)
  const cut = space > width / 3 ? space : width - 1
  const kept = splitLine(l, cut, 0)[0]
  // A kept text that already trails off ("running…") takes no second ellipsis.
  return kept.map(g => g.t).join('').trimEnd().endsWith('…') ? kept : [...kept, { t: '…', dim: true }]
}
