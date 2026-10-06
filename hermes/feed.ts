// The plugin's feed folded into what the widget draws, one session at a time. Hermes runs subagents
// (delegate_task) in the same process and their hooks fire into the same file under their own session
// ids: a turn_start names its parent, so a child's lines are dropped and the main turn only sees the
// delegate_task call itself. A parentless turn_start with a new session id (/new, /resume) swaps the record.
import { apply, init, parse, type State } from '../hooks/events'
import type { SessionRec } from '../hooks/session'
import { toEvent, type Raw } from './calls'

export type Feed = { sid: string; s: State; children: Set<string> }
export type Store = { load(sid: string): SessionRec; save(sid: string, rec: SessionRec): void }

export const open = (): Feed => ({ sid: '', s: init(), children: new Set() })

// One line in; true when the drawing may have changed.
export function step(f: Feed, e: Raw, store: Store): boolean {
  const sid = e.sid ?? ''
  if (e.kind === 'turn_start' && e.parent) {
    f.children.add(sid)
    return false
  }
  if (sid && f.children.has(sid)) return false
  if (e.kind === 'turn_start' && sid && sid !== f.sid) {
    if (f.sid && f.s.turn) store.save(f.sid, apply(f.s, { t: e.t, kind: 'turn_end' }).rec)
    f.sid = sid
    f.s = init(store.load(sid))
    f.s.rec.startedAt ??= e.t
  } else if (sid && f.sid && sid !== f.sid) return false
  const ended = f.s.ended
  apply(f.s, toEvent(e))
  if (f.s.ended !== ended && f.sid) store.save(f.sid, f.s.rec)
  return true
}

// A chunk of the file, whole lines only: the caller keeps a half-written tail for the next read.
export function feed(f: Feed, text: string, store: Store): boolean {
  let changed = false
  for (const e of parse(text)) changed = step(f, e as Raw, store) || changed
  return changed
}
