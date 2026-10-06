import { test, expect } from 'claude-code/testing'
import * as genome from './genome'
import { spinnerRows } from './layout'
import { clipLine } from './cards'
import { finishStep, newTurn, startStep } from './track'

const text = (rows: { t: string }[][]) => rows.map(l => l.map(g => g.t).join(''))
function turn() {
  const t = newTurn('fix calc', 0)
  for (const [id, tool, input] of [['1', 'Read', { file_path: 'calc.py' }], ['2', 'Edit', { file_path: 'calc.py' }], ['3', 'Bash', { command: 'pytest' }]] as const) {
    startStep(t, id, tool, input, 1000)
    finishStep(t, id, tool, input, true, '3 passed', undefined, 2000)
  }
  startStep(t, '4', 'Read', { file_path: 'b.py' }, 3000)
  return t
}
const turns = ['rrre', 'rreect', 'rrrrrrreeeeect', '', 'rrhn', 'rrrreeectk']

test('single card: the genome rides inside, right of the facts, nothing under the card', () => {
  const rows = text(spinnerRows(turn(), 'tool-use', null, null, 5000, 100, 3, undefined, '', { withTodo: false, turns }))
  expect(rows.length).toBe(5) // top, facts, divider, gauges, bottom: the body as before
  expect(rows.every(r => r.length === 100)).toBe(true)
  expect(rows[rows.length - 1]?.startsWith('╰')).toBe(true)
  expect(rows[1]?.includes('[▌▌▌▌]')).toBe(true) // the oldest turn, first body row
  expect(rows.some(r => r.includes('genome'))).toBe(false) // no label inside the card
  expect(rows[2]?.includes('┄  ')).toBe(true) // the divider stops short of the genome column
})

test('single card: a long genome grows the card at most two rows, folding the oldest turns', () => {
  const many = Array.from({ length: 40 }, () => 'rrrreeect')
  const rows = text(spinnerRows(turn(), 'tool-use', null, null, 5000, 100, 3, undefined, '', { withTodo: false, turns: many }))
  expect(rows.length).toBe(7)
  expect(rows[1]?.includes('+')).toBe(true)
  expect(rows.every(r => r.length === 100)).toBe(true)
})

test('single card: no turns yet shows the live turn alone; legacy false and no turns draw as before', () => {
  const t = turn()
  const live = text(spinnerRows(t, 'tool-use', null, null, 5000, 100, 3, undefined, '', { withTodo: false, turns: [] }))
  expect(live[1]?.includes('[')).toBe(true)
  expect(text(spinnerRows(t, 'tool-use', null, null, 5000, 100, 3, undefined, '', false))).toEqual(text(spinnerRows(t, 'tool-use', null, null, 5000, 100, 3, undefined, '', { withTodo: false })))
})

test('single card too narrow for a genome column: the labelled row goes under it', () => {
  const rows = text(spinnerRows(turn(), 'tool-use', null, null, 5000, 34, 3, undefined, '', { withTodo: false, turns }))
  expect(rows[rows.length - 1]?.endsWith('genome')).toBe(true)
})

test('two cards: the frame runs on down around the rows below and one edge closes it', () => {
  const below = genome.idle(turns, 116, { maxRows: 3 })
  const rows = text(spinnerRows(turn(), 'tool-use', null, 40, 5000, 120, 3, undefined, '~/w', { below }))
  expect(rows.every(r => r.length === 120)).toBe(true)
  const end = rows.length - 1 - below.length - 1 // the cards' own bottoms
  expect(rows[end]?.startsWith('├')).toBe(true)
  expect(rows[end]?.endsWith('┫')).toBe(true)
  expect(rows[end + 1]?.startsWith('│ ')).toBe(true)
  expect(rows[end + 1]?.endsWith('genome ┃')).toBe(true)
  expect(rows[rows.length - 1]).toMatch(/^╰─+╼━+┛$/)
  // Nothing below (a fresh session): the cards close as they always did.
  const plain = text(spinnerRows(turn(), 'tool-use', null, 40, 5000, 120, 3, undefined, '~/w'))
  expect(plain[plain.length - 1]?.startsWith('╰')).toBe(true)
  expect(plain[plain.length - 1]?.endsWith('┛')).toBe(true)
})

test('idle: the genome alone, labelled at the right edge, one row when narrow', () => {
  const wide = text(genome.idle(turns, 100))
  expect(wide[0]?.endsWith('genome')).toBe(true)
  expect(wide[0]?.length).toBe(100)
  expect(genome.idle(Array.from({ length: 30 }, () => 'rrree'), 50).length).toBe(1)
  expect(genome.idle([], 100)).toEqual([])
})

test('a clipped line that already trails off takes no second ellipsis', () => {
  const l = clipLine([{ t: 'tests · run 1  ' }, { t: 'running… still going on' }], 24)
  expect(l.map(g => g.t).join('').endsWith('……')).toBe(false)
})

test('a running test row that is cut short shows one ellipsis, not two', () => {
  const t = newTurn('go', 0)
  startStep(t, '1', 'Read', { file_path: '/r/a.py' }, 1)
  finishStep(t, '1', 'Read', { file_path: '/r/a.py' }, true, 'x', undefined, 2)
  startStep(t, '2', 'Bash', { command: 'python3 -m unittest' }, 3)
  const text = spinnerRows(t, undefined, null, null, 4, 90, 3, undefined, '', false).map(l => l.map(g => g.t).join('')).join('\n')
  expect(text.includes('running…')).toBe(true)
  expect(text.includes('……')).toBe(false)
})
