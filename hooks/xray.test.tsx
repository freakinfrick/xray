import { test, expect } from 'claude-code/testing'

import { lastTurn, leftCard, nowCard, taskCard } from './cards'
import { isCheckCommand, isTestCommand, parseTestOutput, sayStep } from './parse'
import { carryTodos, finishStep, newTurn, queueFromResponse, startStep } from './track'

const text = (l: { t: string }[]) => l.map(s => s.t).join('')

test('test commands and check commands are told apart', async () => {
  expect(isTestCommand('npm test')).toBe(true)
  expect(isTestCommand('cd x && python -m pytest -q')).toBe(true)
  expect(isTestCommand('cargo test --all')).toBe(true)
  expect(isTestCommand('claude plugin test ~/claude/mods/xray')).toBe(true)
  expect(isTestCommand('node --test')).toBe(true)
  expect(isTestCommand('ls -la')).toBe(false)
  expect(isCheckCommand('npx tsc -p .')).toBe(true)
  expect(isCheckCommand('npm test')).toBe(false)
})

test('test output counts come out of jest, pytest, cargo and go summaries', async () => {
  const jest = parseTestOutput('  ● cost › rounds cents\n\nTests:       1 failed, 41 passed, 42 total\n')
  expect(jest).toEqual({ pass: 41, fail: 1, total: 42, failing: ['cost › rounds cents'] })
  const py = parseTestOutput('FAILED tests/test_cost.py::test_rounds - AssertionError\n==== 2 failed, 39 passed in 0.4s ====')
  expect(py?.pass).toBe(39)
  expect(py?.fail).toBe(2)
  expect(py?.failing).toEqual(['test_rounds'])
  expect(parseTestOutput('test result: ok. 12 passed; 0 failed; 0 ignored')).toEqual({ pass: 12, fail: 0, total: 12, failing: [] })
  expect(parseTestOutput('--- FAIL: TestX (0.00s)\n--- PASS: TestY (0.00s)\nFAIL')?.fail).toBe(1)
  expect(parseTestOutput('hello world')).toBeNull()
})

test('steps are named in plain words', async () => {
  expect(sayStep('Edit', { file_path: '/a/b/cost.ts' })).toBe('editing cost.ts')
  expect(sayStep('Bash', { command: 'npm test' })).toBe('running the tests')
  expect(sayStep('Bash', { command: 'tsc --noEmit' })).toBe('checking types')
  expect(sayStep('Bash', { command: 'ls', description: 'List the files' })).toBe('list the files')
  expect(sayStep('WebSearch', { query: 'x' })).toBe('searching the web')
})

test('a fix-the-tests turn picks the tests card and shows what still fails', async () => {
  const t = newTurn('fix the failing cost test', 0)
  queueFromResponse(t, [{ type: 'text' }, { type: 'tool_use', id: 'a', name: 'Edit', input: { file_path: 'cost.ts' } }, { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'npm test' } }])
  expect(t.queued.size).toBe(2)
  expect(text(leftCard(t, 40).lines[0])).toBe('2 queued')
  startStep(t, 'a', 'Edit', { file_path: 'cost.ts' }, 1000)
  finishStep(t, 'a', 'Edit', { file_path: 'cost.ts' }, true, '', undefined, 1500)
  startStep(t, 'b', 'Bash', { command: 'npm test' }, 2000)
  expect(t.template).toBe('tests')
  expect(taskCard(t, 3000).tone).toBe('live')
  finishStep(t, 'b', 'Bash', { command: 'npm test' }, false, '● cost › rounds cents\nTests: 1 failed, 41 passed, 42 total', undefined, 5000)
  const card = taskCard(t, 5000)
  expect(card.tone).toBe('fail')
  expect(text(card.lines[0])).toContain('41/42 pass')
  expect(text(card.lines[1])).toContain('cost › rounds cents')
  expect(t.edited.get('cost.ts')?.checked).toBe(false)
  startStep(t, 'c', 'Bash', { command: 'npm test' }, 6000)
  finishStep(t, 'c', 'Bash', { command: 'npm test' }, true, 'Tests: 42 passed, 42 total', undefined, 8000)
  expect(taskCard(t, 8000).tone).toBe('ok')
  expect(t.edited.get('cost.ts')?.checked).toBe(true)
  expect(lastTurn(t, 9000)).toEqual({ headline: 'tests · run 2: all 42 pass ✓', tone: 'ok', owed: [] })
})

test('five edited files make it a refactor; the card counts edited and checked', async () => {
  const t = newTurn('rename usage to spend', 0)
  for (let i = 0; i < 5; i++) {
    startStep(t, `e${i}`, 'Edit', { file_path: `f${i}.ts` }, i * 100)
    finishStep(t, `e${i}`, 'Edit', { file_path: `f${i}.ts` }, true, '', undefined, i * 100 + 50)
  }
  expect(t.template).toBe('refactor')
  expect(text(taskCard(t, 1000).lines[1])).toBe('5 edited · 0 checked')
  startStep(t, 'k', 'Bash', { command: 'tsc --noEmit' }, 2000)
  finishStep(t, 'k', 'Bash', { command: 'tsc --noEmit' }, true, '', undefined, 3000)
  expect(text(taskCard(t, 3000).lines[1])).toBe('5 edited · 5 checked')
  expect(taskCard(t, 3000).tone).toBe('ok')
})

test('reads without edits make it research; to-dos become the questions', async () => {
  const t = newTurn('how does usage work?', 0)
  startStep(t, 'w', 'TodoWrite', { todos: [{ content: 'where is it computed?', status: 'completed', activeForm: 'x' }, { content: 'cache counted?', status: 'in_progress', activeForm: 'checking cache' }] }, 0)
  for (const [i, f] of ['a.ts', 'b.ts', 'c.md', 'd.ts'].entries()) startStep(t, `r${i}`, 'Read', { file_path: f }, i)
  expect(t.template).toBe('research')
  const card = taskCard(t, 10)
  expect(card.title).toBe('questions')
  expect(text(card.lines[0])).toContain('1 of 2 answered')
  expect(text(card.lines[1])).toBe('? cache counted?')
})

test('the plate: queued calls first, then open to-dos; context warns only past 70%', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'c', 'TaskCreate', { subject: 'write docs', activeForm: 'writing docs' }, 0)
  finishStep(t, 'c', 'TaskCreate', { subject: 'write docs' }, true, '', { task: { id: '7', subject: 'write docs' } }, 1)
  expect(text(leftCard(t, 50).lines[0])).toBe('1 to-do')
  expect(text(leftCard(t, 50).lines[1])).toBe('next ▸ write docs')
  expect(leftCard(t, 50).note).toBeUndefined()
  expect(leftCard(t, 72).note).toBe('⚠ context 72%')
  startStep(t, 'u', 'TaskUpdate', { taskId: '7', status: 'completed' }, 2)
  expect(text(leftCard(t, 50).lines[0])).toBe('nothing queued')
  const next = newTurn('y', 10)
  t.todos.push({ id: '8', text: 'still open', active: 'x', status: 'pending' })
  carryTodos(t, next)
  expect(next.todos.map(x => x.text)).toEqual(['still open'])
})

test('the now card names the running step, and time only past 5 seconds', async () => {
  const t = newTurn('x', 0)
  expect(text(nowCard(t, 'thinking', null, 1000).lines[0])).toBe('◇ thinking')
  startStep(t, 'a', 'Bash', { command: 'npm test' }, 1000)
  expect(text(nowCard(t, 'tool-use', 'Running the suite.', 4000).lines[0])).toBe('◆ running the tests')
  expect(text(nowCard(t, 'tool-use', 'Running the suite.', 9000).lines[0])).toBe('◆ running the tests · 8s')
  expect(text(nowCard(t, 'tool-use', 'Running the suite.', 9000).lines[1])).toBe('» Running the suite.')
})

test('with no turn tracked, the spinner is left exactly as the engine draws it', async ($, on) => {
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>Sauteing…</Text>
  })
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'Spinner', props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' } })
  expect(await ui.find({ type: 'Text', text: /Sauteing/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /now/ })).toBeUndefined()
  await ui.unmount()
})
