// One event schema for hosts that feed xray from a JSONL file (hermes, grok: HOSTS.md "Shared pieces"):
// each host's hook or plugin translates its own events into these lines, the host's renderer tails the
// file and folds them here into the same Turn and session record the in-process hosts build (omp/index.ts
// does this from omp's events). Pure: every timestamp is the event's `t`, so a replayed file draws the same.
import type { Mode } from './cards'
import * as genome from './genome'
import { nameOf } from './names'
import { addTurn, emptyRec, fileTouches, type SessionRec } from './session'
import { countedRuns, endTurn, filesRead, finishStep, newTurn, spawnAgent, startStep, type Turn } from './track'

// A tool call in the core's names (Bash, Read, Edit, Grep, Glob, Write, WebFetch, WebSearch, Task, …) and
// argument keys (command, file_path, pattern, url, query, description). `say` and `kind` speak for a tool
// the core has no rule for: its words, and script / todo (bookkeeping, a dim cell) / other.
export type Call = { tool: string; input: Record<string, unknown>; say?: string; kind?: 'script' | 'todo' | 'other' }

export type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; startedAt?: number; firstAt?: number }
// One JSONL line. turn_start {prompt}; start {id, tool, input, say?, as?}; end {id, ok, text?} (tool and
// input again if the host has them, else the start's are used); usage {usage} once per model request;
// turn_end when the agent is done with the person's prompt.
export type Event = {
  t: number
  kind: 'turn_start' | 'start' | 'end' | 'usage' | 'turn_end'
  id?: string
  tool?: string
  input?: Record<string, unknown>
  say?: string
  as?: Call['kind']
  ok?: boolean
  text?: string
  prompt?: string
  usage?: Usage
}

// What a host draws from: the live turn (spinnerRows), the last one (/xray), the session (genome).
// `ended` counts turn_end events folded in, so a host knows when to save `rec`.
export type State = { turn: Turn | null; prev: Turn | null; rec: SessionRec; mode: Mode; calls: Map<string, Call>; reqAt: number; ended: number }

export const init = (rec: SessionRec = emptyRec()): State => ({ turn: null, prev: null, rec, mode: undefined, calls: new Map(), reqAt: 0, ended: 0 })

const KINDS = new Set(['turn_start', 'start', 'end', 'usage', 'turn_end'])
// A JSONL file's text → events, malformed lines (a half-written last line while tailing) skipped.
export function parse(text: string): Event[] {
  const out: Event[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as Event
      if (e && typeof e.t === 'number' && KINDS.has(e.kind)) out.push(e)
    } catch {}
  }
  return out
}

function close(s: State, at: number) {
  const t = s.turn
  if (!t) return
  endTurn(t)
  t.endedAt = at
  const letters = genome.code(t)
  s.rec = addTurn(s.rec, letters, { name: nameOf(letters, countedRuns(t), filesRead(t)), files: fileTouches(t, at) })
  s.prev = t
  s.turn = null
  s.mode = undefined
  s.calls.clear()
  s.ended += 1
}

// One event folded into the state (mutated and returned). A step with no turn open (the file was picked up
// mid-turn, or the host saw no prompt) opens one; a turn_start over an open turn closes it first.
export function apply(s: State, e: Event): State {
  const at = e.t
  const open = (prompt: string) => {
    s.turn = newTurn(prompt, at)
    s.calls.clear()
    s.mode = 'requesting'
    s.reqAt = at
    return s.turn
  }
  switch (e.kind) {
    case 'turn_start':
      close(s, at)
      open(String(e.prompt ?? ''))
      return s
    case 'start': {
      const t = s.turn ?? open('')
      const id = String(e.id ?? `${at}`)
      const c: Call = { tool: String(e.tool ?? 'other'), input: e.input ?? {}, ...(e.say ? { say: e.say } : {}), ...(e.as ? { kind: e.as } : {}) }
      s.calls.set(id, c)
      startStep(t, id, c.tool, c.input, at)
      const step = t.running.get(id)
      if (step && c.say) step.say = c.say
      if (step && c.kind) step.kind = c.kind
      if (c.tool === 'Task' || c.tool === 'Agent') spawnAgent(t, { toolUseId: id, label: c.say ?? String(c.input.description ?? 'agent'), isBackground: false, startedAt: at })
      s.mode = 'tool-use'
      return s
    }
    case 'end': {
      const t = s.turn ?? open('')
      const id = String(e.id ?? '')
      const c = s.calls.get(id) ?? { tool: String(e.tool ?? 'other'), input: e.input ?? {}, ...(e.say ? { say: e.say } : {}), ...(e.as ? { kind: e.as } : {}) }
      const step = t.running.get(id)
      finishStep(t, id, c.tool, c.input, e.ok !== false, String(e.text ?? ''), e.text, at)
      // finishStep files the running step itself; one it had to rebuild (no start seen) gets the words and kind back.
      const done = t.done[t.done.length - 1]
      if (!step && done && c.say) done.say = c.say
      if (!step && done && c.kind) done.kind = c.kind
      s.calls.delete(id)
      if (!t.running.size) {
        s.mode = 'requesting'
        s.reqAt = at
      }
      return s
    }
    case 'usage': {
      const t = s.turn
      const u = e.usage ?? {}
      if (t) {
        const startedAt = u.startedAt ?? s.reqAt
        t.requests.push({ startedAt, firstAt: u.firstAt ?? startedAt, endedAt: at, output: u.output ?? 0, input: u.input ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0 })
        s.mode = t.running.size ? 'tool-use' : 'requesting'
      }
      s.reqAt = at
      return s
    }
    case 'turn_end':
      close(s, at)
      return s
  }
  return s
}

// A whole recorded list at once (a host that re-reads its file, or a test).
export const reduce = (events: readonly Event[], rec?: SessionRec): State => events.reduce(apply, init(rec))
