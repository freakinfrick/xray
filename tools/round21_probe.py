"""Round 21 taste probe: pairs that differ on ONE visual idea each, same content. Every line measured."""
import json, sys, html
sys.path.insert(0, '~/claude/mods/xray/tools')
from mockup import W, pad, wrap, to_html

SW = 54  # swatch width

def box(lines, w=SW, b='d', corners='╭╮╰╯', h='─', v='│', title=None, tc=None):
    tl, tr, bl, br = corners
    top = [(tl + h, b)] + ([(' ' + title + ' ', tc or b)] if title else [])
    top = top + [(h * (w - 1 - W(top)), b), (tr, b)]
    out = [top] + [[(v, b), (' ', '')] + pad(l, w - 4) + [(' ', ''), (v, b)] for l in lines]
    return out + [[(bl + h * (w - 2) + br, b)]]

def bare(lines, w=SW):
    return [pad(l, w) for l in lines]

def fit(lines, w=SW):
    for l in lines:
        assert W(l) <= w, (W(l), l)
    return [pad(l, w) for l in lines]

TD = [('done', 'Read sum.js'), ('live', 'Read the test'), ('todo', 'Fix the bug'), ('todo', 'Run tests')]

def todo_rows(style='patch', palette='rich'):
    hue = {'done': 'g', 'live': 'y', 'todo': 'd'} if palette == 'rich' else {'done': 'd', 'live': 'c', 'todo': 'd'}
    out = []
    for i, (s, t) in enumerate(TD, 1):
        if s == 'live' and style == 'patch':
            out.append([(f' ◆ {i} {t} ', f'B bg-{hue[s]}')])
        else:
            m = {'done': '■', 'live': '◆', 'todo': '□'}[s]
            out.append([(m + ' ', hue[s]), (f'{i} {t}', 'S' if s == 'done' else hue[s])])
    return out

CTXBAR = [('ctx   ', 'd'), ('██', 'g'), ('░░░░░░', 'd'), (' 17%', '')]
CACHEBAR = [('cache ', 'd'), ('███████▉', 'g'), (' 58m', '')]
NARR = 'The reduce starts at 1, so every sum is one high.'

PAIRS = []
def pair(axis, q, left, right, lname, rname):
    PAIRS.append({'axis': axis, 'q': q, 'L': to_html(fit(left)), 'R': to_html(fit(right)), 'ln': lname, 'rn': rname})

# 1 frame vs none
pair('frame', 'Same to-dos. Which reads faster?',
     box(todo_rows(), title='to-do'), bare([[('to-do', 'd')]] + todo_rows() + [[]]), 'framed', 'bare')
# 2 patch vs coloured text
pair('highlight', 'How should the live item stand out?',
     box(todo_rows('patch')), box(todo_rows('text')), 'colour patch (block)', 'coloured text')
# 3 corner weight
pair('corners', 'Frame weight?',
     box(todo_rows(), corners='╭╮╰╯'), box(todo_rows(), corners='┏┓┗┛', h='━', v='┃'), 'thin rounded', 'heavy square')
# 4 density
pair('density', 'Same facts. Which do you prefer?',
     box([[('ctx ', 'd'), ('17%', ''), (' · cache ', 'd'), ('58m', ''), (' · tok/s ', 'd'), ('148', ''), (' · 12s', 'd')], todo_rows()[1]]),
     box([CTXBAR, [], CACHEBAR, [], todo_rows()[1]]), 'packed', 'airy')
# 5 bars vs numbers
pair('gauges', 'Gauges as…',
     box([CTXBAR, CACHEBAR, [('tok/s ', 'd'), ('▂▄▁█▆', 'c'), (' 148', '')]]),
     box([[('ctx   ', 'd'), ('17%', '')], [('cache ', 'd'), ('58m', '')], [('tok/s ', 'd'), ('148', '')]]), 'bars + numbers', 'numbers only')
# 6 labels vs glyphs
pair('labels', 'Labels…',
     box([[('ctx ', 'd'), ('17%', ''), ('   cache ', 'd'), ('58m', ''), ('   turn ', 'd'), ('12s', '')]]),
     box([[('◔ ', 'c'), ('17%', ''), ('   ⧗ ', 'c'), ('58m', ''), ('   ⏱ ', 'c'), ('12s', '')]]), 'words', 'glyphs')
# 7 palette
pair('palette', 'Colour budget?',
     box(todo_rows(palette='rich') + [[('ctx ', 'd'), ('██', 'g'), ('░░░░░░', 'd'), ('  tok/s ', 'd'), ('▂▄█', 'm')]]),
     box(todo_rows(palette='mono') + [[('ctx ', 'd'), ('██', 'c'), ('░░░░░░', 'd'), ('  tok/s ', 'd'), ('▂▄█', 'd')]]), 'many hues', 'one accent + greys')
# 8 many cards vs one sectioned
def small(t, rows, w): return box(rows, w, title=t)
def hj(a, b):
    n = max(len(a), len(b)); a += [[(' ' * W(a[0]), '')]] * (n - len(a)); b += [[(' ' * W(b[0]), '')]] * (n - len(b))
    return [x + [(' ', '')] + y for x, y in zip(a, b)]
pair('grouping', 'Two things to show. How?',
     hj(small('to-do', todo_rows()[:2], 27), small('gauges', [CTXBAR[:1] + [('17%', '')], [('cache ', 'd'), ('58m', '')]], 26)),
     box(todo_rows()[:2] + [[('┄' * (SW - 4), 'd')]] + [[('ctx ', 'd'), ('17%', ''), ('   cache ', 'd'), ('58m', '')]]), 'separate cards', 'one card, divider')
# 9 grid vs flow
pair('alignment', 'Figures laid out…',
     box([[('ctx   ', 'd'), ('17%', ''), ('    turn  ', 'd'), ('12s', '')], [('cache ', 'd'), ('58m', ''), ('    steps ', 'd'), ('10', '')]]),
     box([[('ctx ', 'd'), ('17%', ''), (' · cache ', 'd'), ('58m', ''), (' · turn ', 'd'), ('12s', ''), (' · steps ', 'd'), ('10', '')]]), 'aligned grid', 'inline flow')
# 10 literal vs symbolic
pair('literal', 'Where are we?',
     box([[('Reading the test', 'y'), (' — step 2 of 4', 'd')]]), box([[('■', 'g'), ('◆', 'y'), ('□□', 'd'), ('  2/4', '')]]), 'words', 'symbols')
# 11 narration vs facts
pair('voice', 'What is Claude doing?',
     box(wrap('» ' + NARR + ' Checking the test before the edit.', SW - 4, '')),
     box([[('read ', 'd'), ('sum.js', ''), ('  → ', 'd'), ('reduce init 1', 'y')], [('next ', 'd'), ('sum.test.js', '')]]), 'prose', 'terse facts')
# 12 state in border vs in patch
pair('state', 'A test just failed. Where should that show?',
     box(todo_rows()[2:], b='r', title='tests 0/1', tc='r'), box([[(' ✕ tests 0/1 ', 'B bg-r')]] + todo_rows()[2:]), 'border turns red', 'red patch inside')
# 13 primary weight
pair('emphasis', 'The main card vs the others',
     hj(box(todo_rows()[:2], 27, b='y', corners='┏┓┗┛', h='━', v='┃'), box([[('ctx ', 'd'), ('17%', '')], [('cache ', 'd'), ('58m', '')]], 26)),
     hj(box(todo_rows()[:2], 27), box([[('ctx ', 'd'), ('17%', '')], [('cache ', 'd'), ('58m', '')]], 26)), 'main card heavier', 'all equal')
# 14 filled panel vs outline
pair('fill', 'Card surface',
     [[(' ' * SW, 'bg-panel')]] + [[(' ', 'bg-panel')] + [(t, c + ' bg-panel') for t, c in pad(r, SW - 2)] + [(' ', 'bg-panel')] for r in todo_rows('text')] + [[(' ' * SW, 'bg-panel')]],
     box(todo_rows('text')), 'filled block', 'outline')
# 15 title in edge vs header row
pair('titles', 'Card titles',
     box(todo_rows()[:2], title='to-do 1/4'), box([[(' TO-DO ', 'B bg-d'), (' 1/4', 'd')]] + todo_rows()[:2]), 'in the border', 'tab inside')

json.dump(PAIRS, open(sys.argv[1], 'w'))
print(len(PAIRS), 'pairs')
