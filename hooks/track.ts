// What the current turn has done, is doing, and still owes. Pure: events in, state out.

import { isCheckCommand, isTestCommand, parseTestOutput, sayStep, sourceOf, type TestRun } from './parse'

export type Todo = { id: string; text: string; active: string; status: 'pending' | 'in_progress' | 'completed' }
export type Step = { id: string; tool: string; say: string; startedAt: number; endedAt?: number; ok?: boolean }
// total 0 = the output had no summary to count; ok then says only whether the command passed.
export type Run = TestRun & { running: boolean; startedAt: number; ok?: boolean; isStopped?: boolean }
export type Template = 'default' | 'research' | 'tests' | 'refactor'
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
  template: Template
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
  template: 'default',
})

// To-dos outlive a turn: the list the model keeps is the plate.
export function carryTodos(prev: Turn | null, next: Turn) {
  if (prev) next.todos = prev.todos.filter(t => t.status !== 'completed')
}

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown> }

export function queueFromResponse(t: Turn, content: unknown) {
  if (!Array.isArray(content)) return
  for (const b of content as Block[]) {
    if (b.type === 'tool_use' && b.id && b.name && !t.running.has(b.id) && !t.done.some(s => s.id === b.id)) t.queued.set(b.id, sayStep(b.name, b.input ?? {}))
  }
}

export function startStep(t: Turn, id: string, tool: string, input: Record<string, unknown>, now: number) {
  t.queued.delete(id)
  t.running.set(id, { id, tool, say: sayStep(tool, input), startedAt: now })
  if (tool === 'Bash' && isTestCommand(String(input.command ?? ''))) t.runs.push({ pass: 0, fail: 0, total: 0, failing: [], running: true, startedAt: now })
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    t.todos = (input.todos as { content: string; activeForm?: string; status: Todo['status'] }[]).map((x, i) => ({ id: `w${i}`, text: x.content, active: x.activeForm ?? x.content, status: x.status }))
  }
  if (tool === 'TaskUpdate') {
    const todo = t.todos.find(x => x.id === String(input.taskId))
    if (todo) {
      if (input.status === 'deleted') t.todos = t.todos.filter(x => x !== todo)
      else if (input.status) todo.status = input.status as Todo['status']
      if (input.subject) todo.text = String(input.subject)
      if (input.activeForm) todo.active = String(input.activeForm)
    }
  }
  const src = sourceOf(tool, input)
  if (src) t.sources.push(src)
  pickTemplate(t)
}

export function finishStep(t: Turn, id: string, tool: string, input: Record<string, unknown>, ok: boolean, text: string, result: unknown, now: number) {
  const step = t.running.get(id) ?? { id, tool, say: sayStep(tool, input), startedAt: now }
  t.running.delete(id)
  step.endedAt = now
  step.ok = ok
  t.done.push(step)
  if (!ok) t.failures += 1
  const cmd = String(input.command ?? '')
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
  if (tool === 'TaskCreate' && ok) {
    const task = (result as { task?: { id?: string; subject?: string } } | undefined)?.task
    if (task?.id) t.todos.push({ id: String(task.id), text: String(input.subject ?? task.subject ?? ''), active: String(input.activeForm ?? input.subject ?? ''), status: 'pending' })
  }
  pickTemplate(t)
}

// A run still going when the turn ends was cut off, not finished.
export function endTurn(t: Turn) {
  for (const r of t.runs) if (r.running) Object.assign(r, { running: false, isStopped: true })
}

// A check that started after an edit landed vouches for that edit.
function markChecked(t: Turn, checkStartedAt: number) {
  for (const e of t.edited.values()) if (e.at <= checkStartedAt) e.checked = true
}

// Escalates only, so the task card keeps its place within a turn: default < research < tests | refactor.
export function pickTemplate(t: Turn) {
  if (t.template === 'tests' || t.template === 'refactor') return
  if (t.runs.length) t.template = 'tests'
  else if (t.edited.size >= 5) t.template = 'refactor'
  else if (t.edited.size === 0 && t.sources.length >= 4) t.template = 'research'
}

export const openTodos = (t: Turn) => t.todos.filter(x => x.status !== 'completed')
