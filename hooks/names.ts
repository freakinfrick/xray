// Round 20d: a finished turn's name, from its shape alone (no model): dry, precise, never cute. The
// first rule that matches names it. Inputs are the turn's genome letters (genome.code), its counted test
// runs in order (true = passed) and how many distinct files it read. Ported from the round-20 demo's
// classifier (19 rules, ~/claude/.explainers/xray-r20-src/d/gen.py).

type F = { n: number; r: number; e: number; c: number; t: number; a: number; x: number; runs: boolean[]; files: number }
const times = (n: number) => `×${n}`

const RULES: ((f: F) => string | null)[] = [
  f => (f.n === 0 ? 'talk only' : null),
  f => (f.runs.length >= 3 ? `test loop ${times(f.runs.length)}${f.runs[f.runs.length - 1] ? '' : ', red'}` : null),
  f => (f.runs.length && !f.runs[0] && f.runs[f.runs.length - 1] ? 'red → green' : null),
  f => (f.runs.length && !f.runs.some(Boolean) ? 'left red' : null),
  f => (f.runs.length && f.runs.every(Boolean) && f.e === 0 ? 'green on arrival' : null),
  f => (f.runs.length && f.runs.every(Boolean) && f.e === 1 && f.x === 0 ? 'one-edit fix' : null),
  f => (f.runs.length && f.runs.every(Boolean) && f.e >= 2 ? `${f.e} edits, green` : null),
  f => (f.a >= 2 ? `agent fan-out ${times(f.a)}` : null),
  f => (f.a === 1 ? 'delegated' : null),
  f => (f.e >= 8 && 2 * f.e >= f.n ? 'edit storm' : null),
  f => (f.x >= 3 && 10 * f.x >= 3 * f.n ? `${f.x} misfires` : null),
  f => (f.r === f.n && f.r >= 6 && f.files <= 2 ? 'long read' : null),
  f => (f.r === f.n && f.n <= 3 ? 'quick look' : null),
  f => (10 * f.r >= 7 * f.n && f.e === 0 ? `scouting ${f.files} file${f.files === 1 ? '' : 's'}` : null),
  f => (f.n === 1 && f.c === 1 ? 'one command' : null),
  f => (10 * f.c >= 6 * f.n && f.e === 0 ? `at the shell ${times(f.c)}` : null),
  f => (f.e >= 2 ? `${f.e} edits, untested` : null),
  f => (f.e === 1 ? 'one edit, untested' : null),
  f => `${f.n} steps, mixed`,
]

export function nameOf(letters: string, runs: readonly boolean[], files: number): string {
  const count = (k: string) => [...letters].filter(x => k.includes(x)).length
  // A commit is a command (round 20a gave it its own letter, k).
  const f: F = { n: letters.length, r: count('r'), e: count('e'), c: count('ck'), t: count('t'), a: count('a'), x: count('x'), runs: [...runs], files }
  for (const rule of RULES) {
    const name = rule(f)
    if (name) return name
  }
  return `${f.n} steps`
}
