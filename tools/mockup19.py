"""Round-19 mockups: character as a live factory (OP-1 ethos), three directions + moments + idle.
Reuses mockup.py's measured helpers; every multi-line mockup is width-checked. Output: JSON {name: html}.
Scenario = the live check's turn (rounds 15-18): fixing sum/mul, test run 2, editing mul, 14 s in.
Every figure drawn is a measured value xray already has (or names the one new measure it needs)."""
import json, sys
from mockup import W, pad, card, closed, tray, hjoin, check, to_html, spaced

def fit(line, n, name='row'):
    if W(line) > n: sys.exit(f'{name}: {W(line)} > {n}: ' + ''.join(t for t, _ in line))
    return pad(line, n)

def cat(*parts):
    out = []
    for p in parts: out += p
    return out

def gap(n): return [(' ' * n, '')]

TELE = [('turn 14s · ◐ med', 'd')]
CTX = [('ctx ', 'd'), ('██', 'g'), ('░░░░░░', 'd'), (' 17%', 'd')]
TOK = [('tok/s ', 'd'), ('▁█▇▂▃', 'c'), (' 159', 'd')]
CACHE = [('cache ', 'd'), ('47m left', 'd')]

# ── A · Floor: the turn as a plant floor. One machine per tool kind, a belt carrying each step in order,
# intake = pending to-dos, dock = done ones. KPIs in factory words, all measured.
def machine(label, hue, live, frame):
    """3 rows: a solid colour plate with the label, a count row, the base. The live one stamps (▀/▄)."""
    face = f' {label:<5}'
    piston = ('▀▀' if frame else '▄▄') if live else '  '
    return face, piston

STATIONS = [  # label, hue, steps, seconds, fails, live
    ('read', 'b', 3, '4.1s', 0, False),
    ('edit', 'm', 2, '6.0s', 0, True),
    ('run', 'y', 3, '1.2s', 1, False),
    ('qc', 'g', 2, '2/3', 0, False),
]

def floor_body(frame, w):
    # Stations are two-row solid plates (OP-1: flat colour shapes); the belt runs under them carrying
    # every step in order, crates ▪ drifting one cell per tick. Live plate carries ◆ and a stamping piston.
    def belt(n, off):
        return [(''.join('▪' if (k + off) % 4 == 0 else '═' for k in range(n)), 'd')]
    PW, BW = 11, 9
    r1 = [('intake       ', 'd')]
    r2 = [('□ re-run     ', 'd')]
    r3 = [('◆ fix mul ▸ ', 'y')]
    for i, (lab, hue, n, secs, fails, live) in enumerate(STATIONS):
        lead = 0 if i == 0 else BW
        top = (' ◆ ' if live else '   ') + lab.upper()
        r1 += gap(lead) + [(f'{top:<{PW}}', f'bg-{hue} B')] + ([('▀▀' if frame else '▄▄', hue)] if live else gap(2))
        r2 += gap(lead) + [(f'   {n}' + (' ✕' if fails else ' ·') + f' {secs:<4}', f'bg-{hue} B')] + gap(2)
        r3 += (belt(BW, frame + i) if i else [('═', 'd')]) + [('▀' * PW, hue)] + [('══', 'd')]
    r1 += gap(BW) + [('dock', 'd')]
    r2 += gap(BW) + [('■', 'g'), ('■', 'm'), ('■', 'b'), (' 3 of 5', '')]
    r3 += belt(BW, frame + 9) + [('▶ shipped', 'd')]
    left = [r1, r2, r3]
    lw = max(W(x) for x in left)
    right = [
        [('model ', 'd'), ('██████████', 'c'), ('████', 'y'), ('  72% thinking · 28% tools', 'd')],
        [('cycle ', 'd'), ('1.6 s a step', ''), ('    yield ', 'd'), ('9 of 10', ''), (' ok', 'd')],
        [('wip   ', 'd'), ('1 at edit', ''), ('       queue ', 'd'), ('2 to-dos', '')],
    ]
    rows = subcols_fixed(left, right, lw, 10)
    return [fit(r, w, 'floor') for r in rows]

def subcols_fixed(left, right, wl, g):
    return [pad(left[i], wl) + gap(g) + right[i] for i in range(len(left))]

def floor(frame, cols=188):
    w = cols
    head = [('', ''), (' ◆ focused ', 'bg-c B'), (' line 2 · editing sum.js · 14s ', ''), ('▄' if frame else '▂', 'c'), (' ', '')]
    body = spaced([[ [] ], floor_body(frame, w - 4)], 4)[1:]
    c = card(w, head, [[]] + body, 4, 'c')
    edge = closed(w, TELE + [('   ', '')] + CTX + [('   ', '')] + TOK + [('   ', '')] + CACHE, 'c')
    return check(c + [edge], f'floor{frame}')

def floor_phone(frame, cols=44):
    w = cols - 3
    head = [('', ''), (' ◆ focused ', 'bg-c B'), (' editing · 14s ', ''), ('▄' if frame else '▂', 'c'), (' ', '')]
    belt = lambda n, o: [(''.join('▪' if (k + o) % 4 == 0 else '═' for k in range(n)), 'd')]
    r1 = cat([(' R ', 'bg-b B')], belt(3, frame), [(' E ', 'bg-m B')], belt(3, frame + 1), [(' T ', 'bg-y B')], belt(3, frame + 2), [(' Q ', 'bg-g B')], belt(3, frame + 3), [('■■■', 'g'), ('□□', 'd')])
    r2 = [(' 3   ', 'd'), (' 2◆', 'm'), ('    ', ''), (' 3✕', 'r'), ('   ', ''), ('2/3', 'g'), ('    ', ''), ('3/5', '')]
    r3 = [('model ', 'd'), ('█████', 'c'), ('██', 'y'), (' 72% think · yield 9/10', 'd')]
    c = card(w, head, [fit(r1, w - 4), fit(r2, w - 4), fit(r3, w - 4)], 3, 'c')
    return check(c + [closed(w, CTX + [(' · ◐ med', 'd')], 'c')], f'floorP{frame}')

# ── B · Deck: the OP-1 face. Four coloured encoders own four values everywhere (blue ctx, green tok/s,
# white steps, orange cache); a tape screen plays the turn: reels spin with tokens, the tape is the
# filmstrip, the playhead is now.
KNOB = {0: ('▗▄▖', '▝▀▘'), 1: ('▗▀▖', '▝▀▘'), 2: ('▗▀▖', '▝▄▘'), 3: ('▗▄▖', '▝▄▘')}
REEL = [('▞▚', '▚▞'), ('▚▞', '▞▚')]
TAPE = [('▌', 'b'), ('▌', 'b'), ('█', 'm'), ('█', 'r'), ('█', 'y'), ('█', 'm'), ('█', 'r'), ('▌', 'b'), ('█', 'y')]

def deck_body(frame, w):
    rl = REEL[frame % 2]
    rr = REEL[(frame + 1) % 2]
    tape_rest = 96
    played = W(TAPE)
    screen = [
        [('  ', ''), (rl[0], 'p'), ('▔' * 4, 'd')] + TAPE + [('◆', 'c')] + [('·' * (tape_rest - played - 1), 'd')] + [('▔' * 4, 'd'), (rr[0], 'p')],
        [('  ', ''), (rl[1], 'p'), ('    ', '')] + [('read', 'b'), (' · ', 'd'), ('edit', 'm'), (' · ', 'd'), ('run', 'y'), (' · ', 'd'), ('fail', 'r'), (' ', ''), ('▸ 14s rolling', 'd')] + gap(tape_rest - 32 - 1) + [('    ', ''), (rr[1], 'p')],
        [('  ', ''), ('side A · fix sum + mul', 'd')],
    ]
    sw = max(W(x) for x in screen)
    knobs = [('ctx', 'b', 0, '17%'), ('tok/s', 'g', 3, '159'), ('steps', '', 2, '10'), ('cache', 'p', 3, '47m')]
    k1, k2, k3 = [], [], []
    for lab, hue, q, val in knobs:
        a, b = KNOB[q]
        k1 += [(a, hue)] + gap(9)
        k2 += [(b, hue)] + gap(9)
        k3 += [(f'{lab:<12}', 'd')]
    k1b = [(f'{v:<12}', hue or '') for _, hue, _, v in knobs]
    knob_rows = [[], k1, k2, cat(k3)]
    rows = []
    for i in range(3):
        rows.append(pad(screen[i], sw) + gap(16) + (k1 if i == 0 else k2 if i == 1 else k1b))
    rows.append(pad([], sw) + gap(16) + k3)
    return [fit(r, w, 'deck') for r in rows]

def deck(frame, cols=188):
    head = [('', ''), (' ▶ rec ', 'bg-p B'), (' side A · editing sum.js · 14s ', ''), (' ', '')]
    c = card(cols, head, deck_body(frame, cols - 4), 4, 'p')
    todos = [('■', 'g'), (' run tests  ', 'd'), ('■', 'm'), (' fix sum  ', 'd'), ('■', 'b'), (' re-run  ', 'd'), ('◆', 'y'), (' fix mul  ', 'y'), ('□', 'd'), (' re-run', 'd')]
    edge = closed(cols, [('tracks ', 'd')] + todos + [('   ', ''), ('◐ med', 'd')], 'p')
    return check(c + [edge], f'deck{frame}')

def deck_phone(frame, cols=44):
    w = cols - 3
    rl, rr = REEL[frame % 2], REEL[(frame + 1) % 2]
    r1 = [(rl[0], 'p'), ('▔', 'd')] + TAPE + [('◆', 'c'), ('·' * 11, 'd'), ('▔', 'd'), (rr[0], 'p'), ('  ', ''), ('▗▄▖', 'b'), (' ', ''), ('▗▄▖', 'g')]
    r2 = [(rl[1], 'p'), (' 14s · 10 steps', 'd'), ('         ', ''), (rr[1], 'p'), ('  ', ''), ('▝▀▘', 'b'), (' ', ''), ('▝▄▘', 'g')]
    r3 = [('■■■', 'g'), ('◆', 'y'), ('□', 'd'), (' fix mul', 'y'), (' ' * 13, ''), ('17%', 'b'), (' ', ''), ('159', 'g')]
    head = [('', ''), (' ▶ rec ', 'bg-p B'), (' editing · 14s ', ''), (' ', '')]
    c = card(w, head, [fit(r1, w - 4), fit(r2, w - 4), fit(r3, w - 4)], 3, 'p')
    return check(c + [closed(w, [('cache 47m · ◐ med', 'd')], 'p')], f'deckP{frame}')

# ── C · Crew: the same floor, staffed. A foreman (the model) whose face is the measured mood, and one
# worker per running tool or subagent, holding its tool. Faces are the only new shapes.
FACE = {'focused': '▐•_•▌', 'exploring': '▐o_o▌', 'stuck': '▐>_<▌', 'closing': '▐^‿^▌', 'thinking': '▐-_-▌'}

def crew_body(frame, w):
    boss = FACE['focused']
    worker = '▐•_•▌' if frame else '▐•_-▌'
    rows = [
        [('foreman ', 'd'), (boss, 'c'), ('  “mul next, same file.”', 'd')] + gap(8) + [('crew ', 'd'), (worker, 'm'), ('▀▄' if frame else '▄▀', 'm'), (' edit sum.js', 'm'), (' 6.0s', 'd')] + gap(6) + [('bench ', 'd'), ('▐-_-▌', 'b'), (' read ×3   ', 'd'), ('▐-_-▌', 'y'), (' run ×3 ', 'd'), ('1✕', 'r')],
        [],
        [('shift  ', 'd'), ('▌', 'b'), ('▌', 'b'), ('█', 'm'), ('█', 'r'), ('█', 'y'), ('█', 'm'), ('█', 'r'), ('▌', 'b'), ('█', 'y'), ('◆', 'c'), ('   10 steps · 9 ok', 'd')] + gap(12) + [('■', 'g'), (' run tests  ', 'd'), ('■', 'm'), (' fix sum  ', 'd'), ('■', 'b'), (' re-run  ', 'd'), ('◆', 'y'), (' fix mul  ', 'y'), ('□', 'd'), (' re-run', 'd')],
    ]
    return [fit(r, w, 'crew') for r in rows]

def crew(frame, cols=188):
    head = [('', ''), (' ▐•_•▌', 'c'), (' ', ''), (' focused ', 'bg-c B'), (' editing sum.js · 14s ', ''), (' ', '')]
    c = card(cols, head, crew_body(frame, cols - 4), 4, 'c')
    edge = closed(cols, TELE + [('   ', '')] + CTX + [('   ', '')] + TOK + [('   ', '')] + CACHE, 'c')
    return check(c + [edge], f'crew{frame}')

def crew_phone(frame, cols=44):
    w = cols - 3
    worker = '▐•_•▌' if frame else '▐•_-▌'
    r1 = [('▐•_•▌', 'c'), (' → ', 'd'), (worker, 'm'), ('▀▄' if frame else '▄▀', 'm'), (' edit sum.js', 'm')]
    r2 = [('▌▌█', 'b'), ('█', 'r'), ('█', 'y'), ('█', 'm'), ('█', 'r'), ('▌█', 'b'), ('◆', 'c'), ('  ', ''), ('■■■', 'g'), ('◆', 'y'), ('□', 'd'), (' fix mul', 'y')]
    head = [('', ''), (' ▐•_•▌', 'c'), (' ', ''), (' focused ', 'bg-c B'), (' 14s ', ''), (' ', '')]
    c = card(w, head, [fit(r1, w - 4), fit(r2, w - 4)], 3, 'c')
    return check(c + [closed(w, CTX + [(' · ◐ med', 'd')], 'c')], f'crewP{frame}')

# ── Moments: one-shot beats on real edges, ~500 ms burst then the card settles (round 16's burst rule).
def moment(name, frame, cols=92):
    w = cols
    if name == 'ship':  # to-do list closed
        truck = [('▐██████', 'g'), ('▙▄', 'g')] if frame else [('▐██████', 'g'), ('▙▄', 'g')]
        off = 4 if frame else 0
        r1 = gap(off) + [('▐▀▀▀▀▀▀', 'g'), ('▙▖', 'g')] + gap(4) + [(' SHIPPED ', 'bg-g B'), (' 5 of 5 to-dos · 4m 10s · 2 red runs on the way', 'd')]
        r2 = gap(off) + [(' ▀▘  ▀▘', 'g'), ('  ', '')] + (gap(2) + [('· ·', 'd')] if frame else gap(5))
        head = [('─ ', 'g'), ('dock', 'g'), (' ', '')]
        body = [fit(r1, w - 4), fit(r2, w - 4)]
        b = 'g'
    elif name == 'qc':  # tests red → green
        r1 = [(' ✓ PASS ', 'bg-g B') if frame else (' ✓ PASS ', 'g'), ('  3 of 3', ''), ('   after ', 'd'), ('▃▆', 'r'), ('█', 'g'), ('  red, red, green', 'd')]
        r2 = [('stamped run 3 · suite 0.4 s, same as usual', 'd')]
        head = [('─ ', 'g'), ('qc', 'g'), (' ', '')]
        body = [fit(r1, w - 4), fit(r2, w - 4)]
        b = 'g'
    elif name == 'stall':  # 30 s with nothing moving
        z = [('  z', 'd'), (' Z', 'd')] if frame else [(' z ', 'd'), ('   ', '')]
        r1 = [(' EDIT  ', 'bg-m B')] + z + [('   line idle 34s', 'y'), (' · last thing: waiting on the model', 'd')]
        r2 = [('▔▔▔▔▔▔▔', 'd'), ('   belt stopped; no request for 34 s', 'd')]
        head = [('─ ', 'y'), ('line', 'y'), (' ', '')]
        body = [fit(r1, w - 4), fit(r2, w - 4)]
        b = 'y'
    else:  # clean: first run green, no fails all turn
        sp = [('✦', 'y'), (' ', ''), ('✧', 'c')] if frame else [('✧', 'c'), (' ', ''), ('✦', 'y')]
        r1 = sp + [('  CLEAN RUN ', 'bg-y B'), ('  green first try · 0 fails this turn', 'd')]
        r2 = [('best streak in this repo: 4 turns (memory)', 'd')]
        head = [('─ ', 'y'), ('qc', 'y'), (' ', '')]
        body = [fit(r1, w - 4), fit(r2, w - 4)]
        b = 'y'
    c = card(w, head, body, 2, b)
    return check(c + [closed(w, [], b)], f'm-{name}{frame}')

# ── Idle: the plant between turns. Lights off, what's owed, cache as the boiler cooling.
def idle(kind):
    if kind == 'floor':
        return [[(' ▐▀▌ ', 'd'), (' closed ', 'bg-m B'), ('  shipped ', 'd'), ('■■■', 'g'), (' 3 of 5', ''), ('   owed ', 'd'), ('◆ fix mul  □ re-run', 'y'), ('   boiler cooling ', 'd'), ('47m', ''), (' (cache)', 'd'), ('   ctx ', 'd'), ('██', 'g'), ('░░░░░░', 'd'), (' 17%', 'd')]]
    if kind == 'deck':
        return [[(' ▞▚ ', 'p'), (' ■ stop ', 'bg-p B'), ('  side A, 14s, 10 steps', 'd'), ('   owed ', 'd'), ('◆ fix mul  □ re-run', 'y'), ('   tape holds ', 'd'), ('47m', ''), (' (cache)', 'd'), ('   ctx 17%', 'b')]]
    return [[(' ▐-_-▌ ', 'c'), (' off shift ', 'bg-c B'), ('  3 of 5 done', 'd'), ('   owed ', 'd'), ('◆ fix mul  □ re-run', 'y'), ('   lunch break ends in ', 'd'), ('47m', ''), (' (cache)', 'd'), ('   ctx 17%', 'd')]]

if __name__ == '__main__':
    out = {}
    for f in (0, 1):
        out[f'floor{f}'] = to_html(floor(f)); out[f'floorP{f}'] = to_html(floor_phone(f))
        out[f'deck{f}'] = to_html(deck(f)); out[f'deckP{f}'] = to_html(deck_phone(f))
        out[f'crew{f}'] = to_html(crew(f)); out[f'crewP{f}'] = to_html(crew_phone(f))
        for m in ('ship', 'qc', 'stall', 'clean'):
            out[f'm_{m}{f}'] = to_html(moment(m, f))
    for k in ('floor', 'deck', 'crew'):
        out[f'idle_{k}'] = to_html(idle(k))
    from mockup import wide
    out['today'] = to_html(wide(4))
    json.dump(out, open(sys.argv[1], 'w'))
    print('ok', len(out))
