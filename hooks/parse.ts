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

// What a shell line did, for the genome (user, 2026-10-04, pick 1c): 14 days of transcripts held 34%
// read-only shell (sed -n, grep, cat), 20% inline scripts, 13% file changes, 6% herdr/conductor; all
// of it was one grey `run`. Each head gets a kind and the strongest wins, so `cd x && grep | head` is a
// read and `grep … > out` an edit. Shell keywords and echo/export weigh nothing; a line of only those is a run.
export type ShellKind = 'read' | 'edit' | 'script' | 'orchestrate' | 'network' | 'wait' | 'run'
// 'scaffold' (mkdir, touch) is an edit only when nothing but reads ran with it: `mkdir -p out && python3 -`
// is the script.
type HeadKind = ShellKind | 'scaffold'
const RANK: HeadKind[] = ['read', 'scaffold', 'wait', 'run', 'network', 'orchestrate', 'script', 'edit']
const word = (...w: string[]) => new RegExp(`^(?:${w.join('|')})(?:\\s|$)`)
const SH_GLUE = word('for', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'case', 'esac', 'while', 'in', 'echo', 'printf', 'export', 'cd', 'pushd', 'popd', 'set', 'unset', 'local', 'source', '\\.', 'true', 'false', ':', 'test', '\\[\\[?', '\\]', 'read', 'exit', 'return', 'break', 'continue', 'shopt', 'trap', '\\{', '\\}', '\\(', '\\)', '!')
const SH_READ = word('sed', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'cat', 'bat', 'batcat', 'glow', 'ls', 'll', 'tree', 'wc', 'head', 'tail', 'find', 'fd', 'stat', 'file', 'du', 'df', 'diff', 'cmp', 'jq', 'yq', 'less', 'more', 'awk', 'pwd', 'which', 'type', 'whereis', 'command', 'realpath', 'readlink', 'basename', 'dirname', 'date', 'nvidia-smi', 'ps', 'pgrep', 'ss', 'netstat', 'lsof', 'journalctl', 'sort', 'uniq', 'cut', 'tr', 'column', 'xxd', 'od', 'hexdump', 'strings', 'md5sum', 'sha\\d+sum', 'free', 'uptime', 'id', 'whoami', 'hostname', 'uname', 'lscpu', 'lsblk', 'sensors', 'nproc', 'env', 'printenv', 'pdftotext', 'identify')
const GIT = String.raw`git\s+(?:(?:-C\s+\S+|-c\s+\S+|--no-pager)\s+)*`
const SH_READ_SUB = new RegExp(String.raw`^(?:${GIT}(?:status|log|diff|show|branch|blame|rev-parse|ls-files|ls-tree|grep|remote|describe|shortlog|reflog|cat-file|config\s+--get)|systemctl\s+(?:--user\s+)?(?:status|is-active|is-enabled|show|list-\S+|cat)|docker\s+(?:ps|logs|inspect|images|stats)|npm\s+(?:ls|view|outdated)|pip3?\s+(?:show|list|freeze)|crontab\s+-l)\b`)
const SH_SCAFFOLD = word('mkdir', 'touch')
const SH_EDIT = word('cp', 'mv', 'rm', 'rmdir', 'gio', 'chmod', 'chown', 'ln', 'tee', 'tar', 'unzip', 'zip', 'gzip', 'gunzip', 'rsync', 'truncate', 'patch', 'dd', 'trash')
const SH_EDIT_SUB = new RegExp(String.raw`^(?:(?:sed|perl)\s+(?:-\S+\s+)*-\w*i|find\s.*\s-(?:delete|exec\s+(?:rm|mv|sed))\b|${GIT}(?:add|checkout|switch|mv|rm|stash|reset|restore|apply|merge|rebase|cherry-pick|tag|revert|am|worktree|init)\b)`)
// > or >> into a file; 2>&1, 2>/dev/null and >/dev/null write nothing worth a cell. Only a read or a bare
// echo/cat writing to a file is an edit by redirect; `python -u x.py > run.log` is still the run.
const REDIRECT = /(?:^|[^<>&\d])>>?\s*(?!&|\/dev\/null)[^\s>]/
const SH_SCRIPT = /^(?:python[\d.]*|node|tsx|ts-node|bun|deno|ruby|perl|bash|sh|zsh|php|Rscript)(?:\s+(?:-u\s+)?(?:-|-c|-e|-p|-E)?)?\s*$|^(?:python[\d.]*|node|bun|ruby|perl|bash|sh|zsh)\s+(?:-u\s+)?(?:-c|-e|-p|-E)\s/
const SH_ORCH = /^(?:herdr|tmux|screen|conductor\.py)\b|^\S+\s+\S*conductor\.py\b|^claude\s+(?:-p|--print)\b|^(?:codex|pi|hermes)\s+(?:exec|-p)\b/
const SH_NET = new RegExp(String.raw`^(?:curl|wget|gh|rclone|ssh|scp|sftp|tailscale|http|https|xh|nc|ping|dig|nslookup|traceroute|aria2c|yt-dlp)\b|^${GIT}(?:push|pull|fetch|clone|ls-remote)\b`)
const SH_WAIT = word('sleep', 'until', 'wait', 'inotifywait')
function headKind(h: string): HeadKind | undefined {
  h = h.replace(/^(?:(?:do|then|else|elif|if|while|!|\{|\()\s+)+/, '')
  const k = baseKind(h)
  return REDIRECT.test(h) && (k === undefined || k === 'read') ? 'edit' : k
}
function baseKind(h: string): HeadKind | undefined {
  if (SH_EDIT_SUB.test(h) || SH_EDIT.test(h)) return 'edit'
  if (SH_SCAFFOLD.test(h)) return 'scaffold'
  if (SH_SCRIPT.test(h)) return 'script'
  if (SH_READ_SUB.test(h)) return 'read'
  if (SH_ORCH.test(h)) return 'orchestrate'
  if (SH_NET.test(h)) return 'network'
  if (SH_WAIT.test(h)) return 'wait'
  if (SH_GLUE.test(h) || /^\w+=\S*$/.test(h)) return undefined
  if (SH_READ.test(h)) return 'read'
  return 'run'
}
export function shellKind(cmd: string): ShellKind {
  let best = -1
  for (const h of heads(cmd)) {
    const k = headKind(h)
    if (k) best = Math.max(best, RANK.indexOf(k))
  }
  const k = RANK[best] ?? 'run'
  return k === 'scaffold' ? 'edit' : k
}

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
