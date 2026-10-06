// Where a grok session's xray events live: one folder for every GROK_HOME, as the launchers share
// ~/.grok/sessions, so a session resumed under another launcher keeps its genome.
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DIR = process.env.XRAY_GROK_DIR || join(homedir(), '.grok', 'xray')
export const KEEP = 40
const safe = id => String(id).replace(/[^\w.-]/g, '_')
export const fileOf = id => join(DIR, `${safe(id)}.jsonl`)
