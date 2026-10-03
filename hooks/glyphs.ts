// Colored block glyphs shared by the cards and the panel (round 6, A · Inlay): eighth-cell bars,
// sparklines, solid tiles. Motion steps once a second, the mod's own tick.

import type { Line, Seg } from './cards'

export const SPARK = '▁▂▃▄▅▆▇█'
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// The animation frame: whole seconds, so a glyph alternates at the tick and never faster.
export const frame = (now: number) => Math.floor(now / 1000)

// A bar filled to the eighth of a cell. The split cell is `color` on the track's color when the track
// is a color (a red rest after green), else on the terminal's own background before a dim ░ track.
export function bar(frac: number, cells: number, color: string | undefined, track?: string): Line {
  const x = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0)) * cells
  let full = Math.floor(x)
  let part = Math.round((x - full) * 8)
  if (part === 8) {
    full++
    part = 0
  }
  const out: Line = []
  if (full) out.push({ t: '█'.repeat(full), color })
  if (part) out.push(track ? { t: EIGHTHS[part] as string, color, bg: track } : { t: EIGHTHS[part] as string, color })
  const rest = cells - full - (part ? 1 : 0)
  if (rest > 0) out.push(track ? { t: '█'.repeat(rest), color: track } : { t: '░'.repeat(rest), dim: true })
  return out
}

// One block per value, scaled between the lowest and the highest shown.
export function spark(xs: readonly number[], color: string | null = 'cyan'): Seg {
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  return { t: xs.map(x => SPARK[hi > lo ? Math.round(((x - lo) / (hi - lo)) * 7) : 3]).join(''), color: color ?? undefined }
}

// A solid tile: the glyph in the terminal's background color on `color`.
export const tile = (t: string, color: string): Seg => ({ t, color, inv: true })

// One meaning per shape, on every card and the panel (round 16, direction 5). Circles belong to effort
// alone (○ ◐ ● ◉, Claude Code's own), so a status mark never reads as an effort level.
export const MARK = { live: '◆', done: '■', pending: '□', warn: '▲', fail: '✕', ok: '✓' } as const
// Emphasis in four steps and none between: dim (context, labels, pending), plain (values), bright
// (the one value that changed or matters), band (a card's state, one per card at most).
export const EMPH = { dim: { dim: true }, plain: {}, bright: { bold: true } } as const
