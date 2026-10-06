// xray for hermes' full-screen TUI (`hermes --tui`): the now card docked above the status bar while a turn
// runs, the genome there between turns, /xray for the detail panel. Spec: ./SPEC.md. Hermes gives widgets
// no agent events, so the python plugin (./plugin) appends them to ~/.hermes/xray/live/<this pid>.jsonl
// and this file tails it. Bundled with ../hooks into xray.mjs (./build.sh); hermes hot-loads that from
// ~/.hermes/tui-widgets/.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { compact, TONE_COLOR, type Line } from '../hooks/cards'
import * as genome from '../hooks/genome'
import { spinnerRows, type Memo } from '../hooks/layout'
import { loadRec, type SessionRec } from '../hooks/session'
import { feed, open, type Feed, type Store } from './feed'
import { pad, props, type Colors } from './ink'
import { panelLines } from './panel'

// The slice of hermes' widgetSdk used here (ui-tui/src/sdk/userWidgets.ts, sdk/types.ts, v0.21.5).
type Node = unknown
type El = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => Node
type Ctx<S> = { cols: number; rows: number; state: S; t: { color: Colors } }
type App<S> = {
  id: string
  help: string
  mode?: 'ambient' | 'modal'
  zone?: 'dock-bottom'
  usage?: string
  init(arg: string): S | null
  reduce(state: S, input: unknown): S | null
  render(ctx: Ctx<S>): Node
}
type Sdk = {
  h: El
  Box: unknown
  Text: unknown
  Dialog: unknown
  Overlay: unknown
  defineWidgetApp<S>(app: App<S>): App<S>
  openWidget<S>(app: App<S>, state: S): void
  updateWidget<S>(app: App<S>, fn: (s: S) => S): void
}

const NARROW = 60 // columns: below this the card folds to its compact rows (as omp)
const BODY_ROWS = 3
const HOME = process.env.HERMES_HOME?.trim() || join(homedir(), '.hermes')
const DIR = join(HOME, 'xray')
const LIVE = join(DIR, 'live')
const FILE = `${process.pid}.jsonl`
const STORE = join(DIR, 'genomes.json')

function readStore(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
const store: Store = {
  load: sid => loadRec(readStore()[genome.keyOf(sid)]),
  save(sid: string, rec: SessionRec) {
    try {
      const all = readStore()
      const key = genome.keyOf(sid)
      all[key] = rec
      for (const k of genome.stale(Object.keys(all), key)) delete all[k]
      if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
      writeFileSync(STORE, JSON.stringify(all))
    } catch {}
  },
}

// Feeds left by TUIs that are gone (a crash skips the exit hook).
function prune() {
  try {
    for (const f of readdirSync(LIVE)) {
      const pid = Number(f.replace(/\.jsonl$/, ''))
      if (!pid || pid === process.pid) continue
      try {
        process.kill(pid, 0)
      } catch {
        unlinkSync(join(LIVE, f))
      }
    }
  } catch {}
}

// What survives a hot reload: the folded feed and how far it was read. Replaying the file onto the stored
// record would add its finished turns a second time.
type Tail = { f: Feed; memo: Memo; off: number; rest: string }
type Mounted = { dispose(): void; tail: Tail }
const G = globalThis as { __xrayHermes?: Mounted }

export default function register(sdk: Sdk) {
  // Hot reload imports this file again: the previous copy's watcher and timer go first.
  const prev = G.__xrayHermes
  prev?.dispose()
  if (process.env.CLAUDE_HUMAN_MODS === 'off') return
  const { h, Box, Text } = sdk
  const tail: Tail = prev?.tail ?? { f: open(), memo: { tones: {} }, off: 0, rest: '' }
  const { f, memo } = tail

  // Tail our pid's feed by byte offset; a half-written last line waits for the next read.
  const dec = new TextDecoder()
  function pull(): boolean {
    const path = join(LIVE, FILE)
    try {
      const size = statSync(path).size
      if (size < tail.off) {
        tail.off = 0
        tail.rest = ''
      }
      if (size === tail.off) return false
      const buf = new Uint8Array(size - tail.off)
      const fd = openSync(path, 'r')
      try {
        readSync(fd, buf, 0, buf.length, tail.off)
      } finally {
        closeSync(fd)
      }
      tail.off = size
      const text = tail.rest + dec.decode(buf)
      const cut = text.lastIndexOf('\n') + 1
      tail.rest = text.slice(cut)
      return feed(f, text.slice(0, cut), store)
    } catch {
      return false
    }
  }

  function draw(width: number): Line[] {
    const t = f.s.turn
    const now = Date.now()
    const cols = Math.max(24, width)
    if (!t) return genome.idle(f.s.rec.turns, cols)
    if (cols < NARROW) {
      const k = compact(t, f.s.mode, null, null, now, cols - 2, false)
      const band: Line = [{ t: ` ${k.status} `, bg: TONE_COLOR[k.tone] ?? 'gray', color: 'black' }, ...(k.pulse ? [{ t: ' ' }, k.pulse] : [])]
      return [band, ...k.body, k.bottom, ...genome.idle(f.s.rec.turns, cols, { live: t, now, maxRows: 1 })]
    }
    // No context gauge or folder: hermes' status bar shows both.
    return spinnerRows(t, f.s.mode, null, null, now, cols, BODY_ROWS, memo, '', { withTodo: false, turns: f.s.rec.turns })
  }

  // Each row one truncating <Text>: Ink would wrap a long one and break the frame.
  const rows = (lines: Line[], c: Colors, key: string) =>
    h(Box, { flexDirection: 'column' }, ...lines.map((l, i) => h(Text, { key: `${key}${i}`, wrap: 'truncate-end' }, ...(l.length ? l.map((g, j) => h(Text, { key: j, ...props(c, g) }, g.t)) : [' ']))))

  const card = sdk.defineWidgetApp<{ n: number }>({
    id: 'xray-card',
    help: 'xray: show or hide the now card and genome',
    mode: 'ambient',
    zone: 'dock-bottom',
    init: () => ({ n: 0 }),
    reduce: s => s,
    // The dock pads 2 columns on the right; one more keeps the frame off the pending-wrap column.
    render: ({ cols, t }) => rows(draw(cols - 3), t.color, 'c'),
  })

  sdk.defineWidgetApp<Record<string, never>>({
    id: 'xray',
    help: 'xray: the detail panel (genome, files, turns, requests, steps)',
    mode: 'modal',
    init: () => ({}),
    reduce: () => null,
    render: ({ cols, rows: height, t }) => {
      const width = Math.max(30, cols - 4)
      const inner = width - 6
      // Dialog: border, padding, title and hint take 8 rows; one more spare.
      const room = Math.max(4, height - 9)
      const all = panelLines(f.s, inner, Date.now(), process.cwd(), homedir())
      const shown = all.length > room ? [...all.slice(0, room - 1), [{ t: `+${all.length - room + 1} rows`, dim: true }]] : all
      return h(sdk.Overlay, { zone: 'center' }, h(sdk.Dialog, { title: 'xray', hint: 'any key closes', width }, rows(shown.map(l => pad(l, inner)), t.color, 'p')))
    },
  })

  const bump = () => sdk.updateWidget(card, s => ({ n: s.n + 1 }))
  try {
    mkdirSync(LIVE, { recursive: true })
  } catch {}
  prune()
  pull()
  const watcher = watch(LIVE, (_e, file) => {
    if ((!file || file === FILE) && pull()) bump()
  })
  watcher.unref?.()
  // Elapsed times move without an event: once a second while a turn runs.
  const timer = setInterval(() => {
    if (pull() || f.s.turn) bump()
  }, 1000)
  timer.unref?.()
  const drop = () => {
    try {
      unlinkSync(join(LIVE, FILE))
    } catch {}
  }
  process.on('exit', drop)
  G.__xrayHermes = {
    tail,
    dispose() {
      watcher.close()
      clearInterval(timer)
      process.off('exit', drop)
    },
  }
  // Placed at load: a dock widget otherwise waits for /xray-card. A hot reload re-shows a hidden card.
  sdk.openWidget(card, { n: 0 })
}

