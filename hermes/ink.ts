// xray's Seg lines → props for hermes' Ink <Text>, coloured through the TUI's theme (its skin), so the
// card reads in hermes' own palette. Pure: the widget (./widget.ts) does the createElement.
import type { Line, Seg } from '../hooks/cards'

// The slice of hermes' ThemeColors this uses (ui-tui/src/theme.ts).
export type Colors = { ok: string; error: string; warn: string; accent: string; shellDollar: string; label: string; muted: string; text: string }

// The core's semantic colours → the skin's tokens; hex colours are genome kind identities and stay.
// The default skin is all golds: its one blue is the shell prompt's `$`, so reads keep a blue of the skin's.
export const TOKEN: Record<string, keyof Colors> = {
  green: 'ok',
  red: 'error',
  yellow: 'warn',
  cyan: 'accent',
  blue: 'shellDollar',
  magenta: 'label',
  gray: 'muted',
}

const tone = (c: Colors, color: string): string | undefined => {
  if (color === 'black' || color.startsWith('#')) return color
  const k = TOKEN[color.replace(/Bright$/, '')]
  return k ? c[k] : undefined
}

export type TextProps = { color?: string; backgroundColor?: string; dimColor?: boolean; bold?: boolean; inverse?: boolean; strikethrough?: boolean }

// Plain text takes the skin's text colour (Ink's default reads as the TUI's gold); dim alone is its muted
// colour; dim on a colour is faint.
export function props(c: Colors, g: Seg): TextProps {
  const p: TextProps = {}
  const fg = g.color ? tone(c, g.color) : g.dim ? c.muted : c.text
  if (fg) p.color = fg
  const bg = g.bg ? tone(c, g.bg) : undefined
  if (bg) p.backgroundColor = bg
  if (g.dim && g.color) p.dimColor = true
  if (g.bold) p.bold = true
  if (g.inv) p.inverse = true
  if (g.strike) p.strikethrough = true
  return p
}

export const cells = (l: Line) => l.reduce((a, g) => a + g.t.length, 0)

// One line cut to width cells: Ink would wrap a longer row and break the frame.
export function fit(l: Line, width: number): Line {
  let room = width
  const out: Line = []
  for (const g of l) {
    if (room <= 0) break
    const t = g.t.length > room ? g.t.slice(0, room) : g.t
    room -= t.length
    out.push({ ...g, t })
  }
  return out
}

// Padded to width with plain spaces: the panel's rows cover what is under the overlay.
export const pad = (l: Line, width: number): Line => {
  const f = fit(l, width)
  const n = width - cells(f)
  return n > 0 ? [...f, { t: ' '.repeat(n) }] : f
}
