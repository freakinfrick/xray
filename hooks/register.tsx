import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { TONE_COLOR, band, clip as clipTo, compact, deviceGlyph, fitRows, lastTurn, nowCard, taskCard, telemetry, todoCard, type Card, type Line, type Mode } from './cards'
import { DEFAULTS, WRITER, parseRecipe, sources, writerPrompt } from './custom'
import { addEntry, isRefused, parseRating, rules, type Entry } from './ledger'
import { panel } from './panel'
import { sayStep } from './parse'
import { agentStep, carryTodos, checkSignal, endTurn, finishAgent, finishStep, isJobDue, loadTurn, newTurn, queueFromResponse, readJob, saveTurn, spawnAgent, startStep, type Turn } from './track'

const last = atom({ plugin: 'xray', key: 'last' } as const, null)
const keptTurn = atom({ plugin: 'xray', key: 'prev' } as const, null) // the last finished turn, for the panel after a reload
const COMMAND = 'xray'
const PANE = 'xray'
const NARRATE_GAP_MS = 60_000
const NARRATION_TTL_MS = 30_000
const NARROW = 60 // columns: below this the cards give way to the compact rows (round 8)
const SHORT = 30 // rows: below this (phone keyboard up) the compact rows fold to the ticker
const BODY_ROWS = 3 // card text rows; with the two borders and the telemetry line, 6 rows under the spinner
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
  isWriting: boolean // custom cards: a small model may lay out the task card
  ledger: Entry[] // the taste ledger, from the store
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
      const t = s.turn
      if (t) {
        await followJob($, t)
        checkSignal(t, await $.clock.now())
        void writeRecipe($, s, t)
      }
      $.ui.invalidate('ui.render')
      await $.clock.sleep(1000)
    }
    s.isTicking = false
  })().catch(() => {
    s.isTicking = false
  })
}

const JOB_READ_MAX = 4 * 1024 * 1024

// A background job's output file, re-read only when it grew and its gap passed; the tail is all a card shows.
async function followJob($: EngineInterface, t: Turn) {
  const job = t.job
  if (!job) return
  try {
    const st = await $.fs.stat(job.path)
    const now = await $.clock.now()
    if (st.size > JOB_READ_MAX || !isJobDue(job, st.size, now)) return
    const text = await $.fs.read(job.path)
    readJob(t, typeof text === 'string' ? text.slice(-4000) : '', st.size, now)
  } catch {
    // gone or unreadable: the card keeps what it last read
  }
}

// Once per custom card per turn: a small model lays it out from the kit. Until it answers, or if its
// recipe fails the check, the kept mockup recipe draws.
async function writeRecipe($: EngineInterface, s: Live, t: Turn) {
  const signal = t.signal
  if (!s.isWriting || !signal || t.isRecipeAsked || isOff(s)) return
  t.isRecipeAsked = true
  const prompt = writerPrompt(t, signal, await $.clock.now(), rules(s.ledger, signal))
  const r = await $.model.complete({ model: 'haiku', system: WRITER, prompt, maxTokens: 300, effort: 'low', timeoutMs: 10_000 }).catch(() => null)
  const recipe = r?.isAnswered ? parseRecipe(r.text, signal, Object.keys(sources(t, signal, await $.clock.now()))) : null
  if (recipe && t.signal === signal && !isRefused(s.ledger, signal, recipe)) {
    t.recipe = recipe
    $.ui.invalidate('ui.render')
  }
}

// One sentence from a small model, at task start and on the first failure, at most once a minute.
async function narrate($: EngineInterface, s: Live) {
  const t = s.turn
  if (!s.isNarrating || isOff(s) || !t) return
  const now = await $.clock.now()
  if (now - s.narratedAt < NARRATE_GAP_MS) return
  const before = s.narratedAt
  s.narratedAt = now // claims the slot now so a second trigger can't race this call
  const steps = t.done.slice(-8).map(x => `- ${x.say}${x.ok === false ? ' (failed)' : ''}`)
  const live = [...t.running.values()].map(x => x.say)
  const prompt = `Task from the user: ${t.prompt.replace(/\s+/g, ' ').slice(0, 400)}\nSteps so far:\n${steps.join('\n') || '- none yet'}\nRunning now: ${live.join(', ') || 'thinking'}`
  const r = await $.model.complete({ model: 'haiku', system: NARRATOR, prompt, maxTokens: 60, effort: 'low', timeoutMs: 8000 }).catch(() => null)
  if (r?.isAnswered && s.turn === t) {
    s.narration = r.text.replace(/\s+/g, ' ').replace(/^["'»\s]+|["'\s]+$/g, '').slice(0, 120)
    $.ui.invalidate('ui.render')
  } else if (s.narratedAt === now) s.narratedAt = before // no sentence came back: the next trigger may try again
}

// The device mod (~/claude/mods/device) is optional, so it is not a declared dependency: one
// would stop xray loading wherever it is absent. Its noun is typed here and, when absent, the call
// throws and the strip draws without a glyph.
type DeviceNoun = { device: { class: () => Promise<string> } }

async function deviceClass($: EngineInterface): Promise<string | undefined> {
  try {
    return await ($ as unknown as DeviceNoun).device.class()
  } catch {
    return undefined
  }
}

export const register: Register = (on, options) => {
  const s: Live = { isNarrating: (options as Record<string, unknown>).narration !== 'off', isWriting: (options as Record<string, unknown>).customCards !== 'off', ledger: [], isEnvOff: false, isHidden: false, turn: null, prev: null, mode: undefined, narration: null, narratedAt: -Infinity, ctx: null, isTicking: false }

  on('session.start', async ($, e, next) => {
    s.isEnvOff = (await $.env.get('CLAUDE_HUMAN_MODS')) === 'off'
    if (s.isEnvOff) return next(e)
    s.isHidden = (await $.store.get('isHidden')) === true
    const saved = s.prev ? null : await read($, keptTurn)
    if (saved) s.prev = loadTurn(saved)
    const kept = await $.store.get('ledger')
    s.ledger = Array.isArray(kept) ? (kept as Entry[]) : []
    await $.command.register({ name: COMMAND, description: 'Open or close the xray detail panel; on|off shows or hides the cards; rate good|bad rates the custom card', argumentHint: '[on|off|rate good|bad <note>]', immediate: true })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const rating = parseRating(e.args)
    if (rating) {
      // Rates the custom card on screen (or the last turn's); with none, the note is about the cards at large.
      const t = s.turn?.signal ? s.turn : s.prev?.signal ? s.prev : null
      const signal = t?.signal
      const entry: Entry = { at: new Date(await $.clock.now()).toISOString(), ...rating, ...(t && signal ? { signal, recipe: t.recipe ?? DEFAULTS[signal] } : {}) }
      s.ledger = addEntry(s.ledger, entry)
      await $.store.set('ledger', s.ledger)

      return { text: `${signal ? `the ${signal} card` : 'the cards'} rated ${rating.verdict}. ${s.ledger.length} in the taste ledger.` }
    }
    if (arg === 'on' || arg === 'off') {
      s.isHidden = arg === 'off'
      await $.store.set('isHidden', s.isHidden)
      $.ui.invalidate('ui.render')

      return { text: s.isHidden ? 'cards off. /xray on brings them back.' : 'cards on.' }
    }
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })

      return { text: 'panel closed.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'xray', closeOnEscape: true, rows: 32 })

    return { text: opened.isPlaced ? 'panel open. /xray or Esc closes it.' : 'panel waits for a wider terminal.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    // Only worth asking for when the session has a to-do tool to keep the list with.
    if (isOff(s) || !e.tools.some(x => x === 'TodoWrite' || x === 'TaskCreate')) return r

    return { sections: [...r.sections, { id: 'xray-todos', text: TODO_NUDGE, scope: 'session' }] }
  })

  on('prompt.submit', async ($, e, next) => {
    // Only a person's own prompt starts a turn; task notifications and scheduled triggers join the running one.
    if (isOff(s) || (e.origin.kind !== 'composer' && s.turn)) return next(e)
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

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const t = s.turn
    if (t && !isOff(s) && !e.parentAgentId && r.deny === undefined) {
      spawnAgent(t, { toolUseId: e.tool_use_id, agentId: r.agentId, label: e.name || e.description || e.subagentType, isBackground: e.background, startedAt: await $.clock.now() })
      $.ui.invalidate('ui.render')
    }

    return r
  })

  on('tool.call', async ($, e, next) => {
    const t = s.turn
    if (t && !isOff(s) && e.agentId) {
      agentStep(t, e.agentId, sayStep(e.tool, e as unknown as Record<string, unknown>))
      $.ui.invalidate('ui.render')
    }
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

  // Watches each model request pass, for the telemetry line. Every chunk goes on unchanged.
  on('turn.step', async function* ($, e, next) {
    const t = s.turn
    if (!t || isOff(s) || e.agentId) return yield* next(e)
    t.effort = e.effort
    const startedAt = await $.clock.now()
    let firstAt = 0
    const stream = next(e)
    for await (const c of stream) {
      if (!firstAt && c.kind !== 'engine') firstAt = await $.clock.now()
      yield c
    }
    const r = await stream.result
    const u = r.usage
    if (u) t.requests.push({ startedAt, firstAt: firstAt || startedAt, endedAt: await $.clock.now(), output: u.output_tokens, input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens })

    return r
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ending is that agent coming back; a background one may land after the main turn.
    const owner = s.turn ?? s.prev
    if (owner && !isOff(s) && e.agentId) {
      finishAgent(owner, { agentId: e.agentId }, true, await $.clock.now())
      $.ui.invalidate('ui.render')
    }
    if (s.turn && !isOff(s) && !e.agentId) {
      const t = s.turn
      const now = await $.clock.now()
      endTurn(t)
      await update($, last, () => lastTurn(t, now))
      s.prev = t
      s.turn = null
      await update($, keptTurn, () => saveTurn(t))
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
    // Under 60 columns, rounds 8–11: one framed card; with few rows (phone keyboard up) its body folds to one row.
    if ((e.viewport?.columns ?? 100) < NARROW) {
      const w = Math.max(24, (e.viewport?.columns ?? 47) - 3) // never fill the last column
      const k = compact(s.turn, s.mode, said, s.ctx, now, w, (e.viewport?.rows ?? Infinity) < SHORT)
      const color = TONE_COLOR[k.tone]
      const dim = k.tone === 'quiet'
      const ink = (l: Line, key: string) => l.map((g, i) => (
        <Text key={`${key}${i}`} color={g.color} backgroundColor={g.bg} dimColor={g.dim} bold={g.bold} inverse={g.inv}>
          {g.t}
        </Text>
      ))
      const cellsOf = (l: Line) => l.reduce((a, g) => a + g.t.length, 0)
      // An edge carrying a line: ╭─ text ───╮, or bare when the line is empty.
      const edge = (l: Line, left: string, right: string, key: string) => (
        <Text key={key} wrap="truncate-end">
          <Text color={color} dimColor={dim}>{l.length ? `${left}─ ` : left + '─'}</Text>
          {ink(l, key)}
          <Text color={color} dimColor={dim}>{(l.length ? ' ' : '') + '─'.repeat(Math.max(1, w - (l.length ? 5 + cellsOf(l) : 3))) + right}</Text>
        </Text>
      )
      // The status as a band: the tone color behind dark text (round 11). It starts right after the
      // corner, so its text sits in column 2 like the body's; its overflow is a band row under it.
      // An explicit background, not inverse: Termius drew inverse + magenta as black on green (capture 7).
      const hi = (t: string, key: string) => (
        <Text key={key} backgroundColor={color ?? 'gray'} color="black">
          {` ${t} `}
        </Text>
      )
      const pulseCells = k.pulse ? 1 + k.pulse.t.length : 0
      return (
        <Box flexDirection="column">
          {line}
          <Text key="kt" wrap="truncate-end">
            <Text color={color} dimColor={dim}>{'╭'}</Text>
            {hi(k.status, 'kts')}
            {k.pulse ? <Text color={k.pulse.color}>{` ${k.pulse.t}`}</Text> : null}
            <Text color={color} dimColor={dim}>{' ' + '─'.repeat(Math.max(1, w - 5 - k.status.length - pulseCells)) + '╮'}</Text>
          </Text>
          {k.more ? (
            <Text key="km" wrap="truncate-end">
              <Text color={color} dimColor={dim}>{'│'}</Text>
              {hi(k.more, 'kms')}
              <Text color={color} dimColor={dim}>{' '.repeat(Math.max(0, w - 4 - k.more.length)) + '│'}</Text>
            </Text>
          ) : null}
          {k.body.map((l, r) => (
            <Text key={`kb${r}`} wrap="truncate-end">
              <Text color={color} dimColor={dim}>{'│ '}</Text>
              {ink(l, `kb${r}`)}
              <Text color={color} dimColor={dim}>{' '.repeat(Math.max(0, w - 4 - cellsOf(l))) + ' │'}</Text>
            </Text>
          ))}
          {edge(k.bottom, '╰', '╯', 'kz')}
        </Box>
      )
    }
    const cols = Math.max(40, (e.viewport?.columns ?? 100) - 2)
    const cards = cols >= 72 ? [nowCard(s.turn, s.mode, said, now), todoCard(s.turn, s.ctx), taskCard(s.turn, now)] : [nowCard(s.turn, s.mode, said, now), taskCard(s.turn, now)]
    const widths = cards.length === 3 ? [Math.floor(cols * 0.38), Math.floor(cols * 0.3)] : [Math.floor(cols * 0.55)]
    widths.push(cols - widths.reduce((a, b) => a + b, 0))

    const segs = (l: Line, k: string) => l.map((s, i) => (
      <Text key={`${k}${i}`} color={s.color} backgroundColor={s.bg} dimColor={s.dim} bold={s.bold} inverse={s.inv}>
        {s.t}
      </Text>
    ))
    // Round 13, the phone card's look on the wide cards: the now card's head is its top edge's band, so
    // its body is the narration alone; one telemetry edge closes all the cards.
    const top = band(cards[0]?.lines[0] ?? [], s.turn.running.size > 0)
    const tele = telemetry(s.turn, s.ctx, now)
    const lines = (c: Card, i: number) => (i ? c.lines : c.lines.slice(1))
    const body = cards.map((c, i) => fitRows(lines(c, i), Math.max(1, (widths[i] ?? 20) - 4), BODY_ROWS, c.spare))
    const row = (r: number) => (
      <Box key={`r${r}`} flexDirection="row">
        {cards.map((c, i) => {
          const w = widths[i] ?? 20
          const color = TONE_COLOR[c.tone]
          const dim = c.tone === 'quiet'
          if (r === 0 && i === 0) {
            const pulse = top.pulse ? ` ${top.pulse.t}` : ''
            const status = clipTo(top.status, Math.max(1, w - 6 - pulse.length))
            return (
              <Text key={`c${i}`} wrap="truncate-end">
                <Text color={color} dimColor={dim}>{'╭'}</Text>
                <Text backgroundColor={color ?? 'gray'} color="black">{` ${status} `}</Text>
                {top.pulse ? <Text color={top.pulse.color}>{pulse}</Text> : null}
                <Text color={color} dimColor={dim}>{' ' + '─'.repeat(Math.max(1, w - 5 - status.length - pulse.length)) + '╮'}</Text>
              </Text>
            )
          }
          if (r === 0) {
            const head = `╭─ ${c.title} `
            const note = c.note ? c.note.map(x => x.t).join('') : ''
            const fill = Math.max(0, w - head.length - (note ? note.length + 2 : 0) - 2)
            return (
              <Text key={`c${i}`} wrap="truncate-end">
                <Text color={color} dimColor={dim}>{head + '─'.repeat(fill)}</Text>
                {c.note ? <Text>{[<Text key="a"> </Text>, ...segs(c.note, `n${i}`), <Text key="z"> </Text>]}</Text> : null}
                <Text color={color} dimColor={dim}>{'─╮'}</Text>
              </Text>
            )
          }
          return (
            <Box key={`c${i}`} flexDirection="row" width={w}>
              <Text color={color} dimColor={dim}>{'│ '}</Text>
              <Box width={Math.max(1, w - 4)}>
                <Text wrap="truncate-end">{segs(body[i]?.[r - 1] ?? [], `s${i}${r}`)}</Text>
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
        {Array.from({ length: BODY_ROWS + 1 }, (_, r) => row(r))}
        <Text wrap="truncate-end">
          <Text dimColor>{'╰─ '}</Text>
          {segs(tele, 'tm')}
          <Text dimColor>{' ' + '─'.repeat(Math.max(1, cols - 5 - tele.reduce((a, g) => a + g.t.length, 0))) + '╯'}</Text>
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const usage = await $.session.usage().catch(() => null)
    // Text columns inside the paddingX={1} below; rows as the surface measured them.
    const cols = e.props.bodyColumns !== undefined ? e.props.bodyColumns - 2 : undefined
    const sections = panel(s.turn ?? s.prev, usage, await $.clock.now(), s.ledger, { cols, rows: e.viewport?.rows })

    return (
      <Box flexDirection="column" paddingX={1}>
        {sections.map((sec, i) => (
          <Box key={`p${i}`} flexDirection="column" marginTop={i ? 1 : 0}>
            <Text bold>{sec.title}</Text>
            {sec.rows.map((l, r) => (
              <Text key={`p${i}r${r}`} wrap="truncate-end">
                {l.map((g, k) => (
                  <Text key={`g${k}`} color={g.color} backgroundColor={g.bg} dimColor={g.dim} bold={g.bold} inverse={g.inv}>
                    {g.t}
                  </Text>
                ))}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (isOff(s) || s.turn) return next(e)
    const l = await read($, last)
    if (!l) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const color = l.tone === 'ok' ? 'green' : l.tone === 'fail' ? 'red' : undefined
    // How the turn ended on a tile in its tone; each owed to-do on a tile in its own hue.
    const owed = (l.owed ?? []).map(x => (typeof x === 'string' ? { t: x } : x))
    // The device mod is optional: absent, the strip draws as it did.
    const cls = await deviceClass($)
    const glyph = deviceGlyph(cls)
    // On a phone (47 cols) the tail was cut mid-word; the strip stops at the headline there.
    const hasTail = cls !== 'mobile'

    return (
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          {glyph ? <Text>{`${glyph} `}</Text> : null}
          <Text dimColor>last turn </Text>
          <Text color={color} dimColor={!color} inverse>{` ${l.title ?? 'turn'} `}</Text>
          <Text color={color}>{` ${l.headline}`}</Text>
          {hasTail ? <Text dimColor>{'   still owed '}</Text> : null}
          {!hasTail ? null : owed.length ? (
            owed.map((x, i) => (
              <Text key={`o${i}`}>
                {i ? ' ' : ''}
                <Text color={x.color ?? 'cyan'} inverse>{` ${x.t} `}</Text>
              </Text>
            ))
          ) : (
            <Text color="green">nothing ✓</Text>
          )}
        </Text>
      </Box>
    )
  })
}
