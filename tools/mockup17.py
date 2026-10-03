"""Round-17 mockups: to-do cells in list order, a narrower now card, status-line figures folded in.
Reuses mockup.py's measured helpers; every multi-line mockup is width-checked. Output: JSON {name: html}."""
import json, sys
from mockup import W, pad, wrap, card, tray, hjoin, to_html, check, head_now, head, now_body, tests_cols, subcols, STRIP, BAR, NARR, TELE_NOW, TELE_TODO, TELE_TESTS

# (hue, name, status) in list order; live = in progress
TODOS = [('g', 'run tests', 'done'), ('m', 'fix sum', 'done'), ('b', 're-run tests', 'done'),
         ('y', 'fix mul in sum.js', 'live'), ('c', 're-run tests', 'todo')]
NINE = [('g', 'read the failing test', 'done'), ('m', 'run tests', 'done'), ('b', 'fix sum', 'done'),
        ('c', 're-run tests', 'done'), ('p', 'fix zero', 'done'), ('y', 'fix mul in sum.js', 'live'),
        ('g', 're-run tests', 'todo'), ('m', 'update README', 'todo'), ('b', 'commit', 'todo')]
MARK = {'done': '✓', 'live': '◆', 'todo': '□'}

def name_rows(text, w, n):
    return [r[0][0] for r in wrap(text, w, maxrows=n)][:n]

def cell_a(i, hue, text, st, cw, rows):
    """A · patch: the live to-do is a solid block in its hue; done ones in their hue; pending grey."""
    lines = [f'{MARK[st]} {i}'] + name_rows(text, cw - 2, rows - 1)
    lines += [''] * (rows - len(lines))
    out = []
    for r, t in enumerate(lines):
        t = (' ' + t).ljust(cw)
        if st == 'live': out.append([(t, f'bg-{hue} B')])
        elif st == 'done': out.append([(t, hue if r == 0 else '')])
        else: out.append([(t, 'd')])
    return out

def cell_b(i, hue, text, st, cw, rows):
    """B · boxes: each to-do a small rounded box; border in its hue, pending grey, live with ◆ in the edge."""
    b = 'd' if st == 'todo' else hue
    tag = f' {MARK[st]} {i} '
    top = [('╭─', b), (tag, b if st != 'live' else f'bg-{hue} B'), ('─' * (cw - 3 - len(tag)), b), ('╮', b)]
    inner = name_rows(text, cw - 4, rows - 2)
    inner += [''] * (rows - 2 - len(inner))
    mid = [[('│', b), (' ' + t.ljust(cw - 3), 'd' if st == 'todo' else ''), ('│', b)] for t in inner]
    return [top] + mid + [[('╰' + '─' * (cw - 2) + '╯', b)]]

def cells(todos, inner, rows, style, first=1, more_l=0, more_r=0):
    """Lay cells left to right in list order; dim counts stand in for to-dos outside the window."""
    side = (4 if more_l else 0) + (4 if more_r else 0)
    n = len(todos)
    cw = (inner - side - (n - 1)) // n
    mk = cell_a if style == 'A' else cell_b
    cs = [mk(first + k, h, t, s, cw, rows) for k, (h, t, s) in enumerate(todos)]
    out = []
    for r in range(rows):
        line = []
        if more_l: line += [(f'✓{more_l}'.ljust(3), 'g' if r == rows // 2 else ''), (' ', '')] if r == rows // 2 else [('    ', '')]
        for k, c in enumerate(cs):
            line += ([(' ', '')] if k else []) + c[r]
        if more_r: line += [(' ', ''), (f'+{more_r}'.rjust(3), 'd' if r == rows // 2 else '')] if r == rows // 2 else [('    ', '')]
        out.append(line)
    return out

def window(todos, k):
    """k cells around the live one, list order kept; returns (slice, first index, hidden before, hidden after)."""
    live = next(i for i, x in enumerate(todos) if x[2] == 'live')
    lo = max(0, min(live - 1, len(todos) - k))
    return todos[lo:lo + k], lo + 1, lo, len(todos) - lo - k

CMS = [('~/claude/mods  ', 'd')]
def tele_now(): return CMS + TELE_NOW

def wide17(rows, style='A', todos=TODOS, cols=188):
    wn, wk = 50, 58
    wt = cols - wn - wk - 2
    inner = wt - 4
    crow = 3 if (style == 'A' or rows >= 4) else rows
    if style == 'B' and rows < 4: style = 'A'  # boxes need 4 rows; short terminals fall back to patches
    k = min(len(todos), (inner + 1) // 14)  # cells never under 13 wide
    sl, first, hl, hr = window(todos, k) if k < len(todos) else (todos, 1, 0, 0)
    body = cells(sl, inner, rows if style == 'B' else crow, style, first, hl, hr)
    if style == 'A' and rows >= 4: body += [[('▸ ', 'd'), ('fixing mul in sum.js', 'y'), (f' · {sum(x[2] == "todo" for x in todos)} after it', 'd')]]
    done = sum(x[2] == 'done' for x in todos)
    now = card(wn, head_now(), now_body(wn - 4, rows), rows, 'c')
    todo = card(wt, head(f'to-do · {done} of {len(todos)}', 'y'), body, rows, 'y')
    l, r = tests_cols(26)
    tests = card(wk, head('tests · run 2'), subcols(l, r, 24, 2), rows)
    lines = hjoin([now, todo, tests]) + [tray([wn, wt, wk], [tele_now(), TELE_TODO, TELE_TESTS], ['c', 'y', 'd'])]
    return check(lines, f'wide{rows}{style}{len(todos)}')

def mid17(rows, cols=118):
    wn = 44; wt = cols - wn - 1
    narr = wrap('» ' + NARR, wn - 4, 'd', maxrows=rows - 2)
    trow = [('✕ ', 'r'), ('mul  ', ''), ('███', 'g'), ('██', 'r'), (' 2 of 3 · run 2', 'd')]
    now = card(wn, head_now(), narr + [trow, [('last: ', 'd'), ('edit sum.js · 1 line', '')]], rows, 'c')
    body = cells(TODOS, wt - 4, 3, 'A')
    if rows >= 4: body += [[('▸ ', 'd'), ('fixing mul in sum.js', 'y'), (' · 1 after it', 'd')]]
    todo = card(wt, head('to-do · 3 of 5', 'y'), body, rows, 'y')
    lines = hjoin([now, todo]) + [tray([wn, wt], [tele_now(), TELE_TODO + [('  ', '')] + TELE_TESTS], ['c', 'y'])]
    return check(lines, f'mid{rows}')

def phone17(cols=44):
    w = cols - 3
    sq = [('■', h) if s == 'done' else ('◆', h) if s == 'live' else ('□', 'd') for h, _, s in TODOS]
    body = wrap('» ' + NARR, w - 4, 'd', maxrows=2) + [STRIP + [(' 2✕', 'r'), ('  ', '')] + sq + [(' ', ''), (' fix mul ', 'bg-y B')]]
    from mockup import closed
    c = card(w, head_now()[:3], body, 3, 'c')
    return check(c + [closed(w, [('mods ', 'd')] + TELE_TODO + [(' · ◐ med', 'd')], 'c')], 'phone')

RULE = '─' * 188
def screen_idle(health_ok=True):
    """Between turns: the strip above the prompt carries what the status line did; the status line is gone."""
    strip = [(' ~/claude/mods  ', ''), ('ctx ', 'd'), ('██', 'g'), ('░░░░░░', 'd'), (' 17%  ', 'd'), ('   last turn  ', 'd'), (' tests · run 3 ', 'bg-g B'), (' all 3 pass ✓', ''), ('      still owed  ', 'd'), ('nothing ✓', 'g')]
    if not health_ok: strip += [('      ', ''), ('⚠ ponytail skill missing', 'r')]
    return [strip, [(RULE, 'd')], [('❯ ', '')], [(RULE, 'd')], [('  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents', 'd')]]

def screen_today():
    return [[(' ' + '·' * 60 + '  (cards / last-turn strip)', 'd')], [(RULE, 'd')], [('❯ ', '')], [(RULE, 'd')],
            [('  ~/claude/mods | ', ''), ('█▋········ 112k/1M 11%', 'g'), (' | ', ''), ('[PT ', 'c'), ('●', 'g'), (']', 'c'), (' ', ''), ('[ADHD-CM ', 'm'), ('●', 'g'), (']', 'm'), ('   ← status line', 'd')],
            [('  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents', 'd')]]

if __name__ == '__main__':
    out = {
        'wideA': to_html(wide17(4, 'A')), 'wideB': to_html(wide17(4, 'B')),
        'shortA': to_html(wide17(3, 'A')),
        'nineA': to_html(wide17(4, 'A', NINE)), 'nineB': to_html(wide17(4, 'B', NINE)),
        'mid': to_html(mid17(4)), 'phone': to_html(phone17()),
        'idle': to_html(screen_idle()), 'idleBad': to_html(screen_idle(False)[:1]), 'statusToday': to_html(screen_today()),
    }
    json.dump(out, open(sys.argv[1], 'w'))
    print('ok', {k: v.count('\n') + 1 for k, v in out.items()})
