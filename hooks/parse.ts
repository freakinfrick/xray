// Reading tool calls: what a command is, what its output says, how to name a step in plain words.

export type TestRun = { pass: number; fail: number; total: number; failing: string[] }

const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|jest|vitest|mocha|ava|tap)\b|\bcargo\s+(nextest|test)\b|\bgo\s+test\b|\bclaude\s+plugin\s+test\b|\bunittest\b|\bctest\b|\bnode\s+--test\b/
const CHECK_CMD = /\b(tsc|mypy|pyright|cargo\s+(check|clippy)|go\s+vet|eslint|ruff|flake8|py_compile)\b/

export const isTestCommand = (cmd: string) => TEST_CMD.test(cmd)
export const isCheckCommand = (cmd: string) => !isTestCommand(cmd) && CHECK_CMD.test(cmd)

const num = (re: RegExp, s: string) => {
  const m = s.match(re)
  return m ? Number(m[1]) : 0
}

// Best effort over jest/vitest, pytest, cargo, go, node:test/tap and bun summaries. null = no counts found.
export function parseTestOutput(text: string): TestRun | null {
  const s = text.replace(/\x1b\[[0-9;]*m/g, '')
  let pass = 0
  let fail = 0
  const jest = s.match(/Tests:\s+(.*?)(\d+) total/)
  if (jest) {
    pass = num(/(\d+) passed/, jest[1] ?? '')
    fail = num(/(\d+) failed/, jest[1] ?? '')
  } else if (/test result: (ok|FAILED)\./.test(s)) {
    for (const m of s.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)) {
      pass += Number(m[1])
      fail += Number(m[2])
    }
  } else if (/^\s*\d+ (pass|fail)$/m.test(s)) {
    // bun test (and so `claude plugin test`): " 23 pass" / " 1 fail" on lines of their own
    pass = num(/^\s*(\d+) pass$/m, s)
    fail = num(/^\s*(\d+) fail$/m, s)
  } else if (/^# (pass|fail) +\d+/m.test(s)) {
    pass = num(/^# pass +(\d+)/m, s)
    fail = num(/^# fail +(\d+)/m, s)
  } else if (/\d+ (passed|failed)/.test(s)) {
    pass = num(/(\d+) passed/, s)
    fail = num(/(\d+) failed/, s) + num(/(\d+) errors?\b/, s)
  } else if (/^(ok|FAIL|---) /m.test(s)) {
    pass = (s.match(/^--- PASS/gm) ?? []).length
    fail = (s.match(/^--- FAIL/gm) ?? []).length
    if (!pass && !fail) {
      pass = (s.match(/^ok\s/gm) ?? []).length
      fail = (s.match(/^FAIL\s/gm) ?? []).length
    }
  }
  if (!pass && !fail) return null
  const failing = new Set<string>()
  for (const m of s.matchAll(/^\s*(?:FAILED|✗|✕|×|--- FAIL:|not ok \d+ -|\(fail\))\s+(.+?)\s*$/gm)) failing.add(tidyName(m[1] ?? ''))
  for (const m of s.matchAll(/^\s*●\s+(.+?)\s*$/gm)) failing.add(tidyName(m[1] ?? ''))
  return { pass, fail, total: pass + fail, failing: [...failing].filter(Boolean).slice(0, 8) }
}

const tidyName = (n: string) =>
  n
    .replace(/\s+[([]\d+(\.\d+)?\s*m?s[)\]]$/, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/^.*::/, '')
    .slice(0, 60)

const base = (p: unknown) => String(p ?? '').split('/').filter(Boolean).pop() ?? ''
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// A step in the words a person would use: "editing cost.ts", "running the tests".
export function sayStep(tool: string, input: Record<string, unknown>): string {
  const cmd = String(input.command ?? '')
  switch (tool) {
    case 'Read':
      return `reading ${base(input.file_path)}`
    case 'Edit':
    case 'MultiEdit':
      return `editing ${base(input.file_path)}`
    case 'Write':
      return `writing ${base(input.file_path)}`
    case 'NotebookEdit':
      return `editing ${base(input.notebook_path)}`
    case 'Grep':
      return `searching for ${clip(String(input.pattern ?? ''), 24)}`
    case 'Glob':
      return 'finding files'
    case 'WebSearch':
      return 'searching the web'
    case 'WebFetch':
      return 'reading a web page'
    case 'Agent':
    case 'Task':
      return `starting agent: ${clip(String(input.description ?? input.subagent_type ?? 'helper'), 28)}`
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'updating the to-do list'
    case 'Bash':
      if (isTestCommand(cmd)) return 'running the tests'
      if (isCheckCommand(cmd)) return 'checking types'
      if (/^\s*git\s+commit/.test(cmd)) return 'committing'
      return input.description ? clip(String(input.description), 72).replace(/^\w/, c => c.toLowerCase()) : `running ${clip(cmd.trim().split(/\s+/).slice(0, 2).join(' ') || 'a command', 28)}`
    default:
      return tool.startsWith('mcp__') ? `using ${tool.split('__').pop()}` : `using ${tool}`
  }
}

export const sourceOf = (tool: string, input: Record<string, unknown>): string | null =>
  tool === 'Read' ? base(input.file_path) : tool === 'WebFetch' ? String(input.url ?? '').replace(/^https?:\/\//, '').slice(0, 48) : tool === 'WebSearch' ? `search: ${clip(String(input.query ?? ''), 40)}` : tool === 'Grep' ? `grep ${clip(String(input.pattern ?? ''), 30)}` : null

// The narrator's line is kept only when it holds to the facts it was given (round 16, direction 4):
// every number and every file-like name in it appears in them, and it never calls itself "the agent".
export function checkVoice(line: string, facts: string): boolean {
  if (!line.trim() || /\bthe agent\b|\bclaude(?: is|'s)\b/i.test(line)) return false
  const known = facts.toLowerCase()
  const nums = line.match(/\d+(?:\.\d+)?/g) ?? []
  const names = line.match(/[\w-]+(?:[./_][\w-]+)+/g) ?? []
  return [...nums, ...names].every(x => known.includes(x.toLowerCase()))
}
