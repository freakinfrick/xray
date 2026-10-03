// The three cards and the between-turns line, as plain data. Colors are ANSI names, so they follow
// the terminal's own palette (herdr forest / forest-light); undefined = the terminal's default ink.

import type { LastTurn } from '../types'
import { DEFAULTS, customCard } from './custom'
import { MARK, SPARK, bar, frame, spark, tile } from './glyphs'
import { openTodos, runningAgents, type Run, type StepKind, type Todo, type Turn } from './track'

// inv: drawn inverse, the glyph in the terminal's background on `color` (a solid tile on both themes).
export type Seg = { t: string; color?: string; dim?: boolean; bold?: boolean; inv?: boolean; bg?: string; strike?: boolean }
export type Line = Seg[]
export type Tone = 'quiet' | 'ok' | 'fail' | 'warn' | 'live' | 'think' | 'explore'
// spare: a row drawn only when the lines leave one free after wrapping.
// side: a second subcolumn beside `lines` when the card is wide enough (else under them); chips: whole
// tokens flowed into rows; foot: the card's fact row, set off by a blank row when one is spare (round 16).
// tiles: the to-dos as cells a few rows tall, laid left to right in list order (round 17).
export type Card = { title: string; tone: Tone; note?: Line; lines: Line[]; spare?: Line; side?: Line[]; chips?: Line[]; tiles?: Tile[]; foot?: Line }
// One to-do cell: `n` its place in the list, `look` how its mark and name are drawn; `fill` paints the
// whole cell in the look's background (a patch), else only the text carries it.
export type Tile = { n: number; mark: string; text: string; status: Todo['status']; look: Omit<Seg, 't'>; fill: boolean }
export type Mode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use' | undefined

export const TONE_COLOR: Record<Tone, string | undefined> = { quiet: undefined, ok: 'green', fail: 'red', warn: 'yellow', live: 'cyan', think: 'magenta', explore: 'blue' }

const secs = (ms: number) => Math.floor(ms / 1000)
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// Step text is kept up to 72 chars and shown whole: the band clips the head to its width, the
// body wraps `last:` over its rows (round 14).
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
  const lastLine: Line | undefined = last ? [{ t: 'last: ', dim: true }, { t: last.say + (last.ok === false ? ` ${MARK.fail}` : ''), dim: true }] : undefined
  const sub: Line = narration ? [{ t: '» ' + narration, dim: true }] : lastLine ? [{ t: lastLine.map(x => x.t).join(''), dim: true }] : [{ t: '» ' + clip(t.prompt, 80), dim: true }]
  const f = frame(now)
  const m = mood(t, mode, now)
  if (m) tone = m.tone
  const head: Line = m ? [{ t: `${m.glyph} ${m.word} · ` }, { t: what }] : live.length ? [tile(' ◆ ', 'cyan'), { t: ' ' + what }] : [{ t: '◇ ' + what }]
  if (el > 5) head.push({ t: ` · ${clock(el * 1000)}`, dim: true })
  // Round 16 motion budget: the only thing that moves when all is well is the live step's own cell.
  if (first) {
    const k = KIND[first.kind ?? 'other']
    head.push({ t: ' ' + (f % 2 ? k.t : '▄'), color: k.color ?? 'cyan' })
  }
  // Narration shown: the last step still gets its own row on the wide cards (round 16; the live check
  // saw a minute-old narration hide every step of a 20 s turn).
  return { title: 'now', tone, lines: [head, sub], foot: narration ? lastLine : undefined }
}

// The session's mood (round 16, direction 4), worked out from measured steps, never guessed. First
// match wins: stuck (the last 3 test runs failed, or the last 3 steps did), closing (a run passed after
// a failing one, or 80%+ of the to-dos are done), thinking (the model alone for 15 s+), exploring
// (3+ reads, no edit yet), focused (editing, and the last run no worse than the one before).
// Glyphs keep to the shape tokens: no circles, those belong to effort.
export type Mood = { glyph: string; word: string; tone: Tone }
const MOODS = {
  stuck: { glyph: MARK.fail, word: 'stuck', tone: 'fail' },
  closing: { glyph: MARK.ok, word: 'closing', tone: 'ok' },
  thinking: { glyph: '…', word: 'thinking', tone: 'think' },
  exploring: { glyph: '◇', word: 'exploring', tone: 'explore' },
  focused: { glyph: MARK.live, word: 'focused', tone: 'live' },
} as const satisfies Record<string, Mood>
export function mood(t: Turn, mode: Mode, now: number): Mood | undefined {
  const steps = t.done.filter(x => x.kind !== 'todo')
  const runs = t.runs.filter(r => !r.running && !r.isStopped)
  const tail = runs.slice(-3)
  if ((tail.length === 3 && tail.every(isFailed)) || (steps.length >= 3 && steps.slice(-3).every(x => x.ok === false))) return MOODS.stuck
  const last = runs[runs.length - 1]
  const done = t.todos.filter(x => x.status === 'completed').length
  if ((last && !isFailed(last) && runs.slice(0, -1).some(isFailed)) || (t.todos.length >= 2 && done / t.todos.length >= 0.8)) return MOODS.closing
  const quiet = now - (steps[steps.length - 1]?.endedAt ?? t.startedAt)
  if (!t.running.size && mode === 'thinking' && quiet >= 15_000) return MOODS.thinking
  const edits = steps.filter(x => x.kind === 'edit').length
  if (!edits && steps.filter(x => x.kind === 'read').length >= 3) return MOODS.exploring
  const prev = runs[runs.length - 2]
  const worse = last && prev && last.total && prev.total && last.pass < prev.pass
  if (edits && !worse) return MOODS.focused
  return undefined
}

// The now card's head as the top edge's band (rounds 11, 13): the band is one tone, so the live tile
// and dim timer fold into plain text; the live pulse is drawn after it in its own color.
export function band(head: Line, isLive: boolean): { status: string; pulse?: Seg } {
  const tail = isLive ? head[head.length - 1] : undefined
  const said = (tail ? head.slice(0, -1) : head).map(x => x.t).join('').replace(/\s+/g, ' ').trim()
  return { status: said, pulse: tail ? { ...tail, t: tail.t.trim() } : undefined }
}

// The filmstrip (round 16, direction 1): one cell per step, colored by what it was, so the turn's shape
// reads at a glance: reads as quiet half cells, edits yellow, commands magenta, a test run that passed
// green, agents cyan, anything that failed red; the live step blinks in its kind's color at the tick.
// To-do bookkeeping is left out. With `track`, exactly n cells on a dim ░ track (the phone's gauge,
// aligned with ctx); without, up to n cells with the older steps folded into a dim +k.
const KIND: Record<StepKind, { t: string; color?: string; dim?: boolean }> = {
  read: { t: '▌', color: 'blue' },
  edit: { t: '█', color: 'yellow' },
  run: { t: '█', color: 'magenta' },
  test: { t: '█', color: 'green' },
  agent: { t: '█', color: 'cyan' },
  todo: { t: '▌', dim: true },
  other: { t: '▌', dim: true },
}
const LAND_MS = 480
const LAND = '▁▃▅'
export function filmstrip(t: Turn, n: number, now: number, track = true): Line {
  const steps = [...t.done, ...[...t.running.values()].sort((a, b) => a.startedAt - b.startedAt)].filter(x => x.kind !== 'todo')
  const fold = !track && steps.length > n ? steps.length - (n - 3) : 0
  const shown = track ? steps.slice(-n) : steps.slice(fold)
  const cells: Line = shown.map(x => {
    const k = KIND[x.kind ?? 'other']
    if (x.endedAt === undefined) return { t: frame(now) % 2 ? k.t : '▄', color: k.color ?? 'cyan' }
    const done = x.ok === false ? { t: '█', color: 'red' } : { ...k }
    // A step that just finished lands once, ▁▃▅ then its cell (round 16, direction 3).
    const el = now - x.endedAt
    return el >= 0 && el < LAND_MS ? { ...done, t: LAND[Math.floor(el / (LAND_MS / LAND.length))] ?? done.t } : done
  })
  const lead: Line = fold ? [{ t: `+${fold} `, dim: true }] : []
  return track && cells.length < n ? [...cells, { t: '░'.repeat(n - cells.length), dim: true }] : [...lead, ...cells]
}

// Step counts beside the filmstrip.
export function stepCounts(t: Turn): Line {
  const steps = t.done.filter(x => x.kind !== 'todo')
  const failed = steps.filter(x => x.ok === false).length
  return [{ t: `${steps.length} done`, dim: true }, ...(failed ? [{ t: ` · ${failed} ${MARK.fail}`, color: 'red' }] : [])]
}

// One cell per to-do (round 17 pick: patches): the live one a solid patch in its own hue, pending ones a
// grey patch, done ones struck through in their hue. Patches are an explicit background with black ink,
// never inverse (Termius drew inverse + color wrong). Just done, the name pops bold before the strike.
const FLASH_MS = 320
export const PENDING_BG = '#a39e8e'
export function tileOf(x: Todo, n: number, now = Infinity): Tile {
  const base = { n, text: x.text, status: x.status }
  if (x.status === 'completed') {
    const flash = x.doneAt !== undefined && now - x.doneAt >= 0 && now - x.doneAt < FLASH_MS
    return { ...base, mark: MARK.done, look: flash ? { color: x.color, bold: true } : { color: x.color, strike: true }, fill: false }
  }
  if (x.status === 'in_progress') return { ...base, mark: MARK.live, look: { color: 'black', bg: x.color, bold: true }, fill: true }
  // A fixed light grey, not the palette's bright black: that was #6a7058 on forest, too dark under black ink.
  return { ...base, mark: MARK.pending, look: { color: 'black', bg: PENDING_BG }, fill: true }
}

// The to-do list as cells; what else is on the plate (queued calls, agents out, a filling context)
// rides in the top border.
export function todoCard(t: Turn, ctxPercent: number | null, now = Infinity): Card {
  const done = t.todos.filter(x => x.status === 'completed').length
  const q = t.queued.size
  const bg = runningAgents(t).length
  const warn = ctxPercent !== null && ctxPercent >= 70
  const tags: Line = [...(q ? [{ t: `${q} queued`, dim: true }] : []), ...(bg ? [{ t: plural(bg, 'agent'), dim: true }] : []), ...(warn ? [{ t: `${MARK.warn} context ${Math.round(ctxPercent)}%`, color: 'yellow' }] : [])]
  const note = tags.flatMap((s, i) => (i ? [{ t: ' · ', dim: true }, s] : [s]))
  const cur = t.todos.find(x => x.status === 'in_progress')
  return {
    title: t.todos.length ? `to-do · ${done} of ${t.todos.length}` : 'to-do',
    tone: warn ? 'warn' : t.todos.length && done === t.todos.length ? 'ok' : 'quiet',
    note: note.length ? note : undefined,
    lines: t.todos.length ? [] : [[{ t: 'no to-do list yet', dim: true }]],
    tiles: t.todos.length ? t.todos.map((x, i) => tileOf(x, i + 1, now)) : undefined,
    foot: cur ? [{ t: '▸ ', dim: true }, { t: cur.active }] : undefined,
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
      return progressCard(t, now)
  }
}

const BAR = 16
const isFailed = (r: Run) => (r.total ? r.fail > 0 : r.ok === false)
const sayRun = (r: Run) => (r.isStopped ? 'stopped' : !r.total ? (r.ok ? 'passed' : 'failed') : r.fail ? `${r.fail} failing` : `all ${r.total} passed`)
function testsCard(t: Turn, now: number): Card {
  const n = t.runs.length
  const r = t.runs[n - 1]
  if (!r) return progressCard(t, now)
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
    lines: [[...bar, { t: `${r.pass}/${r.total} pass` }], [{ t: `${MARK.fail} `, color: 'red' }, { t: name ? name + (r.fail > 1 ? ` +${r.fail - 1}` : '') : plural(r.fail, 'failing test') }]],
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
  const marks: Line = t.agents.slice(0, 12).map(a => (a.endedAt === undefined ? { t: MARK.live, color: 'cyan' } : a.ok === false ? { t: MARK.fail, color: 'red' } : { t: MARK.done, color: 'green' }))
  const counts = [live.length ? `${live.length} running` : '', done ? `${done} done` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(' · ')
  const first = live[0]
  const tone: Tone = live.length ? 'live' : failed ? 'fail' : 'ok'
  return {
    title: `agents · ${t.agents.length}`,
    tone,
    lines: [[...marks, { t: ' ' + counts }], first ? [{ t: '▸ ', dim: true }, { t: first.label }, { t: `: ${first.doing ?? 'starting'}`, dim: true }] : [{ t: live.length ? '' : 'all back', dim: true }], [{ t: 'goal ▸ ', dim: true }, { t: clip(t.prompt, 200), dim: true }]],
  }
}

// Row 1 the step gauge (round 13: moved here from the now card), row 2 the to-do squares, row 3 what
// is in progress, or the files changed when there is no to-do list.
function progressCard(t: Turn, now: number): Card {
  const failed = t.done.filter(x => x.ok === false).length
  const gauge: Line = [{ t: LABEL, dim: true }, ...filmstrip(t, GAUGE, now), { t: ` ${t.done.length} done`, dim: true }, ...(failed ? [{ t: ` · ${failed} failed`, color: 'red' }] : [])]
  const files: Line = [{ t: t.edited.size ? `${plural(t.edited.size, 'file')} changed` : '', dim: true }]
  if (!t.todos.length) return { title: 'progress', tone: failed ? 'warn' : 'quiet', lines: [gauge, files] }
  const done = t.todos.filter(x => x.status === 'completed').length
  const cur = t.todos.find(x => x.status === 'in_progress')
  return {
    title: 'progress',
    tone: done === t.todos.length ? 'ok' : failed ? 'warn' : 'quiet',
    lines: [gauge, [{ t: 'to-do ', dim: true }, ...(squares(t) ?? [])], [{ t: cur ? cur.active : done === t.todos.length ? 'all done ✓' : '', dim: !cur }]],
  }
}

function dots(t: Turn): Line {
  return t.todos.slice(0, 12).map(x => ({ t: x.status === 'completed' ? MARK.done : x.status === 'in_progress' ? MARK.live : MARK.pending, color: x.status === 'pending' ? undefined : 'green', dim: x.status === 'pending' }))
}

// One square per to-do in its hue, then k/N; undefined before any to-do list exists.
function squares(t: Turn): Line | undefined {
  if (!t.todos.length) return undefined
  const done = t.todos.filter(x => x.status === 'completed').length
  return [...t.todos.slice(0, 12).map(squareOf), { t: ` ${done}/${t.todos.length}`, dim: true }]
}

// A segment of bars, sparklines or marks only (dots and spaces aside): no words for a one-line summary.
const GLYPHS_ONLY = /^[\s·]*[█▉▊▋▌▍▎▏░▒▓▁▂▃▄▅▆▇■□◆▲✕▐][\s·█▉▊▋▌▍▎▏░▒▓▁▂▃▄▅▆▇■□◆▲✕▐]*$/

// The one line above the prompt between turns: how it ended, what is still owed.
// The device mod's class as the idle strip's leading glyph; unknown (or no device mod) draws nothing.
const DEVICE_GLYPH: Record<string, string> = { mobile: '📱', desktop: '🖥', local: '⌂' }
export const deviceGlyph = (cls: string | undefined): string | undefined => (cls ? DEVICE_GLYPH[cls] : undefined)

// The folder as the status line showed it (round 17 folds that line into xray): home as ~, and only the
// last part on a phone or once the path runs long.
export function where(cwd: string, home: string, short = false): string {
  if (!cwd) return ''
  const p = home && (cwd === home || cwd.startsWith(home + '/')) ? '~' + cwd.slice(home.length) : cwd
  return p !== '~' && (short || p.length > 24) ? (short ? '' : '…/') + (p.split('/').pop() ?? p) : p
}

export function lastTurn(t: Turn, now: number): LastTurn {
  const card = taskCard(t, now)
  const words = (card.lines[0] ?? []).filter(s => !s.inv && !GLYPHS_ONLY.test(s.t))
  const headline = words.map(s => s.t).join('').replace(/\s{2,}/g, ' ').replace(/^[\s·]+|[\s·]+$/g, '') || `${plural(t.done.length, 'step')}`
  const tone: LastTurn['tone'] = card.tone === 'fail' || card.tone === 'warn' ? 'fail' : card.tone === 'ok' ? 'ok' : 'plain'
  return { title: card.title, headline, tone, owed: openTodos(t).slice(0, 4).map(x => ({ t: x.text, color: x.color })) }
}

export function splitLine(line: Line, cut: number, skip: number): [Line, Line] {
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

// Effort in shorthand, the glyph after Claude Code's own `◐ medium`: ○ low · ◐ med · ● high · ◉ xhigh/max.
// A numeric budget reads as itself; no effort sent (a model without one) draws nothing.
const EFFORT: Record<string, string> = { low: '○ low', medium: '◐ med', high: '● high', xhigh: '◉ xhigh', max: '◉ max' }
export const effortTag = (e: string | number | undefined): string | undefined => (e === undefined ? undefined : typeof e === 'number' ? `◐ ${e}` : (EFFORT[e] ?? e))

// Each figure on its own, so the tray can set each under the card it belongs to (round 16).
export function teleParts(t: Turn, ctxPercent: number | null, now: number): { ctx?: Line; tok?: Line; cache?: Line; turn: Line; effort?: Line } {
  const parts: { ctx?: Line; tok?: Line; cache?: Line; turn: Line; effort?: Line } = { turn: [{ t: 'turn ', dim: true }, { t: clock(now - t.startedAt) }] }
  // Past 85% the gauge walks (its last cell blinks at the tick): the one figure that needs you moves.
  const shown = ctxPercent !== null && ctxPercent >= 85 && frame(now) % 2 ? Math.max(0, ctxPercent - 100 / GAUGE) : ctxPercent
  if (ctxPercent !== null && shown !== null) parts.ctx = [{ t: 'ctx ', dim: true }, ...bar(shown / 100, GAUGE, ctxPercent >= 90 ? 'red' : ctxPercent >= 70 ? 'yellow' : 'green'), { t: ` ${Math.round(ctxPercent)}%`, color: ctxPercent >= 70 ? 'yellow' : undefined }]
  const done = t.requests.filter(r => r.endedAt > r.firstAt)
  const out = done.reduce((a, r) => a + r.output, 0)
  const gen = done.reduce((a, r) => a + (r.endedAt - r.firstAt), 0)
  const rates = done.slice(-8).map(r => r.output / ((r.endedAt - r.firstAt) / 1000))
  if (out && gen) parts.tok = [{ t: 'tok/s ', dim: true }, ...(rates.length > 1 ? [spark(rates), { t: ' ' }] : []), { t: String(Math.round(out / (gen / 1000))) }]
  const last = t.requests[t.requests.length - 1]
  const sent = last ? last.input + last.cacheRead + last.cacheWrite : 0
  if (last && sent) parts.cache = [{ t: 'cache ', dim: true }, ...bar(last.cacheRead / sent, GAUGE, 'cyan'), { t: ` ${Math.round((last.cacheRead / sent) * 100)}%` }]
  const eff = effortTag(t.effort)
  if (eff) parts.effort = [{ t: eff, dim: true }]
  return parts
}

// Under 60 columns (a phone, a narrow pane), rounds 8–9: one card `width` cells wide. Top edge = what
// runs now; body = narration, then steps + to-do squares; bottom edge = telemetry. Ticker (few rows,
// the phone's keyboard up): the body folds to one row and the bottom edge stays bare.
// status: the top edge's highlighted band (round 11), `more` its overflow on a band row of its own;
// pulse: the live step's 1 Hz glyph, drawn after the band in the tone color.
export type Compact = { tone: Tone; status: string; more?: string; pulse?: Seg; body: Line[]; bottom: Line }

const LABEL = 'steps ' // so both gauges start in one column: '│ ' + 6 cells = '╰─ ' + 'ctx  '

export function compact(t: Turn, mode: Mode, narration: string | null, ctxPercent: number | null, now: number, width: number, isTicker: boolean, folder = ''): Compact {
  const card = nowCard(t, mode, narration, now)
  const [head = [], sub = []] = card.lines
  const live = t.running.size > 0
  const last = t.done[t.done.length - 1]
  const tone: Tone = !live && last?.ok === false ? 'fail' : card.tone
  const inner = width - 4 // │ text │
  const edge = width - 6 // ╭─ text ─╮, at least one ─ of fill
  const bandCells = width - 8 // ╭ ␣status␣ ▂ ─╮: the band's two pads, the pulse and one ─ of fill
  const failed = t.done.filter(x => x.ok === false).length
  const todo = squares(t)
  const rate = tokRate(t)
  const tok: Line | undefined = rate === null ? undefined : [{ t: `${rate} t/s` }]
  const eff = effortTag(t.effort)
  const effort: Line | undefined = eff ? [{ t: eff, dim: true }] : undefined
  // The card grows at most one row so status texts are not cut: the status's overflow takes it first,
  // else the narration's (rounds 9–10).
  const { status: said, pulse } = band(head, live)
  const [first, rest] = wrapOnce([{ t: said }], bandCells, inner)
  const status = first.map(x => x.t).join('')
  const more = rest?.map(x => x.t).join('').trimStart()
  if (isTicker) {
    const ctx: Line | undefined = ctxPercent === null ? undefined : [{ t: `ctx ${Math.round(ctxPercent)}%`, color: ctxPercent >= 70 ? 'yellow' : undefined }]
    const counts: Line = [...filmstrip(t, 6, now), { t: ` ${t.done.length}${failed ? ` · ${failed}${MARK.fail}` : ''}`, dim: true }]
    return { tone, status, more, pulse, body: [fitParts([counts, todo, ctx, tok, effort], inner, ' · ')], bottom: [] }
  }
  const progress: Line = taskCard(t, now).lines[0] ?? []
  const gauge: Line | undefined = ctxPercent === null ? undefined : [{ t: 'ctx  ', dim: true }, ...bar(wholeCells(ctxPercent / 100, GAUGE), GAUGE, ctxPercent >= 90 ? 'red' : ctxPercent >= 70 ? 'yellow' : 'green'), { t: ` ${Math.round(ctxPercent)}%`, color: ctxPercent >= 70 ? 'yellow' : undefined }]
  const sent = lastSent(t)
  const cache: Line | undefined = sent ? [{ t: 'cache ', dim: true }, { t: `${Math.round(sent * 100)}%` }] : undefined
  const turn: Line = [{ t: clock(now - t.startedAt), dim: true }]
  return {
    tone,
    status,
    more,
    pulse,
    body: [...(more ? [clipLine(sub, inner)] : wrapOnce(sub, inner, inner).filter((l): l is Line => !!l)), fitParts([progress, todo], inner, '  ')],
    bottom: fitParts([folder ? [{ t: folder, dim: true }] : undefined, gauge, tok, effort, turn, cache], edge, '  '),
  }
}

// Whole cells only: Termius draws a thin eighth (▎) near-blank, a gap in a low gauge (capture 6).
// Any use at all shows one cell.
const wholeCells = (frac: number, n: number) => (frac > 0 ? Math.max(1, Math.round(frac * n)) / n : 0)

// One square per to-do in its hue: solid when done, ◆ in progress, a grey □ while pending.
const squareOf = (x: Todo): Seg => (x.status === 'completed' ? { t: MARK.done, color: x.color } : x.status === 'in_progress' ? { t: MARK.live, color: x.color } : { t: MARK.pending, dim: true })

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

export const cells = (l: Line) => l.reduce((a, s) => a + s.t.length, 0)

// Whole parts, left to right, while they fit: the rightmost go first, nothing is cut mid-part.
export function fitParts(parts: (Line | undefined)[], width: number, sep: string): Line {
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
export function clipLine(l: Line, width: number): Line {
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

export const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}
