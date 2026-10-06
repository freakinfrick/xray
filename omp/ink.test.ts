import { test, expect } from 'claude-code/testing'
import { ink, resultText, seg, toCall, type Theme } from './ink'
import { newTurn, startStep, finishStep } from '../hooks/track'
import { spinnerRows } from '../hooks/layout'
import * as genome from '../hooks/genome'

const theme: Theme = {
  getFgAnsi: t => `<${t}>`,
  getColorHex: t => (t === 'success' ? '#00ff88' : '#00b4ff'),
}
const ascii: Theme = { ...theme, boxRound: { topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+', horizontal: '-', vertical: '|' } }
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m|<[a-zA-Z]+>/g, '')

test('semantic colours go through the theme token, kind hexes stay', () => {
  expect(seg(theme, { t: 'ok', color: 'green' })).toBe('<success>ok\x1b[0m')
  expect(seg(theme, { t: 'x', color: 'magentaBright' })).toBe('<customMessageLabel>x\x1b[0m')
  expect(seg(theme, { t: '▌', color: '#ff5f00' })).toBe('\x1b[38;2;255;95;0m▌\x1b[0m')
  expect(seg(theme, { t: 'plain' })).toBe('plain')
})

test('a band takes the token colour as its background, black text on it', () => {
  expect(seg(theme, { t: ' edit ', bg: 'green', color: 'black' })).toBe('\x1b[30m\x1b[48;2;0;255;136m edit \x1b[0m')
})

test('dim with no colour is the theme muted colour; dim on a colour is faint', () => {
  expect(seg(theme, { t: 'a', dim: true })).toBe('<muted>a\x1b[0m')
  expect(seg(theme, { t: 'a', dim: true, color: 'red' })).toBe('<error>\x1b[2ma\x1b[0m')
})

test('the ascii preset swaps the rounded frame glyphs', () => {
  expect(plain(ink(ascii, [{ t: '╭─ now ─╮' }]))).toBe('+- now -+')
  expect(plain(ink(theme, [{ t: '╭─╮' }]))).toBe('╭─╮')
})

test('a line is cut to the width it is given', () => {
  expect(plain(ink(theme, [{ t: 'abcdef', color: 'red' }, { t: 'ghi' }], 7))).toBe('abcdefg')
})

test('omp tools map to the shapes the core classifies', () => {
  expect(toCall('bash', { command: 'git commit -m x', i: 'Committing' })).toEqual({ tool: 'Bash', input: { command: 'git commit -m x' } })
  expect(toCall('read', { path: 'a.ts' }).input).toEqual({ file_path: 'a.ts' })
  expect(toCall('edit', { path: 'a.ts' }, 'Fixing a').say).toBeUndefined() // the spinner line has the intent
  expect(toCall('hub', { i: 'Checking jobs' }).say).toBe('Checking jobs')
  expect(toCall('eval', { title: 'Rename' }).kind).toBe('script')
  expect(toCall('todo', { op: 'init' }).kind).toBe('todo')
  expect(toCall('hub', {}).kind).toBe('other')
})

test('omp results read as text', () => {
  expect(resultText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] })).toBe('a\n\nb')
  expect(resultText('raw')).toBe('raw')
  expect(resultText(null)).toBe('')
})

test('an omp turn through the core: kinds, genome letters, the card alone at full width', () => {
  const t = newTurn('port xray', 0)
  for (const [id, name, args] of [['1', 'read', { path: 'a.ts' }], ['2', 'edit', { path: 'a.ts' }], ['3', 'bash', { command: 'bun test' }]] as const) {
    const c = toCall(name, args)
    startStep(t, id, c.tool, c.input, 1)
    finishStep(t, id, c.tool, c.input, true, '3 pass\n0 fail', undefined, 2)
  }
  expect(t.done.map(x => x.kind)).toEqual(['read', 'edit', 'test'])
  expect(genome.code(t).length).toBe(3)
  const rows = spinnerRows(t, undefined, null, 40, 3, 80, 3, undefined, '', false)
  const text = rows.map(l => l.map(g => g.t).join(''))
  expect(text.every(r => r.length === 80)).toBe(true)
  expect(text.some(r => r.includes('to-do'))).toBe(false)
  expect(text[0]?.startsWith('╭')).toBe(true)
  expect(text[text.length - 1]?.endsWith('╯')).toBe(true)
})
