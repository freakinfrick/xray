"""Round 21b: layouts drawn from the taste probe. Two variants differ only in grouping (one card + divider
vs two cards). Every line measured."""
import json, sys
sys.path.insert(0, '~/claude/mods/xray/tools')
from mockup import W, pad, to_html, check, hjoin

TODOS = [('done', 'Read sum.js'), ('live', 'Read the test'), ('todo', 'Fix the off-by-one bug'), ('todo', 'Run node --test')]
GEN_W = [('(', 'd'), ('▌▌', 'b'), ('▌', 'c'), (')', 'd'), ('[', 'd'), ('▌▌▌', 'b'), ('▌', 'y'), ('▌', 'c')]
GEN_I = [('(', 'd'), ('▌▌', 'b'), ('▌', 'c'), (')', 'd'), ('[', 'd'), ('▌▌▌', 'b'), ('▌', 'y'), ('▌', 'c'), ('▌▌', 'b'), ('▌', 'm'), ('▌', 'g'), (']', 'd')]

def words(text, width, rows):
    out, cur = [], ''
    for w in text.split():
        if cur and len(cur) + 1 + len(w) > width: out.append(cur); cur = w
        else: cur = f'{cur} {w}' if cur else w
    out.append(cur)
    if len(out) > rows: out = out[:rows]; out[-1] = out[-1][:width - 1] + '…'
    return out

def cell(i, state, name, w, rows):
    """Today's cell: live and pending are filled blocks (whole cell painted, so columns never shift)."""
    mark = {'done': '■', 'live': '◆', 'todo': '□'}[state]
    lead = f'{mark} {i} '
    text = words(name, w - 2 - len(lead), rows)
    out = []
    for r in range(rows):
        left = lead if r == 0 else ' ' * len(lead)
        t = text[r] if r < len(text) else ''
        rest = ' ' * (w - 1 - len(left) - len(t))
        if state == 'live': out.append([(' ' + left + t + rest, 'B bg-y')])
        elif state == 'todo': out.append([(' ' + left + t + rest, 'B bg-pend')])
        else: out.append([(' ' + left, 'g')] + ([(t, 'S')] if t else []) + [(rest, '')])
    return out

def cells(inner, rows, cmax=24):
    n = len(TODOS)
    w = min(cmax, (inner - (n - 1)) // n)
    cs = [cell(i + 1, s, t, w, rows) for i, (s, t) in enumerate(TODOS)]
    return [pad([s for k, c in enumerate(cs) for s in (([(' ', '')] if k else []) + c[r])], inner) for r in range(rows)]

SQ = [('■', 'g'), ('◆', 'y'), ('□', 'd'), ('□', 'd')]

def frame(w, title, body, heavy=False, b='d'):
    tl, tr, bl, br, h, v = ('┏', '┓', '┗', '┛', '━', '┃') if heavy else ('╭', '╮', '╰', '╯', '─', '│')
    top = [(tl + h + ' ', b)] + title + [(' ', '')] if title else [(tl, b)]
    top = top + [(h * (w - 1 - W(top)), b), (tr, b)]
    rows = []
    for l in body:
        if l == 'DIV': rows.append([(v, b), ('┄' * (w - 2), 'd'), (v, b)])
        else: rows.append([(v, b), (' ', '')] + pad(l, w - 4) + [(' ', ''), (v, b)])
    return [top] + rows + [[(bl + h * (w - 2) + br, b)]]

def todo_title(b='y'): return [('to-do ', b)] + SQ + [(' 2/4', '')]

FACTS = [[('read ', 'd'), ('sum.js', ''), ('  → ', 'd'), ('reduce starts at 1', 'y')],
         [('now  ', 'd'), ('sum.test.js', ''), ('  · ', 'd'), ('step 11', 'd'), ('  · ', 'd'), ('◐ med', 'y')]]
FACTS_FAIL = [[('ran  ', 'd'), ('node --test', ''), ('  → ', 'd'), ('1 of 1 fail', 'r')],
              [('now  ', 'd'), ('sum.js', ''), ('  · ', 'd'), ('expected 3, got 4', 'r')]]
def gauges(short=False):
    g = [[('ctx ', 'd'), ('█▍', 'g'), ('░░░░░░', 'd'), (' 17%', '')],
         [('cache ', 'd'), ('███████▉', 'g'), (' 58m', '')],
         [('tok/s ', 'd'), ('▂▄▁█', 'c'), (' 148', '')],
         [('turn ', 'd'), ('12s', '')]]
    if short: g = [[('ctx ', 'd'), ('█▍░░', 'g'), (' 17%', '')], [('cache ', 'd'), ('58m', '')], [('12s', '')]]
    out = []
    for i, x in enumerate(g): out += ([(' · ', 'd')] if i else []) + x
    return out

def genome_row(cols, gen=GEN_W):
    l = gen + [('  genome', 'd')]
    return [(' ' * (cols - W(l)), '')] + l

def v_wide(variant, cols=190, fail=False):
    rows = 4
    tw = 4 * 24 + 3 + 4
    rw = cols - tw - 1
    tb = 'y'
    nb = 'r' if fail else 'd'
    todo = frame(tw, todo_title(tb), cells(tw - 4, rows), heavy=True, b=tb)
    facts = FACTS_FAIL if fail else FACTS
    if variant == 1:
        right = frame(rw, [('now', nb)], facts + ['DIV', gauges()], b=nb)
    else:
        a = frame(rw, [('now', 'd')], facts + [[]])
        right = None
    if variant == 1:
        lines = hjoin([todo, right])
    else:
        gw = 30; fw = rw - gw - 1
        a = frame(fw, [('now', nb)], facts + [[], []], b=nb)
        g = gauges().copy()
        gl = [[('ctx   ', 'd'), ('█▍', 'g'), ('░░░░░░', 'd'), (' 17%', '')], [('cache ', 'd'), ('███████▉', 'g'), (' 58m', '')], [('tok/s ', 'd'), ('▂▄▁█', 'c'), (' 148', '')], [('turn  ', 'd'), ('12s', '')]]
        b = frame(gw, [], gl)
        lines = hjoin([todo, a, b])
    return check(lines + [genome_row(cols)], f'v{variant}w')

def v_mid(variant, cols=120):
    rows = 4
    tw = 4 * 17 + 3 + 4
    rw = cols - tw - 1
    todo = frame(tw, todo_title(), cells(tw - 4, rows, 17), heavy=True, b='y')
    f2 = [[('read ', 'd'), ('sum.js', '')], [('  → ', 'd'), ('reduce starts at 1', 'y')], [('now  ', 'd'), ('sum.test.js', '')]]
    if variant == 1:
        right = frame(rw, [('now', 'd')], f2[:2] + ['DIV', [('ctx ', 'd'), ('█▍░░', 'g'), (' 17%', ''), (' · cache ', 'd'), ('58m', '')]])
        lines = hjoin([todo, right])
        return check(lines + [genome_row(cols)], 'v1m')
    a = frame(rw, [('now', 'd')], f2 + [[]])
    g = frame(cols, [], [gauges()])
    return check(hjoin([todo, a]) + g + [genome_row(cols)], 'v2m')

def v_phone(variant, cols=44):
    w = cols - 3
    live = [(' ◆ 2 Read the test' + ' ' * (w - 4 - 18), 'B bg-y')]
    body = [live, [('read ', 'd'), ('sum.js', ''), (' → ', 'd'), ('starts at 1', 'y')]]
    if variant == 1:
        c = frame(w, todo_title(), body + ['DIV', gauges(True)], heavy=True, b='y')
        return check([pad(l, w) for l in c], 'v1p')
    c = frame(w, todo_title(), body, heavy=True, b='y')
    g = frame(w, [], [gauges(True)])
    return check([pad(l, w) for l in c + g], 'v2p')

def idle(cols):
    if cols < 60:
        return [pad([(' ctx ', 'd'), ('█▌░░', 'g'), (' 18%', ''), (' · cache ', 'd'), ('60m', ''), (' · owed ', 'd'), ('0 ✓', 'g')], cols)]
    left = [(' ctx ', 'd'), ('█▌', 'g'), ('░░░░░░', 'd'), (' 18%', ''), (' · cache ', 'd'), ('████████', 'g'), (' 60m', ''), (' · still owed ', 'd'), ('nothing ✓', 'g')]
    r = GEN_I + [('  genome', 'd')]
    return [left + [(' ' * (cols - W(left) - W(r)), '')] + r]

if __name__ == '__main__':
    out = {}
    for v in (1, 2):
        out[f'{v}W'] = v_wide(v); out[f'{v}F'] = v_wide(v, fail=True); out[f'{v}M'] = v_mid(v); out[f'{v}P'] = v_phone(v)
    out['iW'], out['iM'], out['iP'] = idle(190), idle(120), idle(44)
    print({k: sorted({W(l) for l in v}) for k, v in out.items()})
    json.dump({k: to_html(v) for k, v in out.items()}, open(sys.argv[1], 'w'))
