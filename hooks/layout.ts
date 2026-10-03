// The wide cards as exact-width rows (round 16): every row is built here as segments and measured,
// so borders line up and nothing is cut by the renderer. Rules, by number on the round-16 page:
// 1 widths follow content (an empty card folds away), 2 one blank column between cards and a blank
// row between a card's story and its fact when a row is spare, 3 prose wraps at words and chips flow
// to the next row, 4 glyph groups sit in subcolumns while prose gets the whole width, 5 the width
// picks the shape, 6 one tray closes every card with that card's own figures under it.

import { TONE_COLOR, band, cells, clipLine, fitParts, nowCard, splitLine, taskCard, teleParts, todoCard, type Card, type Line, type Mode, type Seg } from './cards'
import type { Turn } from './track'

export const THREE = 140 // columns: three cards from here; below, the to-dos fold into the task card
export const TALL = 40 // rows: from here the cards take one more body row (round 16 pick B)
const GUTTER = 1
const SUBGAP = 3 // between two subcolumns
const MIN_W = 24
const NOW_MIN = 36
const CAP = 0.45 // a non-prose card takes at most this share of the width

const pad = (l: Line, n: number): Line => (cells(l) < n ? [...l, { t: ' '.repeat(n - cells(l)) }] : l)

// A line broken at words into rows of `width`; continuation rows are indented under the text.
export function wrap(l: Line, width: number, indent = 2): Line[] {
  const out: Line[] = []
  let rest = l
  for (let guard = 0; cells(rest) > width && guard < 50; guard++) {
    const all = rest.map(s => s.t).join('')
    const space = all.lastIndexOf(' ', width)
    const cut = space > width / 3 ? space : width
    const [head, tail] = splitLine(rest, cut, all[cut] === ' ' ? 1 : 0)
    out.push(head)
    rest = [{ t: ' '.repeat(indent) }, ...tail]
  }
  out.push(rest)
  return out
}

// Whole tokens (chips) flowed into rows; a token wider than a row is cut to it.
export function pack(tokens: Line[], width: number, gap = 2): Line[] {
  const rows: Line[] = []
  let cur: Line = []
  for (const raw of tokens) {
    const tok = cells(raw) > width ? clipLine(raw, width) : raw
    if (cur.length && cells(cur) + gap + cells(tok) > width) {
      rows.push(cur)
      cur = []
    }
    cur = cur.length ? [...cur, { t: ' '.repeat(gap) }, ...tok] : [...tok]
  }
  return cur.length ? [...rows, cur] : rows
}

// Rows kept to `n`: the last kept row ends in an ellipsis when any were dropped.
function keep(rows: Line[], n: number, width: number): Line[] {
  if (rows.length <= n) return rows
  const out = rows.slice(0, Math.max(0, n))
  const last = out[out.length - 1]
  if (last) out[out.length - 1] = cells(last) < width ? [...last, { t: '…', dim: true }] : clipLine(last, width)
  return out
}

const widest = (ls: Line[]) => ls.reduce((a, l) => Math.max(a, cells(l)), 0)

// The two subcolumns side by side when both fit at their natural widths, else stacked.
function columns(c: Card, inner: number): Line[] {
  const side = c.side ?? []
  if (side.length) {
    const lw = widest(c.lines)
    if (lw + SUBGAP + widest(side) <= inner) {
      return Array.from({ length: Math.max(c.lines.length, side.length) }, (_, i) => [...pad(c.lines[i] ?? [], lw + SUBGAP), ...(side[i] ?? [])])
    }
  }
  return [...c.lines, ...side].flatMap(l => wrap(l, inner))
}

// A card's body rows: its lines (or subcolumns), chips, the spare row, then its fact (`foot`) set off
// by a blank row when one is free.
export function body(c: Card, inner: number, rows: number): Line[] {
  const foot = c.foot ? wrap(c.foot, inner) : []
  let main = [...columns(c, inner), ...(c.chips?.length ? pack(c.chips, inner) : [])].filter((l, i) => i === 0 || cells(l))
  main = keep(main, Math.max(1, rows - foot.length), inner)
  if (c.spare && main.length + foot.length < rows) main.push(c.spare)
  const out = [...main]
  if (foot.length) {
    if (out.length + foot.length < rows) out.push([])
    out.push(...foot)
  }
  while (out.length < rows) out.push([])
  return out.slice(0, rows).map(l => clipLine(l, inner))
}

// The width a card asks for: its longest row (subcolumns side by side), its chips over two rows once
// they run long (rows are there, width is shared), its title, and its figures in the tray.
export function ideal(c: Card, tray: Line[] = []): number {
  const side = c.side ?? []
  const chips = (c.chips ?? []).reduce((a, x, i) => a + cells(x) + (i ? 2 : 0), 0)
  const flow = chips > 40 ? Math.max(widest(c.chips ?? []), Math.ceil(chips / 2) + 2) : chips
  const content = Math.max(side.length ? widest(c.lines) + SUBGAP + widest(side) : widest(c.lines), widest(c.foot ? [c.foot] : []), widest(c.spare ? [c.spare] : []), flow)
  const title = c.title.length + 6 + (c.note ? cells(c.note) + 2 : 0)
  return Math.max(content + 4, title, tray.length ? cells(fitParts(tray, Infinity, '  ')) + 6 : 0)
}

// The prose card (index 0) takes what the others leave; each other card its ideal within [MIN_W, CAP].
export function allot(ideals: number[], cols: number): number[] {
  const avail = cols - GUTTER * (ideals.length - 1)
  const rest = ideals.slice(1).map(w => Math.max(MIN_W, Math.min(w, Math.floor(avail * CAP))))
  let over = NOW_MIN - (avail - rest.reduce((a, b) => a + b, 0))
  for (let i = rest.length - 1; over > 0 && i >= 0; i--) {
    const give = Math.min(over, (rest[i] ?? MIN_W) - MIN_W)
    rest[i] = (rest[i] ?? MIN_W) - give
    over -= give
  }
  return [avail - rest.reduce((a, b) => a + b, 0), ...rest]
}

const ink = (c: Card): Seg => ({ t: '', color: TONE_COLOR[c.tone], dim: c.tone === 'quiet' })
const edge = (c: Card, t: string): Seg => ({ ...ink(c), t })

function topBand(c: Card, w: number, status: string, pulse?: Seg): Line {
  const p = pulse ? ` ${pulse.t}` : ''
  const room = Math.max(1, w - 6 - p.length)
  const said = status.length > room ? status.slice(0, room - 1) + '…' : status
  const color = TONE_COLOR[c.tone]
  return [edge(c, '╭'), { t: ` ${said} `, bg: color ?? 'gray', color: 'black' }, ...(pulse ? [{ t: p, color: pulse.color }] : []), edge(c, ' ' + '─'.repeat(Math.max(1, w - 5 - said.length - p.length)) + '╮')]
}

function topTitle(c: Card, w: number): Line {
  const note = c.note ? [{ t: ' ' }, ...c.note, { t: ' ' }] : []
  const room = Math.max(1, w - 6 - cells(note))
  const title = c.title.length > room ? c.title.slice(0, room - 1) + '…' : c.title
  return [edge(c, `╭─ ${title} ` + '─'.repeat(Math.max(0, w - 6 - title.length - cells(note)))), ...note, edge(c, '─╮')]
}

// One bottom edge under every card, each card's figures under it: ╰─ a ───┴─┴─ b ───╯. Whole figures
// only: the rightmost drop first when a card is too narrow for all of them.
function tray(cards: Card[], ws: number[], parts: Line[][]): Line {
  const out: Line = []
  cards.forEach((c, i) => {
    const w = ws[i] ?? MIN_W
    const fits = fitParts(parts[i] ?? [], w - 5, '  ')
    out.push(edge(c, (i ? '┴' : '╰') + (fits.length ? '─ ' : '─')), ...fits, edge(c, (fits.length ? ' ' : '') + '─'.repeat(Math.max(0, w - 3 - (fits.length ? 2 + cells(fits) : 0))) + (i === cards.length - 1 ? '╯' : '┴')))
    if (i < cards.length - 1) out.push({ t: '─'.repeat(GUTTER), dim: true })
  })
  return out
}

const known = (ps: (Line | undefined)[]): Line[] => ps.filter((p): p is Line => !!p)

// The rows under the spinner at `cols` (≥ 60) wide: top edges, `rows` body rows, the tray.
export function spinnerRows(t: Turn, mode: Mode, narration: string | null, ctx: number | null, now: number, cols: number, rows: number): Line[] {
  const head = nowCard(t, mode, narration, now)
  const now0: Card = { ...head, lines: head.lines.slice(1) }
  const todo = todoCard(t, ctx)
  const task = taskCard(t, now)
  const tp = teleParts(t, ctx, now)
  const hasTodo = !!(todo.chips?.length || todo.note)
  let cards: Card[]
  let parts: Line[][]
  if (cols >= THREE && hasTodo) {
    cards = [now0, todo, task]
    parts = [known([tp.turn, tp.effort]), known([tp.ctx]), known([tp.tok, tp.cache])]
  } else {
    // Rule 5: one card fewer; the to-dos ride in the task card unless it already shows them.
    const folded: Card = task.title === 'progress' || !todo.chips?.length ? task : { ...task, chips: [...(task.chips ?? []), ...todo.chips] }
    cards = [now0, folded]
    parts = [known([tp.turn, tp.effort]), known([tp.ctx, tp.tok, tp.cache])]
  }
  const ws = allot(cards.map((c, i) => ideal(c, parts[i])), cols)
  const top = band(head.lines[0] ?? [], t.running.size > 0)
  const bodies = cards.map((c, i) => body(c, (ws[i] ?? MIN_W) - 4, rows))
  const join = (f: (c: Card, i: number) => Line): Line => cards.flatMap((c, i) => (i ? [{ t: ' '.repeat(GUTTER) }, ...f(c, i)] : f(c, i)))
  const out: Line[] = [join((c, i) => (i ? topTitle(c, ws[i] ?? MIN_W) : topBand(c, ws[i] ?? MIN_W, top.status, top.pulse)))]
  for (let r = 0; r < rows; r++) out.push(join((c, i) => [edge(c, '│ '), ...pad(bodies[i]?.[r] ?? [], (ws[i] ?? MIN_W) - 4), edge(c, ' │')]))
  out.push(tray(cards, ws, parts))
  return out
}
