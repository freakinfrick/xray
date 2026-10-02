// The taste ledger: what the person has picked and rated, as rules the recipe writer is bound by.
// Seed rules come from the design rounds in SPEC.md; ratings come from `/xray rate`.

import type { Recipe, Signal } from './custom'

export type Entry = { at: string; verdict: 'good' | 'bad'; signal?: Signal; recipe?: Recipe; note?: string }

export const MAX_ENTRIES = 50
const SHOWN = 12

// From the person's picks, rounds 1-5 (SPEC.md).
export const SEED = [
  'Glanceable over dense: at most 3 values in a row; an empty row beats a crowded one.',
  'No telemetry in the card (token rate, cache, budgets, cost): that lives in the panel.',
  'Structural and informational, never cartoony or decorative.',
  'Plain words in the title and labels; nothing the person has to decode.',
  'Kept layouts: batch = bar, percent, ETA; bench = sparkline, first → latest, change; bisect = step marks, commits left; build = bar against the last run.',
]

const sayRecipe = (r: Recipe) => `"${r.title}" with rows ${r.rows.map(row => row.map(w => w.src).join('+')).join(' / ')}`

// The rules for one card: the seed, then the person's ratings that concern it (newest last).
export function rules(entries: readonly Entry[], signal: Signal): string[] {
  const mine = entries.filter(e => !e.signal || e.signal === signal).slice(-SHOWN)
  return [
    ...SEED,
    ...mine.map(e => {
      const what = e.recipe ? `the ${e.signal} card ${sayRecipe(e.recipe)}` : 'the cards'
      return `${e.verdict === 'good' ? 'Liked' : 'Disliked'} ${what}${e.note ? `: ${e.note}` : ''}${e.verdict === 'bad' && e.recipe ? '. Do not repeat it.' : '.'}`
    }),
  ]
}

const same = (a: Recipe, b: Recipe) => JSON.stringify(a) === JSON.stringify(b)

// Bound, not advised: a written recipe the person already rated bad for this card is refused.
export const isRefused = (entries: readonly Entry[], signal: Signal, r: Recipe) => entries.some(e => e.verdict === 'bad' && e.signal === signal && e.recipe && same(e.recipe, r))

// `/xray rate good|bad [note]`: null when the words are not a rating.
export function parseRating(args: string): { verdict: Entry['verdict']; note?: string } | null {
  const m = args.trim().match(/^rate\s+(good|bad|\+|-)\b\s*(.*)$/i)
  if (!m) return null
  const verdict = m[1] === 'good' || m[1] === '+' ? 'good' : 'bad'
  const note = (m[2] ?? '').trim().slice(0, 200)
  return note ? { verdict, note } : { verdict }
}

export const addEntry = (entries: readonly Entry[], e: Entry) => [...entries, e].slice(-MAX_ENTRIES)
