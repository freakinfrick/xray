import { test, expect } from 'claude-code/testing'
import { xray, type Pi } from './xray'

// The runner has no node globals; the adapter reads env, cwd and the terminal's rows from process.
;(globalThis as { process?: unknown }).process ??= { env: {}, cwd: () => '/w', stdout: {} }

// The pi-family adapter end to end: a fake host fires one turn's events, the genome store and the widget show it.
function host() {
  const on: Record<string, (e: any, ctx: any) => unknown> = {}
  let widget: ((tui: unknown, theme: unknown) => { render(w: number): readonly string[] }) | undefined
  const ctx = {
    hasUI: true,
    mode: 'tui',
    sessionManager: { getSessionId: () => 'sid-1' },
    getContextUsage: () => undefined,
    setInterval: () => null,
    ui: { setWidget: (_k: string, f: typeof widget) => (widget = f), custom: async () => undefined, notify: () => undefined },
  }
  const pi: Pi = { on: (name, fn) => (on[name] = fn), registerCommand: () => undefined }
  const fire = (name: string, e: unknown = {}) => on[name]?.(e, ctx)
  const draw = (w: number) => (widget?.({ requestRender: () => undefined }, { getFgAnsi: () => '', getColorHex: () => '#ffffff' }).render(w) ?? []).map(l => l.replace(/\x1b\[[\d;]*m/g, ''))
  return { pi, fire, draw }
}

test('one omp turn: steps, a request, an agent; the store keeps the genome, name and files', () => {
  let disk: Record<string, unknown> = {}
  const h = host()
  xray(h.pi, { dir: '.omp', closeOn: 'agent_end' }, { read: () => structuredClone(disk), write: all => (disk = structuredClone(all)) }, '/home/u')
  h.fire('session_start')
  h.fire('tool_execution_start', { toolCallId: 'stray', toolName: 'read', args: { path: 'x.ts' } }) // no turn yet: ignored
  h.fire('before_agent_start', { prompt: 'fix the tests' })
  h.fire('agent_start')
  h.fire('message_start', { message: { role: 'assistant' } })
  h.fire('message_update')
  h.fire('message_end', { message: { role: 'assistant', usage: { input: 10, output: 5, cacheRead: 90, cost: { total: 0.01 } } } })
  for (const [id, toolName, args, result] of [
    ['1', 'read', { path: 'src/a.ts' }, { content: [{ type: 'text', text: 'code' }] }],
    ['2', 'edit', { path: 'src/a.ts' }, 'ok'],
    ['3', 'bash', { command: 'bun test' }, { content: [{ type: 'text', text: '3 pass\n0 fail' }] }],
  ] as const) {
    h.fire('tool_execution_start', { toolCallId: id, toolName, args })
    h.fire('tool_execution_end', { toolCallId: id, toolName, result, isError: false })
  }
  h.fire('tool_execution_start', { toolCallId: '4', toolName: 'task', args: {} })
  const live = h.draw(100).join('\n')
  expect(live).toMatch(/agent/)
  h.fire('tool_execution_end', { toolCallId: '4', toolName: 'task', result: 'done', isError: false })
  h.fire('agent_end', { willContinue: true }) // a retry follows: the turn stays open
  h.fire('agent_end', {})
  const rec = disk['genome:sid-1'] as { turns: string[]; names: string[]; files: { f: string }[] }
  expect(rec.turns).toEqual(['reta'])
  expect(rec.names[0]).toBeTruthy()
  expect(rec.files.map(x => x.f)).toContain('src/a.ts')
  expect(h.draw(100).join('')).toMatch(/\{▌+/) // between turns: the genome, a delegated turn in braces
})
