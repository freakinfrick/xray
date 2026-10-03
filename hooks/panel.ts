// The /xray panel as plain data: the detail the spinner leaves out. Every row is measured.

import type { Line } from './cards'
import { bar, tile } from './glyphs'
import type { Entry } from './ledger'
import { openTodos, type Request, type Step, type Turn } from './track'

export type Usage = { context: { tokens?: number; window: number; percent?: number }; cost?: { usd: number }; rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] }
export type Section = { title: string; rows: Line[] }

const MAX_REQUESTS = 6
const MAX_STEPS = 6
const MAX_OWED = 8
const BAR = 20
const STEP_TEXT = 36
// Under these the panel compacts: a phone is 47 × 42, about 21 rows with the keyboard up.
const NARROW = 60
const SHORT = 30

// What the pane measured: text columns inside the padding, and rows. Unmeasured = roomy.
export type Size = { cols?: number; rows?: number }

const width = (l: Line) => l.reduce((n, g) => n + g.t.length, 0)
// A row's core always shows; its extras follow only while the row still fits.
function fit(core: Line, extras: Line[], cols: number): Line {
  const out = [...core]
  for (const x of extras) {
    if (width(out) + width(x) > cols) break
    out.push(...x)
  }
  return out
}
const GAUGE = 12

// Tenths under 10 s, whole seconds to a minute, then 2m 01s like the cards (fits the 6-cell column).
const secs = (ms: number) => {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))
const when = (iso: string) => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? iso : new Date(ms).toTimeString().slice(0, 5)
}
const pctColor = (p: number) => (p >= 90 ? 'red' : p >= 70 ? 'yellow' : 'green')

const gauge = (percent: number): Line => bar(percent / 100, GAUGE, pctColor(percent))

// Each request as a bar: waiting for the first piece (dim ▒), then generating (cyan, to the eighth of
// a cell), on one time scale.
function requestRow(r: Request, n: number, longest: number, cols: number): Line {
  // #n (4) + bar + space + secs (6) + "  12k out" (9): the bar takes what the width leaves.
  const cells = Math.max(8, Math.min(BAR, cols - 20))
  const total = r.endedAt - r.startedAt
  const wait = Math.round(((r.firstAt - r.startedAt) / longest) * cells)
  const genAt = Math.min(cells - wait, Math.max(1 / 8, ((r.endedAt - r.firstAt) / longest) * cells))
  const gen = Math.max(1, Math.ceil(genAt))
  const sent = r.input + r.cacheRead + r.cacheWrite
  const rate = r.endedAt > r.firstAt ? Math.round(r.output / ((r.endedAt - r.firstAt) / 1000)) : 0
  const core: Line = [
    { t: `#${String(n).padEnd(3)}`, dim: true },
    { t: '▒'.repeat(wait), dim: true },
    ...bar(genAt / gen, gen, 'cyan'),
    { t: ' '.repeat(Math.max(0, cells - wait - gen) + 1) },
    { t: secs(total).padStart(6) },
    { t: `  ${kilo(r.output)} out`, dim: true },
  ]
  const extras: Line[] = [
    ...(rate ? [[{ t: ` · ${rate} tok/s`, dim: true }]] : []),
    ...(sent ? [[{ t: ` · cache ${Math.round((r.cacheRead / sent) * 100)}%`, dim: true }]] : []),
  ]
  return fit(core, extras, cols)
}

function stepRow(s: Step, now: number, cols: number): Line {
  const mark = s.endedAt === undefined ? tile(' ◆ ', 'cyan') : s.ok === false ? tile(' ✗ ', 'red') : tile(' ✓ ', 'green')
  // mark (3) + space + text + secs (7)
  const n = Math.max(12, Math.min(STEP_TEXT, cols - 11))
  return [mark, { t: ' ' }, { t: (s.say.length > n ? s.say.slice(0, n - 1) + '…' : s.say).padEnd(n) }, { t: secs((s.endedAt ?? now) - s.startedAt).padStart(7), dim: true }]
}

export function panel(t: Turn | null, usage: Usage | null, now: number, ledger: readonly Entry[] = [], size: Size = {}): Section[] {
  const out: Section[] = []
  // At NARROW and wider the panel draws exactly as before; the Text rows truncate any overflow.
  const cols = size.cols !== undefined && size.cols < NARROW ? size.cols : Infinity
  const isShort = (size.rows ?? Infinity) < SHORT
  const maxRequests = isShort ? 3 : MAX_REQUESTS
  const maxSteps = isShort ? 3 : MAX_STEPS
  const maxOwed = isShort ? 4 : MAX_OWED
  if (t?.signal)
    out.push({ title: 'task card', rows: [[{ t: `${t.signal} · ` }, t.recipe ? { t: 'layout written for this task', color: 'cyan' } : { t: t.isRecipeAsked ? 'kept layout (the written one did not pass)' : 'kept layout', dim: true }], [{ t: '/xray rate good|bad <note> files it in the taste ledger', dim: true }]] })
  if (t) {
    const reqs = t.requests.slice(-maxRequests)
    const longest = Math.max(1, ...reqs.map(r => r.endedAt - r.startedAt))
    const first = t.requests.length - reqs.length + 1
    out.push({ title: `requests · ${t.requests.length}`, rows: reqs.length ? reqs.map((r, i) => requestRow(r, first + i, longest, cols)) : [[{ t: 'none finished yet', dim: true }]] })
    const steps = [...t.done, ...[...t.running.values()].sort((a, b) => a.startedAt - b.startedAt)].slice(-maxSteps)
    const failed = t.done.filter(s => s.ok === false).length
    out.push({ title: `steps · ${t.done.length} done${failed ? ` · ${failed} failed` : ''}`, rows: steps.length ? steps.map(s => stepRow(s, now, cols)) : [[{ t: 'no tool calls yet', dim: true }]] })
    // The idle strip drops this on a phone, so the panel is where the owed list always is.
    if (t.todos.length) {
      const owed = openTodos(t)
      out.push({
        title: `still owed · ${owed.length}`,
        rows: owed.length
          ? owed.slice(0, maxOwed).map(x => [{ t: x.status === 'in_progress' ? '◆ ' : '· ', color: x.color ?? 'cyan' }, { t: x.text }])
          : [[{ t: 'nothing ✓', color: 'green' }]],
      })
    }
  }
  if (usage) {
    const rows: Line[] = []
    const p = usage.context.percent
    if (p !== undefined) rows.push(fit([{ t: 'context'.padEnd(10), dim: true }, ...gauge(p), { t: ` ${Math.round(p)}%` }], usage.context.tokens ? [[{ t: ` · ${kilo(usage.context.tokens)} of ${kilo(usage.context.window)}`, dim: true }]] : [], cols))
    for (const l of usage.rateLimits) rows.push(fit([{ t: l.kind.slice(0, 9).padEnd(10), dim: true }, ...gauge(l.percentUsed), { t: ` ${Math.round(l.percentUsed)}%` }], l.resetsAt ? [[{ t: ` · resets ${when(l.resetsAt)}`, dim: true }]] : [], cols))
    if (usage.cost) rows.push([{ t: 'spent'.padEnd(10), dim: true }, { t: `$${usage.cost.usd.toFixed(2)}` }, { t: ' this session', dim: true }])
    if (rows.length) out.push({ title: 'session', rows })
  }
  if (ledger.length)
    out.push({
      title: `taste ledger · ${ledger.length}`,
      rows: ledger.slice(isShort ? -1 : -3).map(e => [{ t: e.verdict === 'good' ? '+ ' : '− ', color: e.verdict === 'good' ? 'green' : 'red' }, { t: e.signal ? `${e.signal} card` : 'cards' }, { t: e.note ? ` · ${e.note}` : '', dim: true }]),
    })
  if (!out.length) out.push({ title: 'xray', rows: [[{ t: 'nothing measured yet: send a prompt', dim: true }]] })
  return out
}
