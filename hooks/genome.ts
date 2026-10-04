// The session genome (round 19): every step of the session, one colored cell each in the filmstrip's
// legend, │ between the person's replies. A full-width row under the cards and under the idle strip that
// grows to 3 rows, then folds the oldest whole turns into a dim `+N turns`. Saved per session in the
// plugin store (key `genome:<session id>`), so /resume brings it back. Pure: register.tsx does the I/O.

import { KIND, type Line, type Seg } from './cards'
import { frame } from './glyphs'
import type { StepKind, Turn } from './track'

// One letter per step; a failed step is `x` whatever its kind. To-do bookkeeping is left out, as in the filmstrip.
const CODE: Record<StepKind, string> = { read: 'r', edit: 'e', memory: 'm', run: 'c', test: 't', commit: 'k', agent: 'a', todo: '', other: 'o' }
const KIND_OF: Record<string, StepKind> = { r: 'read', e: 'edit', m: 'memory', c: 'run', t: 'test', k: 'commit', a: 'agent', o: 'other' }

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

export const cellsOf = (letters: string): Line => merge([...letters].map(cellOf))
const cellOf = (c: string): Seg => {
  if (c === 'x') return { t: '▌', color: 'red' }
  const k = KIND[KIND_OF[c] ?? 'other']
  return { t: k.t, color: k.color, dim: k.dim, bold: k.bold }
}

// The live turn's cells: finished steps as stored, then the running ones blinking in their kind's color.
function liveCells(t: Turn, now: number): Seg[] {
  const done = [...code(t)].map(cellOf)
  const running = [...t.running.values()].filter(x => x.kind !== 'todo').sort((a, b) => a.startedAt - b.startedAt)
  const cells: Seg[] = [...done, ...running.map(x => {
    const k = KIND[x.kind ?? 'other']
    return { t: frame(now) % 2 ? k.t : '▄', color: k.color ?? 'cyan' }
  })]
  // Round 20a: a commit just landed: its hash and subject unfold from its cell, and stay until the next step.
  const last = t.done[t.done.length - 1]
  if (running.length || last?.kind !== 'commit' || !last.ok || !last.note || last.endedAt === undefined) return cells
  const said = ` ${last.note.length > COMMIT_CHARS ? last.note.slice(0, COMMIT_CHARS - 1) + '…' : last.note} `
  const shown = Math.max(2, Math.ceil(said.length * Math.min(1, Math.max(0, now - last.endedAt) / UNFOLD_MS)))
  return [...cells, { t: ' ' }, { t: said.slice(0, shown), bg: 'magenta', color: 'black' }]
}
const COMMIT_CHARS = 40
const UNFOLD_MS = 500

// What kind of turn, from its letters alone: { } it sent agents, [ ] it changed something (an edit, a
// memory saved, a command, a test run, a commit; failed steps count by trying), ( ) it only looked or talked.
export type Bracket = 'looked' | 'changed' | 'delegated'
export const BRACKET: Record<Bracket, [string, string]> = { looked: ['(', ')'], changed: ['[', ']'], delegated: ['{', '}'] }
export const bracketOf = (letters: string): Bracket => (letters.includes('a') ? 'delegated' : /[emcktx]/.test(letters) ? 'changed' : 'looked')

// The live turn's letters so far, running steps included, so its bracket is right from its first step.
const liveLetters = (t: Turn) => code(t) + [...t.running.values()].map(x => CODE[x.kind ?? 'other']).join('')

// A laid-out cell and where it came from: turn index (turns.length = the live turn) and step within it.
type Placed = { seg: Seg; turn?: number; step?: number }
type Opts = { live?: Turn; now?: number; maxRows?: number; label?: string }

// The genome wrapped into rows of at most `width - label` cells. Past `maxRows` the oldest whole turns
// fold, one at a time, so a turn is never cut in half.
function place(turns: readonly string[], width: number, opts: Opts): Placed[][] {
  const { live, now = 0, maxRows = MAX_ROWS, label = '' } = opts
  const liveSegs = live ? liveCells(live, now) : []
  if (!turns.some(x => x) && !liveSegs.length) return []
  const room = Math.max(8, width - label.length)
  const lay = (fold: number): Placed[][] => {
    const segs: Placed[] = fold ? [{ seg: { t: `+${fold} turn${fold > 1 ? 's' : ''} `, dim: true } }] : []
    const kept: { cells: Seg[]; turn: number }[] = [...turns.slice(fold).map((x, i) => ({ cells: [...x].map(cellOf), turn: fold + i })), ...(liveSegs.length ? [{ cells: liveSegs, turn: turns.length }] : [])]
    // Each turn in its bracket (2026-10-03, user): the bracket says what kind of turn it was; the live
    // turn shows only its opening one until it ends.
    kept.forEach(({ cells, turn }) => {
      const [open, close] = BRACKET[bracketOf(turns[turn] ?? (live ? liveLetters(live) : ''))]
      segs.push({ seg: { t: open, dim: true } })
      cells.forEach((seg, step) => segs.push({ seg, turn, step }))
      if (turn < turns.length) segs.push({ seg: { t: close, dim: true } })
    })
    const out: Placed[][] = []
    let cur: Placed[] = []
    let n = 0
    for (const p of segs) {
      if (n + p.seg.t.length > room && cur.length) {
        out.push(cur)
        cur = []
        n = 0
      }
      cur.push(p)
      n += p.seg.t.length
    }
    return cur.length ? [...out, cur] : out
  }
  let fold = 0
  let laid = lay(0)
  while (laid.length > maxRows && fold < turns.length) laid = lay(++fold)
  // Still too long (one huge live turn): keep its newest cells.
  return laid.length > maxRows ? laid.slice(-maxRows) : laid
}

// Rows of exactly `width` cells or fewer. `label` leads the first row; later rows indent under it.
export function rows(turns: readonly string[], width: number, opts: Opts = {}): Line[] {
  const label = opts.label ?? ''
  return place(turns, width, opts).map((r, i) => [...(label ? [i ? { t: ' '.repeat(label.length) } : { t: label, dim: true }] : []), ...merge(r.map(p => p.seg))])
}

// Round 20 (interview pick: one shared row): the row drawn just above the genome's newest row, naming
// what happened there. Landmarks sit over their step's cell, glyph first; turn names (round 20d) sit at
// their turn's first cell. Landmarks place first, newest first; a label that won't fit whole shrinks to
// its glyph or is skipped, never cut. Empty when nothing fits.
export type Note = { turn: number; at: number; glyph?: string; text: string; look?: Omit<Seg, 't'> }
export function annotate(turns: readonly string[], width: number, notes: readonly Note[], opts: Opts = {}): Line {
  const laid = place(turns, width, opts)
  const row = laid[laid.length - 1]
  if (!row) return []
  const lead = opts.label?.length ?? 0
  const where = new Map<string, number>()
  let col = lead
  for (const p of row) {
    if (p.turn !== undefined && p.step !== undefined) where.set(`${p.turn}:${p.step}`, col)
    col += p.seg.t.length
  }
  const taken: [number, number][] = []
  const isFree = (a: number, b: number) => b <= width && taken.every(([x, y]) => b + 1 < x || a > y + 1)
  const put: { col: number; segs: Seg[] }[] = []
  const ordered = [...notes].sort((a, b) => Number(!!b.glyph) - Number(!!a.glyph) || b.turn - a.turn || b.at - a.at)
  for (const n of ordered) {
    const c = where.get(`${n.turn}:${n.at}`)
    if (c === undefined) continue
    const tries: Seg[][] = n.glyph ? [[{ t: n.glyph, ...n.look }, { t: ` ${n.text}`, dim: true }], [{ t: n.glyph, ...n.look }]] : [[{ t: n.text, dim: true, ...n.look }]]
    const fit = tries.find(segs => isFree(c, c + segs.reduce((a, g) => a + g.t.length, 0)))
    if (!fit) continue
    const end = c + fit.reduce((a, g) => a + g.t.length, 0)
    taken.push([c, end])
    put.push({ col: c, segs: fit })
  }
  if (!put.length) return []
  const out: Seg[] = []
  let at = 0
  for (const p of put.sort((a, b) => a.col - b.col)) {
    out.push({ t: ' '.repeat(p.col - at) }, ...p.segs)
    at = p.col + p.segs.reduce((a, g) => a + g.t.length, 0)
  }
  return out
}

// Neighbouring cells of one look become one segment (fewer Text nodes per frame).
function merge(segs: Seg[]): Line {
  const out: Seg[] = []
  for (const s of segs) {
    const p = out[out.length - 1]
    if (p && p.color === s.color && p.dim === s.dim && p.bold === s.bold && !p.bg && !s.bg) out[out.length - 1] = { ...p, t: p.t + s.t }
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

// The key under the panel's genome: each cell in its own look and the word for it, then any extra
// tokens (the note row's marks), packed into rows of `width`.
const KEYED: [string, string][] = [['r', 'read'], ['e', 'edit'], ['c', 'command'], ['k', 'commit'], ['m', 'memory'], ['t', 'tests pass'], ['x', 'failed'], ['a', 'agent'], ['o', 'other']]
export function key(width: number, extra: Line[] = []): Line[] {
  const tokens: Line[] = [...KEYED.map(([c, w]) => [cellOf(c), { t: ` ${w}`, dim: true }]), ...(Object.entries(BRACKET) as [Bracket, [string, string]][]).map(([k, [o, c]]): Line => [{ t: `${o}${c}`, dim: true }, { t: ` ${k}`, dim: true }]), ...extra]
  const rows: Line[] = []
  let cur: Line = []
  let n = 0
  for (const tok of tokens) {
    const w = tok.reduce((a, g) => a + g.t.length, 0)
    if (cur.length && n + 3 + w > width) {
      rows.push(cur)
      cur = []
      n = 0
    }
    if (cur.length) cur.push({ t: '   ' })
    cur.push(...tok)
    n += (n ? 3 : 0) + w
  }
  return cur.length ? [...rows, cur] : rows
}

// The label at the right edge of the first row (user, 2026-10-03: "right justified at the window edge,
// like the [-]"). The rows are laid out `label + 1` narrower, so it never covers a cell.
export const EDGE_LABEL = 'genome'
export function labelRight(rows: Line[], width: number, label = EDGE_LABEL): Line[] {
  if (!rows.length) return rows
  const first = rows[0] ?? []
  const used = first.reduce((a, g) => a + g.t.length, 0)
  return [[...first, { t: ' '.repeat(Math.max(1, width - used - label.length)) }, { t: label, dim: true }], ...rows.slice(1)]
}
