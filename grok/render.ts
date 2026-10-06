// What grok's status-line row shows, from the replayed events: the now card (genome inside) while a turn
// runs, the genome alone between turns. Pure; ./status.mjs feeds it the files and stdin. Spec: ./SPEC.md.
import type { Line, Seg } from '../hooks/cards'
import { apply, parse, reduce, type State } from '../hooks/events'
import * as genome from '../hooks/genome'
import { spinnerRows } from '../hooks/layout'

export const MAX_LINES = 5 // grok's cap (views/status_line/sanitize.rs MAX_STATUS_LINE_LINES)
export const MAX_BYTES = 1024 // per line, escapes included: past it grok cuts the line mid-frame
// The card's body rows, tallest first: 3 holds a fact row over the gauges (5 lines); the core grows the
// card for a long genome, so a busy session steps down to stay within MAX_LINES.
const ROWS = [3, 2, 1]

// grok's default theme, GrokNight (xai-grok-pager-render/src/theme/groknight.rs): its palette for the
// core's tone names; the status command can't read the active theme, so this one is assumed.
const GROK: Record<string, string> = { red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#e1e1e1', gray: '#6c6c6c' }
// Every colour as xterm-256 (38;5;n): a truecolor escape is twice the bytes, and a genome row switches
// colour every cell or two against grok's 1024-byte line cap. The nearest of the 6×6×6 cube and grey ramp.
const LEVELS = [0, 95, 135, 175, 215, 255]
export function x256(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const near = (v: number) => LEVELS.reduce((best, l, i) => (Math.abs(l - v) < Math.abs((LEVELS[best] ?? 0) - v) ? i : best), 0)
  const [r, g, b] = c.map(near) as [number, number, number]
  const cube = [LEVELS[r] ?? 0, LEVELS[g] ?? 0, LEVELS[b] ?? 0]
  const k = Math.max(0, Math.min(23, Math.round(((c[0]! + c[1]! + c[2]!) / 3 - 8) / 10)))
  const grey = 8 + 10 * k
  const dist = (x: number[]) => x.reduce((a, v, i) => a + (v - (c[i] ?? 0)) ** 2, 0)
  return dist([grey, grey, grey]) < dist(cube) ? 232 + k : 16 + 36 * r + 6 * g + b
}
function colour(c: string, layer: 38 | 48): string {
  if (c === 'black') return String(layer - 8)
  const hex = /^#[0-9a-f]{6}$/i.test(c) ? c : GROK[c.replace(/Bright$/, '')]
  return hex ? `${layer};5;${x256(hex)}` : ''
}

// A segment's SGR parameters: the foreground alone, and the rest, which a later change has to reset.
function style(g: Seg): { fg: string; rest: string } {
  const fg = g.color ? colour(g.color, 38) : g.dim ? colour('gray', 38) : ''
  const rest = [g.bg ? colour(g.bg, 48) : '', g.bold ? '1' : '', g.dim && g.color ? '2' : '', g.inv ? '7' : '', g.strike ? '9' : ''].filter(Boolean).join(';')
  return { fg, rest }
}

// One line → ANSI, cut to width cells. An escape only where the style changes, a bare colour switch
// where nothing else does: a genome row in per-segment escapes passes grok's byte cap at ~40 cells.
export function ansi(l: Line, width = Infinity): string {
  let room = width
  let out = ''
  let fg = ''
  let rest = ''
  for (const g of l) {
    if (room <= 0) break
    const t = g.t.length > room ? g.t.slice(0, room) : g.t
    room -= t.length
    const s = style(g)
    if (s.rest !== rest) out += `\x1b[${['0', s.fg, s.rest].filter(Boolean).join(';')}m`
    else if (s.fg !== fg) out += `\x1b[${s.fg || '39'}m`
    fg = s.fg
    rest = s.rest
    out += t
  }
  return fg || rest ? `${out}\x1b[0m` : out
}

// The row's lines. The hooks' open turn is the working state: grok's own word (stdin turn.started_at_ms)
// is absent mid-turn in the build on this box (1.0.41), so it may open a turn the hooks haven't, never
// close one; a lost Stop (grok killed mid-turn) holds the card until the next prompt.
export function draw(s: State, running: boolean, now: number, cols: number): Line[] {
  if (running && !s.turn) apply(s, { t: now, kind: 'turn_start', prompt: '' })
  const idle = () => {
    const g = genome.idle(s.rec.turns, cols)
    // A fresh session still holds the row: an empty print removes it and the transcript jumps.
    return g.length ? g : [[{ t: ' '.repeat(Math.max(0, cols - genome.EDGE_LABEL.length)) }, { t: genome.EDGE_LABEL, dim: true }]]
  }
  if (!s.turn) return idle()
  for (const rows of ROWS) {
    const card = spinnerRows(s.turn, s.mode, null, null, now, cols, rows, undefined, '', { withTodo: false, turns: s.rec.turns })
    if (card.length <= MAX_LINES) return card
  }
  return idle()
}

export const bytes = (l: string) => new TextEncoder().encode(l).length

// The status command's whole job, given the session file's text: replay, draw, encode. A line still past grok's
// byte cap (a wide pane of alternating cells) redraws narrower rather than lose its right edge.
export function render(text: string, running: boolean, now: number, cols: number): string[] {
  const events = parse(text)
  for (let w = cols; ; w = Math.floor(w * 0.85)) {
    const out = draw(reduce(events), running, now, w).map(l => ansi(l, w))
    if (w <= 40 || out.every(l => bytes(l) <= MAX_BYTES)) return out
  }
}
