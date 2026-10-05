"""Oasis water: sandstone-coped pool autotile (4-frame animation) and a 3x3 wall fountain (4 frames)."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Anim, Canvas, autotile16

FRAMES = 4


def water_name(x, y, f):
    """Calm ripples, periodic in x and y (period 32), shifting 8 px per frame."""
    xs = (x + 8 * f) % 32
    T = math.tau / 32.0
    band = math.sin(xs * T * 2 + 1.6 * math.sin(y * T * 2)) + 0.8 * math.sin(y * T * 4 + xs * T) + 0.6 * math.sin(xs * T * 3 - y * T * 2)
    if band > 1.9:
        return 'water3'
    if band > 1.1:
        return 'water2'
    if band < -1.7:
        return 'water0'
    return 'water1'


_POOL = {}


def _pool(pal):
    if 'sets' not in _POOL:
        _POOL['sets'] = [autotile16(lambda x, y, f=f: water_name(x, y, f), ['stone1', 'stone2', 'stone3', 'water2'], inset=5,
                                    pal=pal, seed=11, fringe=lambda x, y, k: ('sand3' if (x * 7 + y * 13) % 5 == 0 else None) if k == -1 else None)
                         for f in range(FRAMES)]
    return _POOL['sets']


def _mask_sprite(mask):
    def fn(pal, seed):
        sets = _pool(pal)
        frames = []
        for f in range(FRAMES):
            c = sets[f][mask].copy()
            c.outline()
            rr = c.rng
            for _ in range(3):
                x, y = rr.randint(6, 25), rr.randint(6, 25)
                if c.get(x, y) in ('water1', 'water2') and (x + y + f) % 4 == 0:
                    c.put(x, y, 'foam')
            frames.append(c)
        return Anim(frames, fps=4)
    return fn


for _m in range(16):
    sprite(f'oasis.pond{_m}', note='pool autotile mask %d (N=1 E=2 S=4 W=8 = water neighbour present), 4 frames' % _m)(_mask_sprite(_m))


def fountain_frame(pal, f):
    W, H = 96, 96
    c = Canvas(W, H, pal, 5)
    r = c.rng
    # plaster wall with a tiled band and a deep arched niche
    c.fill_gradient(['plaster1', 'plaster2', 'plaster1'], seed=21, scale=5, gain=4.0, region=(0, 0, W - 1, 71))
    c.rect(0, 0, W - 1, 3, 'terraD'); c.hline(0, W - 1, 0, 'terra')
    for x in range(0, W, 8):
        c.vline(x, 0, 3, 'terra')
    for x in range(0, W, 8):                                  # glazed tile band
        for i, col in enumerate(('tile0', 'tile1', 'tile2', 'tile1')):
            c.rect(x, 6 + i * 2, x + 7, 7 + i * 2, col if (x // 8 + i) % 2 == 0 else 'tile2')
    c.rect(22, 18, 73, 71, 'stone2'); c.ellipse(47.5, 26, 26.5, 14, 'stone2')            # arch frame
    c.rect(26, 22, 69, 71, 'stone0'); c.ellipse(47.5, 28, 22.5, 11, 'stone0')            # dark niche
    c.rect(27, 24, 68, 71, 'tile0'); c.ellipse(47.5, 29, 21.5, 10, 'tile0')               # blue tile backing
    for y in range(24, 72, 4):
        for x in range(27 + (y // 4 % 2) * 2, 69, 4):
            c.put(x, y, 'tile1'); c.put(x + 1, y, 'tile2') if (x + y) % 8 == 0 else None
    c.rect(22, 18, 73, 20, 'stone3') if False else None
    # brass spout (a flared pipe on a round plate) and a falling sheet of water
    c.ellipse(47.5, 33, 7, 5, 'brass0'); c.ellipse(47.5, 32.5, 6, 4, 'brass1'); c.ellipse(47.5, 32, 4.5, 2.5, 'brass2')
    c.rect(41, 35, 54, 37, 'brass1'); c.hline(41, 54, 35, 'brass2'); c.hline(41, 54, 37, 'brass0')
    for y in range(37, 72):
        wob = int(1.0 * math.sin(y * 0.4))
        for x in range(42 + wob, 54 + wob):
            c.put(x, y, 'water1' if 44 < x < 52 else 'water0')
    sr = Canvas(1, 1, pal, 9).rng
    for sx in range(44, 53, 2):                                                       # animated streaks
        for rep in range(2):
            y0 = sr.randint(0, 31) + 32 * rep
            ln = sr.randint(5, 10)
            for i in range(ln):
                y = 38 + ((y0 + 8 * f + i) % 32)
                if y < 72:
                    c.put(sx, y, 'foam' if i < ln // 2 else 'water3')
    # basin: pool surface across the bottom row, coping only on the sides
    for y in range(64, H):
        for x in range(W):
            c.put(x, y, water_name(x, y, f))
    c.rect(0, 62, W - 1, 63, 'stone3'); c.hline(0, W - 1, 62, 'stone2')                # basin rim in front of the wall
    for i in range(14):                                                               # splash ring
        a = i / 14 * math.tau
        rr_ = 8 + (2 if (i + f) % 2 else 0)
        x, y = int(48 + math.cos(a) * rr_), int(74 + math.sin(a) * rr_ * 0.4)
        c.put(x, y, 'foam'); c.put(x + 1, y, 'water3')
    c.rect(42 + f % 2, 70, 53 - f % 2, 72, 'foam')
    for i in range(8):
        mx = 40 + (i * 5 + f * 3) % 18
        c.put(mx, 62 - (i % 3) - (f % 2), 'mist'); c.put(mx + 1, 62 - (i % 3), 'mist')
    for x0 in (0, W - 4):                                                             # side coping
        c.rect(x0, 64, x0 + 3, H - 1, 'stone2'); c.vline(x0 if x0 == 0 else x0 + 3, 64, H - 1, 'stone3')
        c.vline(x0 + 3 if x0 == 0 else x0, 64, H - 1, 'stone0')
    c.outline()
    return c


@sprite('oasis.fall', tw=3, th=3, note='wall fountain 3x3 tiles, 4 frames')
def fountain(pal, seed):
    return Anim([fountain_frame(pal, f) for f in range(FRAMES)], fps=6)
