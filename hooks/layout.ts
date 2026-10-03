// The wide cards as exact-width rows (round 16): every row is built here as segments and measured,
// so borders line up and nothing is cut by the renderer. Rules, by number on the round-16 page:
// 1 widths follow content (an empty card folds away), 2 one blank column between cards and a blank
// row between a card's story and its fact when a row is spare, 3 prose wraps at words and chips flow
// to the next row, 4 glyph groups sit in subcolumns while prose gets the whole width, 5 the width
// picks the shape, 6 one tray closes every card with that card's own figures under it.

import { TONE_COLOR, band, cells, clipLine, filmstrip, fitParts, nowCard, stepCounts, splitLine, taskCard, teleParts, todoCard, type Card, type Line, type Mode, type Seg, type Tone } from './cards'
import { frame } from './glyphs'
import type { Turn } from './track'

export const THREE = 140 // columns: three cards from here; below, the to-dos fold into the task card
export const TALL = 40 // rows: from here the cards take one more body row (round 16 pick B)
const GUTTER = 1
const SUBGAP = 3 // between two subcolumns
const MIN_W = 24
const NOW_MIN = 36
const PROSE = 0.55 // the most of the width the prose card holds back for itself

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

// The prose card (index 0) keeps room for its content over two rows (between NOW_MIN and PROSE of the width),
// each other card gets its ideal out of the rest (never under MIN_W), and whatever is left over goes
// back to the prose card. A short narration so lends its width to a card that needs it.
export function allot(ideals: number[], cols: number): number[] {
  const avail = cols - GUTTER * (ideals.length - 1)
  // Prose wraps, so it holds back room for its longest line over two rows, not one.
  const keepNow = Math.max(NOW_MIN, Math.min(Math.ceil((ideals[0] ?? 0) / 2) + 2, Math.floor(avail * PROSE)))
  const room = avail - keepNow
  const want = ideals.slice(1).map(w => Math.max(MIN_W, w))
  const total = want.reduce((a, b) => a + b, 0)
  // Over budget: each card gives back in proportion to what it asked above the minimum.
  const rest = total <= room ? want : want.map(w => MIN_W + Math.floor(((w - MIN_W) * Math.max(0, room - MIN_W * want.length)) / Math.max(1, total - MIN_W * want.length)))
  return [avail - rest.reduce((a, b) => a + b, 0), ...rest]
}

// Card state the rows draw from beyond the card itself: `walk` (round 16 motion budget: the card
// that needs you walks its border at the tick, nothing else does) and `fade` (its tone just changed:
// the border passes through dim once before taking the new color).
type Drawn = Card & { walk?: number; fade?: boolean }
const ink = (c: Drawn): Seg => (c.fade ? { t: '', dim: true } : { t: '', color: TONE_COLOR[c.tone], dim: c.tone === 'quiet' })
const walked = (t: string, f: number | undefined) => (f === undefined ? t : [...t].map((ch, i) => (ch === '─' && (i + f) % 2 ? '╌' : ch)).join(''))
const edge = (c: Drawn, t: string): Seg => ({ ...ink(c), t: walked(t, c.walk) })
const FADE_MS = 480
const SLOW = 3 // a live step past this many times its kind's usual length walks the now card
const STALL_MS = 20_000 // nothing running, the model not working: the stand-in for "waiting on you"
export type Memo = { tones: Record<number, { tone: Tone; at: number }> }

function topBand(c: Drawn, w: number, status: string, pulse?: Seg): Line {
  const p = pulse ? ` ${pulse.t}` : ''
  const room = Math.max(1, w - 6 - p.length)
  const said = status.length > room ? status.slice(0, room - 1) + '…' : status
  const color = TONE_COLOR[c.tone]
  return [edge(c, '╭'), { t: ` ${said} `, bg: color ?? 'gray', color: 'black' }, ...(pulse ? [{ t: p, color: pulse.color }] : []), edge(c, ' ' + '─'.repeat(Math.max(1, w - 5 - said.length - p.length)) + '╮')]
}

function topTitle(c: Drawn, w: number): Line {
  const note = c.note ? [{ t: ' ' }, ...c.note, { t: ' ' }] : []
  const room = Math.max(1, w - 6 - cells(note))
  const title = c.title.length > room ? c.title.slice(0, room - 1) + '…' : c.title
  return [edge(c, `╭─ ${title} ` + '─'.repeat(Math.max(0, w - 6 - title.length - cells(note)))), ...note, edge(c, '─╮')]
}

// One bottom edge under every card, each card's figures under it: ╰─ a ───┴─┴─ b ───╯. Whole figures
// only: the rightmost drop first when a card is too narrow for all of them.
function tray(cards: Drawn[], ws: number[], parts: Line[][]): Line {
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
export function spinnerRows(t: Turn, mode: Mode, narration: string | null, ctx: number | null, now: number, cols: number, rows: number, memo?: Memo): Line[] {
  const head = nowCard(t, mode, narration, now)
  const now0: Card = { ...head, lines: head.lines.slice(1) }
  const todo = todoCard(t, ctx, now)
  // Rule 4: a task card without the step gauge takes the filmstrip as its second subcolumn.
  const plain = taskCard(t, now)
  const task: Card = plain.title === 'progress' || !t.done.length ? plain : { ...plain, side: [[{ t: 'steps ', dim: true }, ...filmstrip(t, 24, now, false)], stepCounts(t)] }
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
  const f = frame(now)
  const live = [...t.running.values()].sort((a, b) => a.startedAt - b.startedAt)[0]
  const usual = live ? t.done.filter(x => x.kind === live.kind && x.endedAt !== undefined).map(x => (x.endedAt ?? 0) - x.startedAt).sort((a, b) => a - b) : []
  const isSlow = !!live && usual.length >= 3 && now - live.startedAt >= Math.max(10_000, SLOW * (usual[Math.floor(usual.length / 2)] ?? 0))
  const lastEnd = t.done[t.done.length - 1]?.endedAt ?? t.startedAt
  const isStalled = !live && mode !== 'thinking' && mode !== 'responding' && now - lastEnd >= STALL_MS
  cards = cards.map((c, i): Drawn => {
    const seen = memo?.tones[i]
    if (memo && seen?.tone !== c.tone) memo.tones[i] = { tone: c.tone, at: seen ? now : -Infinity }
    const fade = !!memo && now - (memo.tones[i]?.at ?? -Infinity) < FADE_MS
    const walk = c.tone === 'fail' || (i === 0 && (isSlow || isStalled)) ? f : undefined
    return { ...c, walk, fade }
  })
  const ws = allot(cards.map((c, i) => ideal(c, parts[i])), cols)
  const top = band(head.lines[0] ?? [], t.running.size > 0)
  const bodies = cards.map((c, i) => body(c, (ws[i] ?? MIN_W) - 4, rows))
  const join = (f: (c: Card, i: number) => Line): Line => cards.flatMap((c, i) => (i ? [{ t: ' '.repeat(GUTTER) }, ...f(c, i)] : f(c, i)))
  const out: Line[] = [join((c, i) => (i ? topTitle(c, ws[i] ?? MIN_W) : topBand(c, ws[i] ?? MIN_W, top.status, top.pulse)))]
  for (let r = 0; r < rows; r++) out.push(join((c, i) => [edge(c, '│ '), ...pad(bodies[i]?.[r] ?? [], (ws[i] ?? MIN_W) - 4), edge(c, ' │')]))
  out.push(tray(cards, ws, parts))
  return out
}
