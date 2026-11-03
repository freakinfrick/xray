// Round 22: the genome archive. The store keeps 40 sessions for the screen; this keeps every session, one
// self-describing JSON file each (~/.claude/xray-genomes/<session id>.json), rewritten whole at each turn's
// end and never swept. A reader with no other context gets the legend and the schema from the file.
// Pure: register.tsx does the I/O.

import { CODE } from './genome'
import type { FailWhy, Turn } from './track'

export const SCHEMA = 1
export const DIR = '.claude/xray-genomes' // under $HOME

// The legend, letter → kind, from the genome's own table (todo steps have no letter), plus x.
export const LEGEND: Record<string, string> = { ...Object.fromEntries(Object.entries(CODE).filter(([, c]) => c).map(([k, c]) => [c, k])), x: 'failed' }

const ABOUT =
  'One Claude Code session as xray saw it. turns[i].letters: one letter per tool step in the order they ended (see legend; ' +
  "x = failed, its cause in fails[] by step index). Brackets on screen: a or h = delegated, e m c s k t x = changed, else looked. " +
  'user: the prompt that started the turn, as facts only (length, origin, slash command), never its text. end: how the reply ' +
  'ended, classified from its text, which is not kept. Not recorded: conductor workers and arbiters (CLAUDE_HUMAN_MODS=off), ' +
  'turns while /xray off. Other harness ports keep their own stores.'
const PRIVACY = 'Behavioral record of the user. Local only: never send to any external service or model API.'

export type Fail = { at: number; why: FailWhy }
export type End = 'question' | 'decision' | 'status' | 'talk' | 'silent' | 'aborted' | 'error'
export type ArchAgent = { label: string; letters: string; ok?: boolean; ms?: number; isBackground: boolean }
export type ArchTurn = {
  at: number // when the prompt came (epoch ms)
  ms?: number // the turn's wall time
  letters: string
  name: string
  fails: Fail[]
  agents: ArchAgent[]
  user?: { chars: number; origin: string; command?: string }
  awayMs?: number // since the previous turn ended
  midTurn?: number // prompts typed into the turn while it ran
  end: End
  ctxPct?: number // context window used at the end, percent, as the cards last measured
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  model?: string
}
export type Archive = {
  schema: number
  about: string
  privacy: string
  legend: Record<string, string>
  // isInteractive false: a scripted run (`claude -p`, the SDK), kept but tagged so a reader can leave it out.
  session: { id: string; cwd: string; harness: 'claude-code'; isInteractive: boolean; model?: string; startedAt: number }
  turns: ArchTurn[]
}

export const pathOf = (home: string, id: string) => `${home}/${DIR}/${id}.json`

export const newArchive = (id: string, cwd: string, startedAt: number, isInteractive: boolean, model?: string): Archive => ({
  schema: SCHEMA,
  about: ABOUT,
  privacy: PRIVACY,
  legend: LEGEND,
  session: { id, cwd, harness: 'claude-code', isInteractive, ...(model ? { model } : {}), startedAt },
  turns: [],
})

// A file read back: kept turns survive, the header is always today's (a newer legend explains old letters
// too, since letters are only ever added). Anything malformed starts over.
export function loadArchive(text: string | undefined, fresh: Archive): Archive {
  try {
    const o = JSON.parse(text ?? '') as Partial<Archive>
    return Array.isArray(o.turns) ? { ...fresh, session: { ...fresh.session, ...o.session }, turns: o.turns } : fresh
  } catch {
    return fresh
  }
}

// Why a tool call failed, from what it returned. `checked`: tool.check denied this call, by a hook or not
// (core's own blocks, such as reads outside the working folders, come back as a plain error otherwise).
export function failWhy(ran: { deny?: string; isError?: boolean; text?: string } | undefined, checked?: 'hook' | 'denied'): FailWhy | undefined {
  if (ran === undefined) return 'aborted'
  if (checked) return checked
  if (ran.deny !== undefined) return 'denied'
  if (!ran.isError) return undefined
  return /\btimed? ?out\b/i.test(ran.text ?? '') ? 'timeout' : 'error'
}

// How a reply ended, from its last words: a decision box (dbox fence with DECIDE or DO NOW), a status box,
// a question, plain talk, or nothing said.
export function endOf(answer: string, reason: string): End {
  if (reason === 'aborted') return 'aborted'
  if (reason === 'error') return 'error'
  const a = answer.trim()
  if (!a) return 'silent'
  const box = a.match(/```dbox\n([\s\S]*?)```/g)?.pop()
  if (box) return /\b(DECIDE|DO NOW)\b/.test(box) ? 'decision' : 'status'
  return /\?\s*\**$/.test(a) ? 'question' : 'talk'
}

// A finished turn as the archive keeps it. `letters` is genome.code(t): fails index into it.
export function archTurn(t: Turn, letters: string, extra: { name: string; end: End; ms?: number; ctx?: number | null; model?: string }): ArchTurn {
  const steps = t.done.filter(x => x.kind !== 'todo')
  const fails = steps.flatMap((x, at): Fail[] => (x.ok === false ? [{ at, why: x.why ?? 'error' }] : []))
  const agents = t.agents
    .filter(a => a.startedAt >= t.startedAt)
    .map((a): ArchAgent => ({ label: a.label.slice(0, 60), letters: a.letters ?? '', ...(a.ok !== undefined ? { ok: a.ok } : {}), ...(a.endedAt !== undefined ? { ms: a.endedAt - a.startedAt } : {}), isBackground: a.isBackground }))
  const sum = (k: 'input' | 'output' | 'cacheRead' | 'cacheWrite') => t.requests.reduce((n, r) => n + (r[k] || 0), 0)
  return {
    at: t.startedAt,
    ...(extra.ms !== undefined ? { ms: extra.ms } : {}),
    letters,
    name: extra.name,
    fails,
    agents,
    ...(t.user ? { user: t.user } : {}),
    ...(t.awayMs !== undefined ? { awayMs: t.awayMs } : {}),
    ...(t.midTurn ? { midTurn: t.midTurn } : {}),
    end: extra.end,
    ...(typeof extra.ctx === 'number' ? { ctxPct: extra.ctx } : {}),
    ...(t.requests.length ? { tokens: { input: sum('input'), output: sum('output'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite') } } : {}),
    ...(extra.model ? { model: extra.model } : {}),
  }
}

export const addArchTurn = (a: Archive, turn: ArchTurn): Archive => ({ ...a, turns: [...a.turns, turn] })
