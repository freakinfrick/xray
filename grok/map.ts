// grok's hook events → the core's JSONL events (../hooks/events.ts). Pure, so the tests run under
// `claude plugin test`; ./hook.mjs only reads stdin and appends what this returns. Spec: ./SPEC.md.
import type { Call, Event } from '../hooks/events'

// The slice of grok's hook envelope used here (xai-grok-hooks/src/event.rs HookEventEnvelope + payloads).
export type Envelope = {
  hookEventName?: string
  hook_event_name?: string
  sessionId?: string
  toolName?: string
  toolUseId?: string
  toolInput?: unknown
  toolResult?: unknown
  error?: string
  prompt?: string
  subagentType?: string
}

// grok's tools → the names and argument keys the core reads (as omp's toCall). Bash keeps the core's own
// words ("running the tests"), not the model's `description`: grok's tool row already shows that.
export function toCall(name: string, args: unknown): Call {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const str = (k: string) => String(a[k] ?? '')
  switch (name) {
    case 'run_terminal_command':
    case 'bash':
      return { tool: 'Bash', input: { command: str('command') } }
    case 'read_file':
      return { tool: 'Read', input: { file_path: str('target_file') || str('path') } }
    // An empty old_string creates the file (search_replace/mod.rs:214).
    case 'search_replace':
      return { tool: a.old_string === '' ? 'Write' : 'Edit', input: { file_path: str('file_path') } }
    case 'grep':
      return { tool: 'Grep', input: { pattern: str('pattern'), path: str('path') } }
    case 'list_dir':
      return { tool: 'Glob', input: { pattern: str('target_directory') } }
    case 'web_search':
      return { tool: 'WebSearch', input: { query: str('query') } }
    case 'web_fetch':
      return { tool: 'WebFetch', input: { url: str('url') } }
    case 'task':
    case 'spawn_subagent':
      return { tool: 'Task', input: { description: str('description') || 'agent' } }
    // grok pins its own to-do list; xray draws none, the call is a dim bookkeeping cell.
    case 'todo_write':
      return { tool: 'todo', input: {}, say: 'to-do list', kind: 'todo' }
    default:
      return { tool: name, input: {}, say: name.replace(/_/g, ' '), kind: 'other' }
  }
}

// A tool result's text. grok sends a tagged object: Bash { output_for_prompt, output: bytes, exit_code },
// ReadFile { FileContent: { content } }, others a string or { output | content | text }.
export function resultText(r: unknown): string {
  if (typeof r === 'string') return r
  if (!r || typeof r !== 'object') return ''
  const o = r as Record<string, unknown>
  for (const k of ['output_for_prompt', 'output', 'content', 'text', 'stdout']) {
    const v = o[k]
    if (typeof v === 'string') return v
    if (Array.isArray(v) && v.every(x => typeof x === 'number')) return new TextDecoder().decode(new Uint8Array(v as number[]))
  }
  if (Array.isArray(o.content)) return o.content.map(c => (c && typeof c === 'object' ? String((c as { text?: unknown }).text ?? '') : '')).join('\n')
  const inner = Object.values(o).find(v => v && typeof v === 'object' && !Array.isArray(v))
  return inner ? resultText(inner) : ''
}

// A command that ran but exited non-zero is a failed step, as Claude Code reports it (the core reads ok).
const okOf = (r: unknown) => {
  const code = (r as { exit_code?: unknown } | null)?.exit_code
  return typeof code === 'number' ? code === 0 : true
}

// The event's PascalCase name: `hook_event_name` carries it; grok's own `hookEventName` is snake_case
// (pre_tool_use) and spelled camelCase in its docs, so either converts.
export function eventName(e: Envelope): string {
  const n = e.hook_event_name ?? e.hookEventName ?? ''
  return n.replace(/(^|_)([a-z])/g, (_, _u, c: string) => c.toUpperCase())
}

const TEXT_MAX = 4000 // a result's tail is what the core reads (test counts, errors); the file stays small

// One hook envelope → the events it means. A subagent's own calls stay out: its Task cell stands for them.
export function toEvents(e: Envelope, t: number): Event[] {
  const ev = eventName(e)
  if (e.subagentType && ev !== 'SubagentStart' && ev !== 'SubagentStop') return []
  const id = String(e.toolUseId ?? '')
  const call = () => toCall(String(e.toolName ?? ''), e.toolInput)
  const step = (c: Call) => ({ tool: c.tool, input: c.input, ...(c.say ? { say: c.say } : {}), ...(c.kind ? { as: c.kind } : {}) })
  switch (ev) {
    case 'UserPromptSubmit':
      return [{ t, kind: 'turn_start', prompt: String(e.prompt ?? '') }]
    case 'PreToolUse':
      return [{ t, kind: 'start', id, ...step(call()) }]
    case 'PostToolUse':
      return [{ t, kind: 'end', id, ok: okOf(e.toolResult), text: resultText(e.toolResult).slice(-TEXT_MAX), ...step(call()) }]
    case 'PostToolUseFailure':
      return [{ t, kind: 'end', id, ok: false, text: String(e.error ?? '').slice(-TEXT_MAX), ...step(call()) }]
    case 'Stop':
    case 'StopFailure':
    case 'StopCancelled':
      return [{ t, kind: 'turn_end' }]
    default:
      return []
  }
}
