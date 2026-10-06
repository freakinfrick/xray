// The pi family's two pure pieces (omp and pi, specs omp/SPEC.md, pi/SPEC.md): xray's Seg lines → ANSI
// through the host's theme, and a host tool call → the Claude Code shape the shared core (../hooks) reads.
// No host imports, so the tests run under `claude plugin test` like the rest of xray.
import type { Line, Seg } from '../hooks/cards'
import type { Call } from '../hooks/events'
export type { Call }

// The part of the host's Theme this uses (omp packages/tui/src/theme/theme-class.ts v18.3.5; pi
// modes/interactive/theme/theme.d.ts 0.87.1, which has no getColorHex and no boxRound).
export type Theme = {
  getFgAnsi(token: string): string
  getColorHex?(token: string): string
  boxRound?: { topLeft: string; topRight: string; bottomLeft: string; bottomRight: string; horizontal: string; vertical: string }
}

// Semantic colors take the theme's token; titanium has no magenta, so it becomes the gold label colour.
// Hex colours are genome kind identities (script, orchestrate, network, memory) and stay as they are.
export const TOKEN: Record<string, string> = {
  green: 'success',
  red: 'error',
  yellow: 'warning',
  cyan: 'accent',
  blue: 'mdLinkUrl',
  magenta: 'customMessageLabel',
  gray: 'muted',
}
const base = (c: string) => c.replace(/Bright$/, '')

// A host whose theme gives a token another job swaps it here: pi's mdLinkUrl is dim grey, so read cells
// would look like other cells; its mdLink is the blue. The wrapper keeps the theme's methods bound.
export function retoken(theme: Theme, swap: Record<string, string>): Theme {
  const to = (t: string) => swap[t] ?? t
  const hex = theme.getColorHex
  return {
    getFgAnsi: t => theme.getFgAnsi(to(t)),
    ...(hex ? { getColorHex: (t: string) => hex.call(theme, to(t)) } : {}),
    ...(theme.boxRound ? { boxRound: theme.boxRound } : {}),
  }
}

const RESET = '\x1b[0m'
function hexRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m?.[1]) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgb = (hex: string, layer: 38 | 48) => {
  const c = hexRgb(hex)
  return c ? `\x1b[${layer};2;${c.join(';')}m` : ''
}

function fg(theme: Theme, color: string): string {
  if (color === 'black') return '\x1b[30m'
  if (color.startsWith('#')) return rgb(color, 38)
  const token = TOKEN[base(color)]
  if (!token) return ''
  try {
    return theme.getFgAnsi(token)
  } catch {
    return ''
  }
}
// A band's background: omp's hex, else the token's foreground escape moved to the background layer
// (38;2;r;g;b or 38;5;n → 48;…), which is all pi offers. No 38; in it (an unset token): no band colour.
function bg(theme: Theme, color: string): string {
  if (color.startsWith('#')) return rgb(color, 48)
  const token = TOKEN[base(color)]
  if (!token) return ''
  try {
    if (theme.getColorHex) return rgb(theme.getColorHex(token), 48)
    const f = theme.getFgAnsi(token)
    return f.startsWith('\x1b[38;') ? '\x1b[48;' + f.slice(5) : ''
  } catch {
    return ''
  }
}

// The core draws omp's own rounded frame; an ascii (or other) symbol preset swaps the glyphs.
const ROUND = { '╭': 'topLeft', '╮': 'topRight', '╰': 'bottomLeft', '╯': 'bottomRight', '─': 'horizontal', '│': 'vertical' } as const
function glyphs(theme: Theme, t: string): string {
  const box = theme.boxRound
  if (!box || box.topLeft === '╭') return t
  return t.replace(/[╭╮╰╯─│]/g, ch => box[ROUND[ch as keyof typeof ROUND]] ?? ch)
}

export function seg(theme: Theme, g: Seg): string {
  const codes = [g.color ? fg(theme, g.color) : g.dim ? fg(theme, 'gray') : '', g.bg ? bg(theme, g.bg) : '', g.bold ? '\x1b[1m' : '', g.dim && g.color ? '\x1b[2m' : '', g.inv ? '\x1b[7m' : '', g.strike ? '\x1b[9m' : ''].join('')
  const t = glyphs(theme, g.t)
  return codes ? codes + t + RESET : t
}

// Cells, as the core counts them (one per UTF-16 unit; its glyphs are all one cell wide).
export const cells = (l: Line) => l.reduce((a, g) => a + g.t.length, 0)

// One line, cut to width cells: a widget row past the terminal's width wraps and breaks the frame.
export function ink(theme: Theme, l: Line, width = Infinity): string {
  let room = width
  let out = ''
  for (const g of l) {
    if (room <= 0) break
    const t = g.t.length > room ? g.t.slice(0, room) : g.t
    room -= t.length
    out += seg(theme, { ...g, t })
  }
  return out
}

// omp's and pi's tools → the names and argument keys the core reads (track.ts stepKind/startStep/finishStep).
// omp's spinner line already shows each call's intent (`i`, the why), so a mapped tool keeps the core's
// own words (the what: "editing calc.py"); only tools the core has no words for say their intent.
// Call is the core's (../hooks/events), shared with the JSONL-fed hosts.
export function toCall(name: string, args: unknown, intent?: string): Call {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const say = intent ?? (typeof a.i === 'string' ? a.i : undefined)
  const path = { file_path: String(a.path ?? '') }
  switch (name) {
    case 'bash':
      return { tool: 'Bash', input: { command: String(a.command ?? '') } }
    case 'read':
      return { tool: 'Read', input: path }
    case 'grep':
      return { tool: 'Grep', input: { pattern: String(a.pattern ?? ''), path: String(a.path ?? '') } }
    case 'glob':
      return { tool: 'Glob', input: { pattern: String(a.path ?? '') } }
    // pi's own two, both a look around (the read kind): find is a glob under a path, ls lists a folder.
    case 'find':
      return { tool: 'Glob', input: { pattern: String(a.pattern ?? '') } }
    case 'ls':
      return { tool: 'LS', input: {}, say: say ?? `listing ${String(a.path ?? '').split('/').filter(x => x && x !== '.').pop() ?? 'the folder'}` }
    case 'edit':
      return { tool: 'Edit', input: path }
    case 'write':
      return { tool: 'Write', input: path }
    case 'web_search':
      return { tool: 'WebSearch', input: { query: String(a.query ?? '') } }
    case 'web_fetch':
    case 'fetch':
      return { tool: 'WebFetch', input: { url: String(a.url ?? '') } }
    case 'task':
      return { tool: 'Task', input: { description: say ?? '' } }
    // Code the model wrote and ran: the core's script kind (python3 - <<EOF).
    case 'eval':
      return { tool: 'eval', input: {}, say: say ?? (typeof a.title === 'string' ? a.title : 'eval'), kind: 'script' }
    // omp's own to-do list: bookkeeping, a dim cell; xray draws no list of its own (spec decision 1).
    case 'todo':
      return { tool: 'todo', input: {}, say: say ?? 'to-do list', kind: 'todo' }
    default:
      return { tool: name, input: {}, say: say ?? name, kind: 'other' }
  }
}

// A tool result's text: omp and pi results are { content: [{ type: 'text', text }] } (or a bare string).
export function resultText(result: unknown): string {
  if (typeof result === 'string') return result
  const content = (result as { content?: unknown } | null)?.content
  if (!Array.isArray(content)) return ''
  return content.map(c => (c && typeof c === 'object' && (c as { type?: string }).type === 'text' ? String((c as { text?: unknown }).text ?? '') : '')).join('\n')
}
