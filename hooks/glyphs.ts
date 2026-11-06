// Colored block glyphs shared by the cards and the panel (round 6, A · Inlay): eighth-cell bars,
// sparklines, solid tiles. Motion steps once a second, the mod's own tick.

import type { Line, Seg } from './line'

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

// Context fill, on every gauge, card and panel: yellow from CTX_WARN percent, red from CTX_FULL.
export const CTX_WARN = 70
export const CTX_FULL = 90
export const ctxColor = (pct: number, calm?: string): string | undefined => (pct >= CTX_FULL ? 'red' : pct >= CTX_WARN ? 'yellow' : calm)
// The context percent as text after its gauge (or after `lead`), yellow from CTX_WARN.
export const ctxPct = (pct: number, lead = ' '): Seg => ({ t: `${lead}${Math.round(pct)}%`, color: pct >= CTX_WARN ? 'yellow' : undefined })

// Whole seconds as 45s or 2m 01s, on the cards, the panel and the recipe sources; with `hours`, 1h 05m
// from an hour.
export function duration(s: number, hours = false): string {
  if (hours && s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
