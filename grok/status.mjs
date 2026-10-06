// grok status-line command ([ui.status_line] type = "command"): stdin is grok's session status, stdout the
// row (up to 5 lines). A fresh process each run (~300 ms apart during a turn), so it replays the session's
// JSONL from the start; the file is the store, nothing else is kept. Built into dist/status.mjs by ./build.sh.
// No token gauges: grok's payload (and its transcript) update session tokens once per turn, after Stop.
import { readFileSync } from 'node:fs'
import { render } from './render'
import { fileOf } from './store'

if (process.env.CLAUDE_HUMAN_MODS !== 'off') {
  let input = {}
  try { input = JSON.parse(readFileSync(0, 'utf8')) } catch {}
  const id = String(input.session_id ?? '')
  let text = ''
  try { text = id ? readFileSync(fileOf(id), 'utf8') : '' } catch {}
  const running = typeof input.turn?.started_at_ms === 'number'
  const out = render(text, running, Date.now(), Number(process.env.COLUMNS) || 80)
  process.stdout.write(out.join('\n') + '\n')
}
