// grok hook command (every event in ./hooks.json): one envelope on stdin → events appended to the session's
// JSONL. Its stdout and a non-zero exit reach the model (grok docs 10-hooks.md), so it prints nothing and
// exits 0 on every path. Built into dist/hook.mjs by ./build.sh.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { eventName, toEvents } from './map'
import { DIR, KEEP, fileOf } from './store'

try {
  if (process.env.CLAUDE_HUMAN_MODS !== 'off') {
    const e = JSON.parse(readFileSync(0, 'utf8'))
    const id = String(e.sessionId ?? e.session_id ?? '')
    if (eventName(e) === 'SessionStart') prune()
    const lines = id ? toEvents(e, Date.now()).map(x => JSON.stringify(x) + '\n').join('') : ''
    if (lines) {
      mkdirSync(DIR, { recursive: true })
      appendFileSync(fileOf(id), lines)
    }
  }
} catch {}
process.exit(0)

// The newest KEEP sessions' files stay, as the parent's genome store keeps 40.
function prune() {
  const all = readdirSync(DIR).filter(f => f.endsWith('.jsonl')).map(f => ({ f, at: statSync(join(DIR, f)).mtimeMs }))
  for (const { f } of all.sort((a, b) => b.at - a.at).slice(KEEP)) unlinkSync(join(DIR, f))
}
