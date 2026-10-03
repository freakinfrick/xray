"""Round-19c mockups: the 1a Flow screen + the session genome (every step of the session, one coloured cell
each, │ between turns, grows to 3 rows then folds the oldest turns) + the round-17 to-do cells.
Reuses mockup / mockup17 / mockup19b helpers; every multi-line mockup is width-checked. Output: JSON."""
import json, random, sys
from mockup import W, pad, card, closed, check, to_html, wrap
from mockup17 import TODOS, window, MARK
from mockup19b import big, braille, RATE, CALLS, gap, fit

# The filmstrip legend (cards.ts KIND), unchanged: read ▌ blue, edit █ yellow, command █ magenta,
# passing test run █ green, agent █ cyan, failed █ red, other ▌ dim.
CELL = {'r': ('▌', 'b'), 'e': ('█', 'y'), 'c': ('█', 'm'), 't': ('█', 'g'), 'a': ('█', 'c'), 'x': ('█', 'r'), 'o': ('▌', 'd')}

def session(turns, seed=7):
    """A plausible session: each turn reads, edits, runs; some fail; the odd agent."""
    rnd = random.Random(seed)
    out = []
    for k in range(turns):
        n = rnd.randint(3, 22)
        steps = []
        for i in range(n):
            p = rnd.random()
            steps.append('r' if p < .38 else 'e' if p < .6 else 'c' if p < .75 else 'x' if p < .83 else 't' if p < .93 else 'a' if p < .96 else 'o')
        out.append(''.join(steps))
    return out

def genome(turns, width, maxrows=3, live=False, frame=0, label=True):
    """Cells in session order, │ between turns, wrapped at width; past maxrows the oldest whole turns
    fold into a dim '+N turns' lead. The live step blinks ▄ / its cell at the tick."""
    lab = 'genome ' if label else ''
    def lay(ts, lead):
        cells = [(lead, 'd')] if lead else []
        for k, t in enumerate(ts):
            if k: cells.append(('│', 'd'))
            cells += [CELL[c] for c in t]
        if live: cells[-1] = ('▄', 'y') if frame else ('█', 'y')
        rows, cur = [], []
        for c in cells:
            if W(cur) + len(c[0]) > width - len(lab):
                rows.append(cur); cur = []
            cur.append(c)
        return rows + [cur]
    fold = 0
    rows = lay(turns, '')
    while len(rows) > maxrows:
        fold += 1
        rows = lay(turns[fold:], f'+{fold} turns ')
    out = []
    for i, r in enumerate(rows):
        out.append(([(lab, 'd')] if i == 0 else gap(len(lab))) + r)
    steps = sum(len(t) for t in turns)
    return out, f'{len(turns)} turns · {steps} steps'

def cell(i, hue, text, st, cw, rows):
    """Round 17 as built: live = solid patch in its hue; done = hue mark, name struck through; pending grey."""
    names = [r[0][0] for r in wrap(text, cw - 2, maxrows=rows - 1)][:rows - 1]
    lines = [f'{MARK[st] if st != "done" else "■"} {i}'] + names
    lines += [''] * (rows - len(lines))
    out = []
    for r, t in enumerate(lines):
        t = (' ' + t).ljust(cw)
        if st == 'live': out.append([(t, f'bg-{hue} B')])
        elif st == 'done': out.append([(t, hue)] if r == 0 else [(' ', ''), (t[1:].rstrip(), 'S'), (' ' * (cw - 1 - len(t[1:].rstrip())), '')])
        else: out.append([(t, 'd')])
    return out

def todo_cells(todos, inner, rows=3):
    k = min(len(todos), (inner + 1) // 16)
    sl, first, hl, hr = window(todos, k) if k < len(todos) else (todos, 1, 0, 0)
    side = (4 if hl else 0) + (4 if hr else 0)
    cw = min(26, (inner - side - (len(sl) - 1)) // len(sl))
    cs = [cell(first + j, h, t, s, cw, rows) for j, (h, t, s) in enumerate(sl)]
    out = []
    for r in range(rows):
        line = ([(f'✓{hl} ', 'g')] if hl and r == 1 else gap(4) if hl else [])
        for j, c in enumerate(cs): line += (gap(1) if j else []) + c[r]
        if hr: line += [(f' +{hr}', 'd')] if r == 1 else gap(4)
        out.append(line)
    return out

def flow_top(frame):
    wire = '━' if frame else '─'
    L = [
        [('╭───────╮', 'c'), ('      ', ''), ('╭───────────╮', 'y'), ('     ', ''), ('╭──────────────╮', 'd')],
        [('│ model ├', 'c'), ('─', 'c'), (wire * 4, 'y'), ('▶', 'y'), ('┤ edit      ├', 'y'), (wire * 4, 'y'), ('▶', 'y'), ('┤ sum.js  l.9  │', '')],
        [('╰───────╯', 'c'), ('      ', ''), ('╰───────────╯', 'y'), ('     ', ''), ('╰──────────────╯', 'd')],
    ]
    tr = braille(RATE, 34, 3)
    S = [[('tok/s 159 ', 'd'), (tr[0], 'c')], [('          ', ''), (tr[1], 'c')], [('          ', ''), (tr[2], 'c')]]
    t, c, s = big('2/3', 'g'), big('17', ''), big('14', '')
    N = [t[i] + gap(5) + c[i] + gap(5) + s[i] for i in range(3)]
    lab = [('TESTS', 'g'), (' ' * W(t[0]), ''), ('CTX %', ''), (' ' * W(c[0]), ''), ('SEC', 'd')]
    lw = max(W(x) for x in L); sw = max(W(x) for x in S)
    rows = [pad(L[i], lw) + gap(8) + pad(S[i], sw) + gap(8) + N[i] for i in range(3)]
    rows.append(pad([], lw + 8 + sw + 8) + lab)
    return rows

def wide(frame, turns, cols=188, live=True):
    w = cols - 4
    g, meta = genome(turns, w, live=live, frame=frame)
    done = sum(x[2] == 'done' for x in TODOS)
    body = flow_top(frame) + [[]] + g + [[]] + todo_cells(TODOS, w)
    body = [fit(r, w, 'wide') for r in body]
    head = [('', ''), (' ◆ editing ', 'bg-y B'), (' sum.js · fix mul · 14s ', ''), (' ', '')]
    c = card(cols, head, body, len(body), 'd')
    edge = closed(cols, [('genome ', 'd'), (meta, ''), ('   to-do ', 'd'), (f'{done} of {len(TODOS)}', ''), ('   cache ', 'd'), ('47m', 'p'), ('   ◐ med', 'd')])
    return check(c + [edge], f'wide{len(turns)}')

def phone(frame, turns, cols=44):
    w = cols - 3
    wire = '━' if frame else '─'
    g, meta = genome(turns, w - 4, maxrows=1, live=True, frame=frame, label=False)
    sq = [('■', h) if s == 'done' else ('◆', h) if s == 'live' else ('□', 'd') for h, _, s in TODOS]
    t, c = big('2/3', 'g'), big('17', '')
    body = [[('model ', 'c'), (wire * 2 + '▶ ', 'y'), ('edit', 'y'), (' ' + wire * 2 + '▶ ', 'y'), ('sum.js l.9', '')]]
    body += [t[i] + gap(5) + c[i] for i in range(3)]
    body += g + [sq + [(' ', ''), (' fix mul ', 'bg-y B')]]
    head = [('', ''), (' ◆ editing ', 'bg-y B'), (' 14s ', ''), (' ', '')]
    cc = card(w, head, [fit(x, w - 4) for x in body], len(body), 'd')
    return check(cc + [closed(w, [(meta, 'd'), ('  ', ''), ('47m', 'p')])], f'phone{len(turns)}')

def idle(turns, cols=188):
    """Between turns: the strip as today, the genome under it (no live cell)."""
    strip = [(' ~/claude/mods  ', ''), ('ctx 17%', 'd'), ('   last turn  ', 'd'), (' tests · run 3 ', 'bg-g B'), (' all 3 pass ✓', ''), ('   still owed  ', 'd'), ('□ re-run tests', 'd'), ('   cache ', 'd'), ('47m', 'p')]
    g, meta = genome(turns, cols - 2, live=False)
    return [strip] + [[(' ', '')] + r for r in g]

if __name__ == '__main__':
    short, longer, huge = session(4), session(14), session(40)
    out = {}
    for f in (0, 1):
        out[f'w{f}'] = to_html(wide(f, longer))
        out[f'p{f}'] = to_html(phone(f, longer))
    out['short'] = to_html(genome(short, 184)[0])
    out['long'] = to_html(genome(longer, 184)[0])
    out['huge'] = to_html(genome(huge, 184)[0])
    out['idle'] = to_html(idle(longer))
    json.dump(out, open(sys.argv[1], 'w'))
    print('ok', {k: v.count('\n') + 1 for k, v in out.items()})
