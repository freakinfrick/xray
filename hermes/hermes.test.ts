import { test, expect } from 'claude-code/testing'
import { resultText, toCall, toEvent } from './calls'
import { feed, open, step, type Store } from './feed'
import { cells, fit, pad, props, type Colors } from './ink'
import { panelLines } from './panel'
import { emptyRec, type SessionRec } from '../hooks/session'
import { spinnerRows } from '../hooks/layout'

const C: Colors = { ok: '#0f0', error: '#f00', warn: '#ff0', accent: '#0ff', shellDollar: '#00f', label: '#f0f', muted: '#888', text: '#fff' }
const text = (l: { t: string }[]) => l.map(g => g.t).join('')
const mem = (): Store & { saved: Record<string, SessionRec> } => {
  const saved: Record<string, SessionRec> = {}
  return { saved, load: sid => saved[sid] ?? emptyRec(), save: (sid, rec) => void (saved[sid] = rec) }
}
const line = (o: object) => JSON.stringify(o) + '\n'

test('hermes tools map to the core names and argument keys', () => {
  expect(toCall('terminal', { command: 'pytest -q' })).toEqual({ tool: 'Bash', input: { command: 'pytest -q' } })
  expect(toCall('read_file', { path: 'a.py' })).toEqual({ tool: 'Read', input: { file_path: 'a.py' } })
  expect(toCall('patch', { path: 'a.py', old_string: 'x' }).tool).toBe('Edit')
  expect(toCall('write_file', { path: 'b.py' }).tool).toBe('Write')
  expect(toCall('search_files', { pattern: 'foo', path: 'src' })).toEqual({ tool: 'Grep', input: { pattern: 'foo', path: 'src' } })
  expect(toCall('search_files', { pattern: '*.py', target: 'files' })).toEqual({ tool: 'Glob', input: { pattern: '*.py' } })
  expect(toCall('web_extract', { urls: ['https://x.dev'] }).input).toEqual({ url: 'https://x.dev' })
  expect(toCall('delegate_task', { tasks: [{ goal: 'audit' }, { goal: 'b' }] })).toEqual({ tool: 'Task', input: { description: '2 subagents' }, say: '2 subagents' })
  expect(toCall('execute_code', { code: 'print(1)' }).kind).toBe('script')
  expect(toCall('todo_list', {}).kind).toBe('todo')
  expect(toCall('vision_analyze', {})).toEqual({ tool: 'vision_analyze', input: {}, say: 'vision analyze', kind: 'other' })
})

test('a terminal result reads as its output; plain text stays as it is', () => {
  expect(resultText('{"output": "3 passed", "exit_code": 0}')).toBe('3 passed')
  expect(resultText('{"error": "no such file"}')).toBe('no such file')
  expect(resultText('tail of a long run\n1 failed')).toBe('tail of a long run\n1 failed')
})

test('a feed line drops the session fields and carries the mapped call', () => {
  const e = toEvent({ t: 5, kind: 'end', sid: 's', id: 'c1', tool: 'terminal', args: { command: 'ls' }, ok: true, text: '{"output":"a"}' })
  expect(e).toEqual({ t: 5, kind: 'end', id: 'c1', tool: 'Bash', input: { command: 'ls' }, ok: true, text: 'a' })
  expect(toEvent({ t: 1, kind: 'turn_start', sid: 's', parent: '', prompt: 'hi' })).toEqual({ t: 1, kind: 'turn_start', prompt: 'hi' })
})

test('semantic colours take the skin tokens; plain is text, dim alone is muted; bands keep black text', () => {
  expect(props(C, { t: 'x' })).toEqual({ color: '#fff' })
  expect(props(C, { t: 'x', color: 'blue' })).toEqual({ color: '#00f' })
  expect(props(C, { t: 'x', color: 'green' })).toEqual({ color: '#0f0' })
  expect(props(C, { t: 'x', color: 'magentaBright' })).toEqual({ color: '#f0f' })
  expect(props(C, { t: '▌', color: '#ff5f00' })).toEqual({ color: '#ff5f00' })
  expect(props(C, { t: 'x', dim: true })).toEqual({ color: '#888' })
  expect(props(C, { t: 'x', dim: true, color: 'red' })).toEqual({ color: '#f00', dimColor: true })
  expect(props(C, { t: ' edit ', bg: 'cyan', color: 'black' })).toEqual({ color: 'black', backgroundColor: '#0ff' })
})

test('rows are cut and padded to the width', () => {
  expect(text(fit([{ t: 'abc' }, { t: 'def' }], 4))).toBe('abcd')
  expect(cells(pad([{ t: 'ab' }], 6))).toBe(6)
})

const turn = (sid: string, parent = '') => [
  line({ t: 1000, kind: 'turn_start', sid, parent, prompt: 'fix it' }),
  line({ t: 1100, kind: 'start', sid, id: 'a', tool: 'read_file', args: { path: 'calc.py' } }),
  line({ t: 1200, kind: 'end', sid, id: 'a', tool: 'read_file', args: { path: 'calc.py' }, ok: true, text: '{"content":"x"}' }),
  line({ t: 1300, kind: 'start', sid, id: 'b', tool: 'patch', args: { path: 'calc.py' } }),
]

test('a feed builds the live turn, then files it in the session record on turn_end', () => {
  const f = open()
  const st = mem()
  expect(feed(f, turn('s1').join(''), st)).toBe(true)
  expect(f.sid).toBe('s1')
  expect(f.s.turn?.running.size).toBe(1)
  expect(f.s.turn?.done.length).toBe(1)
  const rows = spinnerRows(f.s.turn!, f.s.mode, null, null, 1400, 100, 3, undefined, '', { withTodo: false, turns: f.s.rec.turns })
  expect(rows.every(r => cells(r) <= 100)).toBe(true)
  feed(f, line({ t: 1500, kind: 'end', sid: 's1', id: 'b', tool: 'patch', args: { path: 'calc.py' }, ok: true }) + line({ t: 1600, kind: 'turn_end', sid: 's1' }), st)
  expect(f.s.turn).toBe(null)
  expect(f.s.rec.turns.length).toBe(1)
  expect(st.saved.s1?.turns.length).toBe(1)
})

test("a subagent's lines stay out of the main turn", () => {
  const f = open()
  const st = mem()
  feed(f, turn('main').join(''), st)
  feed(f, turn('child', 'main').join('') + line({ t: 1700, kind: 'turn_end', sid: 'child' }), st)
  expect(f.sid).toBe('main')
  expect(f.s.turn?.done.length).toBe(1)
  expect(f.s.turn?.running.size).toBe(1)
})

test('a new session id swaps the record and keeps the old one saved', () => {
  const f = open()
  const st = mem()
  feed(f, turn('s1').join(''), st)
  step(f, { t: 2000, kind: 'turn_start', sid: 's2', parent: '', prompt: 'next' }, st)
  expect(f.sid).toBe('s2')
  expect(st.saved.s1?.turns.length).toBe(1)
  expect(f.s.rec.turns.length).toBe(0)
  expect(f.s.turn?.prompt).toBe('next')
})

test('the panel draws the genome and the last turn from the feed state', () => {
  const f = open()
  feed(f, turn('s1').join('') + line({ t: 1600, kind: 'turn_end', sid: 's1' }), mem())
  const rows = panelLines(f.s, 70, 2000)
  expect(text(rows[0] ?? [])).toContain('genome')
  expect(rows.some(r => text(r).includes('calc.py'))).toBe(true)
})
