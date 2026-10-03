// Reading tool calls: what a command is, what its output says, how to name a step in plain words.

export type TestRun = { pass: number; fail: number; total: number; failing: string[] }

const TEST_CMD = /^(?:(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|(pytest|jest|vitest|mocha|ava|tap)\b|cargo\s+(nextest|test)\b|go\s+test\b|claude\s+plugin\s+test\b|unittest\b|ctest\b|node\s+--test\b)/
const CHECK_CMD = /^(?:tsc|mypy|pyright|cargo\s+(check|clippy)|go\s+vet|eslint|ruff|flake8|py_compile)\b/
// What may stand in front of the program itself: VAR=x, a runner, a path ("./node_modules/.bin/", ".venv/bin/").
const LEAD = /^(?:\w+=\S*\s+|(?:timeout\s+\S+|time|env|nice|exec|npx|bunx|uv\s+run|poetry\s+run|pipenv\s+run|python3?\s+-m|\S*\/)\s*)/

// The programs a shell line actually runs: heredoc bodies and quoted text dropped (a script that merely
// mentions pytest is not a test run: the history store held sed and heredoc edits as passing runs), split
// at && || ; | and newlines, each with its leading VAR=x, runner and path stripped.
export function heads(cmd: string): string[] {
  const bare = cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, '')
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''")
  return bare.split(/&&|\|\||[;|\n]/).map(seg => {
    let h = seg.trim()
    for (let m = h.match(LEAD); m?.[0]; m = h.match(LEAD)) h = h.slice(m[0].length)
    return h
  }).filter(Boolean)
}

// The test command itself, without what came before or after it ("cd x && node --test 2>&1" → "node --test"),
// so reruns written differently still compare as the same suite.
export function testHead(cmd: string): string | undefined {
  const h = heads(cmd).find(x => TEST_CMD.test(x))
  return h?.replace(/\s*\d?>&?\s*\S+/g, '').trim()
}
export const isTestCommand = (cmd: string) => testHead(cmd) !== undefined
// Round 20a: a git commit at a command's head; `git -C dir commit` too.
export const isCommitCommand = (cmd: string) => heads(cmd).some(h => /^git\s+(?:-C\s+\S+\s+)?commit\b/.test(h))
// What a finished commit says about itself: "3f9c2ab subject" from git's own "[branch 3f9c2ab] subject"
// line, else the -m message (git commit -q prints nothing), else empty.
export function commitNote(cmd: string, out: string): string {
  const m = out.match(/^\[[^\]\s]+(?: \([^)]*\))? ([0-9a-f]{7,})\] (.*)$/m)
  if (m) return `${m[1]} ${m[2]}`.trim()
  const msg = cmd.match(/(?:^|\s)-\w*m\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/)
  return (msg?.[1] ?? msg?.[2] ?? '').split('\n')[0]?.trim() ?? ''
}
export const isCheckCommand = (cmd: string) => !isTestCommand(cmd) && heads(cmd).some(x => CHECK_CMD.test(x))

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
// The narrator's reply as one line: quotes and the » mark trimmed, at most 120 chars; "-" (its way of
// saying it has nothing about the work) comes back empty.
export function narrationOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').replace(/^["'»\s]+|["'\s]+$/g, '').slice(0, 120)
  return /^[-–—.]*$/.test(line) ? '' : line
}

export function checkVoice(line: string, facts: string): boolean {
  if (!line.trim() || /\bthe agent\b|\bclaude(?: is|'s)\b/i.test(line)) return false
  // About the narrator, not the work (round 17 live: "Starting fresh; need facts from you about what's being
  // coded."): no I / you, no talk of facts, context or input.
  if (/\b(I|I'm|I'll|I've|me|my)\b/.test(line) || /\b(you|your|yours)\b|\b(facts?|context|input|information)\b|\bnot enough\b|\bneed more\b/i.test(line)) return false
  const known = facts.toLowerCase()
  const nums = line.match(/\d+(?:\.\d+)?/g) ?? []
  const names = line.match(/[\w-]+(?:[./_][\w-]+)+/g) ?? []
  return [...nums, ...names].every(x => known.includes(x.toLowerCase()))
}
