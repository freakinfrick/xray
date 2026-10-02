// The /xray panel as plain data: the detail the spinner leaves out. Every row is measured.

import type { Line } from './cards'
import type { Entry } from './ledger'
import type { Request, Step, Turn } from './track'

export type Usage = { context: { tokens?: number; window: number; percent?: number }; cost?: { usd: number }; rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] }
export type Section = { title: string; rows: Line[] }

const MAX_REQUESTS = 8
const MAX_STEPS = 8
const BAR = 20
const GAUGE = 12

const secs = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`)
const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))
const when = (iso: string) => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? iso : new Date(ms).toTimeString().slice(0, 5)
}
const pctColor = (p: number) => (p >= 90 ? 'red' : p >= 70 ? 'yellow' : 'green')

function gauge(percent: number): Line {
  const on = Math.max(0, Math.min(GAUGE, Math.round((percent / 100) * GAUGE)))
  return [{ t: '█'.repeat(on), color: pctColor(percent) }, { t: '░'.repeat(GAUGE - on), dim: true }]
}

// Each request as a bar: waiting for the first piece (dim), then generating (cyan), on one time scale.
function requestRow(r: Request, n: number, longest: number): Line {
  const total = r.endedAt - r.startedAt
  const wait = Math.round(((r.firstAt - r.startedAt) / longest) * BAR)
  const gen = Math.max(1, Math.round(((r.endedAt - r.firstAt) / longest) * BAR))
  const sent = r.input + r.cacheRead + r.cacheWrite
  const rate = r.endedAt > r.firstAt ? Math.round(r.output / ((r.endedAt - r.firstAt) / 1000)) : 0
  return [
    { t: `#${String(n).padEnd(3)}`, dim: true },
    { t: '░'.repeat(wait), dim: true },
    { t: '█'.repeat(gen), color: 'cyan' },
    { t: ' '.repeat(Math.max(0, BAR - wait - gen) + 1) },
    { t: secs(total).padStart(6) },
    { t: `  ${kilo(r.output)} out`, dim: true },
    ...(rate ? [{ t: ` · ${rate} tok/s`, dim: true }] : []),
    ...(sent ? [{ t: ` · cache ${Math.round((r.cacheRead / sent) * 100)}%`, dim: true }] : []),
  ]
}

function stepRow(s: Step, now: number): Line {
  const mark: Line[number] = s.endedAt === undefined ? { t: '◆ ', color: 'cyan' } : s.ok === false ? { t: '✗ ', color: 'red' } : { t: '✓ ', color: 'green' }
  return [mark, { t: (s.say.length > 36 ? s.say.slice(0, 35) + '…' : s.say).padEnd(36) }, { t: secs((s.endedAt ?? now) - s.startedAt).padStart(7), dim: true }]
}

export function panel(t: Turn | null, usage: Usage | null, now: number, ledger: readonly Entry[] = []): Section[] {
  const out: Section[] = []
  if (t) {
    const reqs = t.requests.slice(-MAX_REQUESTS)
    const longest = Math.max(1, ...reqs.map(r => r.endedAt - r.startedAt))
    const first = t.requests.length - reqs.length + 1
    out.push({ title: `requests · ${t.requests.length}`, rows: reqs.length ? reqs.map((r, i) => requestRow(r, first + i, longest)) : [[{ t: 'none finished yet', dim: true }]] })
    const steps = [...t.done, ...[...t.running.values()].sort((a, b) => a.startedAt - b.startedAt)].slice(-MAX_STEPS)
    const failed = t.done.filter(s => s.ok === false).length
    out.push({ title: `steps · ${t.done.length} done${failed ? ` · ${failed} failed` : ''}`, rows: steps.length ? steps.map(s => stepRow(s, now)) : [[{ t: 'no tool calls yet', dim: true }]] })
  }
  if (usage) {
    const rows: Line[] = []
    const p = usage.context.percent
    if (p !== undefined) rows.push([{ t: 'context'.padEnd(10), dim: true }, ...gauge(p), { t: ` ${Math.round(p)}%` }, { t: usage.context.tokens ? ` · ${kilo(usage.context.tokens)} of ${kilo(usage.context.window)}` : '', dim: true }])
    for (const l of usage.rateLimits) rows.push([{ t: l.kind.slice(0, 9).padEnd(10), dim: true }, ...gauge(l.percentUsed), { t: ` ${Math.round(l.percentUsed)}%` }, { t: l.resetsAt ? ` · resets ${when(l.resetsAt)}` : '', dim: true }])
    if (usage.cost) rows.push([{ t: 'spent'.padEnd(10), dim: true }, { t: `$${usage.cost.usd.toFixed(2)}` }, { t: ' this session', dim: true }])
    if (rows.length) out.push({ title: 'session', rows })
  }
  if (ledger.length)
    out.push({
      title: `taste ledger · ${ledger.length}`,
      rows: ledger.slice(-3).map(e => [{ t: e.verdict === 'good' ? '+ ' : '− ', color: e.verdict === 'good' ? 'green' : 'red' }, { t: e.signal ? `${e.signal} card` : 'cards' }, { t: e.note ? ` · ${e.note}` : '', dim: true }]),
    })
  if (!out.length) out.push({ title: 'xray', rows: [[{ t: 'nothing measured yet: send a prompt', dim: true }]] })
  return out
}
