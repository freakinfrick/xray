// The three cards and the between-turns line, as plain data. Colors are ANSI names, so they follow
// the terminal's own palette (herdr forest / forest-light); undefined = the terminal's default ink.

import type { LastTurn } from '../types'
import { DEFAULTS, customCard } from './custom'
import { SPARK, bar, frame, spark, tile } from './glyphs'
import { openTodos, runningAgents, type Run, type Todo, type Turn } from './track'

// inv: drawn inverse, the glyph in the terminal's background on `color` (a solid tile on both themes).
export type Seg = { t: string; color?: string; dim?: boolean; bold?: boolean; inv?: boolean; bg?: string }
export type Line = Seg[]
export type Tone = 'quiet' | 'ok' | 'fail' | 'warn' | 'live' | 'think'
// spare: a row drawn only when the lines leave one free after wrapping.
export type Card = { title: string; tone: Tone; note?: Line; lines: Line[]; spare?: Line }
export type Mode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use' | undefined

export const TONE_COLOR: Record<Tone, string | undefined> = { quiet: undefined, ok: 'green', fail: 'red', warn: 'yellow', live: 'cyan', think: 'magenta' }

const secs = (ms: number) => Math.floor(ms / 1000)
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// sayMax: step text is kept up to 72 chars; the wide cards show 40 as they always have, the narrow card all of it.
export function nowCard(t: Turn, mode: Mode, narration: string | null, now: number, sayMax = 40): Card {
  const live = [...t.running.values()].sort((a, b) => a.startedAt - b.startedAt)
  let what: string
  let tone: Tone
  const done = t.done[t.done.length - 1]
  let since = done?.endedAt ?? t.startedAt // idle time counts from the last finished step
  const first = live[0]
  if (first) {
    what = clip(first.say, sayMax) + (live.length > 1 ? ` +${live.length - 1}` : '')
    tone = 'live'
    since = first.startedAt
  } else if (mode === 'thinking') {
    what = 'thinking'
    tone = 'think'
  } else if (mode === 'responding') {
    what = 'writing the reply'
    tone = 'ok'
  } else if (mode === 'tool-input') {
    what = 'deciding the next step'
    tone = 'think'
  } else {
    what = 'waiting on the model'
    tone = 'quiet'
  }
  const el = secs(now - since)
  const last = t.done[t.done.length - 1]
  const sub: Line = narration ? [{ t: '» ' + narration, dim: true }] : last ? [{ t: `last: ${clip(last.say, sayMax)}${last.ok === false ? ' ✗' : ''}`, dim: true }] : [{ t: '» ' + clip(t.prompt, 80), dim: true }]
  const f = frame(now)
  const head: Line = live.length ? [tile(' ◆ ', 'cyan'), { t: ' ' + what }] : [{ t: '◇ ' + what }]
  if (el > 5) head.push({ t: ` · ${clock(el * 1000)}`, dim: true })
  if (live.length) head.push({ t: ' ' + ('▂▄▆█'[f % 4] as string), color: 'cyan' })
  return { title: 'now', tone, lines: [head, sub], spare: stepTrail(t, live.length > 0, f) }
}

const TRAIL = 10

// The turn's steps as a row of blocks: green done, red failed, cyan running (blinking at the tick).
function stepTrail(t: Turn, isRunning: boolean, f: number): Line | undefined {
  if (!t.done.length && !isRunning) return undefined
  const failed = t.done.filter(x => x.ok === false).length
  const marks: Line = t.done.slice(-TRAIL).map(x => ({ t: '▆', color: x.ok === false ? 'red' : 'green' }))
  if (isRunning) marks.push({ t: f % 2 ? '▆' : '▄', color: 'cyan' })
  return [{ t: 'steps ', dim: true }, ...marks, { t: ` ${t.done.length} done${failed ? ` · ${failed} failed` : ''}`, dim: true }]
}

const NBSP = '\u00a0' // keeps a chip whole when its row wraps

// One patch per to-do: a grey patch while pending, its own color in progress (mark and name) and a
// solid patch in that color when done.
function chip(x: Todo): Line {
  const name = clip(x.text, 18).replace(/ /g, NBSP)
  if (x.status === 'completed') return [{ t: `${NBSP}${name}${NBSP}`, color: x.color, inv: true }]
  if (x.status === 'in_progress') return [{ t: '▐◉▌', color: x.color }, { t: name, color: x.color }]
  return [{ t: `${NBSP}${name}${NBSP}`, dim: true, inv: true }]
}

// The to-do list as chips; what else is on the plate (queued calls, agents out, a filling context)
// rides in the top border.
export function todoCard(t: Turn, ctxPercent: number | null): Card {
  const done = t.todos.filter(x => x.status === 'completed').length
  const q = t.queued.size
  const bg = runningAgents(t).length
  const warn = ctxPercent !== null && ctxPercent >= 70
  const tags: Line = [...(q ? [{ t: `${q} queued`, dim: true }] : []), ...(bg ? [{ t: plural(bg, 'agent'), dim: true }] : []), ...(warn ? [{ t: `⚠ context ${Math.round(ctxPercent)}%`, color: 'yellow' }] : [])]
  const note = tags.flatMap((s, i) => (i ? [{ t: ' · ', dim: true }, s] : [s]))
  const chips = t.todos.flatMap((x, i) => (i ? [{ t: ' ' }, ...chip(x)] : chip(x)))
  return {
    title: t.todos.length ? `to-do · ${done} of ${t.todos.length}` : 'to-do',
    tone: warn ? 'warn' : t.todos.length && done === t.todos.length ? 'ok' : 'quiet',
    note: note.length ? note : undefined,
    lines: t.todos.length ? [chips] : [[{ t: 'no to-do list yet', dim: true }]],
  }
}

export function taskCard(t: Turn, now: number): Card {
  if (t.signal) return customCard(t, t.signal, t.recipe ?? DEFAULTS[t.signal], now)
  switch (t.template) {
    case 'tests':
      return testsCard(t, now)
    case 'refactor':
      return filesCard(t)
    case 'research':
      return researchCard(t)
    case 'agents':
      return agentsCard(t)
    default:
      return progressCard(t)
  }
}

const BAR = 16
const isFailed = (r: Run) => (r.total ? r.fail > 0 : r.ok === false)
const sayRun = (r: Run) => (r.isStopped ? 'stopped' : !r.total ? (r.ok ? 'passed' : 'failed') : r.fail ? `${r.fail} failing` : `all ${r.total} passed`)
function testsCard(t: Turn, now: number): Card {
  const n = t.runs.length
  const r = t.runs[n - 1]
  if (!r) return progressCard(t)
  const prev = t.runs.slice(0, -1).reverse().find(x => !x.running)
  if (r.running) {
    const el = secs(now - r.startedAt)
    return { title: `tests · run ${n}`, tone: 'live', lines: [[{ t: '░'.repeat(BAR) + ' ', dim: true }, { t: `running${el > 5 ? ` · ${clock(el * 1000)}` : '…'}` }], [{ t: prev ? `last run: ${sayRun(prev)}` : 'first run', dim: true }]], spare: runHistory(t) }
  }
  if (r.isStopped) return { title: `tests · run ${n}`, tone: 'warn', lines: [[{ t: '░'.repeat(BAR) + ' ', dim: true }, { t: 'run stopped' }], [{ t: 'the turn ended before it finished', dim: true }]] }
  const passed = r.total ? r.pass / r.total : r.ok ? 1 : 0
  const bar: Line = [...barOf(passed), { t: ' ' }]
  const failedBefore = t.runs.slice(0, -1).filter(isFailed).length
  const fixed: Line = [{ t: failedBefore ? `fixed after ${plural(failedBefore, 'failing run')}` : n > 1 ? 'passed every run' : 'passed first time', dim: true }]
  const spare = runHistory(t)
  if (!r.total) return { title: `tests · run ${n}`, tone: r.ok ? 'ok' : 'fail', lines: [[...bar, r.ok ? { t: 'passed ✓', color: 'green' } : { t: 'failed' }], r.ok ? fixed : [{ t: 'no test count in the output', dim: true }]], spare }
  if (!isFailed(r)) return { title: `tests · run ${n}`, tone: 'ok', lines: [[...bar, { t: `all ${r.total} pass ✓`, color: 'green' }], fixed], spare }
  const name = r.failing[0]
  return {
    title: `tests · run ${n}`,
    tone: 'fail',
    lines: [[...bar, { t: `${r.pass}/${r.total} pass` }], [{ t: '✗ ', color: 'red' }, { t: name ? name + (r.fail > 1 ? ` +${r.fail - 1}` : '') : plural(r.fail, 'failing test') }]],
    spare,
  }
}

// Passing share in green, the rest in red; the cell where they meet is split to the eighth.
const barOf = (passed: number): Line => (passed <= 0 ? [{ t: '█'.repeat(BAR), color: 'red' }] : bar(passed, BAR, 'green', 'red'))

// One block per finished run, as tall as its passing share; from two runs on.
function runHistory(t: Turn): Line | undefined {
  const done = t.runs.filter(x => !x.running && !x.isStopped).slice(-12)
  if (done.length < 2) return undefined
  const marks: Line = done.map(x => (x.total ? { t: SPARK[Math.round((x.pass / x.total) * 7)] as string, color: x.fail ? 'red' : 'green' } : { t: x.ok ? '█' : '▁', color: x.ok ? 'green' : 'red' }))
  const counted = done.filter(x => x.total)
  const first = counted[0]
  const last = counted[counted.length - 1]
  const said = first && last && counted.length > 1 ? ` ${first.pass} → ${last.pass} passing` : ''
  return [{ t: 'runs ', dim: true }, ...marks, { t: said, dim: true }]
}

function filesCard(t: Turn): Card {
  const files = [...t.edited.values()]
  const checked = files.filter(f => f.checked).length
  const MAX = 24
  const sq: Line = files.slice(0, MAX).map(f => ({ t: '■', color: f.checked ? 'green' : 'yellow' }))
  if (files.length > MAX) sq.push({ t: ` +${files.length - MAX}`, dim: true })
  return { title: 'files', tone: files.length && checked === files.length ? 'ok' : 'quiet', lines: [sq, [{ t: `${files.length} edited · ${checked} checked` }]] }
}

function researchCard(t: Turn): Card {
  if (t.todos.length) {
    const done = t.todos.filter(x => x.status === 'completed').length
    const cur = openTodos(t)[0]
    return { title: 'questions', tone: 'quiet', lines: [[...dots(t), { t: ` ${done} of ${t.todos.length} answered` }], cur ? [{ t: '? ', color: 'yellow' }, { t: cur.text }] : [{ t: 'all answered ✓', color: 'green' }]] }
  }
  const last = t.sources[t.sources.length - 1]
  return { title: 'sources', tone: 'quiet', lines: [[{ t: `${plural(t.sources.length, 'source')} looked at` }], [{ t: last ? `latest: ${last}` : '', dim: true }]] }
}

// Who is out working, what the oldest running one is doing, and the goal they all serve.
function agentsCard(t: Turn): Card {
  const live = runningAgents(t)
  const failed = t.agents.filter(a => a.ok === false).length
  const done = t.agents.length - live.length - failed
  const marks: Line = t.agents.slice(0, 12).map(a => (a.endedAt === undefined ? { t: '◆', color: 'cyan' } : a.ok === false ? { t: '✗', color: 'red' } : { t: '●', color: 'green' }))
  const counts = [live.length ? `${live.length} running` : '', done ? `${done} done` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(' · ')
  const first = live[0]
  const tone: Tone = live.length ? 'live' : failed ? 'fail' : 'ok'
  return {
    title: `agents · ${t.agents.length}`,
    tone,
    lines: [[...marks, { t: ' ' + counts }], first ? [{ t: '▸ ', dim: true }, { t: first.label }, { t: `: ${first.doing ?? 'starting'}`, dim: true }] : [{ t: live.length ? '' : 'all back', dim: true }], [{ t: 'goal ▸ ', dim: true }, { t: clip(t.prompt, 200), dim: true }]],
  }
}

function progressCard(t: Turn): Card {
  if (t.todos.length) {
    const done = t.todos.filter(x => x.status === 'completed').length
    const cur = t.todos.find(x => x.status === 'in_progress')
    return { title: 'progress', tone: done === t.todos.length ? 'ok' : 'quiet', lines: [[...dots(t), { t: ` ${done} of ${t.todos.length} done` }], [{ t: cur ? cur.active : done === t.todos.length ? 'all done ✓' : '', dim: !cur }]] }
  }
  const steps = t.done.length
  return { title: 'progress', tone: t.failures ? 'warn' : 'quiet', lines: [[{ t: plural(steps, 'step') + ' done' }, ...(t.failures ? [{ t: ` · ${t.failures} failed`, color: 'red' }] : [])], [{ t: t.edited.size ? `${plural(t.edited.size, 'file')} changed` : '', dim: true }]] }
}

function dots(t: Turn): Line {
  return t.todos.slice(0, 12).map(x => ({ t: x.status === 'completed' ? '●' : x.status === 'in_progress' ? '◉' : '○', color: x.status === 'pending' ? undefined : 'green', dim: x.status === 'pending' }))
}

// A segment of bars, sparklines or marks only (dots and spaces aside): no words for a one-line summary.
const GLYPHS_ONLY = /^[\s·]*[█▉▊▋▌▍▎▏░▒▓▁▂▃▄▅▆▇■●◉○◆✗▐][\s·█▉▊▋▌▍▎▏░▒▓▁▂▃▄▅▆▇■●◉○◆✗▐]*$/

// The one line above the prompt between turns: how it ended, what is still owed.
// The device mod's class as the idle strip's leading glyph; unknown (or no device mod) draws nothing.
const DEVICE_GLYPH: Record<string, string> = { mobile: '📱', desktop: '🖥', local: '⌂' }
export const deviceGlyph = (cls: string | undefined): string | undefined => (cls ? DEVICE_GLYPH[cls] : undefined)

export function lastTurn(t: Turn, now: number): LastTurn {
  const card = taskCard(t, now)
  const words = (card.lines[0] ?? []).filter(s => !s.inv && !GLYPHS_ONLY.test(s.t))
  const headline = words.map(s => s.t).join('').replace(/\s{2,}/g, ' ').replace(/^[\s·]+|[\s·]+$/g, '') || `${plural(t.done.length, 'step')}`
  const tone: LastTurn['tone'] = card.tone === 'fail' || card.tone === 'warn' ? 'fail' : card.tone === 'ok' ? 'ok' : 'plain'
  return { title: card.title, headline, tone, owed: openTodos(t).slice(0, 4).map(x => ({ t: x.text, color: x.color })) }
}

// Long lines take the spare rows instead of being cut: each split breaks at a space and the
// continuation is indented under the text. What still does not fit is truncated by the renderer.
export function fitRows(lines: Line[], width: number, rows: number, spare?: Line): Line[] {
  const out = lines.filter((l, i) => i === 0 || l.some(s => s.t))
  for (let i = 0; i < out.length && out.length < rows; i++) {
    const line = out[i] ?? []
    const all = line.map(s => s.t).join('')
    if (all.length <= width) continue
    const space = all.lastIndexOf(' ', width)
    const cut = space > width / 3 ? space : width
    const [head, tail] = splitLine(line, cut, all[cut] === ' ' ? 1 : 0)
    out.splice(i, 1, head, [{ t: '  ' }, ...tail])
  }
  if (spare && out.length < rows) out.push(spare)
  while (out.length < rows) out.push([])
  return out.slice(0, rows)
}

function splitLine(line: Line, cut: number, skip: number): [Line, Line] {
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

const GAUGE = 8

// The one telemetry line under the cards. Every figure is measured; a figure not known yet is left out.
export function telemetry(t: Turn, ctxPercent: number | null, now: number): Line {
  const parts: Line[] = []
  if (ctxPercent !== null) parts.push([{ t: 'ctx ', dim: true }, ...bar(ctxPercent / 100, GAUGE, ctxPercent >= 90 ? 'red' : ctxPercent >= 70 ? 'yellow' : 'green'), { t: ` ${Math.round(ctxPercent)}%`, color: ctxPercent >= 70 ? 'yellow' : undefined }])
  const done = t.requests.filter(r => r.endedAt > r.firstAt)
  const out = done.reduce((a, r) => a + r.output, 0)
  const gen = done.reduce((a, r) => a + (r.endedAt - r.firstAt), 0)
  const rates = done.slice(-8).map(r => r.output / ((r.endedAt - r.firstAt) / 1000))
  if (out && gen) parts.push([{ t: 'tok/s ', dim: true }, ...(rates.length > 1 ? [spark(rates), { t: ' ' }] : []), { t: String(Math.round(out / (gen / 1000))) }])
  const last = t.requests[t.requests.length - 1]
  const sent = last ? last.input + last.cacheRead + last.cacheWrite : 0
  if (last && sent) parts.push([{ t: 'cache ', dim: true }, ...bar(last.cacheRead / sent, GAUGE, 'cyan'), { t: ` ${Math.round((last.cacheRead / sent) * 100)}%` }])
  parts.push([{ t: 'turn ', dim: true }, { t: clock(now - t.startedAt) }])
  return parts.flatMap((p, i) => (i ? [{ t: '   ' }, ...p] : p))
}

// Under 60 columns (a phone, a narrow pane), rounds 8–9: one card `width` cells wide. Top edge = what
// runs now; body = narration, then steps + to-do squares; bottom edge = telemetry. Ticker (few rows,
// the phone's keyboard up): the body folds to one row and the bottom edge stays bare.
// status: the top edge's highlighted band (round 11), `more` its overflow on a band row of its own;
// pulse: the live step's 1 Hz glyph, drawn after the band in the tone color.
export type Compact = { tone: Tone; status: string; more?: string; pulse?: Seg; body: Line[]; bottom: Line }

const LABEL = 'steps ' // so both gauges start in one column: '│ ' + 6 cells = '╰─ ' + 'ctx  '

export function compact(t: Turn, mode: Mode, narration: string | null, ctxPercent: number | null, now: number, width: number, isTicker: boolean): Compact {
  const card = nowCard(t, mode, narration, now, 72)
  const [head = [], sub = []] = card.lines
  const live = t.running.size > 0
  const last = t.done[t.done.length - 1]
  const tone: Tone = !live && last?.ok === false ? 'fail' : card.tone
  const inner = width - 4 // │ text │
  const edge = width - 6 // ╭─ text ─╮, at least one ─ of fill
  const band = width - 8 // ╭ ␣status␣ ▂ ─╮: the band's two pads, the pulse and one ─ of fill
  const failed = t.done.filter(x => x.ok === false).length
  // The steps as a gauge the ctx bar's shape: one █ per step on the same dim ░ track.
  const steps = (n: number): Line => {
    const m: Line = [...t.done.slice(-(live ? n - 1 : n)).map(x => ({ t: '█', color: x.ok === false ? 'red' : 'green' })), ...(live ? [{ t: frame(now) % 2 ? '█' : '▄', color: 'cyan' }] : [])]
    return m.length < n ? [...m, { t: '░'.repeat(n - m.length), dim: true }] : m
  }
  const done = t.todos.filter(x => x.status === 'completed').length
  const squares: Line | undefined = t.todos.length ? [...t.todos.slice(0, 12).map(squareOf), { t: ` ${done}/${t.todos.length}`, dim: true }] : undefined
  const rate = tokRate(t)
  const tok: Line | undefined = rate === null ? undefined : [{ t: `${rate} t/s` }]
  // The card grows at most one row so status texts are not cut: the status's overflow takes it first,
  // else the narration's (rounds 9–10).
  // The band is one tone, so the status goes in as plain text: the live tile and dim timer fold into it.
  const tail = live ? head[head.length - 1] : undefined
  const pulse = tail ? { ...tail, t: tail.t.trim() } : undefined
  const said = (tail ? head.slice(0, -1) : head).map(x => x.t).join('').replace(/\s+/g, ' ').trim()
  const [first, rest] = wrapOnce([{ t: said }], band, inner)
  const status = first.map(x => x.t).join('')
  const more = rest?.map(x => x.t).join('').trimStart()
  if (isTicker) {
    const ctx: Line | undefined = ctxPercent === null ? undefined : [{ t: `ctx ${Math.round(ctxPercent)}%`, color: ctxPercent >= 70 ? 'yellow' : undefined }]
    const counts: Line = [...steps(6), { t: ` ${t.done.length}${failed ? ` · ${failed}✗` : ''}`, dim: true }]
    return { tone, status, more, pulse, body: [fitParts([counts, squares, ctx, tok], inner, ' · ')], bottom: [] }
  }
  const isTask = !!t.signal || t.template !== 'default'
  const progress: Line = isTask ? (taskCard(t, now).lines[0] ?? []) : [{ t: LABEL, dim: true }, ...steps(GAUGE), { t: ` ${t.done.length} done`, dim: true }, ...(failed ? [{ t: ` · ${failed} failed`, color: 'red' }] : [])]
  const gauge: Line | undefined = ctxPercent === null ? undefined : [{ t: 'ctx  ', dim: true }, ...bar(wholeCells(ctxPercent / 100, GAUGE), GAUGE, ctxPercent >= 90 ? 'red' : ctxPercent >= 70 ? 'yellow' : 'green'), { t: ` ${Math.round(ctxPercent)}%`, color: ctxPercent >= 70 ? 'yellow' : undefined }]
  const sent = lastSent(t)
  const cache: Line | undefined = sent ? [{ t: 'cache ', dim: true }, { t: `${Math.round(sent * 100)}%` }] : undefined
  const turn: Line = [{ t: clock(now - t.startedAt), dim: true }]
  return {
    tone,
    status,
    more,
    pulse,
    body: [...(more ? [clipLine(sub, inner)] : wrapOnce(sub, inner, inner).filter((l): l is Line => !!l)), fitParts([progress, squares], inner, '  ')],
    bottom: fitParts([gauge, tok, turn, cache], edge, '  '),
  }
}

// Whole cells only: Termius draws a thin eighth (▎) near-blank, a gap in a low gauge (capture 6).
// Any use at all shows one cell.
const wholeCells = (frac: number, n: number) => (frac > 0 ? Math.max(1, Math.round(frac * n)) / n : 0)

// One square per to-do in its hue: solid when done, ◉ in progress, a grey □ while pending.
const squareOf = (x: Todo): Seg => (x.status === 'completed' ? { t: '■', color: x.color } : x.status === 'in_progress' ? { t: '◉', color: x.color } : { t: '□', dim: true })

const tokRate = (t: Turn): number | null => {
  const done = t.requests.filter(r => r.endedAt > r.firstAt)
  const out = done.reduce((a, r) => a + r.output, 0)
  const gen = done.reduce((a, r) => a + (r.endedAt - r.firstAt), 0)
  return out && gen ? Math.round(out / (gen / 1000)) : null
}

// The cache-read share of what the last request sent, or 0 before any request.
const lastSent = (t: Turn): number => {
  const last = t.requests[t.requests.length - 1]
  const sent = last ? last.input + last.cacheRead + last.cacheWrite : 0
  return last && sent ? last.cacheRead / sent : 0
}

const cells = (l: Line) => l.reduce((a, s) => a + s.t.length, 0)

// Whole parts, left to right, while they fit: the rightmost go first, nothing is cut mid-part.
function fitParts(parts: (Line | undefined)[], width: number, sep: string): Line {
  const out: Line = []
  for (const p of parts) {
    if (!p) continue
    const next: Line = out.length ? [{ t: sep }, ...p] : p
    if (cells(out) + cells(next) > width) break
    out.push(...next)
  }
  return out
}

// A line that fits `first` cells as is; else cut at the last word that fits, the rest one more row
// (indented 2, cut with an ellipsis when it too runs past `rest`).
function wrapOnce(l: Line, first: number, rest: number): [Line, Line | undefined] {
  if (cells(l) <= first) return [l, undefined]
  const all = l.map(s => s.t).join('')
  const space = all.lastIndexOf(' ', first)
  const cut = space > first / 3 ? space : first
  const [head, tail] = splitLine(l, cut, all[cut] === ' ' ? 1 : 0)
  return [head, clipLine([{ t: '  ' }, ...tail], rest)]
}

// A line cut at the last word that fits, with an ellipsis; a line that fits is kept as is.
function clipLine(l: Line, width: number): Line {
  if (cells(l) <= width) return l
  const all = l.map(s => s.t).join('')
  const space = all.lastIndexOf(' ', width - 1)
  const cut = space > width / 3 ? space : width - 1
  return [...splitLine(l, cut, 0)[0], { t: '…', dim: true }]
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}
