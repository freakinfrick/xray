// The three cards and the between-turns line, as plain data. Colors are ANSI names, so they follow
// the terminal's own palette (herdr forest / forest-light); undefined = the terminal's default ink.

import type { LastTurn } from '../types'
import { openTodos, type Turn } from './track'

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
  let since = t.startedAt
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
function testsCard(t: Turn, now: number): Card {
  const n = t.runs.length
  const r = t.runs[n - 1]
  if (!r) return progressCard(t)
  const prev = t.runs.slice(0, -1).reverse().find(x => !x.running)
  if (r.running) {
    const el = secs(now - r.startedAt)
    return { title: `tests · run ${n}`, tone: 'live', lines: [[{ t: '·'.repeat(BAR) + ' ', dim: true }, { t: `running${el > 5 ? ` · ${el}s` : '…'}` }], [{ t: prev ? (prev.fail ? `last run: ${prev.fail} failing` : `last run: all ${prev.total} passed`) : 'first run', dim: true }]] }
  }
  const good = r.total ? Math.round((r.pass / r.total) * BAR) : 0
  const bar: Line = [{ t: '█'.repeat(good), color: 'green' }, { t: '█'.repeat(BAR - good), color: 'red' }, { t: ' ' }]
  if (!r.fail) return { title: `tests · run ${n}`, tone: 'ok', lines: [[...bar, { t: `all ${r.total} pass ✓`, color: 'green' }], [{ t: n > 1 ? `fixed after ${plural(n - 1, 'failing run')}` : 'passed first time', dim: true }]] }
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

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}
