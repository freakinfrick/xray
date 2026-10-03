// Round 20: the one tile slot. Celebrations, records, milestones and landmarks are all found when a turn
// ends; the highest-ranked one takes the slot on the idle strip, the rest still land in the genome's marks
// and the panel. Every moment is a measured fact. Pure: the register gathers the inputs.

import type { Line } from './cards'
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
