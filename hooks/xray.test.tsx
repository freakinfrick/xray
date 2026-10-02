import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'

import { fitRows, lastTurn, nowCard, taskCard, telemetry, todoCard } from './cards'
import { DEFAULTS, checkRecipe, detect, lastLine, lastPair, parseRecipe, writerPrompt } from './custom'
import { SEED, isRefused, parseRating, rules } from './ledger'
import { panel } from './panel'
import { isCheckCommand, isTestCommand, parseTestOutput, sayStep } from './parse'
import { agentStep, carryTodos, checkSignal, endTurn, finishAgent, finishStep, newTurn, queueFromResponse, readJob, spawnAgent, startStep } from './track'

const text = (l?: { t: string }[]) => (l ?? []).map(s => s.t).join('')

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
  const bun = parseTestOutput('(fail) the panel draws in its pane [42ms]\n 23 pass\n 1 fail\nRan 24 tests across 1 file.')
  expect(bun).toEqual({ pass: 23, fail: 1, total: 24, failing: ['the panel draws in its pane'] })
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
  expect(text(todoCard(t, 40).note)).toBe('2 queued')
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

test('a test run with no summary says passed or failed, never a made-up count', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'a', 'Bash', { command: 'npm test' }, 0)
  finishStep(t, 'a', 'Bash', { command: 'npm test' }, false, 'boom', undefined, 10)
  expect(text(taskCard(t, 10).lines[0])).toContain('failed')
  expect(text(taskCard(t, 10).lines[0])).not.toContain('/')
  expect(text(taskCard(t, 10).lines[1])).toBe('no test count in the output')
  startStep(t, 'b', 'Bash', { command: 'npm test' }, 20)
  finishStep(t, 'b', 'Bash', { command: 'npm test' }, true, 'ok', undefined, 30)
  expect(taskCard(t, 30).tone).toBe('ok')
  expect(text(taskCard(t, 30).lines[1])).toBe('fixed after 1 failing run')
  expect(lastTurn(t, 40).headline).toBe('tests · run 2: passed ✓')
})

test('a run cut off by the end of the turn reads as stopped, not running', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'a', 'Bash', { command: 'pytest' }, 0)
  endTurn(t)
  expect(lastTurn(t, 10)).toEqual({ headline: 'tests · run 1: run stopped', tone: 'fail', owed: [] })
})

test('a long line takes the spare row instead of being cut, splitting at a space', async () => {
  const rows = fitRows([[{ t: '◆ reading' }], [{ t: '» Rerunning the tests after fixing the rounding', dim: true }]], 20, 3)
  expect(rows.map(text)).toEqual(['◆ reading', '» Rerunning the', '  tests after fixing the rounding'])
  expect(rows[1]?.[0]?.dim).toBe(true)
  expect(fitRows([[{ t: 'short' }], [{ t: '' }]], 20, 3).map(text)).toEqual(['short', '', ''])
  const styled = fitRows([[{ t: 'next ▸ ', dim: true }, { t: 'updating all of the call sites' }]], 16, 3)
  expect(styled.map(text)).toEqual(['next ▸ updating', '  all of the', '  call sites'])
})

test('the telemetry line shows only measured figures', async () => {
  const t = newTurn('x', 0)
  expect(text(telemetry(t, null, 5000))).toBe('turn 5s')
  t.requests.push({ startedAt: 0, firstAt: 1000, endedAt: 3000, output: 80, input: 100, cacheRead: 800, cacheWrite: 100 })
  expect(text(telemetry(t, 41.4, 72_000))).toBe('ctx 41% · 40 tok/s · cache 80% · turn 1m 12s')
  expect(telemetry(t, 74, 0)[0]?.color).toBe('yellow')
})

test('spawned agents make the agents card: who runs, what the oldest is doing, the goal', async () => {
  const t = newTurn('audit the auth flow', 0)
  startStep(t, 'x', 'Agent', { description: 'map token use' }, 0)
  spawnAgent(t, { toolUseId: 'x', agentId: 'ag1', label: 'map token use', isBackground: true, startedAt: 0 })
  finishStep(t, 'x', 'Agent', { description: 'map token use' }, true, 'launched', undefined, 5)
  spawnAgent(t, { toolUseId: 'y', label: 'read the tests', isBackground: false, startedAt: 10 })
  expect(t.template).toBe('agents')
  agentStep(t, 'ag1', 'reading token.ts')
  agentStep(t, 'ag2', 'searching for expiry')
  expect(t.agents[1]?.agentId).toBe('ag2')
  let card = taskCard(t, 20)
  expect(card.title).toBe('agents · 2')
  expect(card.tone).toBe('live')
  expect(text(card.lines[0])).toBe('◆◆ 2 running')
  expect(text(card.lines[1])).toBe('▸ map token use: reading token.ts')
  expect(text(card.lines[2])).toBe('goal ▸ audit the auth flow')
  expect(text(todoCard(t, 10).note)).toBe('2 agents')
  finishAgent(t, { agentId: 'ag1' }, true, 30)
  finishAgent(t, { agentId: 'ag2' }, false, 31)
  card = taskCard(t, 40)
  expect(text(card.lines[0])).toBe('●✗ 1 done · 1 failed')
  expect(card.tone).toBe('fail')
  expect(lastTurn(t, 40).headline).toBe('agents · 2: 1 done · 1 failed')
})

test('a background agent still running carries into the next turn; a foreground one ends with its call', async () => {
  const t = newTurn('x', 0)
  spawnAgent(t, { toolUseId: 'bg', agentId: 'a', label: 'bg', isBackground: true, startedAt: 0 })
  startStep(t, 'fg', 'Agent', { description: 'fg' }, 0)
  spawnAgent(t, { toolUseId: 'fg', agentId: 'b', label: 'fg', isBackground: false, startedAt: 0 })
  finishStep(t, 'fg', 'Agent', { description: 'fg' }, true, 'done', undefined, 9)
  const next = newTurn('y', 10)
  carryTodos(t, next)
  expect(next.agents.map(a => a.label)).toEqual(['bg'])
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

test('the to-do card: one chip per to-do, grey until done, each in its own hue; plate tags in the border', async () => {
  const t = newTurn('x', 0)
  expect(text(todoCard(t, 10).lines[0])).toBe('no to-do list yet')
  startStep(t, 'w', 'TodoWrite', { todos: [{ content: 'read spec', status: 'completed' }, { content: 'draw cards', status: 'in_progress' }, { content: 'commit', status: 'pending' }] }, 0)
  const card = todoCard(t, 50)
  expect(card.title).toBe('to-do · 1 of 3')
  expect(text(card.lines[0]).replace(/\u00a0/g, ' ')).toBe('[■ read spec] [◉ draw cards] [□ commit]')
  expect(new Set(t.todos.map(x => x.color)).size).toBe(3)
  expect(t.todos.some(x => x.color === 'red')).toBe(false)
  const done = card.lines[0]?.[0]
  expect(done?.color).toBe(t.todos[0]?.color)
  expect(card.lines[0]?.at(-1)?.dim).toBe(true)
  expect(card.note).toBeUndefined()
  expect(text(todoCard(t, 72).note)).toBe('⚠ context 72%')
  // a rewrite keeps each surviving to-do's hue
  const hue = t.todos[1]?.color
  startStep(t, 'w2', 'TodoWrite', { todos: [{ content: 'draw cards', status: 'completed' }, { content: 'commit', status: 'in_progress' }, { content: 'push', status: 'pending' }] }, 1)
  expect(t.todos[0]?.color).toBe(hue)
  expect(new Set(t.todos.map(x => x.color)).size).toBe(3)
  // chips wrap whole: a row breaks between chips, never inside one
  const rows = fitRows(todoCard(t, 10).lines, 26, 3).map(l => text(l).replace(/\u00a0/g, ' '))
  expect(rows.every(r => (r.match(/\[/g) ?? []).length === (r.match(/\]/g) ?? []).length)).toBe(true)
  const next = newTurn('y', 10)
  carryTodos(t, next)
  expect(next.todos.map(x => x.text)).toEqual(['commit', 'push'])
})

test('task-tool to-dos get hues too, and the border tags queued calls and agents', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'c', 'TaskCreate', { subject: 'write docs' }, 0)
  finishStep(t, 'c', 'TaskCreate', { subject: 'write docs' }, true, '', { task: { id: '7', subject: 'write docs' } }, 1)
  expect(t.todos[0]?.color).toBeDefined()
  queueFromResponse(t, [{ type: 'tool_use', id: 'q', name: 'Read', input: { file_path: 'a.ts' } }])
  spawnAgent(t, { toolUseId: 'g', label: 'g', isBackground: true, startedAt: 0 })
  expect(text(todoCard(t, 10).note)).toBe('1 queued · 1 agent')
  startStep(t, 'u', 'TaskUpdate', { taskId: '7', status: 'completed' }, 2)
  expect(todoCard(t, 10).tone).toBe('ok')
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

test('with nothing running, the clock counts from the last finished step', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'a', 'Read', { file_path: 'a.ts' }, 1000)
  finishStep(t, 'a', 'Read', { file_path: 'a.ts' }, true, '', undefined, 20_000)
  expect(text(nowCard(t, 'requesting', null, 23_000).lines[0])).toBe('◇ waiting on the model')
  expect(text(nowCard(t, 'requesting', null, 27_000).lines[0])).toBe('◇ waiting on the model · 7s')
})

const spinnerProps = { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' } as const
const submit = { text: 'fix the tests', wait: false, origin: { kind: 'composer' } } as const

// The engine beneath the plugin, for the events a session start and a prompt pass through.
function engine(on: On, env: Record<string, string>, complete = () => ({ value: { isAnswered: false, reason: 'aborted' } }) as never) {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, env)
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('prompt.compose', () => ({ sections: [] }))
  on('model.complete', complete)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 10 }, rateLimits: [] } }) as never)
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>Sauteing…</Text>
  })
}

test('after a prompt the cards draw under the spinner', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(submit)
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'Spinner', props: spinnerProps })
  expect(await ui.find({ type: 'Text', text: /now/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /thinking/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /turn \d+s/ })).toBeDefined()
  await ui.unmount()
})

test('a conductor pane (CLAUDE_HUMAN_MODS=off) never draws the cards', async ($, on) => {
  engine(on, { CLAUDE_HUMAN_MODS: 'off' })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(submit)
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'Spinner', props: spinnerProps })
  expect(await ui.find({ type: 'Text', text: /now/ })).toBeUndefined()
  await ui.unmount()
})

const compose = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Bash', 'TodoWrite'], outputStyle: null, traits: [] } as const

test('the to-do nudge joins the system prompt, except in conductor panes', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.prompt.compose(compose)
  expect(r.sections.some(x => x.id === 'xray-todos' && x.scope === 'session')).toBe(true)
})

test('no to-do nudge with CLAUDE_HUMAN_MODS=off', async ($, on) => {
  engine(on, { CLAUDE_HUMAN_MODS: 'off' })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.prompt.compose(compose)
  expect(r.sections.some(x => x.id === 'xray-todos')).toBe(false)
})

test('a task notification mid-turn does not wipe the turn', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(submit)
  await $.prompt.submit({ text: 'background task finished', wait: false, origin: { kind: 'task-notification' } } as never)
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'Spinner', props: spinnerProps })
  expect(await ui.find({ type: 'Text', text: /fix the tests/ })).toBeDefined()
  await ui.unmount()
})

test('a narration call that returns nothing does not mute narration for a minute', async ($, on) => {
  let calls = 0
  engine(on, {}, () => {
    calls += 1
    return { value: { isAnswered: false, reason: 'aborted' } } as never
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(submit)
  await $.prompt.submit(submit)
  expect(calls).toBe(2)
})

test('the panel lists requests on one time scale, recent steps, and session budgets', async () => {
  const t = newTurn('x', 0)
  t.requests.push({ startedAt: 0, firstAt: 1000, endedAt: 3000, output: 80, input: 100, cacheRead: 800, cacheWrite: 100 })
  t.requests.push({ startedAt: 4000, firstAt: 4500, endedAt: 5000, output: 20, input: 0, cacheRead: 0, cacheWrite: 0 })
  startStep(t, 'a', 'Read', { file_path: 'a.ts' }, 0)
  finishStep(t, 'a', 'Read', { file_path: 'a.ts' }, false, '', undefined, 400)
  startStep(t, 'b', 'Bash', { command: 'npm test' }, 500)
  const usage = { context: { tokens: 82_000, window: 200_000, percent: 41 }, cost: { usd: 1.84 }, rateLimits: [{ kind: 'five_hour', percentUsed: 92 }] }
  const [req, steps, session] = panel(t, usage, 2500)
  expect(req?.title).toBe('requests · 2')
  expect(text(req?.rows[0])).toBe('#1  ' + '░'.repeat(7) + '█'.repeat(13) + ' ' + '  3.0s  80 out · 40 tok/s · cache 80%')
  expect(text(req?.rows[1])).toContain('20 out · 40 tok/s')
  expect(steps?.title).toBe('steps · 1 done · 1 failed')
  expect(text(steps?.rows[0]).startsWith('✗ reading a.ts')).toBe(true)
  expect(text(steps?.rows[1]).startsWith('◆ running the tests')).toBe(true)
  expect(text(session?.rows[0])).toBe('context   █████░░░░░░░ 41% · 82k of 200k')
  expect(session?.rows[1]?.[1]?.color).toBe('red')
  expect(text(session?.rows[2])).toBe('spent     $1.84 this session')
  expect(panel(null, null, 0)[0]?.title).toBe('xray')
})

test('the panel draws in its pane', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(submit)
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'Pane', requestId: 'xray', props: { title: 'xray', isFocused: false, bodyColumns: 90, placement: 'inline' } as never })
  expect(await ui.find({ type: 'Text', text: /requests · 0/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /context/ })).toBeDefined()
  await ui.unmount()
})

test('no to-do nudge when the session has no to-do tool', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.prompt.compose({ ...compose, tools: ['Bash'] })
  expect(r.sections.some(x => x.id === 'xray-todos')).toBe(false)
})

const bash = (t: ReturnType<typeof newTurn>, id: string, command: string, out: string, at: number, took = 10, extra: Record<string, unknown> = {}) => {
  startStep(t, id, 'Bash', { command, ...extra }, at)
  finishStep(t, id, 'Bash', { command, ...extra }, true, out, undefined, at + took)
}

test('progress pairs and last lines are read the way a person would', async () => {
  expect(lastPair('done 3/40 · then 340/1200 shards')).toEqual({ k: 340, n: 1200 })
  expect(lastPair('2/3 pass on 10/02')).toBeNull()
  expect(lastLine('a\nprogress 10%\rprogress 40%\n\n')).toBe('progress 40%')
})

test('git bisect makes a bisect card: marks per step, commits left, commit under test', async () => {
  const t = newTurn('find the parse regression', 0)
  bash(t, 'a', 'git bisect start HEAD v1.2', 'Bisecting: 28 revisions left to test after this (roughly 5 steps)\n[a3f9c21bb] parse: inline the reader', 0)
  expect(t.signal).toBe('bisect')
  bash(t, 'b', 'git bisect bad', 'Bisecting: 14 revisions left to test after this (roughly 4 steps)\n[b7e01aa9] parse: split tokens', 100)
  bash(t, 'c', 'git bisect good', 'Bisecting: 6 revisions left to test after this (roughly 3 steps)\n[c1d2e3f4] lexer: utf8', 200)
  const card = taskCard(t, 300)
  expect(card.title).toBe('bisect · step 2')
  expect(text(card.lines[0])).toBe('✗● 6 commits · ~3 steps')
  expect(text(card.lines[1])).toBe('testing c1d2e3f · "lexer: utf8"')
  bash(t, 'd', 'git bisect bad', 'c1d2e3f4aa is the first bad commit', 400)
  expect(taskCard(t, 500).tone).toBe('ok')
  expect(text(taskCard(t, 500).lines[2])).toBe('first bad: c1d2e3f ✓')
  expect(text(taskCard(t, 500).lines[1])).toBe('')
  expect(lastTurn(t, 500).headline).toBe('bisect · step 3: 6 commits · ~3 steps')
})

test('a benchmark rerun three times makes a bench card; a plain command repeated does not', async () => {
  const plain = newTurn('tidy the logs', 0)
  for (let i = 0; i < 3; i++) bash(plain, `p${i}`, 'ls -la', 'took 0.4s', i * 100)
  expect(plain.signal).toBeUndefined()
  const t = newTurn('make the pool faster, under 300ms', 0)
  for (const [i, ms] of [412, 350, 287].entries()) bash(t, `b${i}`, './bench.sh', `p50 ${ms - 20}ms\np99 ${ms}ms`, i * 100)
  expect(t.signal).toBe('bench')
  const card = taskCard(t, 400)
  expect(card.title).toBe('bench · run 3')
  expect(text(card.lines[0])).toBe('█▅▁ 412ms → 287ms · −30%')
  expect(card.lines[0]?.at(-1)?.color).toBe('green')
  expect(text(card.lines[2])).toBe('your target: under 300ms ✓')
})

test('a background job followed through its output file makes a batch card with rate and ETA', async () => {
  const t = newTurn('convert the shards', 0)
  bash(t, 'j', 'python3 -u convert.py', 'Command running in background with ID: x1. Output is being written to: /tmp/t/x1.output', 0, 5, { run_in_background: true })
  expect(t.job?.path).toBe('/tmp/t/x1.output')
  readJob(t, 'start\n100/1200 shards\n', 30, 60_000)
  checkSignal(t, 60_000)
  expect(t.signal).toBe('batch')
  readJob(t, 'start\n100/1200 shards\n340/1200 wrote shard_0340.parquet\n', 90, 360_000)
  const card = taskCard(t, 360_000)
  expect(card.title).toBe('batch · 340 of 1200')
  expect(text(card.lines[0])).toBe('███········· 28% · ETA 17m 55s')
  expect(text(card.lines[1])).toBe('48/min · started 6m 00s')
  expect(text(card.lines[2])).toBe('last: 340/1200 wrote shard_0340.parquet')
})

test('a rerun command past a minute makes a build card measured against the last run', async () => {
  const t = newTurn('ship the release build', 0)
  bash(t, 'a', 'cargo build --release', 'Finished', 0, 230_000)
  startStep(t, 'b', 'Bash', { command: 'cargo build --release' }, 300_000)
  checkSignal(t, 330_000)
  expect(t.signal).toBeUndefined()
  checkSignal(t, 461_000)
  expect(t.signal).toBe('build')
  const card = taskCard(t, 461_000)
  expect(card.title).toBe('build · cargo build --release')
  expect(text(card.lines[0])).toBe('████████···· 2m 41s of ~3m 50s')
})

test('a written recipe is kept only within the kit; anything else falls back to the kept layout', async () => {
  expect(checkRecipe({ title: 'shards · {done}/{total}', rows: [[{ src: 'progress' }, { src: 'eta', label: 'left' }]] }, 'batch')).toEqual({ title: 'shards · {done}/{total}', rows: [[{ src: 'progress' }, { src: 'eta', label: 'left' }]] })
  expect(checkRecipe({ title: 'x', rows: [[{ src: 'tokens' }]] }, 'batch')).toBeNull()
  expect(checkRecipe({ title: '{cost}', rows: [[{ src: 'eta' }]] }, 'batch')).toBeNull()
  expect(checkRecipe({ title: 'x', rows: [[], [], [], []] }, 'batch')).toBeNull()
  expect(checkRecipe({ title: 'x', rows: [[{ src: 'eta', label: 'a label far too long' }]] }, 'batch')).toBeNull()
  expect(parseRecipe('Here: {"title":"bisect","rows":[[{"src":"marks"}]]} done', 'bisect')?.rows[0]?.[0]?.src).toBe('marks')
  expect(parseRecipe('no json', 'bisect')).toBeNull()
  for (const [sig, r] of Object.entries(DEFAULTS)) expect(checkRecipe(r, sig as keyof typeof DEFAULTS)).toEqual(r)
})

test('the recipe writer is told the task, the sources with their values, and the rules', async () => {
  const t = newTurn('convert the shards', 0)
  t.samples.push({ at: 0, k: 3, n: 30 })
  const p = writerPrompt(t, 'batch', 0, ['at most 3 widgets per row'])
  expect(p).toContain('The person asked: convert the shards')
  expect(p).toContain('- progress: bar: items done of total (now: 10%)')
  expect(p).toContain('- eta: time left at the current rate (now: not measured yet)')
  expect(p).toContain('- at most 3 widgets per row')
  expect(p).toContain(`Kept layout: ${JSON.stringify(DEFAULTS.batch)}`)
})

test('a rating reads as good or bad with an optional note', async () => {
  expect(parseRating('rate good')).toEqual({ verdict: 'good' })
  expect(parseRating('rate bad  too busy, drop the rate')).toEqual({ verdict: 'bad', note: 'too busy, drop the rate' })
  expect(parseRating('on')).toBeNull()
})

test('the ledger binds the writer: seed rules, ratings for this card, and a disliked layout refused', async () => {
  const bad = { title: 'b', rows: [[{ src: 'marks' }]] }
  const entries = [
    { at: 'x', verdict: 'bad' as const, signal: 'bisect' as const, recipe: bad, note: 'too bare' },
    { at: 'y', verdict: 'good' as const, signal: 'batch' as const, recipe: DEFAULTS.batch },
    { at: 'z', verdict: 'good' as const, note: 'love the borders' },
  ]
  const r = rules(entries, 'bisect')
  expect(r.slice(0, SEED.length)).toEqual(SEED)
  expect(r).toContain('Disliked the bisect card "b" with rows marks: too bare. Do not repeat it.')
  expect(r).toContain('Liked the cards: love the borders.')
  expect(r.some(x => x.includes('batch card'))).toBe(false)
  expect(isRefused(entries, 'bisect', bad)).toBe(true)
  expect(isRefused(entries, 'bisect', DEFAULTS.bisect)).toBe(false)
})

test('/xray rate files the rating; the panel lists it', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'xray', args: 'rate bad too busy', origin: { kind: 'composer' } } as never)
  expect(r.text).toBe('the cards rated bad. 1 in the taste ledger.')
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'Pane', requestId: 'xray', props: { title: 'xray', isFocused: false, bodyColumns: 90, placement: 'inline' } as never })
  expect(await ui.find({ type: 'Text', text: /taste ledger · 1/ })).toBeDefined()
  await ui.unmount()
})
