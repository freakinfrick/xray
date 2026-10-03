"""Round-19b mockups: the OP-1 screen language in a terminal. Thin line art (light box drawing), big thin
digits, braille curves, one colour per value, empty space. Every drawing is the literal thing: the turn's
real signal flow, its real token-rate trace, its real numbers. Width-checked. Output: JSON {name: html}.
Colours own values everywhere: blue = context, green = tests, white = time, peach = cache, red = failure."""
import json, sys
from mockup import W, pad, card, closed, check, to_html

def gap(n): return [(' ' * n, '')]
def fit(line, n, name='row'):
    if W(line) > n: sys.exit(f'{name}: {W(line)} > {n}: ' + ''.join(t for t, _ in line))
    return pad(line, n)

# Thin 3-row digits, drawn with the light box set (the OP-1's line numerals).
DIG = {
    '0': ('╭─╮', '│ │', '╰─╯'), '1': ('╶┐ ', ' │ ', '╶┴╴'), '2': ('╶─╮', '╭─╯', '╰─╴'),
    '3': ('╶─╮', ' ─┤', '╶─╯'), '4': ('╷ ╷', '╰─┤', '  ╵'), '5': ('╭─╴', '╰─╮', '╶─╯'),
    '6': ('╭─╴', '├─╮', '╰─╯'), '7': ('╶─╮', '  │', '  ╵'), '8': ('╭─╮', '├─┤', '╰─╯'),
    '9': ('╭─╮', '╰─┤', '╶─╯'), '/': ('  ╱', ' ╱ ', '╱  '), ' ': ('  ', '  ', '  '), ':': (' ', '·', '·'),
}
def big(s, hue):
    return [[(' '.join(DIG[c][r] for c in s), hue)] for r in range(3)]

# Braille plot: 2 samples per cell, 4 dot rows per text row, line joined between samples.
BITS = [(0x01, 0x08), (0x02, 0x10), (0x04, 0x20), (0x40, 0x80)]
def braille(series, cells, rows, lo=None, hi=None):
    lo = min(series) if lo is None else lo
    hi = max(series) if hi is None else hi
    n = cells * 2
    xs = [series[min(len(series) - 1, int(i * len(series) / n))] for i in range(n)]
    H = rows * 4
    lv = [round((x - lo) / (hi - lo or 1) * (H - 1)) for x in xs]
    grid = [[0] * cells for _ in range(rows)]
    for i, y in enumerate(lv):
        a, b = (y, lv[i - 1]) if i else (y, y)
        for yy in range(min(a, b), max(a, b) + 1):
            top = H - 1 - yy
            grid[top // 4][i // 2] |= BITS[top % 4][i % 2]
    return [''.join(chr(0x2800 + v) for v in row) for row in grid]

# The turn: requests' token rate over time (0 = waiting on a tool), and where each tool ran.
RATE = [0, 140, 175, 160, 0, 0, 120, 168, 150, 0, 0, 0, 155, 180, 172, 0, 0, 130, 162, 159, 159]
CALLS = [(4, 'read', 'b'), (9, 'run', 'y'), (10, '✕', 'r'), (15, 'edit', 'm'), (16, 'run', 'y'), (20, 'edit', 'm')]

# ── V1 · Flow: the turn's real signal path, OP-1 routing-screen style, plus big numbers.
def flow_rows(frame):
    live = 'm'
    dot = '●' if False else ('━' if frame else '─')  # the live wire pulses ─/━ at 1 Hz
    return [
        [('╭───────╮', 'c'), ('      ', ''), ('╭───────────╮', live), ('     ', ''), ('╭──────────────╮', 'd')],
        [('│ model ├', 'c'), ('─', 'c'), (dot * 4, live), ('▶', live), ('┤ edit      ├', live), (dot * 4, live), ('▶', live), ('┤ sum.js  l.9  │', '')],
        [('╰───┬───╯', 'c'), ('      ', ''), ('╰───────────╯', live), ('     ', ''), ('╰──────────────╯', 'd')],
        [('    ╰─ ', 'd'), ('read ×3', 'b'), ('  ', ''), ('run ×3', 'y'), (' ', ''), ('1 fail', 'r'), ('  ', ''), ('edit ×1', 'm'), ('  → node --test', 'd')],
    ]

def numbers(sz):
    t, c, s = big('2/3', 'g'), big('17', 'b'), big('14', '')
    rows = [t[i] + gap(5) + c[i] + gap(5) + s[i] for i in range(3)]
    lab = [('TESTS', 'g'), (' ' * (W(t[0]) - 5 + 5), ''), ('CTX %', 'b'), (' ' * (W(c[0]) - 5 + 5), ''), ('SEC', 'd')]
    return rows + [lab]

def scope(cells, rows, frame):
    tr = braille(RATE, cells, rows)
    out = [[(r, 'c')] for r in tr]
    marks = [' '] * cells
    hues = [''] * cells
    for i, lab, hue in CALLS:
        x = min(cells - 1, int(i * cells / len(RATE)))
        marks[x] = '╵' if lab != '✕' else '✕'
        hues[x] = hue
    out.append([(m, h or 'd') for m, h in zip(marks, hues)])
    return out

def flow(frame, cols=188):
    w = cols - 4
    L = flow_rows(frame)
    S = scope(34, 3, frame)
    S = [[('tok/s 159 ', 'd')] + S[0]] + [[('          ', '')] + r for r in S[1:]]
    N = numbers(0)
    lw = max(W(x) for x in L); sw = max(W(x) for x in S)
    rows = [pad(L[i], lw) + gap(8) + pad(S[i], sw) + gap(8) + N[i] for i in range(4)]
    head = [('', ''), (' ◆ editing ', 'bg-m B'), (' sum.js · fix mul ', ''), (' ', '')]
    c = card(cols, head, [fit(r, w, 'flow') for r in rows], 4, 'd')
    todos = [('to-do ', 'd'), ('■', 'g'), (' run tests  ', 'd'), ('■', 'g'), (' fix sum  ', 'd'), ('■', 'g'), (' re-run  ', 'd'), ('◆', 'm'), (' fix mul  ', 'm'), ('□', 'd'), (' re-run', 'd')]
    edge = closed(cols, todos + [('   cache ', 'd'), ('47m', 'p'), ('   ◐ med', 'd')])
    return check(c + [edge], f'flow{frame}')

def flow_phone(frame, cols=44):
    w = cols - 3
    wire = '━' if frame else '─'
    t, c = big('2/3', 'g'), big('17', 'b')
    body = [[('model ', 'c'), (wire * 2 + '▶ ', 'm'), ('edit', 'm'), (' ' + wire * 2 + '▶ ', 'm'), ('sum.js l.9', '')]]
    body += [t[i] + gap(5) + c[i] for i in range(3)]
    body += [[('TESTS', 'g'), (' ' * (W(t[0]) + 5 - 5), ''), ('CTX %', 'b')]]
    head = [('', ''), (' ◆ editing ', 'bg-m B'), (' 14s ', ''), (' ', '')]
    cc = card(w, head, [fit(x, w - 4) for x in body], 5, 'd')
    return check(cc + [closed(w, [('cache ', 'd'), ('47m', 'p'), ('  ◐ med', 'd')])], f'flowP{frame}')

# ── V2 · Scope: the whole turn as one trace (the OP-1 envelope / tape screen), tools as labelled ticks
# under it, the live point blinking at the right end. Big numbers on the right.
def scope_wide(frame, cols=188):
    w = cols - 4
    cells = 96
    tr = braille(RATE, cells, 3)
    rows = [[(r, 'c')] for r in tr]
    if frame: rows[0] = [(tr[0][:-1], 'c'), ('•', '')]
    ticks = [' '] * cells; labs = []
    for i, lab, hue in CALLS:
        x = min(cells - 1, int(i * cells / len(RATE)))
        ticks[x] = '✕' if lab == '✕' else '┴'
        labs.append((x, lab, hue))
    line4 = []
    pos = 0
    for x, lab, hue in labs:
        if lab == '✕' or x < pos: continue
        line4 += gap(x - pos) + [(lab, hue)]
        pos = x + len(lab)
    rows = [[('tok/s ', 'd')] + rows[0], [('  159 ', 'c')] + rows[1], [('      ', '')] + rows[2], [('      ', '')] + line4]
    rows[2] = rows[2][:1] + [(''.join(ticks[j] if ticks[j] != ' ' else ch for j, ch in enumerate(tr[2])), 'c')]
    N = numbers(0)
    sw = max(W(x) for x in rows)
    out = [pad(rows[i], sw) + gap(10) + N[i] for i in range(4)]
    head = [('', ''), (' ◆ editing ', 'bg-m B'), (' sum.js · fix mul · 14s ', ''), (' ', '')]
    c = card(cols, head, [fit(r, w, 'scope') for r in out], 4, 'd')
    todos = [('to-do ', 'd'), ('■', 'g'), (' run tests  ', 'd'), ('■', 'g'), (' fix sum  ', 'd'), ('■', 'g'), (' re-run  ', 'd'), ('◆', 'm'), (' fix mul  ', 'm'), ('□', 'd'), (' re-run', 'd')]
    return check(c + [closed(cols, todos + [('   cache ', 'd'), ('47m', 'p'), ('   ◐ med', 'd')])], f'scope{frame}')

def scope_phone(frame, cols=44):
    w = cols - 3
    tr = braille(RATE, 20, 3)
    t = big('2/3', 'g')
    body = [[(tr[i], 'c')] + gap(3) + t[i] for i in range(3)] + [[('read run ✕ edit run', 'd'), ('   TESTS', 'g')]]
    head = [('', ''), (' ◆ editing ', 'bg-m B'), (' 14s ', ''), (' ', '')]
    cc = card(w, head, [fit(x, w - 4) for x in body], 4, 'd')
    return check(cc + [closed(w, [('ctx ', 'd'), ('17%', 'b'), ('  cache ', 'd'), ('47m', 'p')])], f'scopeP{frame}')

if __name__ == '__main__':
    out = {}
    for f in (0, 1):
        out[f'flow{f}'] = to_html(flow(f)); out[f'flowP{f}'] = to_html(flow_phone(f))
        out[f'scope{f}'] = to_html(scope_wide(f)); out[f'scopeP{f}'] = to_html(scope_phone(f))
    json.dump(out, open(sys.argv[1], 'w'))
    print('ok', len(out))
