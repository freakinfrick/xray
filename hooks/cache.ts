// Round 18: the prompt cache's countdown. The cache ages only while nobody talks, so it shows between
// turns: the strip above the prompt, one toast before it lapses, and a per-turn table in /xray.
// The mod's usage has no 5m/1h split; the session's transcript does, so the lifetime is read from there.

import type { Line } from './cards'
import { bar } from './glyphs'

export type Ttl = '5m' | '1h'
// One row per turn, from the turn's first request: the one that finds the cache warm or cold.
export type CacheRow = { read: number; wrote: number; fresh: number; why?: string }
// anchor: when the last main-loop request started (the docs count the lifetime from there; every read
// or write refreshes it). size: that request's whole prompt plus its answer, what a lapse rewrites.
export type Cache = { ttl: Ttl | null; anchor: number; size: number; model: string; rows: CacheRow[]; turns: number; toastedAt: number }
export type CacheRequest = { startedAt: number; input: number; cacheRead: number; cacheWrite: number; output: number; model: string }

export const TTL_MS: Record<Ttl, number> = { '5m': 300_000, '1h': 3_600_000 }
export const WARN_MS: Record<Ttl, number> = { '5m': 60_000, '1h': 300_000 }
const SECONDS_UNDER = 300_000 // m:ss in the last five minutes, whole minutes before that
const TOAST_MIN_TOKENS = 20_000
const MAX_ROWS = 50
const MISS = 0.5 // under half the prompt read from cache = a miss worth a reason

// anchor -1: no request yet this session.
export const emptyCache = (): Cache => ({ ttl: null, anchor: -1, size: 0, model: '', rows: [], turns: 0, toastedAt: -1 })

// Where Claude Code keeps this session: every character of the cwd outside [A-Za-z0-9] becomes '-'.
export function transcriptPath(configDir: string, cwd: string, sessionId: string): string {
  return `${configDir}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${sessionId}.jsonl`
}

// The lifetime of the newest main-thread write in a transcript's tail; null when the tail shows none.
export function ttlFromTail(tail: string): Ttl | null {
  const lines = tail.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i] ?? ''
    if (!l.includes('"ephemeral_') || l.includes('"isSidechain":true')) continue
    const h = /"ephemeral_1h_input_tokens":(\d+)/.exec(l)
    const m = /"ephemeral_5m_input_tokens":(\d+)/.exec(l)
    if (Number(h?.[1] ?? 0) > 0) return '1h'
    if (Number(m?.[1] ?? 0) > 0) return '5m'
  }
  return null
}

const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const idle = (ms: number) => (ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m` : `${Math.round(ms / 60_000)}m`)

// Each main-loop request moves the anchor; a turn's first one also files its row, with why it missed.
export function noteRequest(c: Cache, r: CacheRequest, isFirstOfTurn: boolean): Cache {
  const sent = r.input + r.cacheRead + r.cacheWrite
  let rows = c.rows
  let turns = c.turns
  if (isFirstOfTurn) {
    let why: string | undefined
    if (sent && r.cacheRead / sent < MISS) {
      if (c.anchor < 0) why = 'new session'
      else if (c.model && r.model && c.model !== r.model) why = `model ${c.model} → ${r.model}`
      else if (c.ttl && r.startedAt - c.anchor > TTL_MS[c.ttl]) why = `lapsed · idle ${idle(r.startedAt - c.anchor)}`
      else why = 'prefix changed'
    }
    rows = [...c.rows, { read: r.cacheRead, wrote: r.cacheWrite, fresh: r.input, ...(why ? { why } : {}) }].slice(-MAX_ROWS)
    turns = c.turns + 1
  }
  return { ...c, anchor: r.startedAt, size: sent + r.output, model: r.model || c.model, rows, turns }
}

// Time left on the cache, or null when there is nothing to count (no request yet, lifetime unknown).
export function cacheLeft(c: Cache, now: number): number | null {
  if (!c.ttl || c.anchor < 0) return null
  return Math.max(0, c.anchor + TTL_MS[c.ttl] - now)
}

function remaining(ms: number): string {
  if (ms >= SECONDS_UNDER) return `${Math.ceil(ms / 60_000)}m`
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// The strip's figure (pick 1b, words; pick 2b, the phone always shows it). Lapsed = a red tile drawn as an
// explicit background with black text: Termius misdraws reverse video (capture 7).
export function cacheStrip(c: Cache, now: number, isPhone: boolean): Line {
  const left = cacheLeft(c, now)
  if (left === null || !c.ttl) return []
  if (left === 0)
    return isPhone
      ? [{ t: ' ' }, { t: ` lapsed ${kilo(c.size)} `, bg: 'red', color: 'black' }]
      : [{ t: '  ' }, { t: ' cache lapsed ', bg: 'red', color: 'black' }, { t: ` next message rewrites ${kilo(c.size)}`, color: 'red' }]
  const isWarn = left <= WARN_MS[c.ttl]
  const color = isWarn ? 'yellow' : undefined
  if (isPhone) return [{ t: ` ⏱${remaining(left)}`, color, dim: !isWarn }]
  return [{ t: '  cache ', dim: true }, { t: `${remaining(left)} left`, color }, ...(c.ttl === '5m' ? [{ t: ' (5 min)', dim: true }] : [])]
}

// When the strip's text next changes: each minute boundary, every second in the last five minutes,
// and the warning edge (the toast). Null once lapsed: nothing moves until the next message.
export function nextChange(c: Cache, now: number): number | null {
  const left = cacheLeft(c, now)
  if (left === null || left === 0 || !c.ttl) return null
  if (left <= SECONDS_UNDER) return (left % 1000) || 1000
  const toMinute = (left % 60_000) || 60_000
  const toWarn = left - WARN_MS[c.ttl]
  return Math.min(toMinute, toWarn > 0 ? toWarn : toMinute)
}

// One toast per cache entry, at the warning edge, only for a prompt big enough to matter.
export function isToastDue(c: Cache, now: number): boolean {
  const left = cacheLeft(c, now)
  return left !== null && !!c.ttl && left > 0 && left <= WARN_MS[c.ttl] && c.size >= TOAST_MIN_TOKENS && c.toastedAt !== c.anchor
}

export function toastText(c: Cache, now: number): string {
  const left = cacheLeft(c, now) ?? 0
  return `cache lapses in ${left >= 60_000 ? `${Math.round(left / 60_000)} min` : `${Math.ceil(left / 1000)} s`} · after that the next message rewrites ${kilo(c.size)}`
}

// The /xray panel's table: one row per turn, newest first.
export function cacheRows(c: Cache, now: number, max: number, cols: number): { title: string; rows: Line[] } | null {
  if (!c.rows.length) return null
  const left = cacheLeft(c, now)
  const title = `cache${c.ttl ? ` · ${c.ttl}` : ''}${left === null ? (c.ttl ? '' : ' · lifetime unknown') : left ? ` · ${remaining(left)} left` : ' · lapsed'}`
  const first = c.turns - c.rows.length + 1
  const shown = c.rows.slice(-max)
  const head: Line = [{ t: 'turn  read  hit       %   wrote   new', dim: true }]
  const body = shown.map((r, i): Line => {
    const sent = r.read + r.wrote + r.fresh
    const hit = sent ? r.read / sent : 0
    const color = r.why ? (r.why.startsWith('lapsed') ? 'red' : 'yellow') : 'cyan'
    const row: Line = [
      { t: `#${String(first + c.rows.length - shown.length + i)}`.padEnd(4), dim: true },
      { t: kilo(r.read).padStart(5) + ' ' },
      ...bar(hit, 8, color),
      { t: `${Math.round(hit * 100)}%`.padStart(5), color: r.why ? color : undefined },
      { t: kilo(r.wrote).padStart(7) },
      { t: kilo(r.fresh).padStart(6), dim: true },
    ]
    const w = row.reduce((n, g) => n + g.t.length, 0)
    return r.why && w + 2 + r.why.length <= cols ? [...row, { t: `  ${r.why}`, color }] : row
  })
  const missed = c.rows.filter(r => r.why && r.why !== 'new session')
  const rewritten = missed.reduce((n, r) => n + r.wrote, 0)
  const foot: Line = [{ t: `${c.turns} turn${c.turns === 1 ? "" : "s"} · ${missed.length} missed${missed.length ? ` · ${kilo(rewritten)} rewritten` : ''}`, dim: true }]
  return { title, rows: [head, ...body.reverse(), foot] }
}
