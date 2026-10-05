"""Jungle water: rock-rimmed pond autotile (4-frame animation) and a 3x4 waterfall (4 frames)."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Anim, Canvas, autotile16, load_palette

FRAMES = 4


def water_name(x, y, f, seed=3):
    """Calm ripples. Fully periodic in x and y (period 32); shifts 8 px/frame so 4 frames loop."""
    xs = (x + 8 * f) % 32
    T = math.tau / 32.0
    band = math.sin(xs * T * 2 + 1.6 * math.sin(y * T * 2)) + 0.8 * math.sin(y * T * 4 + xs * T) + 0.6 * math.sin(xs * T * 3 - y * T * 2)
    if band > 1.9:
        return 'water3'
    if band > 1.0:
        return 'water2'
    if band < -1.9:
        return 'water0'
    return 'water1'


def pond_tiles(pal):
    # one autotile set per frame, then regroup per mask
    sets = []
    for f in range(FRAMES):
        sets.append(autotile16(lambda x, y, f=f: water_name(x, y, f), ['stone0', 'stone1', 'stone3', 'water2'], inset=5,
                               pal=pal, seed=11,
                               fringe=lambda x, y, k: ('moss2' if (x * 7 + y * 13) % 5 == 0 else None) if k == -1 else None))
    return sets


_POND = {}


def _pond(pal):
    if 'sets' not in _POND:
        _POND['sets'] = pond_tiles(pal)
    return _POND['sets']


def _mask_sprite(mask):
    def fn(pal, seed):
        sets = _pond(pal)
        frames = []
        for f in range(FRAMES):
            c = sets[f][mask].copy()
            # rock outline + a few sparkles
            c.outline()
            rr = c.rng
            for _ in range(3):
                x, y = rr.randint(6, 25), rr.randint(6, 25)
                if c.get(x, y) in ('water1', 'water2'):
                    c.put(x, y, 'foam') if (x + y + f) % 4 == 0 else None
            frames.append(c)
        return Anim(frames, fps=4)
    return fn


for _m in range(16):
    sprite(f'jungle.pond{_m}', note='pond autotile mask %d (N=1 E=2 S=4 W=8 = water neighbour present), 4 frames' % _m)(_mask_sprite(_m))


def waterfall_frame(pal, f):
    W, H = 96, 128
    c = Canvas(W, H, pal, 5)
    r = c.rng
    # cliff face
    c.rect(0, 0, W - 1, 84, 'stone0')
    c.fill_gradient(['stone0', 'stone1', 'rockM', 'stone1'], seed=21, scale=5, gain=7.0, region=(0, 0, W - 1, 84))
    for _ in range(60):                       # rock facets
        x, y = r.randint(0, W - 8), r.randint(0, 80)
        w, h = r.randint(3, 8), r.randint(2, 4)
        c.hline(x, x + w, y, 'stone2'); c.hline(x, x + w - 1, y + h, 'stone0')
    # mossy top ledge with ferns
    c.rect(0, 0, W - 1, 6, 'moss1'); c.dither_band(0, 7, W - 1, 8, 'moss1', 'stone1')
    for x in range(0, W, 5):
        c.put(x + (x // 5) % 3, 5, 'moss3'); c.put(x + 1, 4, 'leaf3')
    # vegetation at both sides of the fall
    for sx in (3, 8, 82, 88):
        c.shaded_ellipse(sx, 10 + (sx % 7), 7, 5, ['leaf0', 'leaf1', 'leaf2', 'leaf3'])
    # falling water column: x 34..61, edges wobble
    for y in range(0, 90):
        wob = int(2 * math.sin(y * 0.3))
        x0, x1 = 30 + wob, 65 + wob
        for x in range(x0, x1 + 1):
            u = (x - x0) / (x1 - x0)
            col = 'water1' if 0.15 < u < 0.85 else 'water0'
            c.put(x, y, col)
        c.put(x0, y, 'water0'); c.put(x1, y, 'water0')
    # animated streaks (period 32 vertical, shift 8 per frame)
    sr = Canvas(1, 1, pal, 9).rng
    for sx in range(33, 64, 3):
        for rep in range(3):
            y0 = sr.randint(0, 31) + 32 * rep
            ln = sr.randint(5, 12)
            for i in range(ln):
                y = (y0 + 8 * f + i) % 96
                if y < 90:
                    c.put(sx + (1 if i % 5 == 4 else 0), y, 'foam' if i < ln // 2 else 'water3')
    # pool
    c.rect(0, 85, W - 1, H - 1, 'water1')
    for y in range(85, H):
        for x in range(W):
            c.put(x, y, water_name(x, y, f))
    c.dither_band(0, 85, W - 1, 87, 'stone0', 'water0')
    # splash foam at the impact point (breathes with frame)
    for i in range(14):
        a = i / 14 * math.tau
        rr_ = 9 + (2 if (i + f) % 2 else 0)
        x, y = int(48 + math.cos(a) * rr_), int(90 + math.sin(a) * rr_ * 0.38)
        c.put(x, y, 'foam'); c.put(x + 1, y, 'water3')
    c.rect(33 + f % 2, 86, 62 - f % 2, 89, 'foam')
    for i in range(10):                         # mist
        mx = 34 + (i * 7 + f * 5) % 28
        my = 78 + (i * 3) % 10 - (f % 2)
        c.put(mx, my, 'mist'); c.put(mx + 1, my, 'mist')
    # rocks around the pool + stone lip at the bottom
    for rx, ry, rw in ((2, 100, 8), (86, 104, 8), (6, 118, 7), (84, 120, 9)):
        c.shaded_ellipse(rx + rw / 2, ry, rw / 2 + 1, 5, ['stone0', 'stone1', 'stone2', 'stone3'])
    c.rect(0, 124, W - 1, H - 1, 'stone1'); c.hline(0, W - 1, 124, 'stone3'); c.hline(0, W - 1, H - 1, 'stone0')
    c.outline()
    return c


@sprite('jungle.waterfall', tw=3, th=4, note='waterfall 3x4 tiles, 4 frames (loops every 4 frames)')
def waterfall(pal, seed):
    return Anim([waterfall_frame(pal, f) for f in range(FRAMES)], fps=6)
