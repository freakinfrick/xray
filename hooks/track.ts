// What the current turn has done, is doing, and still owes. Pure: events in, state out.

import { detect, lastLine, lastMeasure, lastPair, type Recipe, type Signal } from './custom'
import { isCheckCommand, isTestCommand, parseTestOutput, sayStep, sourceOf, type TestRun } from './parse'

// doneAt: when it turned completed, for the one-time flash (round 16, direction 3).
export type Todo = { id: string; text: string; active: string; status: 'pending' | 'in_progress' | 'completed'; color?: string; doneAt?: number }
// One hue per to-do, kept for its life. Red is left out: on these cards it means failing.
export const TODO_COLORS = ['green', 'cyan', 'yellow', 'magenta', 'blue', 'greenBright', 'cyanBright', 'yellowBright', 'magentaBright', 'blueBright']

// A to-do without a hue takes the first one no other to-do holds (cycling once all ten are taken).
function colorTodos(t: Turn) {
  for (const x of t.todos) {
    if (x.color) continue
    const taken = new Set(t.todos.map(y => y.color))
    x.color = TODO_COLORS.find(c => !taken.has(c)) ?? TODO_COLORS[t.todos.indexOf(x) % TODO_COLORS.length]
  }
}
// kind: what the filmstrip colors a step by (round 16, direction 1).
export type StepKind = 'read' | 'edit' | 'run' | 'test' | 'agent' | 'todo' | 'other'
export type Step = { id: string; tool: string; say: string; startedAt: number; endedAt?: number; ok?: boolean; kind?: StepKind }
const READS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead'])
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TODOS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskStop'])
export function stepKind(tool: string, input: Record<string, unknown>): StepKind {
  if (READS.has(tool)) return 'read'
  if (EDITS.has(tool)) return 'edit'
  if (TODOS.has(tool)) return 'todo'
  if (tool === 'Agent' || tool === 'Task') return 'agent'
  if (tool === 'Bash') return isTestCommand(String(input.command ?? '')) ? 'test' : 'run'
  return 'other'
}
// total 0 = the output had no summary to count; ok then says only whether the command passed.
export type Run = TestRun & { running: boolean; startedAt: number; ok?: boolean; isStopped?: boolean }
export type Template = 'default' | 'research' | 'agents' | 'tests' | 'refactor'
// A subagent the main session started. Its own steps arrive on tool.call with its agentId.
export type Agent = { toolUseId: string; agentId?: string; label: string; isBackground: boolean; startedAt: number; endedAt?: number; ok?: boolean; steps: number; doing?: string }
// A shell command the main session ran, kept across turns: reruns are what bench and build compare.
export type Cmd = { cmd: string; startedAt: number; endedAt?: number; ok?: boolean; text?: string; measure?: { v: number; unit: string } }
// A command sent to the background, followed through its output file.
export type Job = { path: string; startedAt: number; lastline?: string; size?: number; readAt?: number }
const JOB_GAP_BYTES = 64 * 1024 // one more second between reads per 64 KiB of output
const JOB_GAP_MAX_MS = 10_000
const BENCH_CMD = /\b(bench|hyperfine|perf|wrk|ab\s+-n|criterion|time)\b/
const BENCH_ASK = /\b(bench\w*|faster|speed\w*|latency|perf\w*|throughput|slow\w*)\b/i
const MAX_CMDS = 40
// One model request: when it was sent, when its first piece arrived, what the API counted.
export type Request = { startedAt: number; firstAt: number; endedAt: number; output: number; input: number; cacheRead: number; cacheWrite: number }

export type Turn = {
  startedAt: number
  prompt: string
  queued: Map<string, string> // tool_use id → plain words, requested by the model but not started
  running: Map<string, Step>
  done: Step[]
  todos: Todo[]
  runs: Run[]
  edited: Map<string, { at: number; checked: boolean }>
  sources: string[]
  failures: number
  requests: Request[]
  agents: Agent[]
  cmds: Cmd[]
  samples: { at: number; k: number; n: number; from?: 'job' }[] // from: the background job's own output
  job?: Job
  signal?: Signal
  recipe?: Recipe
  isRecipeAsked?: boolean
  template: Template
  effort?: string | number // the last main-agent request's effort, as sent
}

export const newTurn = (prompt: string, now: number): Turn => ({
  startedAt: now,
  prompt,
  queued: new Map(),
  running: new Map(),
  done: [],
  todos: [],
  runs: [],
  edited: new Map(),
  sources: [],
  failures: 0,
  requests: [],
  agents: [],
  cmds: [],
  samples: [],
  template: 'default',
})

// To-dos and agents still running outlive a turn: they are the plate. The list goes on whole while any
// of it is open (its count and the done cells stay true, round 17), and is dropped once all of it is done.
export function carryTodos(prev: Turn | null, next: Turn) {
  if (!prev) return
  next.todos = prev.todos.some(t => t.status !== 'completed') ? prev.todos.map(x => ({ ...x, doneAt: undefined })) : []
  next.agents = prev.agents.filter(a => a.endedAt === undefined)
  next.cmds = prev.cmds.slice(-MAX_CMDS)
  if (prev.job) Object.assign(next, { job: prev.job, samples: prev.samples })
}

// Sticky within a turn, like the template: once a property no template shows is measured, the card is custom.
export function checkSignal(t: Turn, now: number) {
  t.signal ??= detect(t, now) ?? undefined
}

// Progress read from wherever it shows up: a job's output file, or a tool result that printed it.
export function sample(t: Turn, text: string, now: number, from?: 'job') {
  const p = lastPair(text)
  const last = t.samples[t.samples.length - 1]
  if (p && (!last || last.k !== p.k || last.n !== p.n)) t.samples.push({ at: now, ...p, ...(from ? { from } : {}) })
}

// A whole-file read costs what the file weighs, so a grown file waits longer before the next one.
export function isJobDue(job: Job, size: number, now: number): boolean {
  if (size === job.size) return false
  const gap = Math.min(JOB_GAP_MAX_MS, 1000 * Math.max(1, Math.floor(size / JOB_GAP_BYTES)))
  return job.readAt === undefined || now - job.readAt >= gap
}

export function readJob(t: Turn, text: string, size: number, now: number) {
  if (!t.job) return
  t.job.size = size
  t.job.readAt = now
  t.job.lastline = lastLine(text).slice(0, 120) || t.job.lastline
  sample(t, text, now, 'job')
}

export function spawnAgent(t: Turn, a: Omit<Agent, 'steps'>) {
  t.agents.push({ ...a, steps: 0 })
  pickTemplate(t)
}

// An agentId the spawn result did not name belongs to the one running agent still without an id.
function agentOf(t: Turn, agentId: string): Agent | undefined {
  const known = t.agents.find(a => a.agentId === agentId)
  if (known) return known
  const unnamed = t.agents.filter(a => !a.agentId && a.endedAt === undefined)
  if (unnamed.length !== 1) return undefined
  const a = unnamed[0] as Agent
  a.agentId = agentId
  return a
}

export function agentStep(t: Turn, agentId: string, say: string) {
  const a = agentOf(t, agentId)
  if (!a) return
  a.steps += 1
  a.doing = say
}

export function finishAgent(t: Turn, key: { agentId?: string; toolUseId?: string }, ok: boolean, now: number) {
  const a = key.agentId ? agentOf(t, key.agentId) : t.agents.find(x => x.toolUseId === key.toolUseId)
  if (!a || a.endedAt !== undefined) return
  a.endedAt = now
  a.ok = ok
  a.doing = undefined
}

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }

export function queueFromResponse(t: Turn, content: unknown) {
  if (!Array.isArray(content)) return
  for (const b of content as Block[]) {
    if (b.type === 'tool_use' && b.id && b.name && !t.running.has(b.id) && !t.done.some(s => s.id === b.id)) t.queued.set(b.id, sayStep(b.name, b.input ?? {}))
    if (b.type === 'text' && b.text) planFromText(t, b.text)
  }
}

// A model that writes its plan as text ("Step 3/5: fix mul") instead of calling a to-do tool still
// fills the to-do card (round 16; the live check's Haiku did exactly this). Tool to-dos always win:
// text never touches a list a tool wrote.
export function planFromText(t: Turn, text: string) {
  if (t.todos.some(x => !x.id.startsWith('k'))) return
  const m = [...text.matchAll(/\bStep (\d+)\s*(?:\/|of)\s*(\d+)\b[:.]?[ \t]*([^\n]*)/gi)].pop()
  if (!m) return
  const n = Math.min(Number(m[2]), 20)
  let said = (m[3] ?? '').replace(/[*_`]/g, '').trim()
  // "Step 3/5 done: X. Next: Y." (this user's own status line) means 3 finished and the next one running.
  const isDone = /^done\b/i.test(said)
  const k = Number(m[1]) + (isDone ? 1 : 0)
  if (isDone) said = (said.match(/\bnext:\s*([^.]*)/i)?.[1] ?? '').trim()
  said = said.replace(/\.$/, '').slice(0, 60)
  if (!(k >= 1 && k <= n + 1)) return
  const old = new Map(t.todos.map(x => [x.id, x]))
  t.todos = Array.from({ length: n }, (_, i) => {
    const id = `k${i + 1}`
    const prev = old.get(id)
    const text = i + 1 === k && said ? said : (prev?.text ?? `step ${i + 1}`)
    return { id, text, active: text, status: i + 1 < k ? 'completed' : i + 1 === k ? 'in_progress' : 'pending', color: prev?.color, doneAt: prev?.doneAt } as Todo
  })
  colorTodos(t)
}

export function startStep(t: Turn, id: string, tool: string, input: Record<string, unknown>, now: number) {
  t.queued.delete(id)
  t.running.set(id, { id, tool, say: sayStep(tool, input), startedAt: now, kind: stepKind(tool, input) })
  if (tool === 'Bash') t.cmds.push({ cmd: String(input.command ?? '').trim(), startedAt: now })
  if (tool === 'Bash' && isTestCommand(String(input.command ?? ''))) t.runs.push({ pass: 0, fail: 0, total: 0, failing: [], running: true, startedAt: now })
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    // A rewrite of the list keeps each surviving to-do's hue, matched by its text.
    const hue = new Map(t.todos.map(x => [x.text, x.color]))
    const was = new Map(t.todos.map(x => [x.text, x]))
    t.todos = (input.todos as { content: string; activeForm?: string; status: Todo['status'] }[]).map((x, i) => {
      const prev = was.get(x.content)
      const doneAt = x.status !== 'completed' ? undefined : prev?.status === 'completed' ? prev.doneAt : prev ? now : undefined
      return { id: `w${i}`, text: x.content, active: x.activeForm ?? x.content, status: x.status, color: hue.get(x.content), doneAt }
    })
    colorTodos(t)
  }
  if (tool === 'TaskUpdate') {
    const todo = t.todos.find(x => x.id === String(input.taskId))
    if (todo) {
      if (input.status === 'deleted') t.todos = t.todos.filter(x => x !== todo)
      else if (input.status) {
        if (input.status === 'completed' && todo.status !== 'completed') todo.doneAt = now
        todo.status = input.status as Todo['status']
      }
      if (input.subject) todo.text = String(input.subject)
      if (input.activeForm) todo.active = String(input.activeForm)
    }
  }
  const src = sourceOf(tool, input)
  if (src) t.sources.push(src)
  pickTemplate(t)
}

export function finishStep(t: Turn, id: string, tool: string, input: Record<string, unknown>, ok: boolean, text: string, result: unknown, now: number) {
  const step = t.running.get(id) ?? { id, tool, say: sayStep(tool, input), startedAt: now, kind: stepKind(tool, input) }
  t.running.delete(id)
  step.endedAt = now
  step.ok = ok
  t.done.push(step)
  if (!ok) t.failures += 1
  const cmd = String(input.command ?? '')
  if (tool === 'Bash') {
    const c = t.cmds.findLast(x => x.cmd === cmd.trim() && x.endedAt === undefined)
    if (c) Object.assign(c, { endedAt: now, ok, text: text.slice(-4000) })
    if (c && !isTestCommand(cmd) && (BENCH_CMD.test(cmd) || BENCH_ASK.test(t.prompt))) c.measure = lastMeasure(text) ?? undefined
    const out = text.match(/Output is being written to: (\S+\.output)/)
    if (input.run_in_background && out?.[1]) t.job = { path: out[1], startedAt: now }
  }
  if (ok && text && !isTestCommand(cmd)) sample(t, text, now)
  if (tool === 'Bash' && isTestCommand(cmd)) {
    const run = t.runs.findLast(r => r.running)
    const counts = parseTestOutput(text)
    if (run) Object.assign(run, counts ?? { pass: 0, fail: 0, total: 0, failing: [] }, { running: false, ok })
    if (ok || (counts && counts.fail === 0)) markChecked(t, step.startedAt)
  }
  if (tool === 'Bash' && isCheckCommand(cmd) && ok) markChecked(t, step.startedAt)
  if (ok && ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool)) {
    const path = String(input.file_path ?? input.notebook_path ?? '')
    if (path) t.edited.set(path, { at: now, checked: false })
  }
  // A foreground agent's tool call returns when the agent is done; a background one returns at launch.
  if ((tool === 'Agent' || tool === 'Task') && !t.agents.find(a => a.toolUseId === id)?.isBackground) finishAgent(t, { toolUseId: id }, ok, now)
  if (tool === 'TaskCreate' && ok) {
    const task = (result as { task?: { id?: string; subject?: string } } | undefined)?.task
    if (task?.id) t.todos.push({ id: String(task.id), text: String(input.subject ?? task.subject ?? ''), active: String(input.activeForm ?? input.subject ?? ''), status: 'pending' })
    colorTodos(t)
  }
  pickTemplate(t)
  checkSignal(t, now)
}

// A run still going when the turn ends was cut off, not finished.
// A finished turn as JSON for $.state, so a hot reload keeps the panel and the plate (Maps as entries).
export const saveTurn = (t: Turn): string => JSON.stringify(t, (_, v) => (v instanceof Map ? { $map: [...v] } : v))
export function loadTurn(json: string): Turn | null {
  try {
    return { ...newTurn('', 0), ...JSON.parse(json, (_, v) => (Array.isArray(v?.$map) ? new Map(v.$map) : v)) }
  } catch {
    return null
  }
}

export function endTurn(t: Turn) {
  for (const r of t.runs) if (r.running) Object.assign(r, { running: false, isStopped: true })
}

// A check that started after an edit landed vouches for that edit.
function markChecked(t: Turn, checkStartedAt: number) {
  for (const e of t.edited.values()) if (e.at <= checkStartedAt) e.checked = true
}

// Escalates only, so the task card keeps its place within a turn: default < research < agents < tests | refactor.
export function pickTemplate(t: Turn) {
  if (t.template === 'tests' || t.template === 'refactor') return
  if (t.runs.length) t.template = 'tests'
  else if (t.edited.size >= 5) t.template = 'refactor'
  else if (t.agents.length) t.template = 'agents'
  else if (t.template === 'default' && t.edited.size === 0 && t.sources.length >= 4) t.template = 'research'
}

export const runningAgents = (t: Turn) => t.agents.filter(a => a.endedAt === undefined)

export const openTodos = (t: Turn) => t.todos.filter(x => x.status !== 'completed')
