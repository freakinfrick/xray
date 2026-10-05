// Round 21: xray answers the task tools itself (TaskCreate / TaskUpdate / TaskList / TaskGet), so Claude
// Code's core never runs them. Core opens its own to-do list under the spinner on every task call
// (`set_expanded_view: "tasks"`), and no setting or key keeps it shut; answering in `tool.call` does.
// The store is per session (`tasks:<id>` in $.store), so a hot reload or /resume keeps the ids. Results
// match core's output schemas exactly: a wrong shape is refused by the engine.

export type Status = 'pending' | 'in_progress' | 'completed'
export type Task = { id: string; subject: string; description: string; activeForm?: string; status: Status; owner?: string; blocks: string[]; blockedBy: string[]; metadata?: Record<string, unknown> }
export type Store = { next: number; tasks: Task[] }

export const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])
export const PREFIX = 'tasks:'
export const keyOf = (sessionId: string) => PREFIX + sessionId
export const emptyStore = (): Store => ({ next: 1, tasks: [] })

export function loadStore(v: unknown): Store {
  const x = v as Store | undefined
  return x && typeof x.next === 'number' && Array.isArray(x.tasks) ? x : emptyStore()
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
const link = (list: string[], id: string) => (list.includes(id) ? list : [...list, id])

// One call answered: the store after it, and the result in the tool's own output shape.
export function answer(store: Store, tool: string, input: Record<string, unknown>): { store: Store; result: unknown } {
  const tasks = store.tasks.map(t => ({ ...t, blocks: [...t.blocks], blockedBy: [...t.blockedBy] }))
  const find = (id: string) => tasks.find(t => t.id === id)

  if (tool === 'TaskCreate') {
    const id = String(store.next)
    const task: Task = { id, subject: String(input.subject ?? ''), description: String(input.description ?? ''), status: 'pending', blocks: [], blockedBy: [] }
    if (input.activeForm) task.activeForm = String(input.activeForm)
    if (input.metadata && typeof input.metadata === 'object') task.metadata = input.metadata as Record<string, unknown>
    return { store: { next: store.next + 1, tasks: [...tasks, task] }, result: { task: { id, subject: task.subject } } }
  }

  if (tool === 'TaskGet') {
    const t = find(String(input.taskId ?? ''))
    return { store, result: { task: t ? { id: t.id, subject: t.subject, description: t.description, status: t.status, blocks: t.blocks, blockedBy: t.blockedBy } : null } }
  }

  if (tool === 'TaskList') {
    return { store, result: { tasks: tasks.map(t => ({ id: t.id, subject: t.subject, status: t.status, ...(t.owner ? { owner: t.owner } : {}), blockedBy: t.blockedBy })) } }
  }

  // TaskUpdate. The id may arrive as a number: core coerces after this hook sees the raw arguments.
  const taskId = String(input.taskId ?? '')
  const t = find(taskId)
  if (!t) return { store, result: { success: false, taskId, updatedFields: [], error: `Task #${taskId} not found` } }
  const fields: string[] = []
  let statusChange: { from: string; to: string } | undefined
  if (input.status === 'deleted') {
    const kept = tasks.filter(x => x !== t).map(x => ({ ...x, blocks: x.blocks.filter(b => b !== taskId), blockedBy: x.blockedBy.filter(b => b !== taskId) }))
    return { store: { ...store, tasks: kept }, result: { success: true, taskId, updatedFields: ['deleted'] } }
  }
  if (typeof input.status === 'string' && input.status !== t.status) {
    statusChange = { from: t.status, to: input.status }
    t.status = input.status as Status
    fields.push('status')
  }
  for (const k of ['subject', 'description', 'activeForm', 'owner'] as const) {
    if (typeof input[k] === 'string' && input[k] !== t[k]) {
      t[k] = input[k] as string
      fields.push(k)
    }
  }
  if (input.metadata && typeof input.metadata === 'object') {
    const m = { ...(t.metadata ?? {}) }
    for (const [k, v] of Object.entries(input.metadata as Record<string, unknown>)) {
      if (v === null) delete m[k]
      else m[k] = v
    }
    t.metadata = m
    fields.push('metadata')
  }
  for (const b of ids(input.addBlocks)) {
    t.blocks = link(t.blocks, b)
    const o = find(b)
    if (o) o.blockedBy = link(o.blockedBy, taskId)
  }
  for (const b of ids(input.addBlockedBy)) {
    t.blockedBy = link(t.blockedBy, b)
    const o = find(b)
    if (o) o.blocks = link(o.blocks, taskId)
  }
  if (ids(input.addBlocks).length) fields.push('blocks')
  if (ids(input.addBlockedBy).length) fields.push('blockedBy')
  return { store: { ...store, tasks }, result: { success: true, taskId, updatedFields: fields, ...(statusChange ? { statusChange } : {}) } }
}

// Stores of other sessions older than the newest KEEP are dropped, like the genome's.
export const KEEP = 50
export function stale(keys: readonly string[], current: string): string[] {
  const mine = keys.filter(k => k.startsWith(PREFIX) && k !== current)
  return mine.length > KEEP ? mine.slice(0, mine.length - KEEP) : []
}
