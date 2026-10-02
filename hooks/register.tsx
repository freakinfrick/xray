import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { TONE_COLOR, lastTurn, leftCard, nowCard, taskCard, type Card, type Line, type Mode } from './cards'
import { carryTodos, finishStep, newTurn, queueFromResponse, startStep, type Turn } from './track'

const last = atom({ plugin: 'xray', key: 'last' } as const, null)
const COMMAND = 'xray'
const NARRATE_GAP_MS = 60_000
const NARRATION_TTL_MS = 30_000
const TODO_NUDGE =
  'The user watches a live view of your to-do list. On any task with 3 or more steps, keep a to-do list current ' +
  '(TodoWrite, or TaskCreate/TaskUpdate): add the steps when you plan them and mark each one done as you finish it.'
const NARRATOR =
  "You narrate a coding agent's work for the person watching it. Reply with one plain sentence of at most 12 words " +
  'saying what the agent is doing right now and why. Be concrete. Never invent results. No preamble, no quotes.'

type Live = {
  isNarrating: boolean
  isEnvOff: boolean // conductor collaborators and arbiters: CLAUDE_HUMAN_MODS=off
  isHidden: boolean // /xray off
  turn: Turn | null
  prev: Turn | null
  mode: Mode
  narration: string | null
  narratedAt: number
  ctx: number | null
  isTicking: boolean
}
const isOff = (s: Live) => s.isEnvOff || s.isHidden

// Once a second while a turn runs: fresh context figure and elapsed times.
function tick($: EngineInterface, s: Live) {
  if (s.isTicking) return
  s.isTicking = true
  void (async () => {
    while (s.turn && !isOff(s)) {
      try {
        s.ctx = (await $.session.usage()).context.percent ?? null
      } catch {
        s.ctx = null
      }
      $.ui.invalidate('ui.render')
      await $.clock.sleep(1000)
    }
    s.isTicking = false
  })().catch(() => {
    s.isTicking = false
  })
}

// One sentence from a small model, at task start and on the first failure, at most once a minute.
async function narrate($: EngineInterface, s: Live) {
  const t = s.turn
  if (!s.isNarrating || isOff(s) || !t) return
  const now = await $.clock.now()
  if (now - s.narratedAt < NARRATE_GAP_MS) return
  s.narratedAt = now
  const steps = t.done.slice(-8).map(x => `- ${x.say}${x.ok === false ? ' (failed)' : ''}`)
  const live = [...t.running.values()].map(x => x.say)
  const prompt = `Task from the user: ${t.prompt.replace(/\s+/g, ' ').slice(0, 400)}\nSteps so far:\n${steps.join('\n') || '- none yet'}\nRunning now: ${live.join(', ') || 'thinking'}`
  const r = await $.model.complete({ model: 'haiku', system: NARRATOR, prompt, maxTokens: 60, effort: 'low', timeoutMs: 8000 }).catch(() => null)
  if (r?.isAnswered && s.turn === t) {
    s.narration = r.text.replace(/\s+/g, ' ').replace(/^["'»\s]+|["'\s]+$/g, '').slice(0, 120)
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = (on, options) => {
  const s: Live = { isNarrating: (options as Record<string, unknown>).narration !== 'off', isEnvOff: false, isHidden: false, turn: null, prev: null, mode: undefined, narration: null, narratedAt: -Infinity, ctx: null, isTicking: false }

  on('session.start', async ($, e, next) => {
    s.isEnvOff = (await $.env.get('CLAUDE_HUMAN_MODS')) === 'off'
    if (s.isEnvOff) return next(e)
    s.isHidden = (await $.store.get('isHidden')) === true
    await $.command.register({ name: COMMAND, description: 'Show or hide the xray-spinner cards', argumentHint: '[on|off]', immediate: true })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    s.isHidden = arg === 'off' ? true : arg === 'on' ? false : !s.isHidden
    await $.store.set('isHidden', s.isHidden)
    $.ui.invalidate('ui.render')

    return { text: s.isHidden ? 'xray-spinner off. /xray to bring it back.' : 'xray-spinner on.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (isOff(s)) return r

    return { sections: [...r.sections, { id: 'xray-todos', text: TODO_NUDGE, scope: 'session' }] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (isOff(s)) return next(e)
    s.prev = s.turn ?? s.prev
    s.turn = newTurn(e.text, await $.clock.now())
    carryTodos(s.prev, s.turn)
    s.narration = null
    s.mode = undefined
    await update($, last, () => null)
    tick($, s)
    void narrate($, s)

    return next(e)
  })

  on('session.append', ($, e, next) => {
    if (s.turn && !isOff(s) && !e.agentId && e.door === 'response' && e.message.type === 'assistant') {
      queueFromResponse(s.turn, e.message.content)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const t = s.turn
    if (!t || isOff(s) || e.agentId) return next(e)
    const input = e as unknown as Record<string, unknown>
    const id = e.tool_use_id ?? `local-${t.done.length + t.running.size}`
    startStep(t, id, e.tool, input, await $.clock.now())
    $.ui.invalidate('ui.render')
    let ran: Awaited<ReturnType<typeof next>> | undefined
    try {
      ran = await next(e)
    } finally {
      const ok = ran !== undefined && ran.deny === undefined && !ran.isError
      const failedBefore = t.failures
      finishStep(t, id, e.tool, input, ok, ran?.text ?? '', ran?.result, await $.clock.now())
      if (failedBefore === 0 && t.failures > 0) void narrate($, s)
      $.ui.invalidate('ui.render')
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (s.turn && !isOff(s) && !e.agentId) {
      const t = s.turn
      await update($, last, () => lastTurn(t, Date.now()))
      s.prev = t
      s.turn = null
    }

    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || isOff(s) || !s.turn) return next(e)
    s.mode = e.props.mode
    const line = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    // A narration line is news for 30 s; after that the last finished step says more.
    const said = now - s.narratedAt < NARRATION_TTL_MS ? s.narration : null
    const cols = Math.max(40, (e.viewport?.columns ?? 100) - 2)
    const cards = cols >= 72 ? [nowCard(s.turn, s.mode, said, now), leftCard(s.turn, s.ctx), taskCard(s.turn, now)] : [nowCard(s.turn, s.mode, said, now), taskCard(s.turn, now)]
    const widths = cards.length === 3 ? [Math.floor(cols * 0.38), Math.floor(cols * 0.3)] : [Math.floor(cols * 0.55)]
    widths.push(cols - widths.reduce((a, b) => a + b, 0))

    const segs = (l: Line, k: string) => l.map((s, i) => (
      <Text key={`${k}${i}`} color={s.color} dimColor={s.dim} bold={s.bold}>
        {s.t}
      </Text>
    ))
    const row = (r: number) => (
      <Box key={`r${r}`} flexDirection="row">
        {cards.map((c, i) => {
          const w = widths[i] ?? 20
          const color = TONE_COLOR[c.tone]
          const dim = c.tone === 'quiet'
          if (r === 0) {
            const head = `╭─ ${c.title} `
            const note = c.note ? ` ${c.note} ` : ''
            const fill = Math.max(0, w - head.length - note.length - 2)
            return (
              <Text key={`c${i}`} wrap="truncate-end">
                <Text color={color} dimColor={dim}>{head + '─'.repeat(fill)}</Text>
                {note ? <Text color="yellow">{note}</Text> : null}
                <Text color={color} dimColor={dim}>{'─╮'}</Text>
              </Text>
            )
          }
          if (r === 3)
            return (
              <Text key={`c${i}`} color={color} dimColor={dim}>
                {'╰' + '─'.repeat(Math.max(0, w - 2)) + '╯'}
              </Text>
            )
          return (
            <Box key={`c${i}`} flexDirection="row" width={w}>
              <Text color={color} dimColor={dim}>{'│ '}</Text>
              <Box width={Math.max(1, w - 4)}>
                <Text wrap="truncate-end">{segs(c.lines[r - 1] ?? [], `s${i}${r}`)}</Text>
              </Box>
              <Text color={color} dimColor={dim}>{' │'}</Text>
            </Box>
          )
        })}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {line}
        {[0, 1, 2, 3].map(row)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (isOff(s) || s.turn) return next(e)
    const l = await read($, last)
    if (!l) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const color = l.tone === 'ok' ? 'green' : l.tone === 'fail' ? 'red' : undefined

    return (
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          <Text dimColor>last turn </Text>
          <Text color={color}>{l.headline}</Text>
          <Text dimColor>{'   still owed '}</Text>
          {l.owed.length ? <Text color="cyan">{l.owed.join(' · ')}</Text> : <Text color="green">nothing ✓</Text>}
        </Text>
      </Box>
    )
  })
}
