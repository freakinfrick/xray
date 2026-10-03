"""Round-16 layout mockups: exact-width terminal lines rendered to HTML spans.
Every line is measured, so borders always align. Output: JSON {name: html} for the page."""
import html, json, sys

def W(line): return sum(len(t) for t, _ in line)
def pad(line, n): return line + [(' ' * (n - W(line)), '')] if W(line) < n else line

def wrap(text, width, cls='', lead='', maxrows=None):
    words, rows, cur = text.split(' '), [], lead
    for w in words:
        if cur.strip() and len(cur) + 1 + len(w) > width:
            rows.append(cur); cur = ' ' * len(lead) + w
        else:
            cur = (cur + ' ' + w) if cur.strip() else cur + w
    rows.append(cur)
    if maxrows and len(rows) > maxrows:
        rows = rows[:maxrows]; r = rows[-1]
        rows[-1] = (r[:width - 1] if len(r) >= width else r) + '…'
    return [[(r, cls)] for r in rows]

def pack(tokens, width, gap=2):
    rows, cur = [], []
    for tok in tokens:
        if cur and W(cur) + gap + W(tok) > width:
            rows.append(cur); cur = []
        cur = cur + ([(' ' * gap, '')] if cur else []) + tok
    return rows + ([cur] if cur else [])

def subcols(left, right, wl, gap=3):
    n = max(len(left), len(right))
    return [pad(left[i] if i < len(left) else [], wl) + [(' ' * gap, '')] + (right[i] if i < len(right) else []) for i in range(n)]

def card(width, head, body, rows, b='d'):
    top = [('╭', b)] + head
    top = top + [('─' * (width - 1 - W(top)), b), ('╮', b)]
    out = [top]
    for i in range(rows):
        line = body[i] if i < len(body) else []
        out.append([('│', b), (' ', '')] + pad(line, width - 4) + [(' ', ''), ('│', b)])
    return out

def closed(width, parts, b='d'):
    line = [('╰─ ', b)] + parts + [(' ', '')]
    return line + [('─' * (width - 1 - W(line)), b), ('╯', b)]

def tray(widths, parts, borders, gutter=1):
    """One bottom edge under all cards; each card's telemetry sits under that card."""
    line = []
    for i, (w, p, b) in enumerate(zip(widths, parts, borders)):
        seg = [('╰' if i == 0 else '┴', b), ('─ ', b)] + p + [(' ', '')]
        seg = seg + [('─' * (w - 1 - W(seg)), b), ('╯' if i == len(widths) - 1 else '┴', b)]
        line += seg + ([('─' * gutter, 'd')] if i < len(widths) - 1 else [])
    return line

def hjoin(cards, gutter=1):
    return [[s for i, c in enumerate(cards) for s in (([(' ' * gutter, '')] if i else []) + c[r])] for r in range(len(cards[0]))]

def to_html(lines):
    out = []
    for line in lines:
        out.append(''.join(f'<span class="{c}">{html.escape(t)}</span>' if c else html.escape(t) for t, c in line))
    return '\n'.join(out)

def check(lines, name):
    ws = {W(l) for l in lines}
    if len(ws) != 1: sys.exit(f'{name}: ragged widths {sorted(ws)}')
    return lines

# ── shared content (the live check's turn, paused at run 2, editing mul) ──
NARR = "sum's clean after one edit. mul next — same file, one line down; the assert wants 6 and it returns 5."
LAST = [('last: ', 'd'), ('edit sum.js · 1 line', '')]
STRIP = [('▌', 'b'), ('▌', 'b'), ('█', 'm'), ('█', 'r'), ('█', 'y'), ('█', 'm'), ('█', 'r'), ('▌', 'b'), ('█', 'y'), ('█', 'c')]
TODOS = [('■', 'g', 'run tests'), ('■', 'm', 'fix sum'), ('■', 'b', 're-run tests'), ('◆', 'y', 'fix mul'), ('□', 'd', 're-run tests')]
CHIPS = [[(g, c), (' ' + n, c if g != '□' else 'd')] for g, c, n in TODOS]
SQUARES = [(g, c) for g, c, _ in TODOS]
BAR = [('███████████', 'g'), ('█████', 'r')]

def head_now(): return [('', ''), (' ◆ focused ', 'bg-c B'), (' editing sum.js · 14s ', ''), ('▄', 'c'), (' ', '')]
def head(t, b='d'): return [('─ ', b), (t, b), (' ', '')]
TELE_NOW = [('turn 14s · ◐ med', 'd')]
TELE_TODO = [('ctx ', 'd'), ('██', 'g'), ('░░░░░░', 'd'), (' 17%', 'd')]
TELE_TESTS = [('tok/s ', 'd'), ('▁█▇▂▃', 'c'), (' 159 · cache ', 'd'), ('███████▉', 'g'), (' 99%', 'd')]

def spaced(groups, rows):
    """Stack groups top to bottom; a spare row becomes a blank between groups (whitespace, not filler)."""
    used = sum(len(g) for g in groups)
    out = []
    for i, g in enumerate(groups):
        if i and used < rows: out.append([]); used += 1
        out += g
    return out

def now_body(wb, rows, narration=NARR):
    narr = wrap('» ' + narration, wb, 'd', maxrows=max(1, rows - 1))
    return spaced([narr, [LAST]], rows)

def tests_cols(wl):
    left = [[('steps ', 'd')] + STRIP, [('10 · ', ''), ('2 ✕', 'r')], [('runs ', 'd'), ('▃▆', 'g'), (' 1 → 2 passing', 'd')]]
    right = [BAR + [(' 2 of 3 pass', '')], [('✕ ', 'r'), ('mul', '')], [('expected 6, got 5', 'd')]]
    return left, right

def wide(rows, cols=188, fail_frame=None):
    wn, wt_, wk = 74, 46, cols - 74 - 46 - 2
    b_t = 'r' if fail_frame is not None else 'd'
    hn = head_now() if fail_frame is None else [('', ''), (' ✕ stuck ', 'bg-r B'), (' 3rd failing run · 31s ', ''), ('▄', 'r'), (' ', '')]
    now = card(wn, hn, now_body(wn - 4, rows, NARR if fail_frame is None else 'Third red run, and worse: sum.js no longer parses. The last edit broke line 2.'), rows, 'c' if fail_frame is None else 'r')
    todo = card(wt_, head('to-do · 3 of 5'), spaced([pack(CHIPS, wt_ - 4), [[('▸ ', 'd'), ('fix mul in sum.js', '')]]], rows), rows)
    l, r = tests_cols(26)
    th = head('tests · run 2', b_t)
    if fail_frame is not None:
        th = [(('╌─' if fail_frame else '─╌'), 'r'), (' tests · run 3 ', 'r')]
        r = [[('████████████████', 'r'), (' 3 of 3 fail', 'r')], [('✕ ', 'r'), ('sum  mul  zero', '')], [('SyntaxError: sum.js line 2', 'd')]]
        l = l[:2] + [[('runs ', 'd'), ('▃▆▁', 'r'), (' 1 → 2 → 0', 'd')]]
    tests = card(wk, th, subcols(l, r, 26, 4), rows, b_t)
    lines = hjoin([now, todo, tests]) + [tray([wn, wt_, wk], [TELE_NOW, TELE_TODO, TELE_TESTS], ['c' if fail_frame is None else 'r', 'd', b_t])]
    if fail_frame is not None:  # walk the failing card's bottom edge
        last = lines[-1]
        start = wn + 1 + wt_ + 1
        flat = ''.join(t for t, _ in last)
        post = ''.join(('╌' if (i + fail_frame) % 2 and ch == '─' else ch) for i, ch in enumerate(flat[start:]))
        import itertools
        runs = [(''.join(g), 'r' if k else 'd') for k, g in itertools.groupby(post, key=lambda ch: ch in '─╌┴╯')]
        lines[-1] = [(flat[:wn], 'r'), (flat[wn:start], 'd')] + runs
    return check(lines, f'wide{rows}')

def mid(rows, cols=118):
    wn = 50; wk = cols - wn - 1
    now = card(wn, head_now(), now_body(wn - 4, rows), rows, 'c')
    l, r = tests_cols(27)
    body = subcols(l[:2], r[:2], 27) + pack(CHIPS, wk - 4)
    tests = card(wk, head('tests · run 2 · to-do 3 of 5'), body, rows)
    lines = hjoin([now, tests]) + [tray([wn, wk], [TELE_NOW, TELE_TODO + [(' · ', 'd')] + TELE_TESTS], ['c', 'd'])]
    return check(lines, f'mid{rows}')

def phone(cols=44):
    w = cols - 3
    # subcolumns on the phone too: steps | to-dos share one row, so the card stays at today's 5-row max
    body = wrap('» ' + NARR, w - 4, 'd', maxrows=2) + [STRIP + [(' 2✕', 'r'), ('   ', '')] + SQUARES + [(' fix mul', 'y')]]
    c = card(w, head_now()[:3], body, 3, 'c')
    return check(c + [closed(w, TELE_TODO + [(' · ◐ med', 'd')], 'c')], 'phone')

def idle(cols):
    if cols < 60:
        return [[(' 📱 ', ''), (' tests · run 3 ', 'bg-g B'), (' all 3 pass ✓', '')]]
    return [[(' last turn  ', 'd'), (' tests · run 3 ', 'bg-g B'), (' all 3 pass ✓', ''), ('   ·  suite 0.4 s, usual 0.4  ·  mul fixed here before, Oct 1 (example)', 'd'), ('      still owed  ', 'd'), ('nothing ✓', 'g')]]

def today(cols=188):
    # today's layout for contrast: fixed 38/30/32 %, no gutter, clipped rows, one shared edge
    w0, w1 = int(cols * .38), int(cols * .30); w2 = cols - w0 - w1
    n = card(w0, [('', ''), (' ◇ waiting on the model ', 'bg-m B'), (' ', '')], wrap('» The agent is planning the task workflow and organizing its approach to debugging.', w0 - 4, 'd'), 3, 'm')
    t = card(w1, head('to-do'), [[('no to-do list yet', 'd')]], 3)
    k = card(w2, head('progress'), [[('steps ', 'd'), ('████', 'g'), ('░░░░', 'd'), (' 4 done · 1 failed', '')]], 3)
    lines = hjoin([n, t, k], 0)
    edge = [('╰─ ctx ', 'd'), ('█▎', 'g'), ('░░░░░░', 'd'), (' 16%   tok/s ', 'd'), ('▁█▇', 'c'), (' 168   cache ', 'd'), ('███████▉', 'g'), (' 99%   turn 7s ', 'd')]
    lines.append(edge + [('─' * (cols - 1 - W(edge)), 'd'), ('╯', 'd')])
    return check(lines, 'today')

if __name__ == '__main__':
  out = {
    'today': to_html(today()),
    'wideA': to_html(wide(3)), 'wideB': to_html(wide(4)),
    'midA': to_html(mid(3)), 'midB': to_html(mid(4)),
    'phone': to_html(phone()),
    'fail0': to_html(wide(4, fail_frame=0)), 'fail1': to_html(wide(4, fail_frame=1)),
    'idleW': to_html(idle(188)), 'idleP': to_html(idle(44)),
}
  json.dump(out, open(sys.argv[1], 'w'))
  print('ok', {k: v.count('\n') + 1 for k, v in out.items()})
