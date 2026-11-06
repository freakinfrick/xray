// xray for the pi family (omp v18.3.5 and pi 0.87.1, one extension API): the now card by the host's spinner
// while it works, the genome between turns, /xray for the detail panel. Specs: ../omp/SPEC.md, ../pi/SPEC.md.
// The drawing is xray's shared core (../hooks); this file feeds it the host's events and hands its lines to
// the host's widget through ./ink (the host's theme). What differs per host comes in as a Host.
import type { Mode } from '../hooks/cards'
import type { Line } from '../hooks/line'
import { hostView, type Memo } from '../hooks/layout'
import { hostPanel, type Usage } from '../hooks/panel'
import * as genome from '../hooks/genome'
import type { StoreIO } from '../hooks/genome'
import { nameOf } from '../hooks/names'
import { addTurn, emptyRec, fileTouches, type SessionRec } from '../hooks/session'
import { countedRuns, endTurn, filesRead, finishStep, newTurn, spawnAgent, startStep, type Turn } from '../hooks/track'
import { cells, ink, resultText, retoken, toCall, type Call, type Theme } from './ink'

// The slice of the extension API used here: omp packages/coding-agent/src/extensibility/extensions/types.ts,
// pi dist/core/extensions/types.d.ts. pi has no ctx.setInterval and may give null context numbers.
type Component = { render(width: number): readonly string[]; invalidate?(): void; dispose?(): void; handleInput?(data: string): void }
type Tui = { requestRender(): void }
type Ctx = {
  hasUI: boolean
  mode: string
  agent?: { kind: string }
  sessionManager: { getSessionId(): string | undefined; getSessionName?(): string | undefined }
  getContextUsage(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined
  setInterval?(fn: () => void, ms: number): unknown
  ui: {
    setWidget(key: string, content: ((tui: Tui, theme: Theme) => Component) | undefined, opts?: { placement?: 'aboveEditor' | 'belowEditor' }): void
    custom<T>(factory: (tui: Tui, theme: Theme, kb: unknown, done: (r: T) => void) => Component, opts?: { overlay?: boolean }): Promise<T>
    notify(msg: string, type?: 'info' | 'warning' | 'error'): void
  }
}
export type Pi = {
  on(event: string, fn: (e: any, ctx: Ctx) => unknown): void
  registerCommand(name: string, cmd: { description?: string; handler(args: string, ctx: Ctx): unknown }): void
}

// What differs between the hosts. dir: the host's config dir under ~ ('.omp', '.pi'), the genome store goes in
// <dir>/agent/xray. closeOn: the event after which nothing more runs in the turn: omp's agent_end (unless it
// says willContinue), pi's agent_settled (pi's agent_end can still be followed by a retry or compaction).
// tokens: theme tokens to swap for this host's palette (ink.ts retoken).
export type Host = { dir: string; closeOn: 'agent_end' | 'agent_settled'; tokens?: Record<string, string> }

const KEY = 'xray'

type Live = {
  turn: Turn | null
  prev: Turn | null
  prompt: string
  calls: Map<string, Call>
  rec: SessionRec
  id: string
  mode: Mode
  memo: Memo
  isHidden: boolean
  cost: number
  msgAt: number
  firstAt: number
  tui: Tui | null
  isTicking: boolean
}


// The main session in the host's TUI only: factories rebind in subagents; unattended panes turn mods off.
const isOn = (ctx: Ctx) => ctx.hasUI && ctx.mode === 'tui' && (ctx.agent?.kind ?? 'main') === 'main' && process.env.CLAUDE_HUMAN_MODS !== 'off'

// io: the genome file (./fileio.ts hostIO); home: the person's home, for short file names in /xray.
export function xray(pi: Pi, host: Host, io: StoreIO, home: string) {
  const s: Live = { turn: null, prev: null, prompt: '', calls: new Map(), rec: emptyRec(), id: '', mode: undefined, memo: { tones: {} }, isHidden: false, cost: 0, msgAt: 0, firstAt: 0, tui: null, isTicking: false }
  const redraw = () => s.tui?.requestRender()
  const paint = (theme: Theme) => (host.tokens ? retoken(theme, host.tokens) : theme)
  const store = genome.storeOver(io)
  let timer: unknown = null

  function load(ctx: Ctx) {
    const id = ctx.sessionManager.getSessionId() ?? ''
    if (id === s.id) return
    s.id = id
    s.rec = id ? store.load(id) : emptyRec()
    s.rec.startedAt ??= Date.now()
  }
  function save(letters: string, extra: Parameters<typeof addTurn>[2]) {
    if (!s.id) return
    s.rec = addTurn(s.rec, letters, extra)
    store.save(s.id, s.rec)
  }

  // One widget for both states: the card while a turn runs, the genome between turns. /new, /resume
  // and a fork wipe every widget, so this runs again on each switch.
  function mount(ctx: Ctx) {
    if (!isOn(ctx)) return
    load(ctx)
    ctx.ui.setWidget(KEY, (tui, raw) => {
      s.tui = tui
      const theme = paint(raw)
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
    return hostView(t, s.mode, s.rec.turns, s.memo, cols, now)
  }

  // Once a second while a turn runs: elapsed times move without an event. omp's ctx timer is cleared with the
  // session; pi has none, so a plain one, cleared on session_shutdown (quit, /reload, /new, /resume, fork).
  function tick(ctx: Ctx) {
    if (s.isTicking) return
    s.isTicking = true
    const fn = () => {
      if (s.turn) redraw()
    }
    if (ctx.setInterval) ctx.setInterval(fn, 1000)
    else timer = setInterval(fn, 1000)
  }

  pi.on('session_start', (_e, ctx) => mount(ctx))
  pi.on('session_shutdown', () => {
    if (timer !== null) clearInterval(timer)
    timer = null
    s.isTicking = false
  })
  // omp only: /new, /resume and a fork keep the runtime (pi tears it down and starts it again instead).
  pi.on('session_switch', (_e, ctx) => {
    s.turn = null
    s.prev = null
    s.id = ''
    mount(ctx)
  })

  pi.on('before_agent_start', (e: { prompt?: string }) => {
    s.prompt = String(e.prompt ?? '')
  })
  // A retry (omp's willContinue) or pi's compaction starts the agent again inside the same turn: keep it.
  pi.on('agent_start', (_e, ctx) => {
    if (!isOn(ctx)) return
    load(ctx)
    if (!s.turn) {
      s.turn = newTurn(s.prompt, Date.now())
      s.calls.clear()
    }
    s.mode = 'requesting'
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
    startStep(t, e.toolCallId, c.tool, c.input, now, { say: c.say, kind: c.kind })
    if (c.tool === 'Task') spawnAgent(t, { toolUseId: e.toolCallId, label: c.say ?? 'agent', isBackground: false, startedAt: now })
    s.mode = 'tool-use'
    redraw()
  })
  pi.on('tool_execution_end', (e: { toolCallId: string; toolName: string; result: unknown; isError: boolean }) => {
    const t = s.turn
    if (!t) return
    const c = s.calls.get(e.toolCallId) ?? toCall(e.toolName, {})
    finishStep(t, e.toolCallId, c.tool, c.input, !e.isError, resultText(e.result), e.result, Date.now(), { say: c.say, kind: c.kind })
    s.calls.delete(e.toolCallId)
    if (!t.running.size) s.mode = 'requesting'
    redraw()
  })

  pi.on(host.closeOn, (e: { willContinue?: boolean }) => {
    const t = s.turn
    if (!t || e.willContinue) return
    const now = Date.now()
    endTurn(t)
    t.endedAt = now
    const letters = genome.code(t)
    save(letters, { name: nameOf(letters, countedRuns(t), filesRead(t)), files: fileTouches(t, now) })
    // No genome in the session name (omp spec d6): omp strips ESC from names, so the colours showed as raw codes.
    s.prev = t
    s.turn = null
    s.mode = undefined
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
      await ctx.ui.custom<void>((tui, raw, _kb, done) => {
        const theme = paint(raw)
        let last: string[] = []
        let at = -1
        return {
          render(width: number) {
            if (width === at) return last
            at = width
            last = framed(theme, panelLines(ctx, width - 4), width)
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
    // pi gives null tokens/percent right after a compaction: unknown, not 0%.
    const usage: Usage = { context: { tokens: c?.tokens ?? undefined, window: c?.contextWindow ?? 0, percent: c?.percent ?? undefined }, cost: { usd: s.cost }, rateLimits: [] }
    return hostPanel(s.turn ?? s.prev, s.turn, s.rec, usage, cols, now, process.cwd(), home)
  }

  // The panel in omp's own overlay chrome (omp d9; pi draws the same, its theme has no boxRound): a rounded box
  // in the accent border colour, the name in its top edge, how to close it in the bottom one. Rows are padded
  // to the width so no chat shows through.
  function framed(theme: Theme, rows: Line[], width: number): string[] {
    const box = theme.boxRound ?? { topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯', horizontal: '─', vertical: '│' }
    let edge = ''
    try {
      edge = theme.getFgAnsi('borderAccent')
    } catch {}
    const paint = (t: string) => (edge ? edge + t + '\x1b[0m' : t)
    const inner = Math.max(10, width - 4)
    const fit = Math.max(1, (process.stdout.rows ?? 40) - 4)
    const shown = rows.length > fit ? [...rows.slice(0, fit - 1), [{ t: `+${rows.length - fit + 1} rows`, dim: true }]] : rows
    const title = ink(theme, [{ t: 'xray', bold: true }])
    const hint = ink(theme, [{ t: 'any key closes', dim: true }])
    return [
      paint(box.topLeft + box.horizontal + ' ') + title + paint(' ' + box.horizontal.repeat(Math.max(1, width - 9)) + box.topRight),
      ...shown.map(l => paint(box.vertical + ' ') + ink(theme, l, inner) + ' '.repeat(Math.max(0, inner - Math.min(cells(l), inner))) + paint(' ' + box.vertical)),
      paint(box.bottomLeft + box.horizontal + ' ') + hint + paint(' ' + box.horizontal.repeat(Math.max(1, width - 19)) + box.bottomRight),
    ]
  }
}
