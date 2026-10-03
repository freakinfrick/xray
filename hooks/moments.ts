// Round 20: the one tile slot. Celebrations, records, milestones and landmarks are all found when a turn
// ends; the highest-ranked one takes the slot on the idle strip, the rest still land in the genome's marks
// and the panel. Every moment is a measured fact. Pure: the register gathers the inputs.

import type { Line } from './cards'
import type { Mark } from './session'
import type { Run, Turn } from './track'

export type MomentKind = 'celebrate' | 'record' | 'milestone' | 'landmark'
export type Moment = { kind: MomentKind; text: string; fact?: string }

const RANK: Record<MomentKind, number> = { celebrate: 0, record: 1, milestone: 2, landmark: 3 }
const GLYPH: Record<MomentKind, string> = { celebrate: '✓', record: '★', milestone: '✦', landmark: '⚑' }
// Peach: the one hue the genome legend doesn't use, so the tile never reads as a step. Explicit background
// and black text (Termius misdraws reverse video, capture 7).
export const MOMENT_BG = '#d7875f'

// The interview's order: celebration > record > milestone > landmark; first found wins a tie.
export const pick = (ms: readonly Moment[]): Moment | undefined => [...ms].sort((a, b) => RANK[a.kind] - RANK[b.kind])[0]

export const tile = (m: Moment, withFact = true): Line => [
  { t: ` ${GLYPH[m.kind]} ${m.text} `, bg: MOMENT_BG, color: 'black' },
  ...(withFact && m.fact ? [{ t: ` ${m.fact}`, dim: true }] : []),
]

const MIN = 60_000
export const LONG_HAUL_MS = 10 * MIN
export const AWAY_MS = 60 * MIN
const SESSION_STEPS = [100, 500, 1000, 2000]
const FOLDER_EVERY = 1000

// 2h14, 35m: an elapsed time the way the strip says it.
export const span = (ms: number) => (ms >= 60 * MIN ? `${Math.floor(ms / (60 * MIN))}h${String(Math.floor((ms % (60 * MIN)) / MIN)).padStart(2, '0')}` : `${Math.max(1, Math.round(ms / MIN))}m`)
// The local calendar day, for "today" and "past midnight".
export const dayOf = (at: number) => new Date(at).toLocaleDateString('en-CA')

// Round 20f: once-each milestones of a finished turn. `before` counts are the steps before this turn.
export type MilestoneIn = {
  steps: number // this turn's genome steps
  sessionBefore: number
  folderBefore: number
  folderSince?: number // when this folder's count began (build day, no backfill)
  turnMs: number
  awayMs?: number // gap before this turn's prompt
  isAwayCold?: boolean // the cache had lapsed when it came
  prevEndedAt?: number // the previous turn of this session, for "past midnight"
  sessionStartedAt?: number
  isFirstGreenToday?: boolean // a counted run passed, after failing ones earlier today
  redsToday?: number
  now: number
}
export function milestones(i: MilestoneIn): Moment[] {
  const out: Moment[] = []
  const crossed = (before: number, n: number) => before < n && before + i.steps >= n
  for (const n of SESSION_STEPS) if (crossed(i.sessionBefore, n)) out.push({ kind: 'milestone', text: `${n}th step`, fact: 'this session' })
  const k = Math.floor((i.folderBefore + i.steps) / FOLDER_EVERY)
  if (k > Math.floor(i.folderBefore / FOLDER_EVERY)) out.push({ kind: 'milestone', text: `${k * FOLDER_EVERY}th step here`, fact: i.folderSince ? `since ${new Date(i.folderSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : undefined })
  if (i.isFirstGreenToday) out.push({ kind: 'milestone', text: 'first green today', fact: i.redsToday ? `after ${i.redsToday} red run${i.redsToday > 1 ? 's' : ''}` : undefined })
  if (i.turnMs >= LONG_HAUL_MS) out.push({ kind: 'milestone', text: 'long haul', fact: `${span(i.turnMs)} turn` })
  if (i.awayMs !== undefined && i.awayMs >= AWAY_MS) out.push({ kind: 'milestone', text: `back after ${span(i.awayMs)}`, fact: i.isAwayCold ? 'cache was cold' : undefined })
  if (i.prevEndedAt !== undefined && dayOf(i.prevEndedAt) !== dayOf(i.now)) out.push({ kind: 'milestone', text: 'past midnight', fact: i.sessionStartedAt ? `${span(i.now - i.sessionStartedAt)} in` : undefined })
  return out
}

// Round 20c needs the same "today" bookkeeping: a folder's counted runs per local day.
export type Day = { day: string; reds: number; isGreen: boolean }
export function noteRuns(d: Day | undefined, oks: readonly boolean[], now: number): { day: Day; isFirstGreen: boolean; reds: number } {
  const today = dayOf(now)
  let cur: Day = d && d.day === today ? { ...d } : { day: today, reds: 0, isGreen: false }
  let isFirstGreen = false
  let reds = 0
  for (const ok of oks) {
    if (!ok) cur = { ...cur, reds: cur.reds + 1 }
    else if (!cur.isGreen) {
      isFirstGreen = cur.reds > 0
      reds = cur.reds
      cur = { ...cur, isGreen: true }
    }
  }
  return { day: cur, isFirstGreen, reds }
}

// Round 20a: what a finished turn celebrates, in this order: tests back to green, a commit, the to-do
// list closed. Each is the turn's own record, not a guess.
export function celebrations(t: Turn): Moment[] {
  const out: Moment[] = []
  const runs = t.runs.filter(r => !r.running && !r.isStopped)
  const isRed = (r: Run) => (r.total ? r.fail > 0 : r.ok === false)
  const last = runs[runs.length - 1]
  const reds = runs.slice(0, -1).filter(isRed).length
  if (last && !isRed(last) && reds) out.push({ kind: 'celebrate', text: 'green', fact: `after ${reds} failing run${reds > 1 ? 's' : ''}` })
  const commit = t.done.findLast(x => x.kind === 'commit' && x.ok)
  if (commit) {
    const hash = commit.note?.match(/^[0-9a-f]{7,}\b/)?.[0]
    out.push({ kind: 'celebrate', text: hash ? `committed ${hash.slice(0, 7)}` : 'committed', fact: (hash ? commit.note?.slice(hash.length) : commit.note)?.trim().slice(0, 60) || undefined })
  }
  const n = t.todos.length
  if (n && t.todos.every(x => x.status === 'completed') && t.todos.some(x => x.doneAt !== undefined && x.doneAt >= t.startedAt)) out.push({ kind: 'celebrate', text: 'list done', fact: `${n} of ${n}` })
  return out
}

// Round 20b: a finished turn's landmarks on the genome, each at its step's index in the turn's letters
// (genome.code's order: steps as they ended, to-do bookkeeping left out). `tests` carries the session's
// test state across turns: green once means a later failing run is "red again".
export type Landmarks = { marks: Omit<Mark, 'turn'>[]; tests?: 'red' | 'green' }
export function landmarks(t: Turn, rec: { marks: readonly Mark[]; tests?: 'red' | 'green' }, ctx: number | null): Landmarks {
  const steps = t.done.filter(x => x.kind !== 'todo')
  const marks: Omit<Mark, 'turn'>[] = []
  let tests = rec.tests
  let isGreenSeen = rec.marks.some(m => m.kind === 'green')
  steps.forEach((x, at) => {
    if (x.kind === 'commit' && x.ok) marks.push({ at, kind: 'commit', text: x.note?.match(/^[0-9a-f]{7,}\b/)?.[0]?.slice(0, 7) ?? 'commit' })
    if (x.kind !== 'test') return
    const run = t.runs.find(r => r.startedAt === x.startedAt && !r.running && !r.isStopped)
    if (!run || !(run.total > 0 || run.ok !== undefined)) return
    const isRed = run.total ? run.fail > 0 : run.ok === false
    if (isRed && tests === 'green') marks.push({ at, kind: 'red', text: 'red again' })
    if (!isRed && tests === 'red' && !isGreenSeen) {
      marks.push({ at, kind: 'green', text: 'green' })
      isGreenSeen = true
    }
    tests = isRed ? 'red' : 'green'
  })
  const agents = steps.map((x, at) => ({ x, at })).filter(({ x }) => x.kind === 'agent')
  if (agents.length >= 2) marks.push({ at: agents[0]?.at ?? 0, kind: 'fanout', text: `${agents.length} agents` })
  const crossed = rec.marks.filter(m => m.kind === 'ctx').map(m => Number(m.text.match(/\d+/)?.[0] ?? 0))
  const edge = [70, 50].find(n => ctx !== null && ctx >= n && !crossed.some(c => c >= n))
  if (edge && steps.length) marks.push({ at: steps.length - 1, kind: 'ctx', text: `ctx ${edge}%` })
  return { marks, tests }
}

// How a landmark draws on the shared row (round 20b's glyphs: ink is plain or peach only; the genome's
// legend owns the other colours).
export const MARK_GLYPH: Record<Mark['kind'], string> = { commit: '⚑', green: '✓', red: '✕', fanout: '⋔', ctx: '▲', longest: '⧗' }
export const markLook = (k: Mark['kind']) => (k === 'commit' ? { color: MOMENT_BG } : { bold: true })

// The newest landmark of a turn as the slot's lowest-ranked moment (round 20b, b3).
export function landmarkMoment(marks: readonly Omit<Mark, 'turn'>[]): Moment | undefined {
  const m = marks[marks.length - 1]
  return m && m.kind !== 'commit' ? { kind: 'landmark', text: m.text } : undefined
}

// Round 20c: this folder's bests, kept in the store as `records:<cwd>` (counted from the day this shipped).
// A record speaks only when it actually falls, by the demo's thresholds: red → green needs 3 earlier
// fixes and strictly fewer steps; a streak speaks at 5, 10, 25, 50 and when one of 10+ ends; a suite's
// fastest run needs 5 earlier runs of that suite and a strictly lower time.
export type Records = { fix?: { best: number; at: number; n: number }; streak?: { cur: number; best: number; at: number }; fastest?: Record<string, { ms: number; at: number; n: number }> }
const STREAK_AT = [5, 10, 25, 50]
const FIX_AFTER = 3
const FAST_AFTER = 5
const MAX_SUITES = 12
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 0)} s`
const short = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function records(t: Turn, was: Records | undefined, suiteOf: (cmd: string) => string | undefined, now: number): { records: Records; moments: Moment[] } {
  const r: Records = { ...was, fastest: { ...was?.fastest } }
  const out: Moment[] = []
  const steps = t.done.filter(x => x.kind !== 'todo')
  const runs = t.runs.filter(x => !x.running && !x.isStopped && (x.total > 0 || x.ok !== undefined))
  const isRed = (x: Run) => (x.total ? x.fail > 0 : x.ok === false)
  // Fewest steps from the turn's first failing run to the run that passed after it.
  const red = runs.find(isRed)
  const green = red ? runs.find(x => x.startedAt > red.startedAt && !isRed(x)) : undefined
  if (red && green) {
    const from = steps.findIndex(x => x.startedAt === red.startedAt)
    const to = steps.findIndex(x => x.startedAt === green.startedAt)
    const n = to - from
    if (from >= 0 && n > 0) {
      const f = r.fix
      if (f && f.n >= FIX_AFTER && n < f.best) out.push({ kind: 'record', text: `red → green in ${n} steps`, fact: `best here, was ${f.best} on ${short(f.at)}` })
      r.fix = !f ? { best: n, at: now, n: 1 } : n < f.best ? { best: n, at: now, n: f.n + 1 } : { ...f, n: f.n + 1 }
    }
  }
  // The fastest run of each suite.
  for (const x of runs) {
    const c = t.cmds.find(y => y.startedAt === x.startedAt && y.endedAt !== undefined)
    const suite = c ? suiteOf(c.cmd) : undefined
    if (!c || c.endedAt === undefined || !suite || isRed(x)) continue
    const ms = c.endedAt - c.startedAt
    const p = r.fastest?.[suite]
    if (p && p.n >= FAST_AFTER && ms < p.ms) out.push({ kind: 'record', text: `fastest ${suite}`, fact: `${secs(ms)}, was ${secs(p.ms)}` })
    r.fastest = Object.fromEntries(Object.entries({ ...r.fastest, [suite]: !p ? { ms, at: now, n: 1 } : ms < p.ms ? { ms, at: now, n: p.n + 1 } : { ...p, n: p.n + 1 } }).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_SUITES))
  }
  // Passing runs in a row, across turns and sessions.
  let s = r.streak ?? { cur: 0, best: 0, at: now }
  for (const x of runs) {
    if (isRed(x)) {
      if (s.cur >= 10) out.push({ kind: 'record', text: `streak of ${s.cur} ends`, fact: `best ${s.best}` })
      s = { ...s, cur: 0 }
      continue
    }
    const cur = s.cur + 1
    s = { cur, best: Math.max(s.best, cur), at: cur > s.best ? now : s.at }
    if (STREAK_AT.includes(cur)) out.push({ kind: 'record', text: `green streak ${cur}`, fact: cur >= s.best ? 'best here' : `best ${s.best}` })
  }
  r.streak = s
  return { records: r, moments: out.slice(0, 1) }
}

// The /xray panel's records section (round 20c, c3): what stands, newest first.
export function recordRows(r: Records | undefined): Line[] {
  if (!r) return []
  const rows: Line[] = []
  if (r.fix) rows.push([{ t: 'red → green   ', dim: true }, { t: `fewest ${r.fix.best} steps` }, { t: ` · ${short(r.fix.at)} · ${r.fix.n} fixes`, dim: true }])
  if (r.streak && r.streak.best) rows.push([{ t: 'green streak  ', dim: true }, { t: `${r.streak.cur} now` }, { t: ` · best ${r.streak.best}`, dim: true }])
  for (const [suite, x] of Object.entries(r.fastest ?? {}).slice(0, 3)) rows.push([{ t: 'fastest       ', dim: true }, { t: `${suite} ${secs(x.ms)}` }, { t: ` · ${short(x.at)} · ${x.n} runs`, dim: true }])
  return rows
}
