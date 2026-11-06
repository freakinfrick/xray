// The session's title as /resume lists it: read from the transcript, the genome appended in colour.
// Changes with Claude Code's transcript format, not with how the genome draws on screen.

import { BRACKET, bracketOf, cellOf } from './genome'
import type { Seg } from './line'

// The genome in the session's title, so /resume's list shows it (user, 2026-10-04, picks 1a, then colour).
// Each step is its real cell in its kind's colour inside a dim bracket, as on screen: the picker draws ANSI
// from a title line in the transcript, and the terminal tab title drops the codes. A hook's sessionTitle
// can't carry it (its ESC bytes become spaces), so register.tsx appends the line itself.
// Past `max` cells the oldest whole turns fold into a leading `…`; one huge turn keeps its bracket and newest cells.
export const TITLE_SEP = ' · '
export const TITLE_MAX = 48
const ESC = '\x1b['
const NAMED: Record<string, number> = { black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90, grey: 90 }
export function sgr(seg: Seg): string {
  const codes = ['0']
  if (seg.bold) codes.push('1')
  if (seg.dim) codes.push('2')
  const c = seg.color
  const hex = c ? /^#([0-9a-f]{6})$/i.exec(c)?.[1] : undefined
  if (hex) codes.push(`38;2;${parseInt(hex.slice(0, 2), 16)};${parseInt(hex.slice(2, 4), 16)};${parseInt(hex.slice(4), 16)}`)
  else if (c && NAMED[c]) codes.push(String(NAMED[c]))
  return `${ESC}${codes.join(';')}m${seg.t}`
}
export function titleGenome(turns: readonly string[], max = TITLE_MAX): string {
  const turnCells = turns.filter(x => x).map(x => {
    const [o, c] = BRACKET[bracketOf(x)]
    return [{ t: o, dim: true }, ...[...x].map(cellOf), { t: c, dim: true }] as Seg[]
  })
  let kept: Seg[] = []
  for (const cells of turnCells.reverse()) {
    if (kept.length + cells.length > max - 1) {
      // One turn alone too long: its bracket opens, then `…` and its newest cells.
      kept = kept.length ? [{ t: '…', dim: true }, ...kept] : [cells[0]!, { t: '…', dim: true }, ...cells.slice(-(max - 2))]
      break
    }
    kept = [...cells, ...kept]
  }
  return kept.length ? kept.map(sgr).join('') + `${ESC}0m` : ''
}
// The title without a genome this mod put there before, so the person's own name (or /rename) stays the
// base: the coloured one, the plain letters of ea41a1d, and ` · [0;2m( …` left by a hook that turned ESC
// into spaces (2026-10-04).
const OLD_GENOME = /\s·\s(?:\s*\x1b\[[\s\S]*|\s+\[[\d;]*m[\s\S]*|(?=[…(\[{])(?:…(?:[a-z]*[)\]}])?)?(?:[(\[{][a-z]*[)\]}])*)$/
export const titleBase = (title: string) => title.replace(OLD_GENOME, '')
// The line Claude Code itself writes for a title, appended to the session's transcript.
export const titleLine = (title: string, sessionId: string) => JSON.stringify({ type: 'custom-title', customTitle: title, sessionId }) + '\n'
// The new title, or undefined to leave it alone: no name yet (setting one now would pin the base before
// Claude Code names the session), no steps, or no change.
export function titleOf(current: string | undefined, turns: readonly string[]): string | undefined {
  const base = current ? titleBase(current).trim() : ''
  const dna = titleGenome(turns)
  if (!base || !dna) return undefined
  const next = base + TITLE_SEP + dna
  return next === current ? undefined : next
}
// The newest custom title in transcript lines, else the newest AI title (the order /resume prefers them).
export function titleFromLines(text: string): string | undefined {
  let custom: string | undefined
  let ai: string | undefined
  for (const line of text.split('\n')) {
    try {
      const o = JSON.parse(line) as { type?: string; customTitle?: unknown; aiTitle?: unknown }
      if (o.type === 'custom-title' && typeof o.customTitle === 'string') custom = o.customTitle
      if (o.type === 'ai-title' && typeof o.aiTitle === 'string') ai = o.aiTitle
    } catch {}
  }
  return custom || ai
}
