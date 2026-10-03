// What xray remembers about a project between sessions (round 16, direction 4): one event per finished
// test run, the last MAX kept per project in the plugin store. It stays on this machine. Pure: the
// register reads and writes the store; this file only turns turns into events and events into words.

import type { Turn } from './track'

export type Event = { at: number; cmd: string; ms: number; failing: string[]; ok: boolean }
export const MAX = 50
export const storeKey = (cwd: string) => `history:${cwd}`

// The finished, counted test runs of a turn as events, appended and capped.
export function record(h: Event[], t: Turn): Event[] {
  const out = [...h]
  for (const r of t.runs) {
    if (r.running || r.isStopped) continue
    const c = t.cmds.find(x => x.startedAt === r.startedAt && x.endedAt !== undefined)
    if (!c || c.endedAt === undefined) continue
    out.push({ at: r.startedAt, cmd: c.cmd, ms: c.endedAt - c.startedAt, failing: r.failing.slice(0, 8), ok: r.total ? r.fail === 0 : r.ok === true })
  }
  return out.slice(-MAX)
}

export const day = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

// Recalled facts about this turn, each one measured: the suite's time against its usual (two earlier
// runs of the same command at least), and failing tests seen failing here before this turn.
export function recall(h: Event[], t: Turn): string[] {
  const before = h.filter(e => e.at < t.startedAt)
  const out: string[] = []
  const now = record([], t)
  const last = now[now.length - 1]
  if (last) {
    const same = before.filter(e => e.cmd === last.cmd).map(e => e.ms)
    if (same.length >= 2) out.push(`suite ${secs(last.ms)}, usual ${secs(median(same))}`)
  }
  const failing = new Set(now.flatMap(e => e.failing))
  for (const name of failing) {
    const seen = before.filter(e => e.failing.includes(name))
    const prev = seen[seen.length - 1]
    if (prev) out.push(`${name} failed here before, ${day(prev.at)}`)
    if (out.length >= 3) break
  }
  return out
}
