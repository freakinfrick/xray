"""Print xray genomes as an image, one session per line, in xray's own palette (round 22).

Reads the archive (~/.claude/xray-genomes/*.json) by default, or a plugin store file with --store
(its `genome:<id>` records, the last 40 sessions only). Scripted runs (`claude -p`) are left out
unless --all. Needs Pillow (~/venv/bin/python).

  ~/venv/bin/python tools/genome_print.py -o /tmp/genomes.png
  ~/venv/bin/python tools/genome_print.py --since 2026-11-01 --size 1920x1080 -o g.png
"""
import argparse, datetime, glob, json, os, re, sys

from PIL import Image, ImageDraw, ImageFont

BG, INK, DIM = (14, 16, 20), (225, 228, 235), (110, 115, 125)
COL = {'r': (80, 130, 255), 'e': (240, 210, 60), 'c': (150, 70, 150), 's': (255, 95, 0), 'h': (0, 215, 175),
       'n': (175, 135, 255), 'w': (70, 72, 80), 't': (60, 200, 90), 'm': (255, 105, 180), 'k': (235, 60, 235),
       'a': (40, 210, 230), 'l': (255, 215, 175), 'p': (135, 175, 175), 'q': (255, 255, 255), 'o': (85, 88, 96),
       'x': (235, 50, 50), 'X': (255, 150, 0)}  # X: an x a hook blocked (archive `fails`)
KEY = [('r', 'read'), ('e', 'edit'), ('c', 'run'), ('s', 'script'), ('t', 'test'), ('k', 'commit'), ('m', 'memory'),
       ('n', 'network'), ('h', 'orchestrate'), ('a', 'agent'), ('l', 'skill'), ('p', 'mcp'), ('q', 'asked you'),
       ('w', 'wait'), ('o', 'other'), ('x', 'failed'), ('X', 'hook block')]
BR = {'looked': '()', 'changed': '[]', 'delegated': '{}'}
FONTS = [os.path.expanduser('~/.local/share/fonts/inter-mono/InterMono-SemiBold.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf']


def bracket(t):
    return 'delegated' if re.search('[ah]', t) else 'changed' if re.search('[emcsktx]', t) else 'looked'


def from_archive(paths, include_scripted):
    out = []
    for p in paths:
        try:
            a = json.load(open(p))
        except (OSError, ValueError):
            continue
        if not include_scripted and a.get('session', {}).get('isInteractive') is False:
            continue
        turns = []
        for t in a.get('turns', []):
            cells = list(t.get('letters', ''))
            for f in t.get('fails', []):
                if f.get('why') == 'hook' and 0 <= f.get('at', -1) < len(cells):
                    cells[f['at']] = 'X'
            turns.append(''.join(cells))
        out.append({'startedAt': a.get('session', {}).get('startedAt', 0), 'turns': turns})
    return out


def from_store(path):
    d = json.load(open(path))
    d = d.get('data', d)
    return [{'startedAt': v.get('startedAt', 0) if isinstance(v, dict) else 0, 'turns': v['turns'] if isinstance(v, dict) else v}
            for k, v in d.items() if k.startswith('genome:')]


def render(recs, size, out):
    W, H = size
    s = H / 2160  # everything scales from the 4K layout
    font = lambda px: next((ImageFont.truetype(f, max(8, int(px * s))) for f in FONTS if os.path.exists(f)), ImageFont.load_default())
    title, lab, leg = font(54), font(26), font(30)
    when = lambda ms: datetime.datetime.fromtimestamp(ms / 1000).strftime('%a %m-%d %H:%M') if ms else '?'
    X0, X1, Y0, Y1 = 420 * s, W - 60 * s, 150 * s, H - 130 * s
    row = (Y1 - Y0) / len(recs)
    units = max(sum(len(t) + 2.6 for t in r['turns']) for r in recs) or 1
    cw = min(22 * s, (X1 - X0) / units)
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    steps = sum(len(t) for r in recs for t in r['turns'])
    turns = sum(len(r['turns']) for r in recs)
    d.text((60 * s, 45 * s), 'xray genomes', font=title, fill=INK)
    d.text((W - 60 * s, 64 * s), '( ) looked  [ ] changed  { } delegated', font=leg, fill=DIM, anchor='ra')
    d.text((520 * s, 64 * s), f'{len(recs)} sessions · {turns} turns · {steps} steps · {when(recs[0]["startedAt"])} → {when(recs[-1]["startedAt"])}', font=leg, fill=DIM)
    ch = min(row * 0.62, 40 * s)
    for i, r in enumerate(recs):
        yc = Y0 + row * (i + 0.5)
        y0, y1 = yc - ch / 2, yc + ch / 2
        d.text((60 * s, yc), f'{when(r["startedAt"])}  {len(r["turns"]):>3}t', font=lab, fill=DIM, anchor='lm')
        x = X0
        for t in r['turns']:
            o, c = BR[bracket(t.replace('X', 'x'))]
            d.text((x, yc), o, font=lab, fill=DIM, anchor='lm')
            x += cw * 1.1
            for L in t:
                w = cw * (0.45 if L in 'xXw' else 0.82)
                d.rectangle([x, y0, x + w, y1], fill=COL.get(L, COL['o']))
                if L == 'k':
                    d.rectangle([x - 1, y0 - 4 * s, x + w + 1, y0], fill=(255, 255, 255))
                if L == 'm':
                    d.ellipse([x, y0 - 10 * s, x + w, y0 - 10 * s + w], fill=COL['m'])
                x += cw
            d.text((x, yc), c, font=lab, fill=DIM, anchor='lm')
            x += cw * 1.5
    lx, ly = 60 * s, H - 70 * s
    for L, name in KEY:
        d.rectangle([lx, ly - 15 * s, lx + 26 * s, ly + 15 * s], fill=COL[L])
        d.text((lx + 38 * s, ly), name, font=leg, fill=INK, anchor='lm')
        lx += 38 * s + d.textlength(name, font=leg) + 34 * s
    im.save(out)
    return len(recs)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('-o', '--out', required=True, help='PNG to write')
    ap.add_argument('--dir', default=os.path.expanduser('~/.claude/xray-genomes'), help='archive folder')
    ap.add_argument('--store', help='read a plugin store JSON instead of the archive')
    ap.add_argument('--since', help='only sessions started on or after YYYY-MM-DD')
    ap.add_argument('--last', type=int, help='only the newest N sessions')
    ap.add_argument('--size', default='3840x2160', help='WxH, default 4K')
    ap.add_argument('--all', action='store_true', help='include scripted (claude -p) runs')
    ap.add_argument('--keep-empty', action='store_true', help='keep sessions with no steps at all')
    a = ap.parse_args(argv)
    recs = from_store(a.store) if a.store else from_archive(sorted(glob.glob(os.path.join(a.dir, '*.json'))), a.all)
    if a.since:
        t0 = datetime.datetime.fromisoformat(a.since).timestamp() * 1000
        recs = [r for r in recs if r['startedAt'] >= t0]
    if not a.keep_empty:
        recs = [r for r in recs if any(r['turns'])]
    recs.sort(key=lambda r: r['startedAt'])
    if a.last:
        recs = recs[-a.last:]
    if not recs:
        sys.exit('no genomes to print')
    W, H = (int(v) for v in a.size.lower().split('x'))
    n = render(recs, (W, H), a.out)
    print(f'{a.out}: {n} sessions, {W}x{H}')


if __name__ == '__main__':
    main()
