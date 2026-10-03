"""Round-18 mockups: the prompt-cache countdown in the between-turns strip, the /xray panel table, the toast.
Reuses mockup.py's measured helpers; every multi-line mockup is width-checked. Output: JSON {name: html}."""
import json, sys
from mockup import W, pad, to_html, check

RULE = '─' * 188
FOLDER = [(' 🖥 ', ''), ('~/claude/mods  ', '')]
CTX = [('ctx ', 'd'), ('█▍', 'g'), ('░░░░░░', 'd'), (' 17%', 'd')]
LAST = [('   last turn ', 'd'), (' tests · run 3 ', 'bg-g B'), (' all 3 pass ✓', ''), ('   still owed ', 'd'), ('nothing ✓', 'g')]

def gauge(frac, hue, cells=8, eighths=True):
    """Draining bar on the ctx gauge's ░ track; eighth glyphs on desktop, whole cells on the phone."""
    full = frac * cells
    n = int(full)
    part = '' if not eighths else ' ▏▎▍▌▋▊▉'[int((full - n) * 8)].strip()
    track = cells - n - (1 if part else 0)
    return [('█' * n + part, hue), ('░' * track, 'd')]

# state → (desktop bar variant, desktop words variant, phone short form)
STATES = {
    'warm':  dict(bar=[('cache 1h ', 'd')] + gauge(47 / 60, 'c') + [(' 47m', '')],
                  words=[('cache ', 'd'), ('47m left', '')],
                  phone=[('⏱47m', 'd')]),
    'warn':  dict(bar=[('cache 1h ', 'd')] + gauge(4.2 / 60, 'y') + [(' 4:12', 'y')],
                  words=[('cache ', 'd'), ('4:12 left', 'y')],
                  phone=[('⏱4:12', 'y')]),
    'five':  dict(bar=[('cache 5m ', 'd')] + gauge(2.5 / 5, 'c') + [(' 2:31', '')],
                  words=[('cache ', 'd'), ('2:31 left', ''), (' (5 min)', 'd')],
                  phone=[('⏱2:31', 'd')]),
    'gone':  dict(bar=[(' cache lapsed ', 'bg-r B'), (' next message rewrites 151k', 'r')],
                  words=[(' cache lapsed ', 'bg-r B'), (' next message rewrites 151k', 'r')],
                  phone=[(' lapsed 151k ', 'bg-r B')]),
}

def desk(state, style):
    return FOLDER + CTX + [('  ', '')] + STATES[state][style] + LAST

def screen(state, style):
    return [desk(state, style), [(RULE, 'd')], [('❯ ', '')], [(RULE, 'd')], [('  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents', 'd')]]

PH_LAST = [('  ', ''), (' tests · run 3 ', 'bg-g B'), (' all 3 pass ✓', '')]
def phone(state, always):
    """44 cols. Today: '📱 mods 17%   last turn  tests · run 3  all 3 pass ✓' already cut; 'last turn' drops here."""
    base = [(' 📱 ', ''), ('mods ', ''), ('17%', 'd')]
    show = always or state in ('warn', 'gone')
    seg = [(' ', '')] + STATES[state]['phone'] if show else []
    line = base + seg + PH_LAST
    cut = []
    for t, c in line:  # truncate-end at 44, as Ink does
        room = 43 - W(cut)  # 📱 draws 2 columns
        if room <= 0: break
        cut.append((t[:room - 1] + '…' if len(t) > room else t, c))
    return check([pad(cut, 43)], "phone")

def panel(cols=96):
    rows = [
        ('#14', '151k', 1.00, '1.2k', '300', '99%', '', 'c'),
        ('#13', '149k', 0.99, '0.9k', '210', '99%', '', 'c'),
        ('#12', '0', 0.0, '150k', '300', '0%', 'lapsed · idle 1h 12m', 'r'),
        ('#11', '147k', 0.98, '2.4k', '180', '98%', '', 'c'),
        ('#10', '61k', 0.41, '88k', '250', '41%', 'prefix changed · model sonnet → opus', 'y'),
    ]
    out = [[('── cache · 1h ', 'd'), ('· lapses 14:47, in 47m ', ''), ('─' * (cols - 37), 'd')],
           [('turn  read  ', 'd'), ('hit      ', 'd'), ('      wrote   new  why it missed', 'd')]]
    for n, rd, hit, wr, new, pct, why, hue in rows:
        line = [(n.ljust(4), 'd'), (rd.rjust(6) + '  ', '')] + gauge(hit, hue) + [(pct.rjust(5), hue if hue != 'c' else ''), (wr.rjust(7), ''), (new.rjust(6), 'd'), ('  ' + why, hue if why else '')]
        out.append(line)
    out.append([('15 turns this session · 2 missed · 238k rewritten at 2× input price', 'd')])
    return check([pad(l, cols) for l in out], 'panel')

def toast():
    return [[(' xray ', 'bg-y B'), (' cache lapses in 5 min · after that the next message rewrites 151k at 2× input price', '')]]

if __name__ == '__main__':
    out = {}
    for st in STATES:
        for style in ('bar', 'words'):
            out[f'{style}_{st}'] = to_html([desk(st, style)])
    out['screen_bar'] = to_html(screen('warm', 'bar'))
    for st in ('warm', 'warn', 'gone'):
        out[f'ph_always_{st}'] = to_html(phone(st, True))
        out[f'ph_quiet_{st}'] = to_html(phone(st, False))
    out['panel'] = to_html(panel())
    out['toast'] = to_html(toast())
    json.dump(out, open(sys.argv[1], 'w'))
    print('ok', {k: v.count('\n') + 1 for k, v in out.items()})
