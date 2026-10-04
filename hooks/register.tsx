import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { TONE_COLOR, compact, deviceGlyph, lastTurn, where, type Line, type Mode } from './cards'
import { bar } from './glyphs'
import { cacheLeft, cacheStrip, emptyCache, isToastDue, nextChange, noteRequest, toastText, transcriptPath, ttlFromTail, type Cache } from './cache'
import { TALL, spinnerRows, type Memo } from './layout'
import { DEFAULTS, WRITER, parseRecipe, sources, writerPrompt } from './custom'
import { addEntry, isRefused, parseRating, rules, type Entry } from './ledger'
import { panel } from './panel'
import { checkVoice, narrationOf, sayStep, testHead } from './parse'
import { clean, recall, record, storeKey, type Event } from './memory'
import * as genome from './genome'
import { nameOf } from './names'
import { addTurn, emptyRec, fileTouches, shortName, loadRec, type SessionRec } from './session'
import { MARK_GLYPH, MOMENT_BG, celebrations, recordRows, records, type Records, landmarkMoment, landmarks, markLook, milestones, noteRuns, pick, span, tile, type Day, type Moment } from './moments'
import { agentStep, carryTodos, checkSignal, endTurn, finishAgent, finishStep, countedRuns, filesRead, isJobDue, loadTurn, newTurn, queueFromResponse, readJob, saveTurn, spawnAgent, startStep, type Turn } from './track'

const last = atom({ plugin: 'xray', key: 'last' } as const, null)
const keptTurn = atom({ plugin: 'xray', key: 'prev' } as const, null) // the last finished turn, for the panel after a reload
const keptCache = atom({ plugin: 'xray', key: 'cache' } as const, null) // round 18: the cache countdown outlives a reload
const COMMAND = 'xray'
const PANE = 'xray'
const NARRATE_GAP_MS = 60_000
const BURST_MS = 500 // one burst per event: a step landing, a to-do done, a tone changing
const BURST_FRAME_MS = 160
const NARRATION_TTL_MS = 30_000
const NARROW = 60 // columns: below this the cards give way to the compact rows (round 8)
const SHORT = 30 // rows: below this (phone keyboard up) the compact rows fold to the ticker
const BODY_ROWS = 3 // card text rows between the top edges and the tray; one more on a tall terminal (round 16)
const TODO_NUDGE =
  'The user watches a live view of your to-do list. On any task with 3 or more steps, keep a to-do list current ' +
  '(TodoWrite, or TaskCreate/TaskUpdate): add the steps when you plan them and mark each one done as you finish it.'
// Round 16, direction 4: one voice. checkVoice drops any line that strays from the facts it was given.
const NARRATOR =
  'You narrate a coding session for the person watching it, in the voice of a dry flight engineer. Reply with one ' +
  'sentence of at most 14 words, present tense: what is happening now and the one thing that matters next. Never ' +
  'say "the agent" or "Claude"; leave the subject out ("Taking sum first."). Use only the facts given: every number ' +
  'and name you write must appear in them. When the history line bears on what is happening, you may point back to ' +
  'it once ("broke here Oct 1 too"). No preamble, no quotes. Never write about yourself, the facts or the reader; ' +
  'if the facts are too thin to say something about the work, reply with exactly: -'

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
  cwd: string
  home: string
  health: string[] // what the status line's PT / ADHD-CM dots checked, named only when missing (round 17)
  history: Event[] // this project's finished test runs, from the store (round 16 memory)
  isBursting: boolean // round 16 transitions: a short ~6 fps redraw after an event is under way
  isMobile: boolean // a phone keeps the 1 Hz tick: no bursts over SSH
  memo: Memo // each card's last tone, for the one-time fade
  cache: Cache // round 18: the prompt cache's countdown
  isCacheOff: boolean // /xray cache off: no countdown, toast or table
  idleGen: number // the between-turns clock running now; a newer one retires it
  records?: Records // round 20c: this folder's bests (records:<cwd>), for the panel
  rec: SessionRec // round 19-20: this session's turns as step letters, names, marks, files (session.ts)
  genomeId: string // the session those belong to; /resume or /clear swaps it
}
const isOff = (s: Live) => s.isEnvOff || s.isHidden

// Round 19: the session genome lives in the store per session id; read again whenever the id changes.
// Round 20: the stored value is the whole session record (a round-19 list still reads, as its turns).
async function loadGenome($: EngineInterface, s: Live) {
  const id = await $.session.id().catch(() => '')
  if (!id || id === s.genomeId) return
  s.genomeId = id
  s.rec = loadRec(await $.store.get(genome.keyOf(id)))
  s.rec.startedAt ??= await $.clock.now()
}
async function saveGenome($: EngineInterface, s: Live, letters: string, extra: Parameters<typeof addTurn>[2] = {}) {
  await loadGenome($, s)
  if (!s.genomeId) return
  s.rec = addTurn(s.rec, letters, extra)
  await $.store.set(genome.keyOf(s.genomeId), s.rec)
  for (const k of genome.stale(await $.store.keys(), genome.keyOf(s.genomeId))) await $.store.delete(k)
}

// Round 20f: a finished turn's milestones, with the folder's step count and its day of test runs kept
// in the store (counted from the day this shipped; nothing is backfilled).
type Count = { n: number; since: number }
async function turnMoments($: EngineInterface, s: Live, t: Turn, letters: string, now: number): Promise<Moment[]> {
  const sessionBefore = s.rec.turns.reduce((a, x) => a + x.length, 0)
  const keyN = `steps:${s.cwd}`
  const kept = (await $.store.get(keyN)) as Count | undefined
  const count: Count = typeof kept?.n === 'number' ? kept : { n: 0, since: now }
  if (s.cwd) await $.store.set(keyN, { ...count, n: count.n + letters.length })
  const keyD = `day:${s.cwd}`
  const runs = countedRuns(t)
  const day = noteRuns((await $.store.get(keyD)) as Day | undefined, runs, now)
  if (s.cwd && runs.length) await $.store.set(keyD, day.day)
  return milestones({
    steps: letters.length,
    sessionBefore,
    folderBefore: count.n,
    folderSince: count.since,
    turnMs: now - t.startedAt,
    awayMs: t.awayMs,
    isAwayCold: t.isAwayCold,
    prevEndedAt: s.prev?.endedAt,
    sessionStartedAt: s.rec.startedAt,
    isFirstGreenToday: day.isFirstGreen,
    redsToday: day.reds,
    now,
  })
}

// Round 18: between turns, the cache countdown's own clock. It wakes only when the strip's text changes
// (each minute, each second in the last five) or the toast is due, and stops once the cache lapses.
// Each start retires the one before (idleGen), so a sleeping old loop never draws stale minutes.
async function idle($: EngineInterface, s: Live) {
  const gen = ++s.idleGen
  if (s.isCacheOff || isOff(s)) return
  try {
    if (!s.turn && s.cache.anchor >= 0) {
      // The transcript line lands just after turn.complete (live check: a read at once found the first
      // turn missing), so wait a beat, and retry a few times while nothing is known.
      for (let i = 0; i < TTL_TRIES && gen === s.idleGen && !s.turn; i++) {
        await $.clock.sleep(TTL_WAIT_MS)
        const ttl = await readTtl($, s)
        if (ttl) {
          s.cache = { ...s.cache, ttl }
          break
        }
      }
      await update($, keptCache, () => s.cache)
    }
    while (gen === s.idleGen && !s.turn && !s.isCacheOff && !isOff(s)) {
      const now = await $.clock.now()
      if (isToastDue(s.cache, now)) {
        s.cache = { ...s.cache, toastedAt: s.cache.anchor }
        $.ui.toast(toastText(s.cache, now), { timeoutMs: 15_000 })
        await update($, keptCache, () => s.cache)
      }
      $.ui.invalidate('ui.render')
      const wait = nextChange(s.cache, now)
      if (wait === null) return
      await $.clock.sleep(wait + 50)
    }
  } catch {
    // the strip keeps its last figure
  }
}

const TAIL_BYTES = '262144'
const TTL_TRIES = 4
const TTL_WAIT_MS = 1000

// The lifetime of the newest write, from the end of this session's transcript (it can run to tens of MB).
async function readTtl($: EngineInterface, s: Live): Promise<Cache['ttl']> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${s.home}/.claude`
  const ran = await $.process.run(['tail', '-c', TAIL_BYTES, transcriptPath(dir, s.cwd, await $.session.id())]).catch(() => null)
  return ran && ran.exitCode === 0 ? ttlFromTail(ran.stdout) : null
}

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
  const run = t.runs.filter(x => !x.running).pop()
  const tests = run ? `\nLatest test run: ${run.total ? `${run.pass} of ${run.total} pass, ${run.fail} failing` : run.ok ? 'passed' : 'failed'}${run.failing.length ? `, failing: ${run.failing.slice(0, 3).join(', ')}` : ''}` : ''
  const past = recall(s.history, t)
  const history = past.length ? `\nHistory in this project: ${past.join('; ')}` : ''
  const prompt = `Task from the user: ${t.prompt.replace(/\s+/g, ' ').slice(0, 400)}\nSteps so far:\n${steps.join('\n') || '- none yet'}\nRunning now: ${live.join(', ') || 'thinking'}${tests}${history}`
  const r = await $.model.complete({ model: 'haiku', system: NARRATOR, prompt, maxTokens: 60, effort: 'low', timeoutMs: 8000 }).catch(() => null)
  const said = r?.isAnswered ? narrationOf(r.text) : ''
  const isBlank = !!r?.isAnswered && !said // "-": nothing to say, and that holds the slot
  if (said && s.turn === t && checkVoice(said, prompt)) {
    s.narration = said
    $.ui.invalidate('ui.render')
  } else if (s.narratedAt === now && !isBlank) s.narratedAt = before // no sentence came back: the next trigger may try again
}

// One-time transitions (round 16, direction 3): a few quick redraws right after an event so a landing
// cell or a flash plays out, then back to the 1 Hz tick. Its own loop, not the tick's: the tick may be
// mid-sleep. A phone keeps 1 Hz.
async function burst($: EngineInterface, s: Live) {
  if (s.isMobile || s.isBursting || isOff(s)) return
  s.isBursting = true
  try {
    for (let i = 0; i < Math.ceil(BURST_MS / BURST_FRAME_MS); i++) {
      await $.clock.sleep(BURST_FRAME_MS)
      $.ui.invalidate('ui.render')
    }
  } finally {
    s.isBursting = false
  }
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
  const s: Live = { isNarrating: (options as Record<string, unknown>).narration !== 'off', isWriting: (options as Record<string, unknown>).customCards !== 'off', ledger: [], isEnvOff: false, isHidden: false, turn: null, prev: null, mode: undefined, narration: null, narratedAt: -Infinity, ctx: null, isTicking: false, cwd: '', home: '', health: [], history: [], isBursting: false, isMobile: false, memo: { tones: {} }, cache: emptyCache(), isCacheOff: false, idleGen: 0, rec: emptyRec(), genomeId: '' }

  on('session.start', async ($, e, next) => {
    s.isEnvOff = (await $.env.get('CLAUDE_HUMAN_MODS')) === 'off'
    if (s.isEnvOff) return next(e)
    s.isHidden = (await $.store.get('isHidden')) === true
    s.cwd = e.cwd ?? ''
    s.home = (await $.env.get('HOME')) ?? ''
    s.health = await health($, s.home)
    s.isMobile = (await deviceClass($)) === 'mobile'
    const past = await $.store.get(storeKey(s.cwd))
    s.history = clean(past)
    s.records = (await $.store.get(`records:${s.cwd}`)) as Records | undefined
    const saved = s.prev ? null : await read($, keptTurn)
    if (saved) s.prev = loadTurn(saved)
    s.isCacheOff = (await $.store.get('isCacheOff')) === true
    const cached = s.cache.anchor < 0 ? await read($, keptCache) : null
    if (cached) {
      s.cache = cached
      void idle($, s)
    }
    await loadGenome($, s)
    const kept = await $.store.get('ledger')
    s.ledger = Array.isArray(kept) ? (kept as Entry[]) : []
    await $.command.register({ name: COMMAND, description: 'Open or close the xray detail panel; on|off shows or hides the cards; cache on|off the cache countdown; rate good|bad rates the custom card', argumentHint: '[on|off|cache on|off|rate good|bad <note>]', immediate: true })

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
    if (arg === 'cache on' || arg === 'cache off') {
      s.isCacheOff = arg === 'cache off'
      await $.store.set('isCacheOff', s.isCacheOff)
      if (!s.isCacheOff) void idle($, s)
      $.ui.invalidate('ui.render')

      return { text: s.isCacheOff ? 'cache countdown off. /xray cache on brings it back.' : 'cache countdown on.' }
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
    await loadGenome($, s)
    s.prev = s.turn ?? s.prev
    const at = await $.clock.now()
    s.turn = newTurn(e.text, at)
    if (s.prev?.endedAt !== undefined) Object.assign(s.turn, { awayMs: at - s.prev.endedAt, isAwayCold: cacheLeft(s.cache, at) === 0 })
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
      void burst($, s)
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
    if (u) {
      t.requests.push({ startedAt, firstAt: firstAt || startedAt, endedAt: await $.clock.now(), output: u.output_tokens, input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens })
      s.cache = noteRequest(s.cache, { startedAt, input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens, model: e.model }, t.requests.length === 1)
    }

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
      t.endedAt = now
      const letters = genome.code(t)
      await loadGenome($, s)
      const lm = landmarks(t, s.rec, s.ctx)
      const keyR = `records:${s.cwd}`
      const rec20 = records(t, (await $.store.get(keyR).catch(() => undefined)) as Records | undefined, testHead, now)
      if (s.cwd) await $.store.set(keyR, rec20.records)
      s.records = rec20.records
      const moments = [...celebrations(t), ...rec20.moments, ...(await turnMoments($, s, t, letters, now).catch(() => [])), ...(lm.marks.length ? [landmarkMoment(lm.marks)].filter((x): x is Moment => !!x) : [])]
      const name = nameOf(letters, countedRuns(t), filesRead(t))
      await saveGenome($, s, letters, { name, marks: lm.marks, tests: lm.tests, files: fileTouches(t, now) })
      const memo = recall(s.history, t)
      s.history = record(s.history, t)
      if (s.cwd) await $.store.set(storeKey(s.cwd), s.history)
      // The turn is over before the strip is told: a redraw while s.turn still stood drew the cards' slot
      // (nothing) and the strip stayed away until something else redrew (round 17 live check).
      s.prev = t
      s.turn = null
      await update($, last, () => ({ ...lastTurn(t, now), memo: memo.length ? memo : undefined, moment: pick(moments), name }))
      await update($, keptTurn, () => saveTurn(t))
      $.ui.invalidate('ui.render')
      void idle($, s)
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // /clear: the same process goes on as a new conversation with a cold cache.
    if (e.reason === 'clear') {
      s.cache = emptyCache()
      s.idleGen++
      await update($, keptCache, () => null)
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
      const k = compact(s.turn, s.mode, said, s.ctx, now, w, (e.viewport?.rows ?? Infinity) < SHORT, where(await here($, s), s.home, true))
      const color = TONE_COLOR[k.tone]
      const dim = k.tone === 'quiet'
      const ink = (l: Line, key: string) => l.map((g, i) => (
        <Text key={`${key}${i}`} color={g.color} backgroundColor={g.bg} dimColor={g.dim} bold={g.bold} inverse={g.inv} strikethrough={g.strike}>
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
          {(e.viewport?.rows ?? Infinity) < SHORT ? null : genomeRows(genome.rows(s.rec.turns, w, { live: s.turn ?? undefined, now, maxRows: 1 }), 'kg', Text)}
        </Box>
      )
    }
    // Round 16: the wide cards come from layout.ts as exact-width rows; each row is one Text.
    const cols = Math.max(40, (e.viewport?.columns ?? 100) - 2) // never fill the last column
    const rows = spinnerRows(s.turn, s.mode, said, s.ctx, now, cols, (e.viewport?.rows ?? 0) >= TALL ? BODY_ROWS + 1 : BODY_ROWS, s.memo, where(await here($, s), s.home))

    return (
      <Box flexDirection="column">
        {line}
        {rows.map((l, r) => (
          <Text key={`w${r}`} wrap="truncate-end">
            {l.map((g, i) => (
              <Text key={`w${r}s${i}`} color={g.color} backgroundColor={g.bg} dimColor={g.dim} bold={g.bold} inverse={g.inv} strikethrough={g.strike}>
                {g.t}
              </Text>
            ))}
          </Text>
        ))}
        {genomeRows(withNotes(s.rec, cols, { live: s.turn ?? undefined, now }), 'wg', Text)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const usage = await $.session.usage().catch(() => null)
    // Text columns inside the paddingX={1} below; rows as the surface measured them.
    const cols = e.props.bodyColumns !== undefined ? e.props.bodyColumns - 2 : undefined
    const sections = panel(s.turn ?? s.prev, usage, await $.clock.now(), s.ledger, { cols, rows: e.viewport?.rows }, s.isCacheOff ? null : s.cache)
    // The genome and its key lead the panel and always show (user, 2026-10-03): placed last, they fell
    // below the pane's 32 rows on a busy turn. At most PANEL_DNA rows; older turns fold into +N.
    const dna = genome.rows(s.rec.turns, cols ?? 80, { live: s.turn ?? undefined, now: await $.clock.now(), maxRows: PANEL_DNA })
    const marks = (Object.keys(MARK_GLYPH) as (keyof typeof MARK_GLYPH)[]).map((k): Line => [{ t: MARK_GLYPH[k], ...markLook(k) }, { t: ` ${MARK_WORD[k]}`, dim: true }])
    // An empty row takes no height: the spacer holds a space.
    sections.unshift({ title: `genome · ${genome.summary(s.rec.turns)}`, rows: [...(dna.length ? dna : [[{ t: 'no steps yet this session', dim: true }]]), [{ t: ' ' }], ...genome.key(cols ?? 80, marks)] })
    const best = recordRows(s.records)
    if (best.length) sections.push({ title: 'records · this folder', rows: best })
    // Round 20e: the files this session touched, newest touch first, each touch a genome cell.
    const files = s.rec.files.slice(0, PANEL_TURNS)
    if (files.length) {
      const all = s.rec.files.map(x => x.f)
      const names = files.map(x => shortName(x.f, all, s.cwd, s.home))
      const w = Math.min(28, Math.max(...names.map(n => n.length)))
      sections.push({ title: `files · ${s.rec.files.length}`, rows: files.map((x, i) => [{ t: (names[i] ?? '').slice(0, w).padEnd(w + 2) }, ...genome.cellsOf(x.cells.slice(-Math.max(8, (cols ?? 80) - w - 4)))]) })
    }
    // Round 20d: each turn by name, newest first (10 at most: the pane is 32 rows).
    const named = s.rec.turns.map((x, i) => ({ x, i, name: s.rec.names[i] ?? '' })).filter(r => r.name).reverse()
    if (named.length) {
      const w = Math.min(24, Math.max(...named.slice(0, PANEL_TURNS).map(r => r.x.length), 1))
      const rows: Line[] = named.slice(0, PANEL_TURNS).map(r => {
        const dna = genome.rows([r.x], w + 1, { maxRows: 1 })[0] ?? []
        return [{ t: `${String(r.i + 1).padStart(3)}  `, dim: true }, ...dna, { t: ' '.repeat(Math.max(0, w - cells(dna)) + 2) }, { t: r.name }]
      })
      sections.push({ title: `turns · ${named.length} · ${new Set(named.map(r => r.name.replace(/\d+/g, 'N'))).size} kinds`, rows })
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {sections.map((sec, i) => (
          <Box key={`p${i}`} flexDirection="column" marginTop={i ? 1 : 0}>
            <Text bold>{sec.title}</Text>
            {sec.rows.map((l, r) => (
              <Text key={`p${i}r${r}`} wrap="truncate-end">
                {l.map((g, k) => (
                  <Text key={`g${k}`} color={g.color} backgroundColor={g.bg} dimColor={g.dim} bold={g.bold} inverse={g.inv} strikethrough={g.strike}>
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

  // Between turns the strip carries what the status line did (round 17, pick 2a): device, folder, the
  // context gauge, and a health check only when it fails. It stays under /xray off; the cards go.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (s.isEnvOff || s.turn) return next(e)
    const l = s.isHidden ? null : await read($, last)
    const { Box, Text } = $.ui.resolve(e)
    // The device mod is optional: absent, the strip draws as it did.
    const cls = await deviceClass($)
    const glyph = deviceGlyph(cls)
    // On a phone (47 cols) the tail was cut mid-word; the strip stops at the headline there.
    const hasTail = cls !== 'mobile'
    const pct = (await $.session.usage().catch(() => null))?.context.percent ?? s.ctx
    const folder = where(await here($, s), s.home, !hasTail)
    const gauge: Line = pct === null || pct === undefined ? [] : [...(hasTail ? [{ t: 'ctx ', dim: true }, ...bar(pct / 100, 8, pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : undefined)] : []), { t: ` ${Math.round(pct)}%`, color: pct >= 70 ? 'yellow' : undefined, dim: pct < 70 }]
    const width = Math.max(24, (e.viewport?.columns ?? 100) - 3)
    // Phone: its own row under the strip. Desktop: flush right on the strip's own line (see `right` below).
    // No room on the strip's line (a long headline, a narrow pane, the phone): its own row, same look, flush right.
    // Between turns the whole genome shows (user, 2026-10-03): on the strip's line only when every turn fits
    // there; otherwise its own rows under the strip, wrapped, nothing folded.
    const own = s.isHidden ? [] : genome.labelRight(genome.rows(s.rec.turns, width - genome.EDGE_LABEL.length - 1, { maxRows: Infinity }), width)
    const ownRow = own.length ? genomeRows(own, 'ig', Text) : null
    // Only read the clock when a figure needs it (the cache, the session's age).
    const now = s.cache.anchor >= 0 || s.rec.startedAt !== undefined ? await $.clock.now() : 0
    const color = l?.tone === 'ok' ? 'green' : l?.tone === 'fail' ? 'red' : undefined
    // How the turn ended on a tile in its tone; each owed to-do on a tile in its own hue.
    const owed = (l?.owed ?? []).map(x => (typeof x === 'string' ? { t: x } : x))
    const memoText = hasTail && l?.memo?.length ? `  ·  ${l.memo.join('  ·  ')}` : ''
    // Round 20: the one tile slot sits where the memo does; on a phone it takes its own row.
    const moment: Line = l?.moment && hasTail ? [{ t: '  ' }, ...tile(l.moment)] : []
    const owedCells = !hasTail ? 0 : 14 + (owed.length ? owed.reduce((a, x) => a + x.t.length + 2, 0) + owed.length - 1 : 'nothing ✓'.length)
    const turnCells = l ? 13 + (l.name ?? l.title ?? 'turn').length + (l.name && hasTail ? (l.title ?? 'turn').length + 3 : 0) + 2 + 1 + l.headline.length + cells(moment) + memoText.length + owedCells : 0
    // Round 20f: the cache bar and the session's age are extras: they give way when they would push the
    // whole genome off this line, since the genome is what the line is for.
    const age: Line = hasTail && s.rec.startedAt !== undefined ? [{ t: `  ${span(now - s.rec.startedAt)} · ${s.rec.turns.length} turn${s.rec.turns.length === 1 ? '' : 's'}`, dim: true }] : []
    const cacheOf = (isBar: boolean) => (s.isCacheOff || s.cache.anchor < 0 ? [] : cacheStrip(s.cache, now, !hasTail, isBar))
    const leadOf = (isExtra: boolean): Line => [...(glyph ? [{ t: `${glyph} ` }] : []), ...(folder ? [{ t: `${folder}  ` }] : []), ...gauge, ...cacheOf(isExtra), ...(isExtra ? age : []), ...s.health.map(x => ({ t: `  ${MARK_WARN} ${x}`, color: 'red' }))]
    // The strip's width in cells, to know the room left for the genome on its line (glyph = 2 cells).
    const usedOf = (lead: Line) => cells(lead) + (glyph ? 1 : 0) + turnCells
    const roomOf = (lead: Line) => width - usedOf(lead) - 3 - EDGE_MARK
    const extra = leadOf(true)
    // They cost nothing when the genome is on its own row anyway (a long last-turn line pushes it there).
    const isWhole = (room: number) => genome.shown(s.rec.turns, room) >= s.rec.turns.length
    const isExtra = hasTail && (s.isHidden || !isWhole(roomOf(leadOf(false))) || isWhole(roomOf(extra)))
    const lead = isExtra ? extra : leadOf(false)
    const right = (used: number) => {
      if (s.isHidden || !hasTail) return null
      const room = width - used - 3 - EDGE_MARK
      if (genome.shown(s.rec.turns, room) < s.rec.turns.length) return null
      const segs = genome.tail(s.rec.turns, room)
      if (!segs.length) return null
      return [<Text key="gtpad">{' '.repeat(Math.max(1, width - used - cells(segs) - EDGE_MARK))}</Text>, ...ink(segs, 'gt', Text)]
    }
    const onLine = right(usedOf(lead))
    const phoneMoment = l?.moment && !hasTail && !s.isHidden ? genomeRows([tile(l.moment, false)], 'im', Text) : null

    return (
      <Box paddingX={1} flexDirection="column">
        <Text wrap="truncate-end">
          {ink(lead, 'ld', Text)}
          {l ? (
            <Text>
              <Text dimColor>{hasTail || !l.name ? '   last turn ' : '  '}</Text>
              <Text color={color} dimColor={!color} inverse>{` ${l.name ?? l.title ?? 'turn'} `}</Text>
              {l.name && hasTail ? <Text dimColor>{` ${l.title ?? 'turn'} ·`}</Text> : null}
              <Text color={color}>{` ${l.headline}`}</Text>
              {ink(moment, 'mo', Text)}
              {memoText ? <Text dimColor>{memoText}</Text> : null}
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
          ) : null}
          {onLine}
        </Text>
        {phoneMoment}
        {onLine ? null : ownRow}
      </Box>
    )
  })
}

const cells = (l: Line) => l.reduce((a, g) => a + g.t.length, 0)
function ink(l: Line, key: string, Text: ReturnType<EngineInterface['ui']['resolve']>['Text']) {
  return l.map((g, i) => (
    <Text key={`${key}${i}`} color={g.color} backgroundColor={g.bg} dimColor={g.dim} bold={g.bold}>
      {g.t}
    </Text>
  ))
}

// Round 20 (one shared row): the genome's rows with the note row just above the newest one: landmarks
// over their step, turn names at each turn's first cell, the session's longest turn marked ⧗.
// The label rides the first genome row's right edge, so cells and notes lay out label + 1 narrower.
function withNotes(rec: SessionRec, cols: number, opts: Parameters<typeof genome.rows>[2]): Line[] {
  const width = cols - genome.EDGE_LABEL.length - 1
  const rows = genome.labelRight(genome.rows(rec.turns, width, opts), cols)
  if (!rows.length) return rows
  const longest = rec.turns.reduce((best, x, i) => (x.length > (rec.turns[best]?.length ?? 0) ? i : best), 0)
  const notes: genome.Note[] = [
    ...rec.marks.map(m => ({ turn: m.turn, at: m.at, glyph: MARK_GLYPH[m.kind], text: m.text, look: markLook(m.kind) })),
    ...(rec.turns.length >= 3 && (rec.turns[longest]?.length ?? 0) >= LONGEST_MIN ? [{ turn: longest, at: 0, glyph: MARK_GLYPH.longest, text: `longest · ${rec.turns[longest]?.length} steps`, look: markLook('longest') }] : []),
    ...rec.names.map((name, turn) => ({ turn, at: 0, text: name })).filter(n => n.text && rec.turns[n.turn]),
  ]
  const row = genome.annotate(rec.turns, width, notes, opts)
  return row.length ? [...rows.slice(0, -1), row, ...rows.slice(-1)] : rows
}
const LONGEST_MIN = 12
const PANEL_TURNS = 10
const PANEL_DNA = 12
// The note row's marks in words, for the genome's key.
const MARK_WORD = { commit: 'commit', green: 'back to green', red: 'red again', fanout: '2+ agents', ctx: 'context 50/70 %', longest: 'longest turn' } as const

// Round 19: the genome's rows, one Text each (exact widths from genome.ts).
const EDGE_MARK = 5 // Claude Code draws its own `[-]` at the strip line's right end (live check); the genome stops short of it
function genomeRows(rows: Line[], key: string, Text: ReturnType<EngineInterface['ui']['resolve']>['Text']) {
  return rows.map((l, r) => (
    <Text key={`${key}${r}`} wrap="truncate-end">
      {l.map((g, i) => (
        <Text key={`${key}${r}s${i}`} color={g.color} backgroundColor={g.bg} dimColor={g.dim} bold={g.bold}>
          {g.t}
        </Text>
      ))}
    </Text>
  ))
}

// The two checks the status line's dots made (PT, ADHD-CM), as words when one fails.
const MARK_WARN = '▲'
async function health($: EngineInterface, home: string): Promise<string[]> {
  if (!home) return []
  const out: string[] = []
  if (!(await $.fs.exists(`${home}/.claude/skills/ponytail/SKILL.md`).catch(() => false))) out.push('ponytail skill missing')
  const rules = await $.fs.read(`${home}/.claude/CLAUDE.md`).catch(() => '')
  if (typeof rules !== 'string' || !rules.includes('caveman compression')) out.push('style rules missing from CLAUDE.md')
  return out
}

// The folder now, as the status line read it on every redraw: a cd mid-session moves it. s.cwd stays the
// session's start folder (the project memory is keyed to it).
const here = ($: EngineInterface, s: Live) => $.session.cwd().catch(() => s.cwd)
