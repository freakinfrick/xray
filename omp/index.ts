// xray for omp (oh-my-pi v18.3.5): the now card under omp's spinner while it works, the genome between
// turns, /xray for the detail panel. Spec: ./SPEC.md. The drawing is xray's shared core (../hooks); this
// file only feeds it omp's events and hands its lines to omp's widget through ./ink (omp's theme).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Line, Mode } from '../hooks/cards'
import { compact, TONE_COLOR } from '../hooks/cards'
import { spinnerRows, type Memo } from '../hooks/layout'
import { panel, type Usage } from '../hooks/panel'
import * as genome from '../hooks/genome'
import { nameOf } from '../hooks/names'
import { addTurn, emptyRec, fileTouches, loadRec, shortName, type SessionRec } from '../hooks/session'
import { countedRuns, endTurn, filesRead, finishStep, newTurn, spawnAgent, startStep, type Turn } from '../hooks/track'
import { cells, ink, resultText, toCall, type Call, type Theme } from './ink'

// The slice of omp's extension API used here (packages/coding-agent/src/extensibility/extensions/types.ts).
type Component = { render(width: number): readonly string[]; invalidate?(): void; dispose?(): void; handleInput?(data: string): void }
type Tui = { requestRender(): void }
type Ctx = {
  hasUI: boolean
  mode: string
  agent?: { kind: string }
  sessionManager: { getSessionId(): string | undefined; getSessionName?(): string | undefined }
  getContextUsage(): { tokens: number; contextWindow: number; percent: number } | undefined
  setInterval(fn: () => void, ms: number): unknown
  ui: {
    setWidget(key: string, content: ((tui: Tui, theme: Theme) => Component) | undefined, opts?: { placement?: 'aboveEditor' | 'belowEditor' }): void
    custom<T>(factory: (tui: Tui, theme: Theme, kb: unknown, done: (r: T) => void) => Component, opts?: { overlay?: boolean }): Promise<T>
    notify(msg: string, type?: 'info' | 'warning' | 'error'): void
  }
}
type Pi = {
  on(event: string, fn: (e: any, ctx: Ctx) => unknown): void
  registerCommand(name: string, cmd: { description?: string; handler(args: string, ctx: Ctx): unknown }): void
  getSessionName(): string | undefined
  setSessionName(name: string): void
}

const KEY = 'xray'
const NARROW = 60 // columns: below this the card folds to its compact rows (parent round 8)
const BODY_ROWS = 3
const PANEL_DNA = 12
const PANEL_TURNS = 10
const STORE = join(homedir(), '.omp', 'agent', 'xray', 'genomes.json')

type Live = {
  turn: Turn | null
  prev: Turn | null
  prompt: string
  calls: Map<string, Call>
  rec: SessionRec
  id: string
  ctx: number | null
  mode: Mode
  memo: Memo
  isHidden: boolean
  cost: number
  msgAt: number
  firstAt: number
  tui: Tui | null
  isTicking: boolean
}

function readStore(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
function writeStore(all: Record<string, unknown>) {
  try {
    const dir = join(homedir(), '.omp', 'agent', 'xray')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(STORE, JSON.stringify(all))
  } catch {}
}

// The main session in omp's TUI only: factories rebind in subagents; unattended panes turn mods off.
const isOn = (ctx: Ctx) => ctx.hasUI && ctx.mode === 'tui' && (ctx.agent?.kind ?? 'main') === 'main' && process.env.CLAUDE_HUMAN_MODS !== 'off'

export default function xray(pi: Pi) {
  const s: Live = { turn: null, prev: null, prompt: '', calls: new Map(), rec: emptyRec(), id: '', ctx: null, mode: undefined, memo: { tones: {} }, isHidden: false, cost: 0, msgAt: 0, firstAt: 0, tui: null, isTicking: false }
  const redraw = () => s.tui?.requestRender()

  function load(ctx: Ctx) {
    const id = ctx.sessionManager.getSessionId() ?? ''
    if (id === s.id) return
    s.id = id
    s.rec = id ? loadRec(readStore()[genome.keyOf(id)]) : emptyRec()
    s.rec.startedAt ??= Date.now()
  }
  function save(letters: string, extra: Parameters<typeof addTurn>[2]) {
    if (!s.id) return
    s.rec = addTurn(s.rec, letters, extra)
    const all = readStore()
    const key = genome.keyOf(s.id)
    all[key] = s.rec
    for (const k of genome.stale(Object.keys(all), key)) delete all[k]
    writeStore(all)
  }

  // One widget for both states: the card while a turn runs, the genome between turns. /new, /resume
  // and a fork wipe every widget, so this runs again on each switch.
  function mount(ctx: Ctx) {
    if (!isOn(ctx)) return
    load(ctx)
    ctx.ui.setWidget(KEY, (tui, theme) => {
      s.tui = tui
      let last: string[] = []
      let sig = ''
      return {
        render(width: number) {
          const lines = s.isHidden ? [] : draw(width).map(l => ink(theme, l, width))
          const next = lines.join('\n')
          if (next !== sig) {
            sig = next
            last = lines
          }
          return last
        },
        invalidate() {
          sig = ''
        },
      }
    }, { placement: 'aboveEditor' })
  }

  function draw(width: number): Line[] {
    const now = Date.now()
    const t = s.turn
    // Never the last column: a full-width row wraps in some terminals.
    const cols = Math.max(24, width - 1)
    if (!t) {
      // Between turns the genome alone: omp's own status line already carries the folder and context.
      const w = cols - genome.EDGE_LABEL.length - 1
      return genome.labelRight(genome.rows(s.rec.turns, w, { maxRows: cols < NARROW ? 1 : 3 }), cols)
    }
    const dna = genome.labelRight(genome.rows(s.rec.turns, cols - genome.EDGE_LABEL.length - 1, { live: t, now, maxRows: 1 }), cols)
    if (cols < NARROW) {
      const k = compact(t, s.mode, null, s.ctx, now, cols - 2, false)
      const band: Line = [{ t: ` ${k.status} `, bg: TONE_COLOR[k.tone] ?? 'gray', color: 'black' }, ...(k.pulse ? [{ t: ' ' }, k.pulse] : [])]
      return [band, ...k.body, k.bottom, ...dna]
    }
    return [...spinnerRows(t, s.mode, null, s.ctx, now, cols, BODY_ROWS, s.memo, '', false), ...dna]
  }

  // Once a second while a turn runs: elapsed times and the context figure move without an event.
  function tick(ctx: Ctx) {
    if (s.isTicking) return
    s.isTicking = true
    ctx.setInterval(() => {
      if (!s.turn) return
      s.ctx = ctx.getContextUsage()?.percent ?? s.ctx
      redraw()
    }, 1000)
  }

  pi.on('session_start', (_e, ctx) => mount(ctx))
  pi.on('session_switch', (_e, ctx) => {
    s.turn = null
    s.prev = null
    s.id = ''
    mount(ctx)
  })

  pi.on('before_agent_start', (e: { prompt?: string }) => {
    s.prompt = String(e.prompt ?? '')
  })
  pi.on('agent_start', (_e, ctx) => {
    if (!isOn(ctx)) return
    load(ctx)
    s.turn = newTurn(s.prompt, Date.now())
    s.calls.clear()
    s.mode = 'requesting'
    s.ctx = ctx.getContextUsage()?.percent ?? s.ctx
    tick(ctx)
    redraw()
  })

  pi.on('message_start', (e: { message?: { role?: string } }) => {
    if (!s.turn || e.message?.role !== 'assistant') return
    s.msgAt = Date.now()
    s.firstAt = 0
    s.mode = 'requesting'
  })
  pi.on('message_update', () => {
    if (!s.turn || s.mode === 'responding') return
    s.firstAt ||= Date.now()
    s.mode = 'responding'
    redraw()
  })
  pi.on('message_end', (e: { message?: { role?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } } } }) => {
    const u = e.message?.role === 'assistant' ? e.message.usage : undefined
    if (!u) return
    s.cost += u.cost?.total ?? 0
    const t = s.turn
    if (!t) return
    const now = Date.now()
    t.requests.push({ startedAt: s.msgAt || now, firstAt: s.firstAt || now, endedAt: now, output: u.output ?? 0, input: u.input ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0 })
    s.mode = t.running.size ? 'tool-use' : 'requesting'
    redraw()
  })

  pi.on('tool_execution_start', (e: { toolCallId: string; toolName: string; args: unknown; intent?: string }) => {
    const t = s.turn
    if (!t) return
    const c = toCall(e.toolName, e.args, e.intent)
    s.calls.set(e.toolCallId, c)
    const now = Date.now()
    startStep(t, e.toolCallId, c.tool, c.input, now)
    const step = t.running.get(e.toolCallId)
    if (step && c.say) step.say = c.say
    if (step && c.kind) step.kind = c.kind
    if (c.tool === 'Task') spawnAgent(t, { toolUseId: e.toolCallId, label: c.say ?? 'agent', isBackground: false, startedAt: now })
    s.mode = 'tool-use'
    redraw()
  })
  pi.on('tool_execution_end', (e: { toolCallId: string; toolName: string; result: unknown; isError: boolean }) => {
    const t = s.turn
    if (!t) return
    const c = s.calls.get(e.toolCallId) ?? toCall(e.toolName, {})
    const step = t.running.get(e.toolCallId)
    finishStep(t, e.toolCallId, c.tool, c.input, !e.isError, resultText(e.result), e.result, Date.now())
    // finishStep files the running step itself; a step it had to rebuild gets omp's words and kind back.
    const done = t.done[t.done.length - 1]
    if (!step && done && c.say) done.say = c.say
    if (!step && done && c.kind) done.kind = c.kind
    s.calls.delete(e.toolCallId)
    if (!t.running.size) s.mode = 'requesting'
    redraw()
  })

  pi.on('agent_end', (e: { willContinue?: boolean }, ctx) => {
    const t = s.turn
    if (!t || e.willContinue) return
    const now = Date.now()
    endTurn(t)
    t.endedAt = now
    const letters = genome.code(t)
    save(letters, { name: nameOf(letters, countedRuns(t), filesRead(t)), files: fileTouches(t, now) })
    // The genome rides the session's name, as it rides the /resume title in Claude Code. Left alone until
    // omp (or the person) has named the session, so the base stays theirs.
    const name = genome.titleOf(pi.getSessionName(), s.rec.turns)
    if (name) pi.setSessionName(name)
    s.prev = t
    s.turn = null
    s.mode = undefined
    s.ctx = ctx.getContextUsage()?.percent ?? s.ctx
    redraw()
  })

  pi.registerCommand('xray', {
    description: 'xray: the detail panel; on|off shows or hides the card',
    handler: async (args, ctx) => {
      const arg = args.trim()
      if (arg === 'on' || arg === 'off') {
        s.isHidden = arg === 'off'
        ctx.ui.notify(`xray ${s.isHidden ? 'hidden' : 'shown'}`, 'info')
        redraw()
        return
      }
      if (!ctx.hasUI) return
      load(ctx)
      await ctx.ui.custom<void>((tui, theme, _kb, done) => {
        let last: string[] = []
        let at = -1
        return {
          render(width: number) {
            if (width === at) return last
            at = width
            last = panelLines(ctx, width - 4).map(l => (l.length ? '  ' + ink(theme, l, width - 4) : ''))
            return last
          },
          invalidate() {
            at = -1
          },
          handleInput() {
            done()
            tui.requestRender()
          },
        }
      }, { overlay: true })
    },
  })

  function panelLines(ctx: Ctx, cols: number): Line[] {
    const now = Date.now()
    const c = ctx.getContextUsage()
    const usage: Usage = { context: { tokens: c?.tokens, window: c?.contextWindow ?? 0, percent: c?.percent }, cost: { usd: s.cost }, rateLimits: [] }
    const sections = panel(s.turn ?? s.prev, usage, now, [], { cols }, null)
    const dna = genome.rows(s.rec.turns, cols, { live: s.turn ?? undefined, now, maxRows: PANEL_DNA })
    sections.unshift({ title: `genome · ${genome.summary(s.rec.turns)}`, rows: [...(dna.length ? dna : [[{ t: 'no steps yet this session', dim: true }]]), [{ t: ' ' }], ...genome.key(cols)] })
    if (s.rec.startedAt !== undefined) {
      const mins = Math.round((now - s.rec.startedAt) / 60_000)
      sections.splice(1, 0, { title: 'here', rows: [[{ t: `${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`} · ${s.rec.turns.length} turn${s.rec.turns.length === 1 ? '' : 's'}`, dim: true }]] })
    }
    // The files this session touched, newest touch first, each touch a genome cell (parent round 20e).
    const files = s.rec.files.slice(0, PANEL_TURNS)
    if (files.length) {
      const all = s.rec.files.map(x => x.f)
      const names = files.map(x => shortName(x.f, all, process.cwd(), homedir()))
      const w = Math.min(28, Math.max(...names.map(n => n.length)))
      sections.push({ title: `files · ${s.rec.files.length}`, rows: files.map((x, i) => [{ t: (names[i] ?? '').slice(0, w).padEnd(w + 2) }, ...genome.cellsOf(x.cells.slice(-Math.max(8, cols - w - 4)))]) })
    }
    const named = s.rec.turns.map((x, i) => ({ x, i, name: s.rec.names[i] ?? '' })).filter(r => r.name).reverse().slice(0, PANEL_TURNS)
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
    const out: Line[] = [[{ t: 'xray', bold: true }, { t: '  any key closes', dim: true }], []]
    for (const sec of sections) out.push([{ t: sec.title, bold: true }], ...sec.rows, [])
    return out
  }
}
