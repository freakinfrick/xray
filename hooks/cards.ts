// The three cards and the between-turns line, as plain data. Colors are ANSI names, so they follow
// the terminal's own palette (herdr forest / forest-light); undefined = the terminal's default ink.

import type { LastTurn } from '../types'
import { openTodos, type Run, type Turn } from './track'

export type Seg = { t: string; color?: string; dim?: boolean; bold?: boolean }
export type Line = Seg[]
export type Tone = 'quiet' | 'ok' | 'fail' | 'warn' | 'live' | 'think'
export type Card = { title: string; tone: Tone; note?: string; lines: [Line, Line] }
export type Mode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use' | undefined

export const TONE_COLOR: Record<Tone, string | undefined> = { quiet: undefined, ok: 'green', fail: 'red', warn: 'yellow', live: 'cyan', think: 'magenta' }

const secs = (ms: number) => Math.floor(ms / 1000)
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

export function nowCard(t: Turn, mode: Mode, narration: string | null, now: number): Card {
  const live = [...t.running.values()].sort((a, b) => a.startedAt - b.startedAt)
  let what: string
  let tone: Tone
  const done = t.done[t.done.length - 1]
  let since = done?.endedAt ?? t.startedAt // idle time counts from the last finished step
  const first = live[0]
  if (first) {
    what = first.say + (live.length > 1 ? ` +${live.length - 1}` : '')
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
  const sub: Line = narration ? [{ t: '» ' + narration, dim: true }] : last ? [{ t: `last: ${last.say}${last.ok === false ? ' ✗' : ''}`, dim: true }] : [{ t: '» ' + clip(t.prompt, 80), dim: true }]
  return { title: 'now', tone, lines: [[{ t: (live.length ? '◆ ' : '◇ ') + what },...(el > 5 ? [{ t: ` · ${el}s`, dim: true }] : [])], sub] }
}

export function leftCard(t: Turn, ctxPercent: number | null): Card {
  const open = openTodos(t)
  const q = t.queued.size
  const head = [q ? `${q} queued` : '', open.length ? plural(open.length, 'to-do') : ''].filter(Boolean).join(' · ') || 'nothing queued'
  const next = [...t.queued.values()][0] ?? open.find(x => x.status === 'in_progress')?.active ?? open[0]?.text
  const warn = ctxPercent !== null && ctxPercent >= 70
  return {
    title: 'left',
    tone: warn ? 'warn' : 'quiet',
    note: warn ? `⚠ context ${Math.round(ctxPercent)}%` : undefined,
    lines: [[{ t: head, dim: !q && !open.length }], next ? [{ t: 'next ▸ ', dim: true }, { t: next }] : [{ t: open.length ? '' : 'no to-do list yet', dim: true }]],
  }
}

export function taskCard(t: Turn, now: number): Card {
  switch (t.template) {
    case 'tests':
      return testsCard(t, now)
    case 'refactor':
      return filesCard(t)
    case 'research':
      return researchCard(t)
    default:
      return progressCard(t)
  }
}

const BAR = 12
const isFailed = (r: Run) => (r.total ? r.fail > 0 : r.ok === false)
const sayRun = (r: Run) => (r.isStopped ? 'stopped' : !r.total ? (r.ok ? 'passed' : 'failed') : r.fail ? `${r.fail} failing` : `all ${r.total} passed`)
function testsCard(t: Turn, now: number): Card {
  const n = t.runs.length
  const r = t.runs[n - 1]
  if (!r) return progressCard(t)
  const prev = t.runs.slice(0, -1).reverse().find(x => !x.running)
  if (r.running) {
    const el = secs(now - r.startedAt)
    return { title: `tests · run ${n}`, tone: 'live', lines: [[{ t: '·'.repeat(BAR) + ' ', dim: true }, { t: `running${el > 5 ? ` · ${el}s` : '…'}` }], [{ t: prev ? `last run: ${sayRun(prev)}` : 'first run', dim: true }]] }
  }
  if (r.isStopped) return { title: `tests · run ${n}`, tone: 'warn', lines: [[{ t: '·'.repeat(BAR) + ' ', dim: true }, { t: 'run stopped' }], [{ t: 'the turn ended before it finished', dim: true }]] }
  const good = r.total ? Math.round((r.pass / r.total) * BAR) : r.ok ? BAR : 0
  const bar: Line = [{ t: '█'.repeat(good), color: 'green' }, { t: '█'.repeat(BAR - good), color: 'red' }, { t: ' ' }]
  const failedBefore = t.runs.slice(0, -1).filter(isFailed).length
  const fixed: Line = [{ t: failedBefore ? `fixed after ${plural(failedBefore, 'failing run')}` : n > 1 ? 'passed every run' : 'passed first time', dim: true }]
  if (!r.total) return { title: `tests · run ${n}`, tone: r.ok ? 'ok' : 'fail', lines: [[...bar, r.ok ? { t: 'passed ✓', color: 'green' } : { t: 'failed' }], r.ok ? fixed : [{ t: 'no test count in the output', dim: true }]] }
  if (!isFailed(r)) return { title: `tests · run ${n}`, tone: 'ok', lines: [[...bar, { t: `all ${r.total} pass ✓`, color: 'green' }], fixed] }
  const name = r.failing[0]
  return {
    title: `tests · run ${n}`,
    tone: 'fail',
    lines: [[...bar, { t: `${r.pass}/${r.total} pass` }], [{ t: '✗ ', color: 'red' }, { t: name ? name + (r.fail > 1 ? ` +${r.fail - 1}` : '') : plural(r.fail, 'failing test') }]],
  }
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

// The one line above the prompt between turns: how it ended, what is still owed.
export function lastTurn(t: Turn, now: number): LastTurn {
  const card = taskCard(t, now)
  const headline = card.lines[0].map(s => s.t).join('').replace(/[█·■●◉○]+/g, '').trim() || `${plural(t.done.length, 'step')}`
  const tone: LastTurn['tone'] = card.tone === 'fail' || card.tone === 'warn' ? 'fail' : card.tone === 'ok' ? 'ok' : 'plain'
  return { headline: `${card.title}: ${headline}`, tone, owed: openTodos(t).map(x => x.text).slice(0, 4) }
}

// Long lines take the spare rows instead of being cut: each split breaks at a space and the
// continuation is indented under the text. What still does not fit is truncated by the renderer.
export function fitRows(lines: Line[], width: number, rows: number): Line[] {
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

// The one telemetry line under the cards. Every figure is measured; a figure not known yet is left out.
export function telemetry(t: Turn, ctxPercent: number | null, now: number): Line {
  const parts: Line[] = []
  if (ctxPercent !== null) parts.push([{ t: `ctx ${Math.round(ctxPercent)}%`, color: ctxPercent >= 70 ? 'yellow' : undefined, dim: ctxPercent < 70 }])
  const done = t.requests.filter(r => r.endedAt > r.firstAt)
  const out = done.reduce((a, r) => a + r.output, 0)
  const gen = done.reduce((a, r) => a + (r.endedAt - r.firstAt), 0)
  if (out && gen) parts.push([{ t: `${Math.round(out / (gen / 1000))} tok/s`, dim: true }])
  const last = t.requests[t.requests.length - 1]
  const sent = last ? last.input + last.cacheRead + last.cacheWrite : 0
  if (last && sent) parts.push([{ t: `cache ${Math.round((last.cacheRead / sent) * 100)}%`, dim: true }])
  parts.push([{ t: `turn ${clock(now - t.startedAt)}`, dim: true }])
  return parts.flatMap((p, i) => (i ? [{ t: ' · ', dim: true }, ...p] : p))
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}
