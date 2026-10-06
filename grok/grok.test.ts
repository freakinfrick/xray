import { test, expect } from 'claude-code/testing'
import { eventName, resultText, toCall, toEvents, type Envelope } from './map'
import { ansi, bytes, draw, MAX_BYTES, MAX_LINES, render, x256 } from './render'
import { init, reduce, type Event } from '../hooks/events'

// Envelopes as grok 1.0.41 sent them in the live run (keys trimmed to the ones read).
const sid = '01a11190-e217-73b3-a2ca-0fc2df34a8c1'
const prompt: Envelope = { hookEventName: 'user_prompt_submit', hook_event_name: 'UserPromptSubmit', sessionId: sid, prompt: 'fix calc' }
const pre: Envelope = { hookEventName: 'pre_tool_use', hook_event_name: 'PreToolUse', sessionId: sid, toolName: 'read_file', toolUseId: 'c1', toolInput: { target_file: '/r/calc.py' } }
const bashOut = (code: number): Envelope => ({
  hookEventName: 'post_tool_use',
  hook_event_name: 'PostToolUse',
  sessionId: sid,
  toolName: 'run_terminal_command',
  toolUseId: 'c2',
  toolInput: { command: 'python3 -m pytest -q', description: 'Run the tests' },
  toolResult: { type: 'Bash', output: [51, 32, 112, 97, 115, 115, 101, 100], output_for_prompt: `exit: ${code}\n3 passed in 0.1s`, exit_code: code },
})
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '')

test("the event's name: hook_event_name's PascalCase, or grok's snake_case / camelCase converted", () => {
  expect(eventName(prompt)).toBe('UserPromptSubmit')
  expect(eventName({ hookEventName: 'post_tool_use_failure' })).toBe('PostToolUseFailure')
  expect(eventName({ hookEventName: 'stopCancelled' })).toBe('StopCancelled')
})

test("grok's tools map into the core's names and argument keys", () => {
  expect(toCall('read_file', { target_file: 'a.py' })).toEqual({ tool: 'Read', input: { file_path: 'a.py' } })
  expect(toCall('search_replace', { file_path: 'a.py', old_string: 'x', new_string: 'y' }).tool).toBe('Edit')
  expect(toCall('search_replace', { file_path: 'b.py', old_string: '', new_string: 'y' }).tool).toBe('Write')
  expect(toCall('run_terminal_command', { command: 'ls', description: 'List files' })).toEqual({ tool: 'Bash', input: { command: 'ls' } })
  expect(toCall('list_dir', { target_directory: '/r' })).toEqual({ tool: 'Glob', input: { pattern: '/r' } })
  expect(toCall('todo_write', { todos: [] })).toEqual({ tool: 'todo', input: {}, say: 'to-do list', kind: 'todo' })
  expect(toCall('ask_user_question', {})).toEqual({ tool: 'ask_user_question', input: {}, say: 'ask user question', kind: 'other' })
})

test("a result's text: Bash's prompt text, its raw bytes, a read file's content", () => {
  expect(resultText(bashOut(0).toolResult)).toBe('exit: 0\n3 passed in 0.1s')
  expect(resultText({ type: 'Bash', output: [104, 105] })).toBe('hi')
  expect(resultText({ type: 'ReadFile', FileContent: { content: 'def add' } })).toBe('def add')
  expect(resultText(null)).toBe('')
})

test('envelopes become core events: a non-zero exit fails the step, Stop of any kind ends the turn', () => {
  expect(toEvents(prompt, 1)).toEqual([{ t: 1, kind: 'turn_start', prompt: 'fix calc' }])
  expect(toEvents(pre, 2)).toEqual([{ t: 2, kind: 'start', id: 'c1', tool: 'Read', input: { file_path: '/r/calc.py' } }])
  expect(toEvents(bashOut(0), 3)[0]?.ok).toBe(true)
  expect(toEvents(bashOut(1), 3)[0]?.ok).toBe(false)
  expect(toEvents({ ...pre, hookEventName: 'post_tool_use_failure', hook_event_name: 'PostToolUseFailure', error: 'denied' }, 4)[0]).toMatchObject({ kind: 'end', ok: false, text: 'denied' })
  for (const n of ['Stop', 'StopFailure', 'StopCancelled']) expect(toEvents({ hook_event_name: n }, 5)).toEqual([{ t: 5, kind: 'turn_end' }])
  expect(toEvents({ hook_event_name: 'SessionStart' }, 6)).toEqual([])
})

test("a subagent's own calls stay out of the main genome", () => {
  expect(toEvents({ ...pre, subagentType: 'explore' }, 1)).toEqual([])
})

// A session of n finished turns of six steps, then an open turn with an edit running.
function session(n: number): Event[] {
  const out: Event[] = []
  let t = 0
  for (let k = 0; k < n; k++) {
    out.push({ t: t++, kind: 'turn_start', prompt: 'p' })
    for (let i = 0; i < 6; i++) {
      out.push({ t: t++, kind: 'start', id: `${k}.${i}`, tool: i % 3 ? 'Read' : 'Bash', input: { file_path: 'a.py', command: 'pytest -q' } })
      out.push({ t: t++, kind: 'end', id: `${k}.${i}`, ok: i !== 4, text: '3 passed' })
    }
    out.push({ t: t++, kind: 'turn_end' })
  }
  out.push({ t: t++, kind: 'turn_start', prompt: 'fix' }, { t: t++, kind: 'start', id: 'x', tool: 'Edit', input: { file_path: 'calc.py' } })
  return out
}
const jsonl = (es: Event[]) => es.map(e => JSON.stringify(e)).join('\n')

test("the row stays within grok's 5 lines and 1024 bytes a line, at any width and session length", () => {
  for (const cols of [40, 60, 90, 120, 200, 300])
    for (const n of [0, 1, 8, 60]) {
      const text = jsonl(session(n))
      const working = render(text, false, 1e6, cols)
      const idle = render(text.split('\n').slice(0, -2).join('\n'), false, 1e6, cols)
      for (const out of [working, idle]) {
        expect(out.length).toBeGreaterThan(0)
        expect(out.length).toBeLessThanOrEqual(MAX_LINES)
        expect(out.every(l => bytes(l) <= MAX_BYTES)).toBe(true)
        expect(out.every(l => plain(l).length <= cols)).toBe(true)
      }
    }
})

test('working = the hooks hold a turn open: the now card, its genome inside; idle = the genome alone', () => {
  const working = render(jsonl(session(3)), false, 1e6, 120).map(plain)
  expect(working[0]?.startsWith('╭')).toBe(true)
  expect(working.at(-1)?.startsWith('╰')).toBe(true)
  expect(working.length).toBe(MAX_LINES)
  expect(working.some(l => l.includes('editing calc.py'))).toBe(true)
  const idle = render(jsonl(session(3).slice(0, -2)), false, 1e6, 120).map(plain)
  expect(idle.length).toBe(1)
  expect(idle[0]?.endsWith('genome')).toBe(true)
})

test("grok's own running turn opens a card the hooks haven't; a fresh session still holds the row", () => {
  expect(plain(render('', true, 1e6, 80)[0] ?? '').startsWith('╭')).toBe(true)
  const fresh = render('', false, 0, 80)
  expect(fresh.length).toBe(1)
  expect(plain(fresh[0] ?? '')).toBe(' '.repeat(74) + 'genome')
  expect(draw(init(), false, 0, 80).length).toBe(1)
  // A turn the hooks closed stays closed whatever stdin says between turns.
  expect(reduce(session(1).slice(0, -2)).turn).toBe(null)
})

test("colours: GrokNight's palette in xterm-256, one escape per change, plain text bare", () => {
  expect(x256('#6c6c6c')).toBe(242)
  expect(x256('#9ece6a')).toBe(149)
  expect(ansi([{ t: 'ok', color: 'green' }])).toBe('\x1b[38;5;149mok\x1b[0m')
  expect(ansi([{ t: 'a', color: 'green' }, { t: 'b', color: 'greenBright' }, { t: 'c' }])).toBe('\x1b[38;5;149mab\x1b[39mc')
  expect(ansi([{ t: ' edit ', bg: 'cyan', color: 'black' }, { t: '│', color: 'cyan' }])).toBe('\x1b[0;30;48;5;117m edit \x1b[0;38;5;117m│\x1b[0m')
  expect(ansi([{ t: 'plain' }])).toBe('plain')
  expect(ansi([{ t: 'abcdef' }], 3)).toBe('abc')
})
