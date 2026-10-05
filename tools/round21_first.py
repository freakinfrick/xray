"""Round 21 mockups: three ways to give xray a hierarchy and fixed slots. Every line measured."""
import json, sys
from mockup import W, pad, wrap, card, closed, hjoin, to_html, check

# ── the live fixture turn, paused at to-do 2 of 4 ──
TODOS = [('done', 'Read sum.js'), ('live', 'Read the test'), ('todo', 'Fix the off-by-one bug'), ('todo', 'Run node --test')]
NARR = 'The reduce starts at 1, so every sum comes out one high. Checking what the test expects before the edit.'
GENOME = [('[', 'd'), ('▌▌', 'b'), ('▌', 'c'), (']', 'd'), ('(', 'd'), ('▌▌▌', 'b'), ('▌', 'y'), ('▌', 'c'), ('▌', 'b')]
GENOME_IDLE = [('[', 'd'), ('▌▌', 'b'), ('▌', 'c'), (']', 'd'), ('[', 'd'), ('▌▌▌', 'b'), ('▌', 'y'), ('▌', 'c'), ('▌▌', 'b'), ('▌', 'm'), ('▌', 'g'), (']', 'd')]
CTX = [('ctx   ', 'd'), ('█▍', 'g'), ('░░░░░░', 'd'), (' 17%', '')]
CACHE = [('cache ', 'd'), ('███████▉', 'g'), (' 58m', '')]
TOKS = [('tok/s ', 'd'), ('▄▅▁█', 'c'), (' 148', '')]
TURN = [('turn  ', 'd'), ('12s', ''), ('  ◐', 'y')]
STEPS = [('steps ', 'd'), ('10', '')]


def cell(i, state, name, w, rows=2):
    """One to-do as a cell w wide, rows tall: mark + number on row 1, name wrapped under it."""
    mark = {'done': ('■', 'g'), 'live': ('◆', 'B bg-y'), 'todo': ('□', 'd')}[state]
    style = {'done': 'S', 'live': 'y', 'todo': 'd'}[state]
    text = wrap(f'{i} {name}', w - 2, style, maxrows=rows)
    out = []
    for r in range(rows):
        lead = [(mark[0], mark[1]), (' ', '')] if r == 0 else [('  ', '')]
        body = text[r] if r < len(text) else []
        out.append(pad(lead + body, w))
    return out


def cells(wb, rows=2, gap=2):
    n = len(TODOS)
    w = (wb - gap * (n - 1)) // n
    cs = [cell(i + 1, s, t, w, rows) for i, (s, t) in enumerate(TODOS)]
    return [pad([s for k, c in enumerate(cs) for s in (([(' ' * gap, '')] if k else []) + c[r])], wb) for r in range(rows)]


def own_edge(width, parts, b='d'):
    return closed(width, parts, b) if parts else [('╰' + '─' * (width - 2) + '╯', b)]


def sep(parts, gap='   '):
    out = []
    for i, p in enumerate(parts):
        out += ([(gap, '')] if i else []) + p
    return out


def right(line, cols):
    return [(' ' * (cols - W(line)), '')] + line


def spread(left, rt, cols):
    return left + [(' ' * (cols - W(left) - W(rt)), '')] + rt


# ── A · three fixed bays ─────────────────────────────────────────────────
# to-do bay left (widest, tier 1), now bay middle (narration only, tier 2), gauge bay right
# (fixed 26 cols, rows in a fixed order: tier 3). Each bay closes its own edge.
GW = 26

def a_wide(cols=190, rows=3):
    wn = 52
    wt = cols - wn - GW - 2
    todo = card(wt, [('─ ', 'y'), ('to-do 1/4', 'y'), (' ', '')], cells(wt - 4, rows), rows, 'y') + [own_edge(wt, [], 'y')]
    now = card(wn, [('─ ', 'd'), ('now', 'd'), (' ', '')], wrap(NARR, wn - 4, '', maxrows=rows), rows) + [own_edge(wn, [])]
    g = card(GW, [('─', 'd')], [CTX, CACHE, TOKS], rows) + [own_edge(GW, TURN[1:])]
    return check(hjoin([todo, now, g]) + [genome_row(cols)], 'aW')

def a_mid(cols=120, rows=3):
    wt = cols - GW - 1
    body = cells(wt - 4, 2) + [[('» ', 'd')] + wrap(NARR, wt - 6, '', maxrows=1)[0]]
    todo = card(wt, [('─ ', 'y'), ('to-do 1/4', 'y'), (' ', '')], body, rows, 'y') + [own_edge(wt, [], 'y')]
    g = card(GW, [('─', 'd')], [CTX, CACHE, TOKS], rows) + [own_edge(GW, TURN[1:])]
    return check(hjoin([todo, g]) + [genome_row(cols)], 'aM')

def a_phone(cols=44):
    w = cols - 3
    ws = w - 4
    rows = [[('◆ ', 'B bg-y'), ('Read the test', 'y')], squares(), [('» ', 'd')] + wrap(NARR, ws - 2, '', maxrows=1)[0]]
    c = card(w, [('─ ', 'y'), ('to-do', 'y'), (' ', '')], rows, 3, 'y')
    return check(c + [own_edge(w, [('17%', ''), (' · ', 'd'), ('58m', ''), (' · 12s ◐', 'd')], 'y')], 'aP')


# ── B · headline band + two cards ────────────────────────────────────────
# One sticky band row on top: what is happening now (tier 1) left, the gauges at a fixed right
# edge (tier 3). Under it the to-do cells and the narration, nothing else.

def band(cols, short=False):
    left = [(' ◆ ' if short else ' ◆ 2/4 ', 'B bg-y'), (' Read the test', 'y')]
    g = [('ctx ', 'd'), ('█▍░░░░░░', 'g'), (' 17%', '')] if not short else [('ctx ', 'd'), ('17%', '')]
    rt = sep([g, [('cache ', 'd'), ('58m', '')], [('12s ', ''), ('◐', 'y')]] + ([[('148 tok/s', 'd')]] if not short else []), '   ') + [(' ', '')]
    return spread(left, rt, cols)

def b_wide(cols=190, rows=2):
    wn = 64
    wt = cols - wn - 1
    todo = card(wt, [('─', 'd')], cells(wt - 4, rows), rows) + [own_edge(wt, [])]
    now = card(wn, [('─', 'd')], wrap(NARR, wn - 4, '', maxrows=rows), rows) + [own_edge(wn, [])]
    return check([band(cols)] + hjoin([todo, now]) + [genome_row(cols)], 'bW')

def b_mid(cols=120, rows=3):
    body = cells(cols - 4, 2) + [[('» ', 'd')] + wrap(NARR, cols - 6, '', maxrows=1)[0]]
    c = card(cols, [('─', 'd')], body, rows) + [own_edge(cols, [])]
    return check([band(cols)] + c + [genome_row(cols)], 'bM')

def b_phone(cols=44):
    w = cols - 3
    body = [squares() + [('  ', '')] + [('3 Fix the off-by…', 'd')], [('» ', 'd')] + wrap(NARR, w - 6, '', maxrows=1)[0]]
    c = card(w, [('─', 'd')], body, 2)
    return check([pad(band(w, True)[:2], w)] + c + [own_edge(w, [('ctx 17%', ''), (' · ', 'd'), ('cache 58m', ''), (' · 12s ◐', 'd')])], 'bP')


# ── C · one baseline shared with the idle strip ──────────────────────────
# Cards hold work only: to-dos and narration. Every number lives on ONE row under the cards,
# and between turns that same row, same columns, is the idle strip. ctx is always column 1.

def baseline(cols, working=True, short=False):
    ctx = [('ctx ', 'd'), ('█▍░░░░░░', 'g'), (' 17%', '')] if not short else [('ctx ', 'd'), ('17%', '')]
    cache = [('cache ', 'd'), ('███████▉', 'g'), (' 58m', '')] if not short else [('cache ', 'd'), ('58m', '')]
    if working:
        mid = [[('turn ', 'd'), ('12s ', ''), ('◐', 'y')]] + ([[('tok/s ', 'd'), ('▄▅▁█', 'c'), (' 148', '')]] if not short else [])
    else:
        mid = [[('still owed ', 'd'), ('nothing ✓', 'g')]] if not short else [[('owed ', 'd'), ('0 ✓', 'g')]]
    left = [(' ', '')] + sep([ctx, cache] + mid, '   ')
    if short:
        return pad(left, cols)
    g = GENOME if working else GENOME_IDLE
    return spread(left, g + [('  genome ', 'd')], cols)

def c_wide(cols=190, rows=2):
    wn = 64
    wt = cols - wn - 1
    todo = card(wt, [('─ ', 'y'), ('to-do 1/4', 'y'), (' ', '')], cells(wt - 4, rows), rows, 'y') + [own_edge(wt, [], 'y')]
    now = card(wn, [('─ ', 'd'), ('now', 'd'), (' ', '')], wrap(NARR, wn - 4, '', maxrows=rows), rows) + [own_edge(wn, [])]
    return check(hjoin([todo, now]) + [baseline(cols)], 'cW')

def c_mid(cols=120, rows=3):
    body = cells(cols - 4, 2) + [[('» ', 'd')] + wrap(NARR, cols - 6, '', maxrows=1)[0]]
    c = card(cols, [('─ ', 'y'), ('to-do 1/4', 'y'), (' ', '')], body, rows, 'y') + [own_edge(cols, [], 'y')]
    return check(c + [baseline(cols)], 'cM')

def c_phone(cols=44):
    w = cols - 3
    body = [[('◆ ', 'B bg-y'), ('Read the test', 'y')], squares(), [('» ', 'd')] + wrap(NARR, w - 6, '', maxrows=1)[0]]
    c = card(w, [('─ ', 'y'), ('to-do', 'y'), (' ', '')], body, 3, 'y') + [own_edge(w, [], 'y')]
    return check([pad(l, w) for l in c] + [baseline(w, True, True)], 'cP')


# ── shared bits ──

def squares():
    m = {'done': ('■', 'g'), 'live': ('◆', 'y'), 'todo': ('□', 'd')}
    return [m[s] for s, _ in TODOS]

def genome_row(cols):
    return right(GENOME + [('  genome ', 'd')], cols)

def idle_ab(cols):
    """A and B between turns: ctx + cache, still owed, genome; fixed order, nothing else."""
    left = [(' ', '')] + sep([[('ctx ', 'd'), ('█▌░░░░░░', 'g'), (' 18%', '')], [('cache ', 'd'), ('████████', 'g'), (' 60m', '')], [('still owed ', 'd'), ('nothing ✓', 'g')]], '   ')
    if cols < 60:
        return [pad([(' ctx ', 'd'), ('18%', ''), ('  cache ', 'd'), ('60m', ''), ('  owed ', 'd'), ('0 ✓', 'g')], cols)]
    return [spread(left, GENOME_IDLE + [('  genome ', 'd')], cols)]


if __name__ == '__main__':
    out = {
        'aW': a_wide(), 'aM': a_mid(), 'aP': a_phone(),
        'bW': b_wide(), 'bM': b_mid(), 'bP': b_phone(),
        'cW': c_wide(), 'cM': c_mid(), 'cP': c_phone(),
        'iW': idle_ab(190), 'iM': idle_ab(120), 'iP': idle_ab(44),
        'cIW': [baseline(190, False)], 'cIM': [baseline(120, False)], 'cIP': [baseline(44, False, True)],
    }
    widths = {k: sorted({W(l) for l in v}) for k, v in out.items()}
    json.dump({k: to_html(v) for k, v in out.items()}, open(sys.argv[1], 'w'))
    print(widths)
