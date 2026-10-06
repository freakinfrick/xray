// /xray's rows: the same sections omp's panel draws (omp/index.ts panelLines), from the feed's State.
// Hermes' status bar already carries the context gauge and cost, so the usage block stays empty.
import type { Line } from '../hooks/cards'
import type { State } from '../hooks/events'
import * as genome from '../hooks/genome'
import { panel } from '../hooks/panel'
import { shortName } from '../hooks/session'
import { cells } from './ink'

const PANEL_DNA = 12
const PANEL_TURNS = 10

export function panelLines(s: State, cols: number, now: number, cwd = '', home = ''): Line[] {
  const rec = s.rec
  const sections = panel(s.turn ?? s.prev, null, now, [], { cols }, null)
  const dna = genome.rows(rec.turns, cols, { live: s.turn ?? undefined, now, maxRows: PANEL_DNA })
  sections.unshift({ title: `genome · ${genome.summary(rec.turns)}`, rows: [...(dna.length ? dna : [[{ t: 'no steps yet this session', dim: true }]]), [{ t: ' ' }], ...genome.key(cols)] })
  if (rec.startedAt !== undefined) {
    const mins = Math.max(0, Math.round((now - rec.startedAt) / 60_000))
    sections.splice(1, 0, { title: 'here', rows: [[{ t: `${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`} · ${rec.turns.length} turn${rec.turns.length === 1 ? '' : 's'}`, dim: true }]] })
  }
  // The files this session touched, newest touch first, each touch a genome cell.
  const files = rec.files.slice(0, PANEL_TURNS)
  if (files.length) {
    const all = rec.files.map(x => x.f)
    const names = files.map(x => shortName(x.f, all, cwd, home))
    const w = Math.min(28, Math.max(...names.map(n => n.length)))
    sections.push({ title: `files · ${rec.files.length}`, rows: files.map((x, i) => [{ t: (names[i] ?? '').slice(0, w).padEnd(w + 2) }, ...genome.cellsOf(x.cells.slice(-Math.max(8, cols - w - 4)))]) })
  }
  const named = rec.turns.map((x, i) => ({ x, i, name: rec.names[i] ?? '' })).filter(r => r.name).reverse().slice(0, PANEL_TURNS)
  if (named.length) {
    const w = Math.min(24, Math.max(...named.map(r => r.x.length), 1))
    sections.push({
      title: `turns · ${named.length}`,
      rows: named.map(r => {
        const d = genome.rows([r.x], w + 1, { maxRows: 1 })[0] ?? []
        return [{ t: `${String(r.i + 1).padStart(3)}  `, dim: true }, ...d, { t: ' '.repeat(Math.max(0, w - cells(d)) + 2) }, { t: r.name }]
      }),
    })
  }
  const out: Line[] = []
  for (const sec of sections) out.push([{ t: sec.title, bold: true }], ...sec.rows, [])
  return out.slice(0, -1)
}
