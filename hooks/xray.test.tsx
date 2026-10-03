import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'

import { TONE_COLOR, compact, deviceGlyph, effortTag, filmstrip, mood, stepCounts, teleParts, lastTurn, nowCard, taskCard, todoCard, where, PENDING_BG } from './cards'
import { allot, body, ideal, pack, spinnerRows, tileRows, wrap } from './layout'
import { DEFAULTS, checkRecipe, detect, lastLine, lastPair, parseRecipe, writerPrompt } from './custom'
import { SEED, isRefused, parseRating, rules } from './ledger'
import { panel } from './panel'
import { cacheLeft, cacheRows, cacheStrip, emptyCache, isToastDue, nextChange, noteRequest, transcriptPath, ttlFromTail, type Cache } from './cache'
import { checkVoice, narrationOf, isCheckCommand, isTestCommand, parseTestOutput, sayStep } from './parse'
import { recall, record } from './memory'
import { agentStep, carryTodos, checkSignal, endTurn, finishAgent, finishStep, isJobDue, loadTurn, newTurn, queueFromResponse, readJob, saveTurn, spawnAgent, startStep } from './track'

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
  expect(sayStep('Bash', { command: 'node test.js' })).toBe('running node test.js')
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
  expect(text(taskCard(t, 8000).spare)).toBe('runs ██ 41 → 42 passing')
  expect(taskCard(t, 8000).spare?.[1]?.color).toBe('red')
  expect(lastTurn(t, 9000)).toEqual({ title: 'tests · run 2', headline: 'all 42 pass ✓', tone: 'ok', owed: [] })
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
  expect(lastTurn(t, 40).headline).toBe('passed ✓')
})

test('a run cut off by the end of the turn reads as stopped, not running', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'a', 'Bash', { command: 'pytest' }, 0)
  endTurn(t)
  expect(lastTurn(t, 10)).toEqual({ title: 'tests · run 1', headline: 'run stopped', tone: 'fail', owed: [] })
})

test('a long line wraps at a space into the card body instead of being cut', async () => {
  const rows = body({ title: 'now', tone: 'quiet', lines: [[{ t: '◆ reading' }], [{ t: '» Rerunning the tests after fixing the rounding', dim: true }]] }, 20, 3)
  expect(rows.map(text)).toEqual(['◆ reading', '» Rerunning the', '  tests after…'])
  expect(rows[1]?.[0]?.dim).toBe(true)
  const styled = wrap([{ t: 'next ▸ ', dim: true }, { t: 'updating all of the call sites' }], 16)
  expect(styled.map(text)).toEqual(['next ▸ updating', '  all of the', '  call sites'])
})

test('a spare row is drawn only when the lines leave one free after wrapping', async () => {
  const spare = [{ t: 'steps ▆▆' }]
  expect(body({ title: 'x', tone: 'quiet', lines: [[{ t: 'a' }], [{ t: 'short' }]], spare }, 20, 3).map(l => text(l))).toEqual(['a', 'short', 'steps ▆▆'])
  expect(body({ title: 'x', tone: 'quiet', lines: [[{ t: 'a' }], [{ t: 'a narration long enough to wrap' }]], spare }, 20, 3).map(l => text(l))).toEqual(['a', 'a narration long', '  enough to wrap'])
})

test('the telemetry figures are only the measured ones', async () => {
  const t = newTurn('x', 0)
  const all = (c: number | null, n: number) => {
    const p = teleParts(t, c, n)
    return [p.ctx, p.tok, p.cache, p.turn, p.effort].filter(Boolean).map(x => text(x)).join('   ')
  }
  expect(all(null, 5000)).toBe('turn 5s')
  t.requests.push({ startedAt: 0, firstAt: 1000, endedAt: 3000, output: 80, input: 100, cacheRead: 800, cacheWrite: 100 })
  expect(all(41.4, 72_000)).toBe('ctx ███▎░░░░ 41%   tok/s 40   cache ██████▍░ 80%   turn 1m 12s')
  expect(teleParts(t, 74, 0).ctx?.find(x => x.t === ' 74%')?.color).toBe('yellow')
  t.requests.push({ startedAt: 3000, firstAt: 3500, endedAt: 4500, output: 20, input: 100, cacheRead: 800, cacheWrite: 100 })
  expect(all(null, 5000)).toContain('tok/s █▁ 33')
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
  expect(text(card.lines[0])).toBe('■✕ 1 done · 1 failed')
  expect(card.tone).toBe('fail')
  expect(lastTurn(t, 40).headline).toBe('1 done · 1 failed')
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

test('the to-do card: one cell per to-do, live a patch in its hue, pending grey, done struck through; plate tags in the border', async () => {
  const t = newTurn('x', 0)
  expect(text(todoCard(t, 10).lines[0])).toBe('no to-do list yet')
  startStep(t, 'w', 'TodoWrite', { todos: [{ content: 'read spec', status: 'completed' }, { content: 'draw cards', status: 'in_progress' }, { content: 'commit', status: 'pending' }] }, 0)
  const card = todoCard(t, 50)
  expect(card.title).toBe('to-do · 1 of 3')
  expect((card.tiles ?? []).map(x => `${x.n} ${x.mark} ${x.text}`)).toEqual(['1 ■ read spec', '2 ◆ draw cards', '3 □ commit'])
  expect(card.tiles?.[0]).toMatchObject({ fill: false, look: { strike: true } }) // done: struck through in its hue
  expect(card.tiles?.[1]).toMatchObject({ fill: true, look: { color: 'black', bg: t.todos[1]?.color } }) // live: a solid patch, never inverse
  expect(card.tiles?.[2]).toMatchObject({ fill: true, look: { color: 'black', bg: PENDING_BG } }) // pending: a light grey patch, the same on every palette
  expect(text(card.foot)).toBe('▸ ' + t.todos[1]?.active) // the one in progress, as the card's fact row
  expect(new Set(t.todos.map(x => x.color)).size).toBe(3)
  expect(t.todos.some(x => x.color === 'red')).toBe(false)
  expect(card.tiles?.[0]?.look.color).toBe(t.todos[0]?.color)
  expect(card.note).toBeUndefined()
  expect(text(todoCard(t, 72).note)).toBe('▲ context 72%')
  // a rewrite keeps each surviving to-do's hue
  const hue = t.todos[1]?.color
  startStep(t, 'w2', 'TodoWrite', { todos: [{ content: 'draw cards', status: 'completed' }, { content: 'commit', status: 'in_progress' }, { content: 'push', status: 'pending' }] }, 1)
  expect(t.todos[0]?.color).toBe(hue)
  expect(new Set(t.todos.map(x => x.color)).size).toBe(3)
  // cells sit left to right in list order, each name wrapped inside its own cell
  const rows = tileRows(todoCard(t, 10).tiles ?? [], 60, 3).map(l => text(l))
  expect(rows.length === 3 && rows.every(r => r.length <= 60)).toBe(true) // fits; the card pads the rest
  expect(rows[0]).toMatch(/■ 1 .*◆ 2 .*□ 3/)
  expect(rows[1]).toMatch(/draw cards .*commit .*push/)
  const next = newTurn('y', 10)
  carryTodos(t, next)
  expect(next.todos.map(x => x.text)).toEqual(['draw cards', 'commit', 'push']) // whole while any is open: the count stays true
  expect(todoCard(next, 10).title).toBe('to-do · 1 of 3')
  next.todos.forEach(x => (x.status = 'completed'))
  const after = newTurn('z', 20)
  carryTodos(next, after)
  expect(after.todos).toEqual([]) // all done: the next turn starts clean
})

test('a carried list at 4 of 5 opens the next turn green before any step runs', async () => {
  const t = newTurn('x', 0)
  t.todos = ['a', 'b', 'c', 'd', 'e'].map((s, i) => ({ id: `${i}`, text: s, active: s, status: i < 4 ? 'completed' : 'pending' }))
  const next = newTurn('y', 10)
  carryTodos(t, next)
  expect(next.done.length).toBe(0)
  expect(mood(next, undefined, 10)?.word).toBe('closing')
  const k = compact(next, undefined, null, 8, 10, 44, false) // the phone card
  expect(k.tone).toBe('ok')
  expect(k.status).toMatch(/^✓ closing/)
  next.todos[3]!.status = 'pending' // 3 of 5 is under the bar
  expect(mood(next, undefined, 10)?.word).not.toBe('closing')
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
  expect(text(nowCard(t, 'tool-use', 'Running the suite.', 4000).lines[0])).toBe(' ◆  running the tests ▄')
  expect(text(nowCard(t, 'tool-use', 'Running the suite.', 9000).lines[0])).toBe(' ◆  running the tests · 8s █')
  expect(nowCard(t, 'tool-use', null, 9000).lines[0]?.[0]?.inv).toBe(true)
  expect(nowCard(t, 'tool-use', null, 9000).spare).toBeUndefined() // the steps live in the progress card (round 13)
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
  expect(await ui.find({ type: 'Text', text: /^ ◇ thinking $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /progress/ })).toBeDefined()
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

test('a narrator that answers "-" (nothing to say) shows nothing and holds its minute', async ($, on) => {
  let calls = 0
  engine(on, {}, () => {
    calls += 1
    return { value: { isAnswered: true, text: '-' } } as never
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...submit, text: 'done' })
  await $.prompt.submit({ ...submit, text: 'done' })
  expect(calls).toBe(1)
  expect(narrationOf('-')).toBe('')
  expect(narrationOf(' "—" ')).toBe('')
  expect(narrationOf('» "Taking sum first."')).toBe('Taking sum first.')
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
  expect(text(req?.rows[0])).toBe('#1  ' + '▒'.repeat(7) + '█'.repeat(13) + ' ' + '  3.0s  80 out · 40 tok/s · cache 80%')
  expect(text(req?.rows[1])).toContain('20 out · 40 tok/s')
  expect(steps?.title).toBe('steps · 1 done · 1 failed')
  expect(text(steps?.rows[0]).startsWith(' ✕  reading a.ts')).toBe(true)
  expect(text(steps?.rows[1]).startsWith(' ◆  running the tests')).toBe(true)
  expect(text(session?.rows[0])).toBe('context   ████▉░░░░░░░ 41% · 82k of 200k')
  expect(session?.rows[1]?.[1]?.color).toBe('red')
  expect(text(session?.rows[2])).toBe('spent     $1.84 this session')
  expect(panel(null, null, 0)[0]?.title).toBe('xray')
  t.signal = 'bisect'
  expect(text(panel(t, null, 0).find(x => x.title === 'task card')?.rows[0])).toBe('bisect · kept layout')
  t.recipe = DEFAULTS.bisect
  expect(text(panel(t, null, 0).find(x => x.title === 'task card')?.rows[0])).toBe('bisect · layout written for this task')
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
  expect(text(card.lines[0])).toBe('✕ ✓ 6 commits · ~3 steps')
  expect(card.lines[0]?.[0]).toMatchObject({ color: 'red', inv: true })
  expect(text(card.lines[1])).toBe('testing c1d2e3f · "lexer: utf8"')
  expect(text(card.lines[2])).toBe('░░░░███░░░░░ 6 of 28')
  bash(t, 'd', 'git bisect bad', 'c1d2e3f4aa is the first bad commit', 400)
  expect(taskCard(t, 500).tone).toBe('ok')
  expect(text(taskCard(t, 500).lines[2])).toBe('first bad: c1d2e3f ✓')
  expect(text(taskCard(t, 500).lines[1])).toBe('')
  expect(lastTurn(t, 500)).toMatchObject({ title: 'bisect · step 3', headline: '6 commits · ~3 steps' })
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
  expect(text(card.lines[0])).toBe('███▍░░░░░░░░ 28% · ETA 17m 55s')
  expect(text(card.lines[1])).toBe('48/min · started 6m 00s')
  expect(text(card.lines[2])).toBe('last: 340/1200 wrote shard_0340.parquet')
})

test('a job output file is re-read only when it grew, and a big one waits longer between reads', async () => {
  const job = { path: '/tmp/t/x1.output', startedAt: 0 }
  expect(isJobDue(job, 10, 0)).toBe(true)
  const t = newTurn('convert the shards', 0)
  t.job = job
  readJob(t, 'a\n', 10, 0)
  expect(isJobDue(job, 10, 5000)).toBe(false) // same size: no read
  expect(isJobDue(job, 20, 999)).toBe(false) // small file: one read a second
  expect(isJobDue(job, 20, 1000)).toBe(true)
  readJob(t, 'a\n', 1024 * 1024, 1000)
  expect(isJobDue(job, 1024 * 1024 + 1, 9999)).toBe(false) // 1 MiB: 10 s apart
  expect(isJobDue(job, 1024 * 1024 + 1, 11_000)).toBe(true)
  readJob(t, 'a\n', 4 * 1024 * 1024, 11_000)
  expect(isJobDue(job, 4 * 1024 * 1024 + 1, 21_000)).toBe(true) // capped at 10 s
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
  expect(text(card.lines[0])).toBe('████████▍░░░ 2m 41s of ~3m 50s')
})

test('a written recipe is kept only within the kit; anything else falls back to the kept layout', async () => {
  const full = { title: 'shards · {done}/{total}', rows: [[{ src: 'progress' }, { src: 'percent' }, { src: 'eta', label: 'left' }], [{ src: 'rate' }, { src: 'elapsed' }], [{ src: 'lastline' }]] }
  expect(checkRecipe(full, 'batch')).toEqual(full)
  expect(checkRecipe({ ...full, title: 'shards · 340 done' }, 'batch')).toBeNull()
  expect(checkRecipe({ ...full, rows: [[{ src: 'progress' }, { src: 'eta' }]] }, 'batch')).toBeNull()
  const noTarget = { title: 'bench · run {runs}', rows: [[{ src: 'series' }, { src: 'trend' }, { src: 'change' }], [{ src: 'best', label: 'best' }]] }
  expect(checkRecipe(noTarget, 'bench')).toBeNull()
  expect(checkRecipe(noTarget, 'bench', ['series', 'trend', 'change', 'best', 'runs'])).toEqual(noTarget)
  expect(checkRecipe({ title: 'x', rows: [[{ src: 'tokens' }]] }, 'batch')).toBeNull()
  expect(checkRecipe({ title: '{cost}', rows: [[{ src: 'eta' }]] }, 'batch')).toBeNull()
  expect(checkRecipe({ title: 'x', rows: [[], [], [], []] }, 'batch')).toBeNull()
  expect(checkRecipe({ title: 'x', rows: [[{ src: 'eta', label: 'a label far too long' }]] }, 'batch')).toBeNull()
  expect(parseRecipe(`Here: ${JSON.stringify(DEFAULTS.bisect)} done`, 'bisect')?.rows[0]?.[0]?.src).toBe('marks')
  expect(parseRecipe('{"title":"bisect","rows":[[{"src":"marks"}]]}', 'bisect')).toBeNull()
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

test('the idle strip leads with the device class glyph, nothing when unknown or absent', async () => {
  expect(deviceGlyph('mobile')).toBe('📱')
  expect(deviceGlyph('desktop')).toBe('🖥')
  expect(deviceGlyph('local')).toBe('⌂')
  expect(deviceGlyph('unknown')).toBeUndefined()
  expect(deviceGlyph(undefined)).toBeUndefined()
})

const LAST = { title: 'tests', headline: 'all 11 pass ✓', tone: 'ok' as const, owed: [] }
const fakeDevice = {
  name: 'device',
  register: (on: On) => {
    on('engine.create', async (_$, e, next) => ({ ...(await next(e)), device: { class: async () => 'mobile' } }))
  },
}

test('the idle strip leads with 📱 when the device mod says mobile', { plugins: [fakeDevice] }, async ($, on) => {
  on('state.get', async () => ({ value: { value: LAST, version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await ui.find({ type: 'Text', text: /📱/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /still owed/ })).toBeUndefined()
  await ui.unmount()
})

const fakeDesktop = {
  name: 'device',
  register: (on: On) => {
    on('engine.create', async (_$, e, next) => ({ ...(await next(e)), device: { class: async () => 'desktop' } }))
  },
}

test('on a desktop the idle strip keeps its still-owed tail', { plugins: [fakeDesktop] }, async ($, on) => {
  on('state.get', async () => ({ value: { value: LAST, version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await ui.find({ type: 'Text', text: /🖥/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /still owed/ })).toBeDefined()
  await ui.unmount()
})

test('without the device mod the idle strip draws as before, no glyph', async ($, on) => {
  on('state.get', async () => ({ value: { value: LAST, version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /📱|🖥|⌂/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /still owed/ })).toBeDefined()
  await ui.unmount()
})

test('the panel lists what is still owed, the one in progress marked', async () => {
  const t = newTurn('x', 0)
  expect(panel(t, null, 0).find(x => x.title.startsWith('still owed'))).toBeUndefined()
  t.todos = [
    { id: '1', text: 'write spec', active: 'writing spec', status: 'completed', color: 'green' },
    { id: '2', text: 'build it', active: 'building it', status: 'in_progress', color: 'cyan' },
    { id: '3', text: 'run tests', active: 'running tests', status: 'pending', color: 'yellow' },
  ]
  const owed = panel(t, null, 0).find(x => x.title.startsWith('still owed'))
  expect(owed?.title).toBe('still owed · 2')
  expect(owed?.rows.map(r => text(r))).toEqual(['◆ build it', '· run tests'])
  expect(owed?.rows[1]?.[0]?.color).toBe('yellow')
  t.todos = t.todos.map(x => ({ ...x, status: 'completed' as const }))
  expect(text(panel(t, null, 0).find(x => x.title.startsWith('still owed'))?.rows[0])).toBe('nothing ✓')
})

function busyTurn() {
  const t = newTurn('x', 0)
  for (let i = 0; i < 6; i++) t.requests.push({ startedAt: i * 4000, firstAt: i * 4000 + 1000, endedAt: i * 4000 + 3000, output: 12_000, input: 100, cacheRead: 800, cacheWrite: 100 })
  for (let i = 0; i < 6; i++) {
    startStep(t, `s${i}`, 'Bash', { command: 'make deploy', description: 'Deploy the whole integration build for the device mod' }, i * 100)
    finishStep(t, `s${i}`, 'Bash', { command: 'make deploy' }, true, '', undefined, i * 100 + 50)
  }
  t.todos = Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, text: `to-do number ${i}`, active: '', status: 'pending' as const, color: 'cyan' }))
  return t
}
const USAGE = { context: { tokens: 214_000, window: 1_000_000, percent: 21 }, cost: { usd: 1.84 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-02T23:00:00Z' }] }
const rowCols = (l?: { t: string }[]) => text(l).length

test('at 60 columns and wider the panel draws exactly as it always has', async () => {
  const t = busyTurn()
  expect(panel(t, USAGE, 30_000, [], { cols: 88, rows: 50 })).toEqual(panel(t, USAGE, 30_000))
  expect(panel(t, USAGE, 30_000, [], { cols: 60 })).toEqual(panel(t, USAGE, 30_000))
})

test('on a phone (42 text columns) every panel row fits, the core of each kept', async () => {
  const sections = panel(busyTurn(), USAGE, 30_000, [], { cols: 42 })
  for (const sec of sections) for (const r of sec.rows) expect(rowCols(r)).toBeLessThanOrEqual(42)
  const req = sections.find(x => x.title.startsWith('requests'))
  expect(text(req?.rows[0])).toContain('12k out')
  expect(text(req?.rows[0])).not.toContain('cache')
  expect(text(sections.find(x => x.title.startsWith('steps'))?.rows[0])).toContain('…')
  expect(text(sections.find(x => x.title === 'session')?.rows[0])).toBe('context   ██▌░░░░░░░░░ 21% · 214k of 1000k')
  expect(text(panel(busyTurn(), USAGE, 30_000, [], { cols: 30 }).find(x => x.title === 'session')?.rows[0])).toBe('context   ██▌░░░░░░░░░ 21%')
})

test('with the keyboard up (few rows) the panel shows fewer of each', async () => {
  const sections = panel(busyTurn(), USAGE, 30_000, [], { cols: 42, rows: 21 })
  expect(sections.find(x => x.title.startsWith('requests'))?.rows.length).toBe(3)
  expect(sections.find(x => x.title.startsWith('steps'))?.rows.length).toBe(3)
  expect(sections.find(x => x.title.startsWith('still owed'))?.rows.length).toBe(4)
  expect(panel(busyTurn(), USAGE, 30_000, [], { cols: 42, rows: 42 }).find(x => x.title.startsWith('requests'))?.rows.length).toBe(6)
})

// Rounds 8–9: under 60 columns one framed card, `width` cells wide: edges hold ≤ width − 6, body rows ≤ width − 4.
test('on a phone the card grows one row for a long narration, each row within the frame', async () => {
  const t = busyTurn()
  startStep(t, 'live', 'Bash', { command: 'ls', description: 'List files' }, 900) // a short status: the spare row is the narration's
  t.todos[0] = { ...t.todos[0]!, status: 'completed' }
  t.todos[1] = { ...t.todos[1]!, status: 'in_progress' }
  const k = compact(t, 'tool-use', 'checking which of the model files exist on the disk right now', 41, 30_000, 44, false)
  expect(k.body.length).toBe(3)
  expect(k.status.length).toBeLessThanOrEqual(36) // band: width − 8
  expect(k.more).toBeUndefined()
  expect(text(k.bottom).length).toBeLessThanOrEqual(38)
  for (const r of k.body) expect(text(r).length).toBeLessThanOrEqual(40)
  // The narration takes the one spare row instead of being cut.
  expect(text(k.body[0])).toBe('» checking which of the model files')
  expect(text(k.body[1])).toBe('  exist on the disk right now')
  expect(text(k.body[2])).toMatch(/^steps █{6}[█▄]░ 6 done {2}■◆□□□□ 1\/6$/)
  expect(text(k.bottom)).toMatch(/^ctx {2}.{8} 41% {2}\d+ t\/s {2}30s$/)
  expect(k.tone).toBe('live')
})

test('the steps and ctx gauges start in one column, both 8 cells', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'a', 'Bash', { command: 'ls' }, 0)
  expect(text(taskCard(t, 9000).lines[0])).toBe('steps █░░░░░░░ 0 done') // live step, blinking █/▄ at the tick
  expect(text(taskCard(t, 10_000).lines[0])).toBe('steps ▄░░░░░░░ 0 done')
  finishStep(t, 'a', 'Bash', { command: 'ls' }, false, '', undefined, 10)
  const k = compact(t, undefined, null, 16, 30_000, 44, false)
  const steps = '│ ' + text(k.body[1])
  const ctx = '╰─ ' + text(k.bottom)
  expect(steps.search(/[█▄░]/)).toBe(ctx.search(/[█▉▊▋▌▍▎▏░]/))
  expect(steps.slice(8, 16)).toBe('█░░░░░░░')
  expect(text(k.body[1])).toContain('1 failed')
  expect(k.tone).toBe('fail')
})

test('with the keyboard up the body folds to one row and the bottom edge is bare', async () => {
  const k = compact(busyTurn(), undefined, null, 6, 30_000, 44, true)
  expect(k.body.length).toBe(1)
  expect(k.bottom).toEqual([])
  // 6000 t/s would push the row past 40 cells, so it goes whole.
  expect(text(k.body[0])).toBe('██████ 6 · □□□□□□ 0/6 · ctx 6%')
  // Too narrow for every part: the rightmost go whole, the rest stay intact.
  // At 28 cells the status ('◇ waiting on the model · 29s') wraps too, so the folded row is second.
  const narrow = compact(busyTurn(), undefined, null, 6, 30_000, 28, true)
  expect(narrow.more).toBe('model · 29s')
  expect(text(narrow.body[0])).toBe('██████ 6 · □□□□□□ 0/6')
})

test('the spinner draws one framed card at 47 columns, folded at 21 rows, the three cards at 100', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(submit)
  const at = (columns: number, rows: number) => $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'Spinner', props: spinnerProps, viewport: { columns, rows } })
  const phone = await at(47, 42)
  expect(await phone.find({ type: 'Text', text: /╭─ now/ })).toBeUndefined()
  expect(await phone.find({ type: 'Text', text: /^╭$/ })).toBeDefined()
  const band = await phone.find({ type: 'Text', text: /^ ◇ thinking $/ }) // the status band
  expect((band as { props?: Record<string, unknown> } | undefined)?.props?.backgroundColor).toBe('magenta')
  expect((band as { props?: Record<string, unknown> } | undefined)?.props?.inverse).toBeUndefined()
  expect(await phone.find({ type: 'Text', text: /thinking/ })).toBeDefined()
  expect(await phone.find({ type: 'Text', text: /^» / })).toBeDefined()
  await phone.unmount()
  const typing = await at(47, 21)
  expect(await typing.find({ type: 'Text', text: /^» / })).toBeUndefined()
  expect(await typing.find({ type: 'Text', text: /thinking/ })).toBeDefined()
  await typing.unmount()
  const wide = await at(100, 42)
  // Round 13: the wide cards wear the phone's look, the now card's head as a band, telemetry as one bottom edge.
  expect(await wide.find({ type: 'Text', text: /╭─ now/ })).toBeUndefined()
  const wband = await wide.find({ type: 'Text', text: /^ ◇ thinking $/ })
  expect((wband as { props?: Record<string, unknown> } | undefined)?.props?.backgroundColor).toBe('magenta')
  // Round 16: under 140 columns, and with no to-dos at all, the to-do card folds away; the tray closes the cards.
  expect(await wide.find({ type: 'Text', text: /╭─ to-do/ })).toBeUndefined()
  expect(await wide.find({ type: 'Text', text: /^╰─ $/ })).toBeDefined()
  await wide.unmount()
})

test('the progress card carries the step gauge, then the to-do squares and the one in progress', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'a', 'Bash', { command: 'ls' }, 0)
  expect(text(taskCard(t, 9000).lines[0])).toBe('steps █░░░░░░░ 0 done') // live step, blinking █/▄ at the tick
  expect(text(taskCard(t, 10_000).lines[0])).toBe('steps ▄░░░░░░░ 0 done')
  finishStep(t, 'a', 'Bash', { command: 'ls' }, true, '', undefined, 10)
  startStep(t, 'b', 'Bash', { command: 'false' }, 20)
  finishStep(t, 'b', 'Bash', { command: 'false' }, false, '', undefined, 30)
  expect(text(taskCard(t, 1000).lines[0])).toBe('steps ██░░░░░░ 2 done · 1 failed')
  expect(taskCard(t, 1000).lines[0]?.[2]?.color).toBe('red')
  startStep(t, 'w', 'TodoWrite', { todos: [{ content: 'read spec', status: 'completed' }, { content: 'draw cards', status: 'in_progress', activeForm: 'drawing cards' }, { content: 'commit', status: 'pending' }] }, 40)
  finishStep(t, 'w', 'TodoWrite', {}, true, '', undefined, 50)
  const c = taskCard(t, 1000)
  expect(text(c.lines[1])).toBe('to-do ■◆□ 1/3')
  expect(text(c.lines[2])).toBe('drawing cards')
})

test('the narrow ctx gauge draws whole cells only, one at any use (no near-blank eighth)', async () => {
  const gauge = (pct: number) => text(compact(newTurn('x', 0), undefined, null, pct, 1000, 44, false).bottom).slice(5, 13)
  expect(gauge(15)).toBe('█░░░░░░░')
  expect(gauge(2)).toBe('█░░░░░░░')
  expect(gauge(0)).toBe('░░░░░░░░')
  expect(gauge(50)).toBe('████░░░░')
})

test('a step past a minute reads 2m 01s, not 121s', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'a', 'Bash', { command: 'make' }, 0)
  expect(text(nowCard(t, 'tool-use', null, 121_000).lines[0])).toContain('· 2m 01s')
})

test('panel times past a minute read 2m 01s, not 121s', async () => {
  const t = newTurn('x', 0)
  t.requests.push({ startedAt: 0, firstAt: 1000, endedAt: 121_000, output: 100, input: 10, cacheRead: 0, cacheWrite: 0 })
  startStep(t, 'a', 'Bash', { command: 'make' }, 0)
  finishStep(t, 'a', 'Bash', { command: 'make' }, true, '', undefined, 4_200)
  const rows = panel(t, null, 200_000).flatMap(x => x.rows.map(r => text(r)))
  expect(rows.some(r => r.includes('2m 01s'))).toBe(true)
  expect(rows.some(r => /\b121s\b/.test(r))).toBe(false)
  expect(rows.some(r => r.includes('4.2s'))).toBe(true)
})

test('a long status wraps into the spare row, keyboard up or down; the card grows by one row at most', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'a', 'Bash', { command: 'make', description: 'Rebuild the whole integration bundle for every device' }, 0)
  const say = 'a narration line that would also like the spare row on the phone screen'
  const down = compact(t, 'tool-use', say, 20, 9_000, 44, false)
  const up = compact(t, 'tool-use', say, 20, 9_000, 44, true)
  // The band carries the status as plain text: tile, timer and spaces folded, the pulse kept apart.
  expect(down.status).toBe('◆ rebuild the whole integration')
  expect(down.more).toBe('bundle for every device · 9s')
  expect(down.pulse?.t).toMatch(/^[▂▄▆█]$/)
  for (const k of [down, up]) {
    expect(k.status.length).toBeLessThanOrEqual(36)
    expect(k.more).toBe(down.more)
    for (const r of k.body) expect(text(r).length).toBeLessThanOrEqual(40)
  }
  // The status took the spare row: the narration is cut, the card grows by that one row only.
  expect(down.body.length).toBe(2)
  expect(text(down.body[0])).toMatch(/^» a narration .*…$/)
  expect(up.body.length).toBe(1)
  // A short status and short narration: no extra row.
  expect(compact(newTurn('x', 0), undefined, 'short', 20, 1000, 44, false).body.length).toBe(2)
  expect(compact(newTurn('x', 0), undefined, null, 20, 1000, 44, true).body.length).toBe(1)
})

test('step text is kept to 72 chars and the now card shows it whole, last: included', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'a', 'Bash', { command: 'make', description: 'Rebuild the whole integration bundle for every device' }, 0)
  expect(text(nowCard(t, 'tool-use', null, 1000).lines[0])).toBe(' ◆  rebuild the whole integration bundle for every device █')
  finishStep(t, 'a', 'Bash', { command: 'make' }, true, '', undefined, 500)
  expect(text(nowCard(t, undefined, null, 1000).lines[1])).toBe('last: rebuild the whole integration bundle for every device')
})

test('effort shows in shorthand: desktop telemetry, phone bottom edge, keyboard-up row; nothing when absent', async () => {
  expect([effortTag('low'), effortTag('medium'), effortTag('high'), effortTag('xhigh'), effortTag('max'), effortTag(undefined)]).toEqual(['○ low', '◐ med', '● high', '◉ xhigh', '◉ max', undefined])
  const t = newTurn('x', 0)
  expect(teleParts(t, null, 5000).effort).toBeUndefined()
  t.effort = 'medium'
  expect(text(teleParts(t, null, 5000).effort)).toBe('◐ med')
  expect(text(compact(t, undefined, null, 22, 2000, 44, false).bottom)).toBe('ctx  ██░░░░░░ 22%  ◐ med  2s')
  expect(text(compact(t, undefined, null, 22, 2000, 44, true).body[0])).toBe('░░░░░░ 0 · ctx 22% · ◐ med')
})

test('round 17: a k-of-N in other tool output while a job runs is not a batch', async () => {
  const t = newTurn('wait on the pane', 0)
  bash(t, 'j', 'until grep -q x f; do sleep 1; done', 'Command running in background with ID: x2. Output is being written to: /tmp/t/x2.output', 0, 5, { run_in_background: true })
  bash(t, 'g', 'grep -n budget SPEC.md', 'note: 80 of 100 rows kept', 10, 20)
  checkSignal(t, 30)
  expect(t.signal).toBeUndefined()
})

test('a finished turn survives the trip through $.state that a hot reload makes', async () => {
  const t = newTurn('fix the build', 1_000)
  bash(t, 'b1', 'npm test', 'Tests: 3 passed, 3 total', 2_000)
  t.todos = [{ id: '1', text: 'ship', active: 'shipping', status: 'pending', color: 'cyan' }]
  endTurn(t)
  const back = loadTurn(saveTurn(t))
  expect(back?.prompt).toBe('fix the build')
  expect(back?.edited instanceof Map).toBe(true)
  expect(back?.done.length).toBe(1)
  expect(panel(back, null, 5_000).map(x => x.title)).toEqual(panel(t, null, 5_000).map(x => x.title))
  const next = newTurn('next', 6_000)
  carryTodos(back, next)
  expect(next.todos.map(x => x.text)).toEqual(['ship'])
  expect(loadTurn('{not json')).toBe(null)
})

// Round 16 layout: a mid-fix turn with a to-do list, two edits and failing runs.
function midFix() {
  const t = newTurn('fix the bugs in sum.js one at a time', 0)
  startStep(t, 'w', 'TodoWrite', { todos: [{ content: 'run tests', status: 'completed' }, { content: 'fix sum', status: 'completed' }, { content: 're-run tests', status: 'completed' }, { content: 'fix mul', status: 'in_progress', activeForm: 'fixing mul in sum.js' }, { content: 're-run tests to verify', status: 'pending' }] }, 0)
  finishStep(t, 'w', 'TodoWrite', {}, true, '', undefined, 10)
  startStep(t, 'b1', 'Bash', { command: 'npm test' }, 1_000)
  finishStep(t, 'b1', 'Bash', { command: 'npm test' }, false, 'Tests: 2 failed, 1 passed, 3 total', undefined, 1_500)
  startStep(t, 'e', 'Edit', { file_path: 'sum.js' }, 3_000)
  finishStep(t, 'e', 'Edit', { file_path: 'sum.js' }, true, '', undefined, 3_500)
  startStep(t, 'b2', 'Bash', { command: 'npm test' }, 4_000)
  finishStep(t, 'b2', 'Bash', { command: 'npm test' }, false, 'Tests: 1 failed, 2 passed, 3 total', undefined, 4_500)
  return t
}
const NARR = "sum's clean after one edit. mul next, same file, one line down; the assert wants 6 and it returns 5."

test('round 16: every row is exactly as wide as asked, at 190, 120 and 60 columns, 3 or 4 body rows', async () => {
  const t = midFix()
  for (const cols of [188, 118, 60]) {
    for (const rows of [3, 4]) {
      const out = spinnerRows(t, undefined, NARR, 17, 9_000, cols, rows)
      expect(out.length).toBe(rows + 2)
      expect(out.map(l => text(l).length)).toEqual(Array(rows + 2).fill(cols))
    }
  }
})

test('round 16: three cards from 140 columns with a gap between them; below, the task card rides in the now card (round 17)', async () => {
  const t = midFix()
  const wide = spinnerRows(t, undefined, NARR, 17, 9_000, 188, 4).map(l => text(l))
  expect(wide[0]?.match(/╮ ╭/g)?.length).toBe(2) // three cards, one blank column between each
  expect(wide[0]).toContain('╭─ to-do · 3 of 5')
  expect(wide.some(r => r.includes('▸ fixing mul in sum.js'))).toBe(true)
  expect(wide.at(-1)).toMatch(/^╰─ turn 9s .*┴─┴─ ctx .*┴─┴[─╌]*╯$/) // the tray: each card's figures under it
  const mid = spinnerRows(t, undefined, NARR, 17, 9_000, 118, 4).map(l => text(l))
  expect(mid[0]?.match(/╮ ╭/g)?.length).toBe(1)
  expect(mid[0]).toContain('╭─ to-do · 3 of 5') // the to-dos keep their card
  expect(mid[1]).toMatch(/■ 1 .*◆ 4 .*□ 5/) // all five cells: the now card gives way to its floor for them
  expect(mid.some(r => /│ tests · run 2  .*pass/.test(r))).toBe(true) // the task card's first row is the now card's fact
})

test('round 16: narration wraps whole and the last step keeps its own row; beside to-do cells the prose takes three rows', async () => {
  const t = midFix()
  const out = spinnerRows(t, undefined, NARR, 17, 9_000, 188, 4).map(l => text(l))
  const nowCol = (r: string) => r.slice(0, r.indexOf('│', 1) + 1)
  const rows = out.slice(1, 5).map(nowCol).map(r => r.slice(2, -2).trimEnd())
  expect(rows.join(' ').replace(/\s+/g, ' ')).toContain('the assert wants 6 and it returns 5.')
  expect(rows.at(-1)).toMatch(/^last: /) // the fact row last, the story whole above it
  expect(rows.slice(0, 3).every(r => r !== '')).toBe(true) // three rows of prose, the now card no wider than that needs
  expect(rows[0]?.length ?? 0).toBeLessThan(50)
  // at 3 rows the blank goes first; the fact row stays
  const three = spinnerRows(t, undefined, NARR, 17, 9_000, 188, 3).map(l => text(l)).slice(1, 4).map(nowCol)
  expect(three[2]).toMatch(/last: /)
})

test('round 16: a card asks for its content width; the prose card takes what is left', async () => {
  expect(allot([100, 40, 50], 188)).toEqual([188 - 2 - 40 - 50, 40, 50])
  expect(allot([100, 10, 10], 100)).toEqual([100 - 2 - 24 - 24, 24, 24]) // never under the minimum
  const ws = allot([100, 200, 200], 100)
  expect(ws[0]).toBeGreaterThanOrEqual(36) // the now card keeps room to read
  expect(ws.reduce((a, b) => a + b, 0)).toBe(98)
  expect(ideal({ title: 'x', tone: 'quiet', lines: [[{ t: 'ab' }]], side: [[{ t: 'cdef' }]] })).toBe(2 + 3 + 4 + 4)
  expect(allot([30, 70], 118)).toEqual([117 - 70, 70]) // a short narration lends its width to a card that needs it
  expect(allot([200, 70], 118)[0]).toBe(Math.floor(117 * 0.55)) // a long one holds back at most 55%, and wraps
})

test('round 16: wrap breaks at words, pack keeps chips whole, body ends in … only when rows run out', async () => {
  expect(wrap([{ t: 'one two three four' }], 9).map(l => text(l))).toEqual(['one two', '  three', '  four'])
  expect(pack([[{ t: 'aaa' }], [{ t: 'bbb' }], [{ t: 'ccc' }]], 8).map(l => text(l))).toEqual(['aaa  bbb', 'ccc'])
  const long = body({ title: 'now', tone: 'quiet', lines: [[{ t: 'word '.repeat(30).trim() }]], foot: [{ t: 'last: x' }] }, 20, 3).map(l => text(l))
  expect(long[1]?.endsWith('…')).toBe(true)
  expect(long[2]).toBe('last: x')
})

test('round 16: the spinner takes one more body row on a tall terminal', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(submit)
  const at = async (rows: number) => {
    const m = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'Spinner', props: spinnerProps, viewport: { columns: 120, rows } })
    const n = (await m.findAll({ type: 'Text', text: /^│ $/ })).length
    await m.unmount()
    return n
  }
  expect(await at(50)).toBe(2 * 4) // two cards × 4 body rows
  expect(await at(35)).toBe(2 * 3)
})

test('the filmstrip colors each step by its kind, failures red, the live one blinking; to-do bookkeeping left out', async () => {
  const t = midFix()
  const strip = filmstrip(t, 24, 9_000, false)
  expect(strip.map(s => `${s.t}:${s.color}`)).toEqual(['█:red', '█:yellow', '█:red'])
  startStep(t, 'r', 'Read', { file_path: 'sum.js' }, 9_000)
  const live = filmstrip(t, 24, 9_000, false)
  expect(live.at(-1)?.color).toBe('blue')
  expect(filmstrip(t, 8, 9_000).map(s => s.t).join('')).toMatch(/^███[▌▄]░{4}$/) // the phone's 8-cell gauge on its track
  for (let i = 0; i < 30; i++) bash(t, `x${i}`, 'ls', '', 10_000 + i)
  const long = filmstrip(t, 12, 11_000, false)
  expect(long[0]?.t).toMatch(/^\+\d+ $/) // older steps fold into a count
  expect(long.slice(1).length).toBe(9)
  expect(text(stepCounts(t))).toBe('33 done · 2 ✕')
})

test('mood comes from measured steps: exploring, focused, stuck, closing, thinking', async () => {
  const t = newTurn('look around', 0)
  expect(mood(t, undefined, 0)).toBeUndefined()
  for (const f of ['a.ts', 'b.ts', 'c.ts']) {
    startStep(t, f, 'Read', { file_path: f }, 10)
    finishStep(t, f, 'Read', { file_path: f }, true, '', undefined, 20)
  }
  expect(mood(t, undefined, 30)?.word).toBe('exploring')
  expect(mood(t, 'thinking', 20_000)?.word).toBe('thinking')
  const f = midFix() // two failing runs with an edit between, the second one better
  expect(mood(f, undefined, 9_000)?.word).toBe('focused')
  startStep(f, 'b3', 'Bash', { command: 'npm test' }, 9_000)
  finishStep(f, 'b3', 'Bash', { command: 'npm test' }, false, 'Tests: 3 failed, 0 passed, 3 total', undefined, 9_500)
  expect(mood(f, undefined, 10_000)?.word).toBe('stuck')
  const stuck = spinnerRows(f, undefined, null, 10, 10_000, 188, 3).map(l => text(l))
  expect(stuck[0]?.slice(0, 60)).not.toContain('╌') // stuck: the now card is red but still
  expect(stuck[0]).toContain('╌') // the failing tests card walks
  expect(text(nowCard(f, undefined, null, 10_000).lines[0])).toMatch(/^✕ stuck · /)
  expect(nowCard(f, undefined, null, 10_000).tone).toBe('fail')
  startStep(f, 'b4', 'Bash', { command: 'npm test' }, 11_000)
  finishStep(f, 'b4', 'Bash', { command: 'npm test' }, true, 'Tests: 3 passed, 3 total', undefined, 11_500)
  expect(mood(f, undefined, 12_000)?.word).toBe('closing')
})

test('the narrator line is kept only when its numbers and names are in the facts', async () => {
  const facts = 'Steps so far:\n- editing sum.js\nLatest test run: 2 of 3 pass, failing: mul'
  expect(checkVoice('Two red on the board. Taking sum first.', facts)).toBe(true)
  expect(checkVoice('2 of 3 pass; mul next in sum.js.', facts)).toBe(true)
  expect(checkVoice('4 tests failing in cost.ts.', facts)).toBe(false) // made-up number and file
  expect(checkVoice('The agent is planning the task.', facts)).toBe(false)
  expect(checkVoice('Claude is planning.', facts)).toBe(false)
  expect(checkVoice('Rebuilding the claude repo docs.', facts)).toBe(true) // the repo's name is fine
  // round 17 live: the narrator wrote about itself on a turn with no steps
  expect(checkVoice("Starting fresh; need facts from you about what's being coded.", facts)).toBe(false)
  expect(checkVoice('I am waiting for more context.', facts)).toBe(false)
  expect(checkVoice('Not enough to go on yet.', facts)).toBe(false)
  expect(checkVoice('Fixing mul next in sum.js.', facts)).toBe(true) // the work itself still passes
})

test('memory: finished runs become events per project; a recurring failure and the usual suite time are recalled', async () => {
  const day1 = Date.UTC(2026, 9, 1)
  const a = newTurn('fix', day1)
  bash(a, 'r1', 'npm test', 'Tests: 3 passed, 3 total', day1 + 1_000, 400)
  bash(a, 'r2', 'npm test', 'Tests: 3 passed, 3 total', day1 + 5_000, 400)
  let h = record([], a)
  expect(h.length).toBe(2)
  const b = newTurn('fix again', day1 + 86_400_000)
  startStep(b, 'r3', 'Bash', { command: 'npm test' }, day1 + 86_401_000)
  finishStep(b, 'r3', 'Bash', { command: 'npm test' }, false, '● mul\nTests: 1 failed, 2 passed, 3 total', undefined, day1 + 86_401_500)
  h = [...h.slice(0, 1), { ...h[1]!, failing: ['mul'] }]
  expect(recall(h, b)).toEqual(['suite 0.5 s, usual 0.4 s', 'mul failed here before, Oct 1'])
  expect(record(Array(60).fill(h[0]), b).length).toBe(50) // capped
})

test('a plan written as text ("Step 3/5: fix mul") fills the to-dos; a tool list always wins', async () => {
  const t = newTurn('x', 0)
  queueFromResponse(t, [{ type: 'text', text: 'Tests show 2 failures. **Step 3/5:** fix mul.' }])
  expect(t.todos.map(x => x.status)).toEqual(['completed', 'completed', 'in_progress', 'pending', 'pending'])
  expect(t.todos[2]?.text).toBe('fix mul')
  queueFromResponse(t, [{ type: 'text', text: 'Step 4/5: re-run tests' }])
  expect(t.todos[2]?.text).toBe('fix mul') // a finished step keeps its name
  expect(t.todos[3]?.status).toBe('in_progress')
  const own = newTurn('y', 0)
  queueFromResponse(own, [{ type: 'text', text: 'Step 3/5 done: tests pass. Next: commit.' }])
  expect(own.todos.map(x => x.status)).toEqual(['completed', 'completed', 'completed', 'in_progress', 'pending'])
  expect(own.todos[3]?.text).toBe('commit')
  startStep(t, 'w', 'TodoWrite', { todos: [{ content: 'real one', status: 'pending' }] }, 1)
  queueFromResponse(t, [{ type: 'text', text: 'Step 1/2: nope' }])
  expect(t.todos.map(x => x.text)).toEqual(['real one'])
})

test('motion budget: calm cards hold still; only a failing card walks its border, one frame to the next', async () => {
  const calm = newTurn('read', 0)
  startStep(calm, 'r', 'Read', { file_path: 'a.ts' }, 0)
  finishStep(calm, 'r', 'Read', { file_path: 'a.ts' }, true, '', undefined, 10)
  const still = (n: number) => spinnerRows(calm, 'tool-use', null, 10, n, 188, 3).map(l => text(l))
  expect(still(5_000)[0]).toBe(still(6_000)[0])
  expect(still(5_000).at(-1)?.replace(/\d+s/, '')).toBe(still(6_000).at(-1)?.replace(/\d+s/, '')) // only the clock's figure changes
  expect(still(5_000).join('')).not.toContain('╌')
  const f = midFix() // the tests card is failing
  const a = spinnerRows(f, 'tool-use', null, 10, 9_000, 188, 3).map(l => text(l))
  const b = spinnerRows(f, 'tool-use', null, 10, 10_000, 188, 3).map(l => text(l))
  expect(a.at(-1)).not.toBe(b.at(-1))
  const nowPart = (r?: string) => r?.slice(0, 40).replace(/turn \d+s ─?/, '')
  expect(nowPart(a.at(-1))).not.toContain('╌') // the now card does not walk
  expect(nowPart(b.at(-1))).not.toContain('╌')
})

test('one-time transitions: a step lands ▁▃▅ then holds, a done to-do flashes once, a tone change fades through dim', async () => {
  const t = midFix()
  const lastCell = (now: number) => filmstrip(t, 24, now, false).at(-1)?.t
  expect(lastCell(4_510)).toBe('▁')
  expect(lastCell(4_850)).toBe('▅')
  expect(lastCell(5_200)).toBe('█')
  startStep(t, 'u', 'TodoWrite', { todos: [{ content: 'run tests', status: 'completed' }, { content: 'fix sum', status: 'completed' }, { content: 're-run tests', status: 'completed' }, { content: 'fix mul', status: 'completed' }, { content: 're-run tests to verify', status: 'in_progress' }] }, 6_000)
  expect(t.todos[3]?.doneAt).toBe(6_000)
  expect(t.todos[0]?.doneAt).toBeUndefined() // done before, never flashes again
  expect(todoCard(t, 10, 6_100).tiles?.[3]?.look).toEqual({ color: t.todos[3]?.color, bold: true })
  expect(todoCard(t, 10, 7_000).tiles?.[3]?.look).toEqual({ color: t.todos[3]?.color, strike: true })
  const memo = { tones: {} }
  const borderOf = (rows: ReturnType<typeof spinnerRows>, i: number) => rows[0]?.filter(s => s.t.includes('╭'))[i]
  spinnerRows(t, undefined, null, 10, 6_000, 188, 3, memo)
  startStep(t, 'b9', 'Bash', { command: 'npm test' }, 6_040) // the tests card goes from failing to passing
  finishStep(t, 'b9', 'Bash', { command: 'npm test' }, true, 'Tests: 3 passed, 3 total', undefined, 6_050)
  const fading = spinnerRows(t, undefined, null, 10, 6_100, 188, 3, memo)
  const settled = spinnerRows(t, undefined, null, 10, 7_000, 188, 3, memo)
  expect(borderOf(fading, 2)?.dim).toBe(true)
  expect(borderOf(settled, 2)?.color).toBe(TONE_COLOR[taskCard(t, 7_000).tone])
})

test('context past 85% walks its gauge at the tick; below, it holds', async () => {
  const t = newTurn('x', 0)
  const ctx = (pct: number, now: number) => text(teleParts(t, pct, now).ctx)
  expect(ctx(90, 1_000)).not.toBe(ctx(90, 2_000))
  expect(ctx(60, 1_000)).toBe(ctx(60, 2_000))
})

test('the walk keeps one rhythm across segment joins, and a card that moves place does not fade', async () => {
  const f = midFix()
  const tray = text(spinnerRows(f, 'tool-use', null, 10, 9_000, 188, 3).at(-1))
  const span = tray.slice(tray.lastIndexOf('┴') + 1)
  expect(span).not.toMatch(/──|╌╌/) // strictly alternating once walking
  const memo = { tones: {} }
  f.todos = [] // a to-do card with only a border note gives way below 140 columns
  spinnerRows(f, undefined, null, 72, 9_000, 188, 3, memo) // three cards: now, to-do (▲ context), tests
  const two = spinnerRows(f, undefined, null, 72, 9_100, 118, 3, memo) // two cards: tests moves to place 1
  expect(two[0]?.filter(s => s.t.includes('╭'))[1]?.dim).not.toBe(true)
})

test('round 17: more to-dos than fit slide a window over the list, kept in order, counts at both ends', async () => {
  const t = newTurn('x', 0)
  const names = ['a1', 'a2', 'a3', 'a4', 'a5', 'live', 'p7', 'p8', 'p9']
  startStep(t, 'w', 'TodoWrite', { todos: names.map((c, i) => ({ content: c, status: i < 5 ? 'completed' : i === 5 ? 'in_progress' : 'pending' })) }, 0)
  const rows = tileRows(todoCard(t, 10).tiles ?? [], 70, 3).map(l => text(l))
  expect(rows.every(r => r.length <= 70)).toBe(true)
  expect(rows[0]).toMatch(/■ 5 .*◆ 6 .*□ 7/) // one done one kept before the live one, then the list in order
  expect(rows[1]).toMatch(/^✓4 /) // the hidden done ones count at the left
  expect(rows[1]).toMatch(/\+\d+ *$/) // the rest at the right
})

test('round 17: the folder reads as the status line showed it', async () => {
  expect(where('/home/u/claude/mods', '/home/u')).toBe('~/claude/mods')
  expect(where('/home/u', '/home/u')).toBe('~')
  expect(where('/home/u/claude/mods/xray/.claude-plugin/types', '/home/u')).toBe('…/types') // long: the last part
  expect(where('/home/u/claude/mods', '/home/u', true)).toBe('mods') // phone
  expect(where('', '/home/u')).toBe('')
})

test('round 17: between turns the strip carries folder and context, health only when a check fails, and stays under /xray off', async ($, on) => {
  engine(on, { HOME: '/h' })
  on('fs.exists', () => ({ value: false }) as never) // the ponytail skill is gone
  on('fs.read', () => ({ value: '## 7.2 Grammar (caveman compression)' }) as never)
  await $.session.start({ cwd: '/h/proj', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await ui.find({ type: 'Text', text: /~\/proj/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / 10%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ponytail skill missing/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /style rules/ })).toBeUndefined() // that check passed: nothing drawn
  await ui.unmount()
  await $.command.run({ command: 'xray', args: 'off', origin: { kind: 'composer' } } as never)
  ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await ui.find({ type: 'Text', text: /~\/proj/ })).toBeDefined() // the cards hide, the status figures stay
  await ui.unmount()
})

test('round 17: after a turn the strip leads with the folder, then how the turn ended', async ($, on) => {
  engine(on, { HOME: '/h' })
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.read', () => ({ value: 'caveman compression' }) as never)
  on('state.get', async () => ({ value: { value: LAST, version: 1 } }))
  await $.session.start({ cwd: '/h/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await ui.find({ type: 'Text', text: /~\/proj/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /missing/ })).toBeUndefined()
  await ui.unmount()
})

test('round 17: the folder follows the session after a cd, as the status line did', async ($, on) => {
  engine(on, { HOME: '/h' })
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.read', () => ({ value: 'caveman compression' }) as never)
  let cwd = '/h/proj'
  on('session.cwd', () => ({ value: cwd }) as never)
  await $.session.start({ cwd: '/h/proj', surface: 'terminal', isInteractive: true })
  cwd = '/h/proj/sub'
  const ui = await $.ui.mount({ plugin: 'xray', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await ui.find({ type: 'Text', text: /~\/proj\/sub/ })).toBeDefined()
  await ui.unmount()
})

test('round 17: a name cut short takes the ▸ row back on a tall terminal', async () => {
  const t = newTurn('x', 0)
  startStep(t, 'w', 'TodoWrite', { todos: [{ content: 'write m.test.js with node:assert tests for every export', status: 'in_progress', activeForm: 'writing tests' }, { content: 'run', status: 'pending' }] }, 0)
  const card = todoCard(t, 10)
  const rows = body(card, 40, 4).map(l => text(l))
  expect(rows.join('\n')).not.toContain('▸ writing tests')
  expect(rows.filter(r => r.trim()).length).toBe(4)
  const short = newTurn('y', 0)
  startStep(short, 'w', 'TodoWrite', { todos: [{ content: 'fix mul', status: 'in_progress', activeForm: 'fixing mul' }] }, 0)
  expect(body(todoCard(short, 10), 40, 4).map(l => text(l)).at(-1)).toContain('▸ fixing mul') // fits: the ▸ row stays
})

// ── round 18: the prompt-cache countdown ──
const req = (startedAt: number, cacheRead: number, cacheWrite: number, model = 'opus') => ({ startedAt, input: 300, cacheRead, cacheWrite, output: 0, model })
const warm = (ttl: '5m' | '1h', at = 0): Cache => ({ ...noteRequest(emptyCache(), req(at, 150_000, 1000), true), ttl })

test('round 18: the lifetime comes from the newest main-thread write in the transcript tail', async () => {
  const main = (h: number, m: number) => `{"type":"assistant","message":{"usage":{"cache_creation":{"ephemeral_5m_input_tokens":${m},"ephemeral_1h_input_tokens":${h}}}}}`
  expect(ttlFromTail([main(0, 900), main(1200, 0)].join('\n'))).toBe('1h')
  expect(ttlFromTail([main(1200, 0), main(0, 900)].join('\n'))).toBe('5m')
  expect(ttlFromTail(`${main(0, 900)}\n{"isSidechain":true,"message":{"usage":{"cache_creation":{"ephemeral_1h_input_tokens":5}}}}`)).toBe('5m')
  expect(ttlFromTail(main(0, 0))).toBe(null) // a read-only request: the last known lifetime carries
  expect(transcriptPath('/h/.claude', '/tmp/a_b.c/d', 'sid')).toBe('/h/.claude/projects/-tmp-a-b-c-d/sid.jsonl')
})

test('round 18: the strip counts down in words, yellow near the end, red once lapsed (1b, 2b)', async () => {
  const c = warm('1h')
  expect(text(cacheStrip(c, 13 * 60_000, false))).toBe('  cache 47m left')
  const late = cacheStrip(c, 3_600_000 - 252_000, false)
  expect(text(late)).toBe('  cache 4:12 left')
  expect(late[1]?.color).toBe('yellow')
  expect(text(cacheStrip(warm('5m'), 149_000, false))).toBe('  cache 2:31 left (5 min)')
  const gone = cacheStrip(c, 3_600_001, false)
  expect(text(gone)).toBe('   cache lapsed  next message rewrites 151k')
  expect(gone[1]?.bg).toBe('red')
  expect(text(cacheStrip(c, 13 * 60_000, true))).toBe(' ⏱47m')
  expect(text(cacheStrip(c, 3_600_001, true))).toBe('  lapsed 151k ')
  expect(cacheStrip(emptyCache(), 0, false)).toEqual([]) // nothing before the first request
  expect(cacheStrip({ ...c, ttl: null }, 0, false)).toEqual([]) // lifetime unknown: no guess
})

test('round 18: one toast per cache entry, at the warning edge, big prompts only', async () => {
  const c = warm('1h')
  expect(isToastDue(c, 3_600_000 - 400_000)).toBe(false)
  expect(isToastDue(c, 3_600_000 - 290_000)).toBe(true)
  expect(isToastDue({ ...c, toastedAt: c.anchor }, 3_600_000 - 290_000)).toBe(false)
  expect(isToastDue({ ...c, size: 5000 }, 3_600_000 - 290_000)).toBe(false)
  expect(isToastDue(c, 3_600_001)).toBe(false) // lapsed: too late to say
  expect(nextChange(c, 0)).toBe(60_000)
  expect(nextChange(c, 3_600_000 - 310_000)).toBe(10_000) // lands on the warning edge
  expect(nextChange(c, 3_600_000 - 1500)).toBe(500)
  expect(nextChange(c, 3_600_001)).toBe(null)
})

test('round 18: each turn files one row, and a miss names its cause', async () => {
  let c = noteRequest(emptyCache(), req(0, 0, 150_000), true)
  c = { ...c, ttl: '1h' }
  c = noteRequest(c, req(1000, 150_000, 500), false) // same turn: anchor moves, no row
  expect(c.rows.length).toBe(1)
  expect(c.anchor).toBe(1000)
  c = noteRequest(c, req(60_000, 150_000, 800), true)
  c = noteRequest(c, req(60_000 + 4_320_000, 0, 151_000), true)
  c = noteRequest(c, req(4_400_000, 0, 151_000, 'sonnet'), true)
  c = noteRequest(c, req(4_401_000, 10_000, 141_000, 'sonnet'), true)
  expect(c.rows.map(r => r.why)).toEqual(['new session', undefined, 'lapsed · idle 1h 12m', 'model opus → sonnet', 'prefix changed'])
  expect(cacheLeft(c, 4_401_000)).toBe(3_600_000)
  const sec = cacheRows(c, 4_401_000 + 60_000, 6, 200)
  expect(sec?.title).toBe('cache · 1h · 59m left')
  expect(text(sec?.rows[1])).toContain('#5')
  expect(text(sec?.rows[1])).toContain('prefix changed')
  expect(text(sec?.rows.at(-1))).toBe('5 turns · 3 missed · 443k rewritten')
  expect(text(cacheRows(c, 0, 6, 40)?.rows[1])).not.toContain('prefix') // a narrow panel drops the reason, never wraps
})
