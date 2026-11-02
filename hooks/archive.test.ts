import { test, expect } from 'claude-code/testing'
import * as archive from './archive'
import * as genome from './genome'
import { agentLetter, finishStep, newTurn, spawnAgent, startStep, stepKind } from './track'

test('round 22: skills, MCP tools and questions get their own letters, and count as looking', () => {
  expect(stepKind('Skill', {})).toBe('skill')
  expect(stepKind('mcp__aside__speak', {})).toBe('mcp')
  expect(stepKind('AskUserQuestion', {})).toBe('ask')
  expect(genome.bracketOf('lpq')).toBe('looked')
  expect(archive.LEGEND).toMatchObject({ l: 'skill', p: 'mcp', q: 'ask', r: 'read', x: 'failed' })
})

test('round 22: why a step failed', () => {
  expect(archive.failWhy(undefined)).toBe('aborted')
  expect(archive.failWhy({ deny: 'rm refused' }, 'hook')).toBe('hook')
  expect(archive.failWhy({ isError: true, text: 'ls was blocked' }, 'denied')).toBe('denied')
  expect(archive.failWhy({ deny: 'no' })).toBe('denied')
  expect(archive.failWhy({ isError: true, text: 'Command timed out after 2m' })).toBe('timeout')
  expect(archive.failWhy({ isError: true, text: 'exit 1' })).toBe('error')
  expect(archive.failWhy({ text: 'fine' })).toBeUndefined()
})

test('round 22: how a reply ended, from its text alone', () => {
  expect(archive.endOf('done.\n```dbox\nDECIDE\nd1  x\n```', 'answer')).toBe('decision')
  expect(archive.endOf('done.\n```dbox\nSTATUS\nDONE  x\n```', 'answer')).toBe('status')
  expect(archive.endOf('Which one do you want?', 'answer')).toBe('question')
  expect(archive.endOf('Fixed it.', 'answer')).toBe('talk')
  expect(archive.endOf('  ', 'answer')).toBe('silent')
  expect(archive.endOf('half', 'aborted')).toBe('aborted')
})

test('round 22: a turn as the archive keeps it: fails index the letters, agents carry their own genome', () => {
  const t = newTurn('fix it', 1000)
  t.user = { chars: 6, origin: 'composer' }
  t.midTurn = 1
  startStep(t, 'a', 'Read', { file_path: 'a.ts' }, 1100)
  finishStep(t, 'a', 'Read', { file_path: 'a.ts' }, true, '', undefined, 1200)
  startStep(t, 'b', 'Bash', { command: 'rm -rf x' }, 1300)
  finishStep(t, 'b', 'Bash', { command: 'rm -rf x' }, false, '', undefined, 1400)
  t.done[1]!.why = 'hook'
  spawnAgent(t, { toolUseId: 'g', agentId: 'ag1', label: 'scout', isBackground: false, startedAt: 1500 })
  agentLetter(t, 'ag1', 'r')
  agentLetter(t, 'ag1', 'x')
  t.requests.push({ startedAt: 0, firstAt: 0, endedAt: 0, output: 10, input: 5, cacheRead: 100, cacheWrite: 7 })
  const letters = genome.code(t)
  const a = archive.archTurn(t, letters, { name: 'n', end: 'talk', ms: 900, ctx: 42, model: 'm' })
  expect(a).toMatchObject({ at: 1000, ms: 900, letters: 'rx', fails: [{ at: 1, why: 'hook' }], user: { chars: 6, origin: 'composer' }, midTurn: 1, end: 'talk', ctxPct: 42, tokens: { input: 5, output: 10, cacheRead: 100, cacheWrite: 7 }, model: 'm' })
  expect(a.agents).toEqual([{ label: 'scout', letters: 'rx', isBackground: false }])
})

test('round 22: the archive file reads back its turns under a current header; junk starts over', () => {
  const fresh = archive.newArchive('id1', '/w', 5, 'opus')
  const kept = archive.addArchTurn(fresh, { at: 1, letters: 'r', name: '', fails: [], agents: [], end: 'talk' })
  const back = archive.loadArchive(JSON.stringify({ ...kept, schema: 0, legend: {} }), fresh)
  expect(back.turns).toHaveLength(1)
  expect(back.schema).toBe(archive.SCHEMA)
  expect(back.legend.r).toBe('read')
  expect(archive.loadArchive('not json', fresh)).toBe(fresh)
  expect(archive.pathOf('/home/u', 'id1')).toBe('/home/u/.claude/xray-genomes/id1.json')
})
