// The wide cards as exact-width rows (round 16): every row is built here as segments and measured,
// so borders line up and nothing is cut by the renderer. Rules, by number on the round-16 page:
// 1 widths follow content (an empty card folds away), 2 one blank column between cards and a blank
// row between a card's story and its fact when a row is spare, 3 prose wraps at words and chips flow
// to the next row, 4 glyph groups sit in subcolumns while prose gets the whole width, 5 the width
// picks the shape, 6 one tray closes every card with that card's own figures under it.

import { TONE_COLOR, band, cells, clipLine, filmstrip, fitParts, nowCard, squares, stepCounts, splitLine, taskCard, teleParts, todoCard, type Card, type Line, type Mode, type Seg, type Tile, type Tone } from './cards'
import * as genome from './genome'
import { MARK, frame } from './glyphs'
import type { Turn } from './track'

export const TALL = 40 // rows: from here the cards take one more body row (round 16 pick B)
const GUTTER = 1
const SUBGAP = 3 // between two subcolumns
const MIN_W = 24
const NOW_MIN = 36
const NOW_TODO = 40 // the now card's floor beside to-do cells (round 17)
const CELL_MIN = 13 // a to-do cell is never narrower
const CELL_MAX = 24
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
  // A full last row gives up its last word to make room for the ellipsis.
  // The more-below mark, unless the row already trails off ("running…"): one ellipsis, never two.
  const trails = !!last && last.map(g => g.t).join('').trimEnd().endsWith('…')
  if (last && !trails) out[out.length - 1] = cells(last) < width ? [...last, { t: '…', dim: true }] : clipLine(last, width - 1)
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

// To-do cells (round 17): each a few rows tall, left to right in list order. Row 0 holds the mark and the
// place in the list, the rest the name wrapped at words (… only when its rows run out).
const cellRowsOf = (c: Card, rows: number) => (c.foot && rows >= 4 ? rows - 1 : rows)
// The width one cell asks for: its name over all its rows after the `■ 1 ` lead, between CELL_MIN and CELL_MAX.
const leadOf = (x: Tile) => `${x.mark} ${x.n} `
const cellWant = (x: Tile, rows: number) => Math.max(CELL_MIN, Math.min(CELL_MAX, Math.ceil(x.text.length / Math.max(1, rows)) + leadOf(x).length + 2))

function words(text: string, width: number, rows: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const w0 of text.split(/\s+/).filter(Boolean)) {
    const w = w0.length > width ? w0.slice(0, width) : w0
    if (cur && cur.length + 1 + w.length > width) {
      out.push(cur)
      cur = w
    } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) out.push(cur)
  if (out.length <= rows) return out
  const kept = out.slice(0, Math.max(1, rows))
  const last = kept[kept.length - 1] ?? ''
  kept[kept.length - 1] = (last.length >= width ? last.slice(0, width - 1) : last) + '…'
  return kept
}

// Round 19 (user): the name starts on the number's row and wraps over every row, the wrapped rows in
// line with its first word.
function cell(x: Tile, w: number, rows: number): Line[] {
  const lead = leadOf(x)
  const text = words(x.text, Math.max(1, w - 2 - lead.length), rows)
  return Array.from({ length: rows }, (_, r) => {
    const t = text[r] ?? ''
    const left = r === 0 ? lead : ' '.repeat(lead.length)
    const rest = ' '.repeat(Math.max(0, w - 1 - left.length - t.length))
    if (x.fill) return [{ t: ' ' + left + t + rest, ...x.look }]
    return [{ t: ' ' + left, color: x.look.color }, ...(t ? [{ t, ...x.look }] : []), { t: rest }]
  })
}

// The cells in `inner` columns over `rows`. More than fit: a window keeps the list order around the live
// one (one before it for context), and dim counts stand for the rest (✓N when all of them are done).
export function tileRows(tiles: Tile[], inner: number, rows: number): Line[] {
  const n = tiles.length
  let lo = 0
  let k = n
  if (n * CELL_MIN + (n - 1) > inner) {
    k = Math.max(1, Math.floor((inner - 8 + 1) / (CELL_MIN + 1)))
    const live = tiles.findIndex(x => x.status !== 'completed')
    lo = Math.max(0, Math.min((live < 0 ? n : live) - 1, n - k))
  }
  const shown = tiles.slice(lo, lo + k)
  const before = tiles.slice(0, lo)
  const after = n - lo - shown.length
  const side = (before.length ? 4 : 0) + (after ? 4 : 0)
  const w = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor((inner - side - (shown.length - 1)) / shown.length)))
  const drawn = shown.map(x => cell(x, w, rows))
  const mid = Math.floor((rows - 1) / 2)
  const allDone = before.every(x => x.status === 'completed')
  return Array.from({ length: rows }, (_, r) => {
    const out: Line = []
    if (before.length) out.push(r === mid ? { t: `${allDone ? MARK_OK : '+'}${before.length}`.padEnd(4), color: allDone ? 'green' : undefined, dim: !allDone } : { t: '    ' })
    drawn.forEach((c, i) => out.push(...(i ? [{ t: ' ' }] : []), ...(c[r] ?? [])))
    if (after) out.push(r === mid ? { t: ` +${after}`.padEnd(4), dim: true } : { t: '    ' })
    return out
  })
}
const MARK_OK = '✓'

// A card's body rows: its lines (or subcolumns), chips, the spare row, then its fact (`foot`) set off
// by a blank row when one is free.
export function body(c: Card, inner: number, rows: number): Line[] {
  if (c.tiles?.length) {
    let cr = cellRowsOf(c, rows)
    let out = tileRows(c.tiles, inner, cr)
    // A name cut short takes the ▸ row back: the band above already names the live step.
    if (cr < rows && out.some(l => l.some(g => g.t.includes('…')))) out = tileRows(c.tiles, inner, (cr = rows))
    if (cr < rows && c.foot) out.push(wrap(c.foot, inner)[0] ?? [])
    while (out.length < rows) out.push([])
    return out.slice(0, rows).map(l => clipLine(l, inner))
  }
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
  return withHot(out.slice(0, rows), c.hot, inner).map(l => clipLine(l, inner))
}

// Round 20e: the hot file rides flush right on the row that names the last step, when it fits whole.
function withHot(rows: Line[], hot: Line | undefined, inner: number): Line[] {
  if (!hot) return rows
  const i = rows.findLastIndex(l => (l[0]?.t ?? '').startsWith('last: '))
  const row = rows[i]
  if (!row || cells(row) + 3 + cells(hot) > inner) return rows
  return rows.map((l, k) => (k === i ? [...l, { t: ' '.repeat(inner - cells(l) - cells(hot)) }, ...hot] : l))
}

// The width a card asks for: its longest row (subcolumns side by side), its chips over two rows once
// they run long (rows are there, width is shared), its title, and its figures in the tray.
export function ideal(c: Card, tray: Line[] = []): number {
  const side = c.side ?? []
  const chips = (c.chips ?? []).reduce((a, x, i) => a + cells(x) + (i ? 2 : 0), 0)
  if (c.tiles?.length) {
    // Cells at the width their names ask for (title and tray still count): the most a to-do card wants.
    const cw = Math.max(...c.tiles.map(x => cellWant(x, 3)))
    return Math.max(c.tiles.length * (cw + 1) - 1 + 4, c.title.length + 6 + (c.note ? cells(c.note) + 2 : 0), tray.length ? cells(fitParts(tray, Infinity, '  ')) + 6 : 0)
  }
  const flow = chips > 40 ? Math.max(widest(c.chips ?? []), Math.ceil(chips / 2) + 2) : chips
  const content = Math.max(side.length ? widest(c.lines) + SUBGAP + widest(side) : widest(c.lines), widest(c.foot ? [c.foot] : []), widest(c.spare ? [c.spare] : []), flow)
  const title = c.title.length + 6 + (c.note ? cells(c.note) + 2 : 0)
  return Math.max(content + 4, title, tray.length ? cells(fitParts(tray, Infinity, '  ')) + 6 : 0)
}

// The prose card (index 0) keeps room for its content over two rows (between NOW_MIN and PROSE of the width),
// each other card gets its ideal out of the rest (never under MIN_W), and whatever is left over goes
// back to the prose card. A short narration so lends its width to a card that needs it.
// Round 17: with to-do cells beside it (`cellsAt` their card's index, `cap` the most they use) the prose
// card keeps room for three rows instead, and the spare width goes to the cells first.
export const cellsCap = (c: Card) => (c.tiles?.length ? c.tiles.length * (CELL_MAX + 1) - 1 + 4 : 0)
// The width that shows every cell at its narrowest: the prose card gives way down to its floor for it.
export const cellsNeed = (c: Card) => (c.tiles?.length ? c.tiles.length * (CELL_MIN + 1) - 1 + 4 : 0)
export function allot(ideals: number[], cols: number, cellsAt?: number, cap = Infinity, need = 0): number[] {
  const avail = cols - GUTTER * (ideals.length - 1)
  const want = ideals.map(w => Math.max(MIN_W, w))
  if (cellsAt) {
    // Cells beside the prose: the other cards keep what they ask, the prose card three rows' worth,
    // the cells everything else up to their cap; whatever the cap leaves goes back to the prose.
    const others = want.reduce((a, w, i) => (i === 0 || i === cellsAt ? a : a + w), 0)
    const roomy = Math.max(NOW_TODO, Math.min(Math.ceil(((ideals[0] ?? 0) - 4) / 3) + 12, Math.floor(avail * PROSE))) // + borders, indent, word breaks
    const keepNow = Math.max(NOW_TODO, Math.min(roomy, avail - others - need))
    const cellsW = Math.min(Math.max(cap, want[cellsAt] ?? 0), avail - keepNow - others)
    if (cellsW >= MIN_W) {
      const out = want.map((w, i) => (i === cellsAt ? cellsW : w))
      out[0] = avail - out.reduce((a, w, i) => (i ? a + w : a), 0)
      return out
    }
  }
  // Prose wraps, so it holds back room for its longest line over two rows, not one.
  const keepNow = Math.max(NOW_MIN, Math.min(Math.ceil((ideals[0] ?? 0) / 2) + 2, Math.floor(avail * PROSE)))
  const room = avail - keepNow
  const rest0 = want.slice(1)
  const total = rest0.reduce((a, b) => a + b, 0)
  // Over budget: each card gives back in proportion to what it asked above the minimum.
  const rest = total <= room ? rest0 : rest0.map(w => MIN_W + Math.floor(((w - MIN_W) * Math.max(0, room - MIN_W * rest0.length)) / Math.max(1, total - MIN_W * rest0.length)))
  return [avail - rest.reduce((a, b) => a + b, 0), ...rest]
}

// Card state the rows draw from beyond the card itself: `walk` (round 16 motion budget: the card
// that needs you walks its border at the tick, nothing else does) and `fade` (its tone just changed:
// the border passes through dim once before taking the new color).
type Drawn = Card & { walk?: number; fade?: boolean }
const ink = (c: Drawn): Seg => (c.fade ? { t: '', dim: true } : { t: '', color: TONE_COLOR[c.tone], dim: c.tone === 'quiet' })
const edge = (c: Drawn, t: string): Seg => ({ ...ink(c), t })

// The walk is laid over a finished row by absolute column, so the dashes keep one rhythm across
// segment joins: every other ─ inside a walking card's span turns ╌, shifting one cell per tick.
function walkRow(row: Line, spans: { from: number; to: number; f: number }[]): Line {
  if (!spans.length) return row
  let col = 0
  return row.map(s => {
    const t = [...s.t].map((ch, i) => {
      const at = col + i
      const span = spans.find(x => at >= x.from && at < x.to)
      return span && ch === '─' && (at + span.f) % 2 ? '╌' : ch
    }).join('')
    col += s.t.length
    return t === s.t ? s : { ...s, t }
  })
}
const FADE_MS = 480
const SLOW = 3 // a live step past this many times its kind's usual length walks the now card
const STALL_MS = 20_000 // nothing running, the model not working: the stand-in for "waiting on you"
export type Memo = { tones: Record<string, { tone: Tone; at: number }> }
// A card's identity across frames: its title's first word ("tests · run 2" → tests), the now card by place.
const keyOf = (c: Card, i: number) => (i ? (c.title.split(' ')[0] ?? c.title) : 'now')

function topBand(c: Drawn, w: number, status: string, pulse?: Seg): Line {
  const p = pulse ? ` ${pulse.t}` : ''
  const room = Math.max(1, w - 6 - p.length)
  const said = status.length > room ? status.slice(0, room - 1) + '…' : status
  const color = TONE_COLOR[c.tone]
  return [edge(c, '╭'), { t: ` ${said} `, bg: color ?? 'gray', color: 'black' }, ...(pulse ? [{ t: p, color: pulse.color }] : []), edge(c, ' ' + '─'.repeat(Math.max(1, w - 5 - said.length - p.length)) + '╮')]
}

// A title in the top edge, its note (the to-do squares, tags) right after it: ┏━ to-do ■◆□□ 2/4 ━━━┓.
function topTitle(c: Drawn, w: number, g = { tl: '╭', tr: '╮', h: '─' }): Line {
  const note = c.note?.length ? [...c.note, { t: ' ' }] : []
  const room = Math.max(1, w - 6 - cells(note))
  const title = c.title.length > room ? c.title.slice(0, room - 1) + '…' : c.title
  const fill = g.h.repeat(Math.max(1, w - 5 - title.length - cells(note)))
  // Round 20a: a lit title is a patch in the tone's colour, black text, in the same cells.
  const said: Seg = c.isLit ? { t: ` ${title} `, bg: TONE_COLOR[c.tone] ?? 'gray', color: 'black' } : { ...edge(c, ` ${title} `), bold: true }
  return [edge(c, g.tl + g.h), said, ...note, edge(c, fill + g.tr)]
}

// Neighbouring cells of one look as one segment.
function runs(segs: Seg[]): Line {
  const out: Seg[] = []
  for (const g of segs) {
    const p = out[out.length - 1]
    if (p && p.color === g.color && p.dim === g.dim && p.bg === g.bg && p.bold === g.bold) out[out.length - 1] = { ...p, t: p.t + g.t }
    else out.push({ ...g })
  }
  return out
}

const known = (ps: (Line | undefined)[]): Line[] => ps.filter((p): p is Line => !!p)

// Round 21 (pick 1): two cards with fixed places. Left, the now card: the live step's band in its top
// edge, terse fact rows, a ┄ divider, the gauges on one row, the folder in its bottom edge. Right, always,
// the to-do card: a heavy square frame (the main card), `to-do ■◆□□ 2/4` in its border, the cells on every
// body row. Each fact once: no ▸ row (the band names the live step), no progress card, no shared tray.
const HEAVY = { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' }
const LIGHT = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' }

// The fact rows, most telling first: the task card's own fact (tests, files, sources, agents; the step
// gauge otherwise), the narration when that setting is on, then the last finished step. Before any step,
// the prompt. A task card lit for a beat (20a: back to green) lights its label here.
function facts(t: Turn, head: Card, now: number): Line[] {
  const task = taskCard(t, now)
  const label: Seg = task.isLit ? { t: ` ${task.title} `, bg: TONE_COLOR[task.tone] ?? 'gray', color: 'black' } : { t: task.title, dim: true }
  const fact: Line = task.title === 'progress'
    ? [{ t: 'steps ', dim: true }, ...filmstrip(t, 24, now, false), { t: ' ' }, ...stepCounts(t)]
    : [label, { t: '  ' }, ...(task.lines[0] ?? [])]
  // The last real step: to-do bookkeeping is what the to-do card already shows.
  const step = t.done.findLast(x => x.kind !== 'todo')
  const lastRow: Line | undefined = step ? [{ t: 'last: ', dim: true }, { t: step.say + (step.ok === false ? ` ${MARK.fail}` : ''), dim: true }] : undefined
  const said = head.foot ? head.lines[1] : undefined // nowCard puts the narration there when it has one
  const rows = known([t.done.length ? fact : undefined, said, lastRow]).filter(l => cells(l))
  return rows.length ? rows : [[{ t: '» ' + t.prompt, dim: true }]]
}

// How a host wants the cards. withTodo false (omp, pi, …: the host pins its own to-do list): the now card
// alone, the full width; given `turns` (the session's finished turns) the genome rides inside it, right of
// the facts. `below` (Claude Code, two cards): rows `cols - 4` wide the frame runs on down to enclose.
export type SpinnerOpts = { withTodo?: boolean; turns?: readonly string[]; below?: Line[] }
const GROW = 2 // body rows the single card may add for its genome
const DNA_MIN = 16 // cells: a narrower genome column leaves the card and sits under it

export function spinnerRows(t: Turn, mode: Mode, narration: string | null, ctx: number | null, now: number, cols: number, rows: number, memo?: Memo, folder = '', how: boolean | SpinnerOpts = true): Line[] {
  const o: SpinnerOpts = typeof how === 'boolean' ? { withTodo: how } : how
  const withTodo = o.withTodo ?? true
  const head = nowCard(t, mode, narration, now)
  const todo0 = todoCard(t, ctx, now)
  const sq = squares(t)
  const todo: Card = { ...todo0, title: 'to-do', foot: undefined, note: [...(sq ?? []), ...(todo0.note ? [{ t: '  ', dim: true }, ...todo0.note] : [])] }
  const tp = teleParts(t, ctx, now)
  const gauges = fitParts(known([tp.ctx, tp.cache, tp.tok, tp.turn, tp.effort]), Infinity, ' · ')
  const task = taskCard(t, now)
  const tone: Tone = task.tone === 'fail' ? 'fail' : head.tone
  const now0: Card = { ...head, tone, lines: facts(t, head, now), foot: undefined }
  const f = frame(now)
  const live = [...t.running.values()].sort((a, b) => a.startedAt - b.startedAt)[0]
  const usual = live ? t.done.filter(x => x.kind === live.kind && x.endedAt !== undefined).map(x => (x.endedAt ?? 0) - x.startedAt).sort((a, b) => a - b) : []
  const isSlow = !!live && usual.length >= 3 && now - live.startedAt >= Math.max(10_000, SLOW * (usual[Math.floor(usual.length / 2)] ?? 0))
  const lastEnd = t.done[t.done.length - 1]?.endedAt ?? t.startedAt
  const isStalled = !live && mode !== 'thinking' && mode !== 'responding' && now - lastEnd >= STALL_MS
  const cards = [now0, todo].map((c, i): Drawn => {
    const key = keyOf(c, i)
    const seen = memo?.tones[key]
    if (memo && seen?.tone !== c.tone) memo.tones[key] = { tone: c.tone, at: seen ? now : -Infinity }
    const fade = !!memo && now - (memo.tones[key]?.at ?? -Infinity) < FADE_MS
    // The now card walks when stuck, slow or stalled: the one card that needs you moves.
    const walk = i === 0 && (c.tone === 'fail' || isSlow || isStalled) ? f : undefined
    return { ...c, walk, fade }
  })
  // Widths: the cells ask for their cap, the now card keeps room for its facts and gauges.
  const nowWant = Math.max(cells(gauges) + 4, ...now0.lines.map(l => cells(l) + 4), NOW_TODO)
  const ws = withTodo ? allot([nowWant, ideal(todo)], cols, todo.tiles?.length ? 1 : undefined, cellsCap(todo), cellsNeed(todo)) : [cols, 0]
  const [wn, wt] = [ws[0] ?? MIN_W, ws[1] ?? MIN_W]
  const inner = wn - 4
  // The genome inside the single card: a column right of the facts and gauges, as wide as they leave
  // (the facts keep their own width, never more than half), up to GROW rows taller than the body.
  const turns = !withTodo ? o.turns : undefined
  const lw = turns ? Math.min(Math.max(cells(gauges), ...now0.lines.map(l => cells(l)), 12), Math.floor(inner / 2)) : inner
  const dna = turns && inner - lw - SUBGAP >= DNA_MIN ? genome.rows(turns, inner - lw - SUBGAP, { live: t, now, maxRows: rows + GROW }) : []
  const fw = dna.length ? lw : inner // the facts' width
  // Body: facts over rows - 2, then the divider and the gauges (whole figures only, the last drops first).
  const factRows = Math.max(0, rows - 2, dna.length - 2)
  const nowBody: Line[] = [...keep(now0.lines.map(l => clipLine(l, fw)), factRows, fw)]
  while (nowBody.length < factRows) nowBody.push([])
  const shown = fitParts(known([tp.ctx, tp.cache, tp.tok, tp.turn, tp.effort]), fw, ' · ')
  const hot = head.hot
  const lastAt = nowBody.findIndex(l => (l[0]?.t ?? '').startsWith('last: '))
  if (hot && lastAt >= 0 && cells(nowBody[lastAt] ?? []) + 3 + cells(hot) <= fw) nowBody[lastAt] = [...(nowBody[lastAt] ?? []), { t: ' '.repeat(fw - cells(nowBody[lastAt] ?? []) - cells(hot)) }, ...hot]
  // No room for the column (a narrow pane): the genome sits under the card, labelled, as it did.
  const under = turns && !dna.length ? genome.idle(turns, cols, { live: t, now, maxRows: 1 }) : []
  const todoBody = withTodo ? body(todo, wt - 4, rows) : []
  const nowCardD = cards[0] as Drawn
  const todoCardD = cards[1] as Drawn
  const top = band(head.lines[0] ?? [], t.running.size > 0)
  const out: Line[] = []
  const side = (l: Line): Line => (withTodo ? [{ t: ' '.repeat(GUTTER) }, ...l] : [])
  out.push([...walkRow(topBand(nowCardD, wn, top.status, top.pulse), nowCardD.walk === undefined ? [] : [{ from: 0, to: wn, f: nowCardD.walk }]), ...side(topTitle(todoCardD, wt, HEAVY))])
  const bodyRows = factRows + 2
  for (let r = 0; r < bodyRows; r++) {
    const right: Line = dna.length ? [{ t: ' '.repeat(SUBGAP) }, ...(dna[r] ?? [])] : []
    const left: Line = r < factRows
      ? [edge(nowCardD, '│ '), ...pad([...pad(nowBody[r] ?? [], fw), ...right], inner), edge(nowCardD, ' │')]
      : r === factRows
        // With the genome column the divider runs under the facts only, stopping short of the genome.
        ? dna.length
          ? [edge(nowCardD, '│'), { t: '┄'.repeat(fw + 2), dim: true }, ...pad([{ t: ' '.repeat(SUBGAP - 1) }, ...(dna[r] ?? [])], inner - fw - 1), edge(nowCardD, ' │')]
          : [edge(nowCardD, '│'), { t: '┄'.repeat(wn - 2), dim: true }, edge(nowCardD, '│')]
        : [edge(nowCardD, '│ '), ...pad([...pad(shown, fw), ...right], inner), edge(nowCardD, ' │')]
    out.push([...left, ...side([edge(todoCardD, HEAVY.v + ' '), ...pad(todoBody[r] ?? [], wt - 4), edge(todoCardD, ' ' + HEAVY.v)])])
  }
  const below = withTodo ? o.below ?? [] : []
  if (!below.length) {
    out.push([...bottom(nowCardD, wn, folder ? [{ t: folder, dim: true }] : [], LIGHT), ...side(bottom(todoCardD, wt, [], HEAVY))])
    return [...out, ...under]
  }
  // Claude Code (HOSTS.md decision 3): the now card's left edge and the to-do card's right edge run on
  // down past the cards' own bottoms (their outer corners become tees), the rows `below` sit between
  // them, and one edge closes the shape, light under the now card, heavy under the to-do card.
  const nowEnd = bottom(nowCardD, wn, folder ? [{ t: folder, dim: true }] : [], LIGHT)
  const todoEnd = bottom(todoCardD, wt, [], HEAVY)
  out.push([...retip(nowEnd, LIGHT.bl, '├', 'start'), { t: ' '.repeat(GUTTER) }, ...retip(todoEnd, HEAVY.br, '┫', 'end')])
  for (const l of below) out.push([edge(nowCardD, '│ '), ...pad(clipLine(l, cols - 4), cols - 4), edge(todoCardD, ' ' + HEAVY.v)])
  out.push([edge(nowCardD, LIGHT.bl + LIGHT.h.repeat(wn - 1)), edge(todoCardD, '╼' + HEAVY.h.repeat(Math.max(0, cols - wn - 2)) + HEAVY.br)])
  return out
}

// A row with its first (or last) glyph swapped: a card's corner becoming a tee where its edge runs on.
function retip(l: Line, from: string, to: string, at: 'start' | 'end'): Line {
  const i = at === 'start' ? 0 : l.length - 1
  const g = l[i]
  if (!g) return l
  const t = at === 'start' ? (g.t.startsWith(from) ? to + g.t.slice(from.length) : g.t) : g.t.endsWith(from) ? g.t.slice(0, -from.length) + to : g.t
  return l.map((x, k) => (k === i ? { ...x, t } : x))
}

// A card's own bottom edge, an optional figure riding it: ╰─ …/live ───╯.
function bottom(c: Drawn, w: number, fig: Line, g: typeof LIGHT): Line {
  const room = w - 6
  const f = cells(fig) <= room ? fig : []
  if (!f.length) return [edge(c, g.bl + g.h.repeat(Math.max(0, w - 2)) + g.br)]
  return [edge(c, g.bl + g.h + ' '), ...f, edge(c, ' ' + g.h.repeat(Math.max(1, w - 5 - cells(f))) + g.br)]
}
