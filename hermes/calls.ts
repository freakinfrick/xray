// Hermes' tools in the core's names (spec hermes/SPEC.md d3). The python plugin writes hermes' own tool
// names and raw args into the feed; this table maps them before ../hooks/events applies them, so the one
// table sits in TS beside omp/ink.ts toCall and the gate tests it. Names from `hermes tools list` and the
// tool registry (v0.21.5).
import type { Call, Event } from '../hooks/events'

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

export function toCall(name: string, args: unknown): Call {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const path = { file_path: str(a.path) }
  switch (name) {
    case 'terminal':
      return { tool: 'Bash', input: { command: str(a.command) } }
    case 'read_file':
      return { tool: 'Read', input: path }
    case 'write_file':
      return { tool: 'Write', input: path }
    case 'patch':
      return { tool: 'Edit', input: path }
    // One tool for both: 'content' greps inside files, 'files' finds them by name.
    case 'search_files':
      return a.target === 'files' ? { tool: 'Glob', input: { pattern: str(a.pattern) } } : { tool: 'Grep', input: { pattern: str(a.pattern), path: str(a.path) } }
    case 'web_search':
      return { tool: 'WebSearch', input: { query: str(a.query) } }
    case 'web_extract':
      return { tool: 'WebFetch', input: { url: str(Array.isArray(a.urls) ? a.urls[0] : a.urls) } }
    case 'browser_navigate':
      return { tool: 'WebFetch', input: { url: str(a.url) } }
    case 'delegate_task': {
      const tasks = Array.isArray(a.tasks) ? a.tasks : []
      const first = tasks[0] as Record<string, unknown> | undefined
      const goal = str(first?.goal ?? a.goal ?? a.message)
      const say = tasks.length > 1 ? `${tasks.length} subagents` : goal.slice(0, 60) || 'subagent'
      return { tool: 'Task', input: { description: say }, say }
    }
    // Code the model wrote and ran: the core's script kind.
    case 'execute_code':
      return { tool: 'execute_code', input: {}, say: 'running code', kind: 'script' }
    // Hermes draws its own to-do list: bookkeeping, a dim cell.
    case 'todo_list':
      return { tool: 'todo_list', input: {}, say: 'to-do list', kind: 'todo' }
    case 'memory':
      return { tool: 'memory', input: {}, say: 'memory', kind: 'todo' }
    default:
      return { tool: name, input: {}, say: name.replace(/_/g, ' '), kind: 'other' }
  }
}

// A terminal result is JSON ({output, exit_code, error}); the core reads the output (test counts, errors).
export function resultText(raw: unknown): string {
  if (typeof raw !== 'string') return raw === undefined || raw === null ? '' : JSON.stringify(raw)
  try {
    const d = JSON.parse(raw) as Record<string, unknown>
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const out = [d.output, d.content, d.error].filter(v => typeof v === 'string' && v).join('\n')
      if (out) return out
    }
  } catch {}
  return raw
}

// A feed line as the plugin writes it: the core's Event with hermes' names, plus the session it belongs to.
export type Raw = Event & { sid?: string; parent?: string; args?: unknown }

// Hermes' names → the core's. start and end both carry the tool and its args, so an end with no start
// seen (the feed picked up mid-call) still lands as the right kind.
export function toEvent(e: Raw): Event {
  const { sid: _sid, parent: _parent, args, ...rest } = e
  if (e.kind !== 'start' && e.kind !== 'end') return rest
  const c = toCall(String(e.tool ?? ''), args ?? e.input)
  const out: Event = { ...rest, tool: c.tool, input: c.input, ...(c.say ? { say: c.say } : {}), ...(c.kind ? { as: c.kind } : {}) }
  if (e.kind === 'end') out.text = resultText(e.text)
  return out
}
