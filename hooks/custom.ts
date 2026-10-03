// Custom task cards: a recipe lays out widgets from a fixed kit over sources the mod measures.
// The gate: a card is custom only when a measured property shows that no template serves.
// A small model may write the recipe; checkRecipe keeps it to the kit, and DEFAULTS stand in.

import type { Card, Line, Tone } from './cards'
import { MARK, bar, frame, spark, tile } from './glyphs'
import type { Cmd, Turn } from './track'

export type Signal = 'bisect' | 'bench' | 'batch' | 'build'
export type Val = { kind: 'ratio'; v: number } | { kind: 'series'; v: number[] } | { kind: 'marks'; v: ('good' | 'bad' | 'live')[] } | { kind: 'window'; v: number } | { kind: 'text'; v: string; dim?: boolean; color?: string }
export type Sources = Record<string, Val>
export type Widget = { src: string; label?: string }
export type Recipe = { title: string; rows: Widget[][] }

const BUILD_MS = 60_000
const BISECT = /\bgit\s+bisect\b/
const PAIR = /\b(\d{1,9})\s*(?:\/|\bof\b)\s*(\d{2,9})\b/g
const MEASURE = /(\d+(?:\.\d+)?)\s*(ns|µs|us|ms|s|KB|MB|GB|ops\/s|req\/s|it\/s)\b/g
const HIGHER_IS_BETTER = new Set(['ops/s', 'req/s', 'it/s'])

// ---- reading outputs ----------------------------------------------------------------------------

// The last k-of-N pair in a text, if it looks like progress: N at least 10, k no more than N.
export function lastPair(text: string): { k: number; n: number } | null {
  let out: { k: number; n: number } | null = null
  for (const m of text.matchAll(PAIR)) {
    const k = Number(m[1])
    const n = Number(m[2])
    if (n >= 10 && k <= n) out = { k, n }
  }
  return out
}

// The number a benchmark run reports: the last value with a unit in its output.
export function lastMeasure(text: string): { v: number; unit: string } | null {
  let out: { v: number; unit: string } | null = null
  for (const m of text.matchAll(MEASURE)) out = { v: Number(m[1]), unit: m[2] ?? '' }
  return out
}

export const lastLine = (text: string) =>
  (text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n')
    .map(l => l.split('\r').pop() ?? '')
    .filter(l => l.trim())
    .pop() ?? '').trim()

// ---- the gate -------------------------------------------------------------------------------------

const ofTurn = (t: Turn) => t.cmds.filter(c => c.startedAt >= t.startedAt)
const benchRuns = (t: Turn) => {
  const by = new Map<string, Cmd[]>()
  for (const c of t.cmds) if (c.endedAt !== undefined && c.measure) by.set(c.cmd, [...(by.get(c.cmd) ?? []), c])
  return [...by.values()].filter(r => r.length >= 3 && r.some(c => c.startedAt >= t.startedAt)).sort((a, b) => (b.at(-1)?.startedAt ?? 0) - (a.at(-1)?.startedAt ?? 0))[0]
}
const longRun = (t: Turn, now: number) => {
  const c = ofTurn(t).filter(x => x.endedAt === undefined && now - x.startedAt > BUILD_MS).pop()
  return c && t.cmds.some(x => x.cmd === c.cmd && x.endedAt !== undefined) ? c : undefined
}

// Which measured property no template shows, most specific first; null = a template serves.
export function detect(t: Turn, now: number): Signal | null {
  if (ofTurn(t).some(c => BISECT.test(c.cmd))) return 'bisect'
  if (benchRuns(t)) return 'bench'
  // One k-of-N could be anything; a job's own output, or the same N seen twice, is progress.
  const last = t.samples[t.samples.length - 1]
  if (last && (t.job || t.samples.filter(x => x.n === last.n).length >= 2)) return 'batch'
  if (longRun(t, now)) return 'build'
  return null
}

// ---- sources: every value a recipe may show, measured ----------------------------------------------

const secs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}
const T = (v: string, o: Partial<Extract<Val, { kind: 'text' }>> = {}): Val => ({ kind: 'text', v, ...o })
const fmt = (v: number, unit: string) => `${Number.isInteger(v) ? v : v.toFixed(v < 10 ? 2 : 1)}${unit}`

export function sources(t: Turn, signal: Signal, now: number): Sources {
  switch (signal) {
    case 'batch': {
      const last = t.samples[t.samples.length - 1] ?? { k: 0, n: 1, at: now }
      const first = t.samples.find(x => x.n === last.n) ?? last
      const perMin = last.at > first.at ? ((last.k - first.k) / (last.at - first.at)) * 60_000 : 0
      const out: Sources = { progress: { kind: 'ratio', v: last.k / last.n }, percent: T(`${Math.round((last.k / last.n) * 100)}%`), done: T(String(last.k)), total: T(String(last.n)), elapsed: T(secs(now - (t.job?.startedAt ?? first.at)), { dim: true }) }
      if (perMin > 0) {
        out.rate = T(`${perMin >= 10 ? Math.round(perMin) : perMin.toFixed(1)}/min`, { dim: true })
        out.eta = T(secs(((last.n - last.k) / perMin) * 60_000), { dim: true })
      }
      if (t.job?.lastline) out.lastline = T(t.job.lastline, { dim: true })
      return out
    }
    case 'bench': {
      const runs = benchRuns(t) ?? []
      const vals = runs.map(c => c.measure!.v)
      const unit = runs[0]?.measure?.unit ?? ''
      const first = vals[0] ?? 0
      const last = vals[vals.length - 1] ?? 0
      const higher = HIGHER_IS_BETTER.has(unit)
      const bestV = higher ? Math.max(...vals) : Math.min(...vals)
      const delta = first ? Math.round(((last - first) / first) * 100) : 0
      const better = higher ? delta > 0 : delta < 0
      const out: Sources = { series: { kind: 'series', v: vals }, first: T(fmt(first, unit)), last: T(fmt(last, unit)), trend: T(`${fmt(first, unit)} → ${fmt(last, unit)}`), change: T(`${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)}%`, { color: delta ? (better ? 'green' : 'red') : undefined }), best: T(`${fmt(bestV, unit)} (run ${vals.indexOf(bestV) + 1})`, { dim: true }), runs: T(String(vals.length)) }
      const goal = t.prompt.match(/\b(?:under|below|less than|<)\s*(\d+(?:\.\d+)?)\s*(ns|µs|us|ms|s|KB|MB|GB)\b/i)
      if (goal && goal[2] === unit) out.target = T(`under ${goal[1]}${unit}${last < Number(goal[1]) ? ' ✓' : ''}`, { color: last < Number(goal[1]) ? 'green' : undefined })
      return out
    }
    case 'bisect': {
      const cmds = ofTurn(t).filter(c => BISECT.test(c.cmd))
      const marks: ('good' | 'bad' | 'live')[] = []
      for (const c of cmds) {
        const m = c.cmd.match(/\bgit\s+bisect\s+(good|bad|old|new)\b/)
        if (m) marks.push(m[1] === 'good' || m[1] === 'old' ? 'good' : 'bad')
      }
      const text = cmds.map(c => c.text ?? '').join('\n')
      const lefts = [...text.matchAll(/Bisecting: (\d+) revisions? left to test after this \(roughly (\d+) steps?\)/g)]
      const left = lefts[lefts.length - 1]
      const start = Number(lefts[0]?.[1] ?? 0)
      const at = [...text.matchAll(/^\[([0-9a-f]{7,40})\] (.+)$/gm)].pop()
      const found = text.match(/^([0-9a-f]{7,40}) is the first bad commit/m)
      const out: Sources = { marks: { kind: 'marks', v: cmds.some(c => c.endedAt === undefined) ? [...marks, 'live'] : marks }, steps: T(String(marks.length)) }
      if (left) Object.assign(out, { left: T(`${left[1]} commits`), remaining: T(`~${left[2]} steps`, { dim: true }) })
      if (at && !found) Object.assign(out, { commit: T((at[1] ?? '').slice(0, 7), { dim: true }), subject: T(`"${at[2]}"`) })
      if (left && start && !found) Object.assign(out, { range: { kind: 'window', v: Number(left[1]) / start }, span: T(`${left[1]} of ${start}`, { color: 'cyan' }) })
      if (found) out.found = T(`first bad: ${(found[1] ?? '').slice(0, 7)} ✓`, { color: 'green' })
      return out
    }
    case 'build': {
      const c = longRun(t, now) ?? ofTurn(t).filter(x => x.startedAt).pop()!
      const prev = t.cmds.filter(x => x.cmd === c.cmd && x.endedAt !== undefined && x !== c).pop()
      const took = (c.endedAt ?? now) - c.startedAt
      const was = prev ? (prev.endedAt ?? 0) - prev.startedAt : 0
      const out: Sources = { elapsed: T(secs(took)), command: T(c.cmd.split(/\s+/).slice(0, 3).join(' ')) }
      if (was > 0) Object.assign(out, { progress: { kind: 'ratio', v: Math.min(1, took / was) }, previous: T(secs(was), { dim: true }), versus: T(`${secs(took)} of ~${secs(was)}`) })
      const line = c.endedAt === undefined ? t.job?.lastline : c.text ? lastLine(c.text) : undefined
      if (line) out.lastline = T(line, { dim: true })
      return out
    }
  }
}

// What each source means, for the recipe writer.
export const SOURCE_DOCS: Record<Signal, Record<string, string>> = {
  batch: { progress: 'bar: items done of total', percent: 'percent done', done: 'items done', total: 'items in all', rate: 'items per minute', eta: 'time left at the current rate', elapsed: 'time since the job started', lastline: 'latest line the job printed' },
  bench: { series: 'sparkline: the measured value per run', first: 'first run value', last: 'latest run value', trend: 'first → latest value', change: 'change first → latest, colored good/bad', best: 'best value and its run', runs: 'how many runs', target: 'the goal the person stated, ✓ once met' },
  bisect: { marks: 'one mark per step: good, bad, testing now', steps: 'steps taken', left: 'commits left to test', remaining: 'steps left, roughly', range: 'window bar: commits left against those left at the first step', span: 'commits left of those left at the first step, in numbers', commit: 'commit under test', subject: 'its subject line', found: 'the first bad commit, once found' },
  build: { progress: 'bar: elapsed against the last run of the same command', elapsed: 'time this run has taken', previous: 'how long the last run took', versus: 'elapsed of the last run\'s time', command: 'the command', lastline: 'latest line it printed' },
}

// The mockup recipes the person kept (round 5): shown at once, and whenever a written one fails the check.
export const DEFAULTS: Record<Signal, Recipe> = {
  batch: { title: 'batch · {done} of {total}', rows: [[{ src: 'progress' }, { src: 'percent' }, { src: 'eta', label: 'ETA' }], [{ src: 'rate' }, { src: 'elapsed', label: 'started' }], [{ src: 'lastline', label: 'last:' }]] },
  bench: { title: 'bench · run {runs}', rows: [[{ src: 'series' }, { src: 'trend' }, { src: 'change' }], [{ src: 'best', label: 'best' }], [{ src: 'target', label: 'your target:' }]] },
  bisect: { title: 'bisect · step {steps}', rows: [[{ src: 'marks' }, { src: 'left' }, { src: 'remaining' }], [{ src: 'commit', label: 'testing' }, { src: 'subject' }], [{ src: 'range' }, { src: 'span' }, { src: 'found' }]] },
  build: { title: 'build · {command}', rows: [[{ src: 'progress' }, { src: 'versus' }], [{ src: 'previous', label: 'last run took' }], [{ src: 'lastline', label: 'last:' }]] },
}

// ---- checking and drawing -------------------------------------------------------------------------

// A written recipe is kept only if it is a recipe over this signal's sources, within the card's room,
// with no number typed into its title (one would freeze there) and every value the kept layout shows
// that is measured now (`measured`; all of them when not given).
export function checkRecipe(raw: unknown, signal: Signal, measured?: readonly string[]): Recipe | null {
  const known = SOURCE_DOCS[signal]
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { title?: unknown; rows?: unknown }
  if (typeof r.title !== 'string' || r.title.length > 40 || !Array.isArray(r.rows) || !r.rows.length || r.rows.length > 3) return null
  for (const name of r.title.matchAll(/\{(\w+)\}/g)) if (!(name[1]! in known)) return null
  const rows: Widget[][] = []
  for (const row of r.rows) {
    if (!Array.isArray(row) || !row.length || row.length > 4) return null
    const out: Widget[] = []
    for (const w of row as { src?: unknown; label?: unknown }[]) {
      if (!w || typeof w.src !== 'string' || !(w.src in known)) return null
      if (w.label !== undefined && (typeof w.label !== 'string' || w.label.length > 14 || /\n/.test(w.label))) return null
      out.push(w.label ? { src: w.src, label: w.label } : { src: w.src })
    }
    rows.push(out)
  }
  if (/\d/.test(r.title.replace(/\{\w+\}/g, ''))) return null
  const used = new Set([...rows.flat().map(w => w.src), ...[...r.title.matchAll(/\{(\w+)\}/g)].map(m => m[1])])
  if (DEFAULTS[signal].rows.flat().some(w => !used.has(w.src) && (!measured || measured.includes(w.src)))) return null
  return { title: r.title, rows }
}

const BAR = 12

// f: the animation frame (whole seconds); a mark under test blinks at the tick.
function widget(v: Val, f: number): Line {
  switch (v.kind) {
    case 'ratio':
      return bar(v.v, BAR, 'cyan')
    case 'series':
      return [spark(v.v.slice(-12))]
    case 'marks':
      return v.v.flatMap((m, i) => [...(i ? [{ t: ' ' }] : []), m === 'good' ? tile(MARK.ok, 'green') : m === 'bad' ? tile(MARK.fail, 'red') : { t: f % 2 ? '▓' : '▒', color: 'cyan' }])
    case 'window': {
      // What is left, as a lit stretch in the middle of the range it started from.
      const lit = Math.max(1, Math.round(Math.max(0, Math.min(1, v.v)) * BAR))
      const before = Math.floor((BAR - lit) / 2)
      return [{ t: '░'.repeat(before), dim: true }, { t: '█'.repeat(lit), color: 'cyan' }, { t: '░'.repeat(BAR - lit - before), dim: true }]
    }
    case 'text':
      return [{ t: v.v, dim: v.dim, color: v.color }]
  }
}

const tone = (signal: Signal, src: Sources, t: Turn): Tone => {
  if (signal === 'bisect') return src.found ? 'ok' : 'live'
  if (signal === 'batch') return (src.progress as { v: number } | undefined)?.v === 1 ? 'ok' : 'live'
  if (signal === 'build') return t.running.size ? 'live' : 'quiet'
  const c = src.change as { color?: string } | undefined
  return c?.color === 'green' ? 'ok' : 'quiet'
}

// A widget whose source is not measured yet is left out; a row left empty stays empty.
export function customCard(t: Turn, signal: Signal, recipe: Recipe, now: number): Card {
  const src = sources(t, signal, now)
  const text = (name: string) => {
    const v = src[name]
    return v?.kind === 'text' ? v.v : v?.kind === 'ratio' ? `${Math.round(v.v * 100)}%` : ''
  }
  const lines = recipe.rows.map(row => {
    const line: Line = []
    let prev: Val['kind'] | null = null
    for (const w of row) {
      const v = src[w.src]
      if (!v) continue
      // Two values in words read as a list (·); after a bar, sparkline or marks a space is enough.
      if (prev) line.push({ t: prev === 'text' && v.kind === 'text' ? ' · ' : ' ', dim: true })
      prev = v.kind
      if (w.label) line.push({ t: w.label + ' ', dim: true })
      line.push(...widget(v, frame(now)))
    }
    return line
  })
  return { title: recipe.title.replace(/\{(\w+)\}/g, (_, n: string) => text(n)).replace(/\s*·\s*$/, ''), tone: tone(signal, src, t), lines }
}

// ---- the recipe writer's brief --------------------------------------------------------------------

export const WRITER =
  'You lay out one small status card for a person watching a coding agent work. Reply with JSON only, no prose: ' +
  '{"title": string of at most 28 characters (may hold {source} placeholders), "rows": 1 to 3 rows, each a list of 1 to 4 ' +
  '{"src": source name, "label"?: at most 12 characters}}. Use only the sources listed. Answer at a glance: how far along, ' +
  'how it is going, what is happening now. Start from the kept layout and change only what this task needs: its words, ' +
  'or a value that matters more here; keep every value it shows. Numbers in the title only as {placeholders}. A label says what a value means to a person ("left", "ETA"); never repeat a source ' +
  'name as a label, and never label a bar, sparkline, window or marks. Keep the number that matters most in the title. ' +
  'Follow every rule from the person below.'

export function writerPrompt(t: Turn, signal: Signal, now: number, rules: string[]): string {
  const src = sources(t, signal, now)
  const list = Object.entries(SOURCE_DOCS[signal]).map(([name, doc]) => {
    const v = src[name]
    const shown = !v ? 'not measured yet' : v.kind === 'text' ? v.v : v.kind === 'ratio' ? `${Math.round(v.v * 100)}%` : JSON.stringify(v.v).slice(0, 60)
    return `- ${name}: ${doc} (now: ${shown})`
  })
  return [`The person asked: ${t.prompt.replace(/\s+/g, ' ').slice(0, 300)}`, `What is happening: ${signal}`, 'Sources:', ...list, `Kept layout: ${JSON.stringify(DEFAULTS[signal])}`, 'Rules from the person:', ...rules.map(r => `- ${r}`)].join('\n')
}

// The first JSON object in a reply.
export function parseRecipe(text: string, signal: Signal, measured?: readonly string[]): Recipe | null {
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    return checkRecipe(JSON.parse(text.slice(a, b + 1)), signal, measured)
  } catch {
    return null
  }
}
