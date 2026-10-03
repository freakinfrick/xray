// The session genome (round 19): every step of the session, one colored cell each in the filmstrip's
// legend, │ between the person's replies. A full-width row under the cards and under the idle strip that
// grows to 3 rows, then folds the oldest whole turns into a dim `+N turns`. Saved per session in the
// plugin store (key `genome:<session id>`), so /resume brings it back. Pure: register.tsx does the I/O.

import { KIND, type Line, type Seg } from './cards'
import { frame } from './glyphs'
import type { StepKind, Turn } from './track'

// One letter per step; a failed step is `x` whatever its kind. To-do bookkeeping is left out, as in the filmstrip.
const CODE: Record<StepKind, string> = { read: 'r', edit: 'e', run: 'c', test: 't', agent: 'a', todo: '', other: 'o' }
const KIND_OF: Record<string, StepKind> = { r: 'read', e: 'edit', c: 'run', t: 'test', a: 'agent', o: 'other' }

export const MAX_ROWS = 3
export const MAX_TURNS = 400 // per session, oldest dropped: a few KB at most
export const MAX_SESSIONS = 40 // sessions kept in the store, oldest dropped
export const PREFIX = 'genome:'
export const keyOf = (sessionId: string) => PREFIX + sessionId

// A finished turn as letters, in the order its steps ended.
export function code(t: Turn): string {
  return t.done
    .filter(x => x.kind !== 'todo')
    .map(x => (x.ok === false ? 'x' : CODE[x.kind ?? 'other'] || 'o'))
    .join('')
}

// A reply with no steps still counts (its │ shows the person spoke): stored as ''.
export const append = (g: readonly string[], turn: string): string[] => [...g, turn].slice(-MAX_TURNS)

// Stored value → turns, ignoring anything that isn't a list of strings.
export const load = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

// Store keys to delete so at most MAX_SESSIONS genomes stay (keys come in insertion order, oldest first).
export function stale(keys: readonly string[], keep: string): string[] {
  const mine = keys.filter(k => k.startsWith(PREFIX) && k !== keep)
  return mine.slice(0, Math.max(0, mine.length - (MAX_SESSIONS - 1)))
}

const cellOf = (c: string): Seg => {
  if (c === 'x') return { t: '█', color: 'red' }
  const k = KIND[KIND_OF[c] ?? 'other']
  return { t: k.t, color: k.color, dim: k.dim }
}

// The live turn's cells: finished steps as stored, then the running ones blinking in their kind's color.
function liveCells(t: Turn, now: number): Seg[] {
  const done = [...code(t)].map(cellOf)
  const running = [...t.running.values()].filter(x => x.kind !== 'todo').sort((a, b) => a.startedAt - b.startedAt)
  return [...done, ...running.map(x => {
    const k = KIND[x.kind ?? 'other']
    return { t: frame(now) % 2 ? k.t : '▄', color: k.color ?? 'cyan' }
  })]
}

// Rows of exactly `width` cells or fewer. `label` leads the first row; later rows indent under it.
// Past `maxRows` the oldest whole turns fold, one at a time, so a turn is never cut in half.
export function rows(turns: readonly string[], width: number, opts: { live?: Turn; now?: number; maxRows?: number; label?: string } = {}): Line[] {
  const { live, now = 0, maxRows = MAX_ROWS, label = '' } = opts
  const liveSegs = live ? liveCells(live, now) : []
  if (!turns.some(x => x) && !liveSegs.length) return []
  const room = Math.max(8, width - label.length)
  const lay = (fold: number): Seg[][] => {
    const segs: Seg[] = fold ? [{ t: `+${fold} turn${fold > 1 ? 's' : ''} `, dim: true }] : []
    const kept: Seg[][] = [...turns.slice(fold).map(x => [...x].map(cellOf)), ...(liveSegs.length ? [liveSegs] : [])]
    kept.forEach((cells, i) => {
      if (i) segs.push({ t: '│', dim: true })
      segs.push(...cells)
    })
    const out: Seg[][] = []
    let cur: Seg[] = []
    let n = 0
    for (const s of segs) {
      if (n + s.t.length > room && cur.length) {
        out.push(cur)
        cur = []
        n = 0
      }
      cur.push(s)
      n += s.t.length
    }
    return cur.length ? [...out, cur] : out
  }
  let fold = 0
  let laid = lay(0)
  while (laid.length > maxRows && fold < turns.length) laid = lay(++fold)
  // Still too long (one huge live turn): keep its newest cells.
  if (laid.length > maxRows) laid = laid.slice(-maxRows)
  return laid.map((r, i) => [...(label ? [i ? { t: ' '.repeat(label.length) } : { t: label, dim: true }] : []), ...merge(r)])
}

// Neighbouring cells of one look become one segment (fewer Text nodes per frame).
function merge(segs: Seg[]): Line {
  const out: Seg[] = []
  for (const s of segs) {
    const p = out[out.length - 1]
    if (p && p.color === s.color && p.dim === s.dim && !p.bg && !s.bg) out[out.length - 1] = { ...p, t: p.t + s.t }
    else out.push({ ...s })
  }
  return out
}

// Round 19 (user): between turns the genome rides the strip's line, flush right, newest cells at the right
// end, its label just left of it (so the label moves left as the genome grows); past `room` the oldest
// whole turns fold. Empty when even one turn won't fit.
export function tail(turns: readonly string[], room: number, label = 'genome '): Line {
  const r = rows(turns, room - label.length, { maxRows: 1 })[0]
  if (!r || room < 12) return []
  return [{ t: label, dim: true }, ...r]
}

export const summary = (turns: readonly string[]) => `${turns.length} turn${turns.length === 1 ? '' : 's'} · ${turns.reduce((a, x) => a + x.length, 0)} steps`

// How many turns `tail` shows in `room` cells (round 20f: the strip's extras give way before the genome
// drops under three turns).
export function shown(turns: readonly string[], room: number, label = 'genome '): number {
  const r = tail(turns, room, label)
  if (!r.length) return 0
  const fold = r.find(g => g.t.startsWith('+'))
  return turns.length - (fold ? Number(fold.t.slice(1).split(' ')[0]) : 0)
}
