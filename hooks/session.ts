// Round 20: what a session leaves behind, as ONE stored record under the genome's key (was a bare list of
// turns): each turn's letters, what the turn was called, the session's landmarks, the files it touched and
// when it began. One key per session, so genome.stale() still sweeps it whole. Pure: the register reads
// and writes the store.

import { MAX_TURNS } from './genome'
import type { Turn } from './track'

// A landmark on the genome: `turn` indexes `turns`, `at` the step within that turn's letters (round 20b).
export type MarkKind = 'commit' | 'green' | 'red' | 'fanout' | 'ctx' | 'longest'
export type Mark = { turn: number; at: number; kind: MarkKind; text: string }
// A file's touches in time order as genome letters (r read, e edit, x failed), newest last (round 20e).
export type FileHeat = { f: string; cells: string; at: number }
// tests: the session's test state after its last counted run (round 20b: "red again" needs it).
export type SessionRec = { turns: string[]; names: string[]; marks: Mark[]; files: FileHeat[]; startedAt?: number; tests?: 'red' | 'green' }

export const MAX_FILES = 60
export const MAX_CELLS = 40 // per file; the oldest touches drop first

export const emptyRec = (): SessionRec => ({ turns: [], names: [], marks: [], files: [] })

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

// Stored value → record. A plain list is a round-19 genome (turns only); anything malformed reads as empty.
export function loadRec(v: unknown): SessionRec {
  if (Array.isArray(v)) return { ...emptyRec(), turns: strs(v) }
  if (!v || typeof v !== 'object') return emptyRec()
  const o = v as Record<string, unknown>
  const marks = Array.isArray(o.marks) ? (o.marks as Mark[]).filter(m => typeof m?.turn === 'number' && typeof m.at === 'number' && typeof m.text === 'string') : []
  const files = Array.isArray(o.files) ? (o.files as FileHeat[]).filter(x => typeof x?.f === 'string' && typeof x.cells === 'string') : []
  return { turns: strs(o.turns), names: strs(o.names), marks, files, ...(typeof o.startedAt === 'number' ? { startedAt: o.startedAt } : {}), ...(o.tests === 'red' || o.tests === 'green' ? { tests: o.tests } : {}) }
}

// One finished turn appended. Past MAX_TURNS the oldest turns go, and their names and marks with them.
export function addTurn(rec: SessionRec, letters: string, extra: { name?: string; marks?: Omit<Mark, 'turn'>[]; files?: FileHeat[]; tests?: 'red' | 'green' } = {}): SessionRec {
  const n = rec.turns.length
  const names = [...rec.names, ...Array(Math.max(0, n - rec.names.length)).fill('')].slice(0, n)
  let turns = [...rec.turns, letters]
  let named = [...names, extra.name ?? '']
  let marks = [...rec.marks, ...(extra.marks ?? []).map(m => ({ ...m, turn: n }))]
  const cut = Math.max(0, turns.length - MAX_TURNS)
  if (cut) {
    turns = turns.slice(cut)
    named = named.slice(cut)
    marks = marks.filter(m => m.turn >= cut).map(m => ({ ...m, turn: m.turn - cut }))
  }
  return { ...rec, turns, names: named, marks, files: mergeFiles(rec.files, extra.files ?? []), ...(extra.tests ? { tests: extra.tests } : {}) }
}

// A turn's file touches folded into the session's: cells appended, newest touch first, capped.
export function mergeFiles(old: readonly FileHeat[], add: readonly FileHeat[]): FileHeat[] {
  const by = new Map(old.map(x => [x.f, { ...x }]))
  for (const x of add) {
    const p = by.get(x.f)
    by.set(x.f, p ? { f: x.f, cells: (p.cells + x.cells).slice(-MAX_CELLS), at: Math.max(p.at, x.at) } : { ...x, cells: x.cells.slice(-MAX_CELLS) })
  }
  return [...by.values()].sort((a, b) => b.at - a.at).slice(0, MAX_FILES)
}

// A turn's touches per file, in the order its steps ended: r read, e edit, x failed (round 20e).
export function fileTouches(t: Turn, now: number): FileHeat[] {
  const by = new Map<string, string>()
  for (const x of t.done) {
    if (!x.file || (x.kind !== 'read' && x.kind !== 'edit')) continue
    by.set(x.file, (by.get(x.file) ?? '') + (x.ok === false ? 'x' : x.kind === 'read' ? 'r' : 'e'))
  }
  return [...by].map(([f, cells]) => ({ f, cells, at: now }))
}

// Paths as short as they can be and still tell apart: the file's name, one parent more where two
// names clash or the name says little (index.ts), home as ~ when it is outside the folder.
const GENERIC = /^(index|main|mod|init|__init__|utils?|types?)\.\w+$/
export function shortName(path: string, all: readonly string[], cwd = '', home = ''): string {
  if (cwd && path.startsWith(cwd + '/')) path = path.slice(cwd.length + 1)
  else if (home && path.startsWith(home + '/')) path = '~/' + path.slice(home.length + 1)
  const parts = path.split('/')
  const base = parts[parts.length - 1] ?? path
  const clash = all.some(p => p !== path && !p.endsWith('/' + path) && p.split('/').pop() === base)
  return (clash || GENERIC.test(base)) && parts.length > 1 ? parts.slice(-2).join('/') : base
}

// The turn's hottest file (most touches, 2 at least), for the now card's last row.
export function hotFile(t: Turn): { f: string; n: number; isEdited: boolean } | undefined {
  const top = fileTouches(t, 0).sort((a, b) => b.cells.length - a.cells.length)[0]
  return top && top.cells.length >= 2 ? { f: top.f, n: top.cells.length, isEdited: top.cells.includes('e') } : undefined
}
