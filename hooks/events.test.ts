import { test, expect } from 'claude-code/testing'
import { apply, init, parse, reduce, type Event } from './events'
import * as genome from './genome'
import { spinnerRows } from './layout'

// A recorded hermes/grok-style session: two turns, the second with a failed command and a stepless reply.
const recorded: Event[] = [
  { t: 0, kind: 'turn_start', prompt: 'fix calc' },
  { t: 10, kind: 'usage', usage: { input: 900, output: 40, cacheRead: 800 } },
  { t: 11, kind: 'start', id: 'a', tool: 'Read', input: { file_path: 'calc.py' } },
  { t: 20, kind: 'end', id: 'a', ok: true, text: 'def add(a, b): ...' },
  { t: 21, kind: 'start', id: 'b', tool: 'Edit', input: { file_path: 'calc.py' } },
  { t: 30, kind: 'end', id: 'b', ok: true },
  { t: 31, kind: 'start', id: 'c', tool: 'Bash', input: { command: 'pytest -q' } },
  { t: 40, kind: 'end', id: 'c', ok: true, text: '3 passed in 0.1s' },
  { t: 50, kind: 'usage', usage: { input: 1200, output: 80, cacheRead: 1000 } },
  { t: 51, kind: 'turn_end' },
  { t: 60, kind: 'turn_start', prompt: 'ship it' },
  { t: 61, kind: 'start', id: 'd', tool: 'Bash', input: { command: 'make deploy' } },
  { t: 70, kind: 'end', id: 'd', ok: false, text: 'make: *** no rule' },
  { t: 71, kind: 'start', id: 'e', tool: 'skill_view', input: {}, say: 'reading a skill', as: 'other' },
  { t: 72, kind: 'end', id: 'e', ok: true },
  { t: 80, kind: 'turn_end' },
  { t: 90, kind: 'turn_start', prompt: 'thanks' },
  { t: 95, kind: 'turn_end' },
]

test('a recorded event list folds into the turns, kinds and genome letters omp builds', () => {
  const s = reduce(recorded)
  expect(s.rec.turns).toEqual(['ret', 'xo', ''])
  expect(s.ended).toBe(3)
  expect(s.turn).toBe(null)
  expect(s.mode).toBe(undefined)
  const first = reduce(recorded.slice(0, 10)).prev
  expect(first?.done.map(x => x.kind)).toEqual(['read', 'edit', 'test'])
  expect(first?.requests.map(r => [r.startedAt, r.endedAt])).toEqual([[0, 10], [40, 50]])
  expect(s.prev?.prompt).toBe('thanks')
})

test('a tool the core has no rule for keeps the host words and kind', () => {
  const s = reduce(recorded.slice(10, 15))
  const step = s.turn?.done.find(x => x.id === 'e')
  expect(step?.say).toBe('reading a skill')
  expect(step?.kind).toBe('other')
})

test('the live turn while it runs: mode, running cell, and the card draws from it', () => {
  const s = reduce(recorded.slice(0, 7))
  expect(s.mode).toBe('tool-use')
  expect(s.turn?.running.size).toBe(1)
  const rows = spinnerRows(s.turn!, s.mode, null, null, 35, 90, 3, undefined, '', { withTodo: false, turns: s.rec.turns })
  expect(rows.every(l => l.reduce((a, g) => a + g.t.length, 0) === 90)).toBe(true)
})

test('steps with no turn open (file picked up mid-turn) open one; a turn_start closes an open turn', () => {
  const s = reduce([
    { t: 0, kind: 'start', id: 'a', tool: 'Read', input: { file_path: 'a' } },
    { t: 1, kind: 'end', id: 'a', ok: true },
    { t: 2, kind: 'turn_start', prompt: 'next' },
  ])
  expect(s.rec.turns).toEqual(['r'])
  expect(s.turn?.prompt).toBe('next')
})

test('an end with no start seen is rebuilt from its own tool and input', () => {
  const s = reduce([{ t: 0, kind: 'turn_start' }, { t: 5, kind: 'end', id: 'z', tool: 'Write', input: { file_path: 'b.py' }, ok: true }, { t: 6, kind: 'turn_end' }])
  expect(s.rec.turns).toEqual(['e'])
})

test('incremental apply over a tailed file equals reduce; malformed lines are skipped', () => {
  const text = recorded.map(e => JSON.stringify(e)).join('\n') + '\n{"t": 99, "kind": "sta'
  const events = parse(text)
  expect(events.length).toBe(recorded.length)
  const s = init()
  for (const e of events) apply(s, e)
  expect(s.rec.turns).toEqual(reduce(recorded).rec.turns)
  expect(genome.code(s.prev!)).toBe('')
})
