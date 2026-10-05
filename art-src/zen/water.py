"""Zen koi pond: boulder-rimmed autotile with lily pads and drifting koi (4 frames)."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Anim, autotile16

FRAMES = 4


def water_name(x, y, f):
    xs = (x + 8 * f) % 32
    T = math.tau / 32.0
    band = math.sin(xs * T * 2 + 1.4 * math.sin(y * T * 2)) + 0.7 * math.sin(y * T * 3 + xs * T) + 0.5 * math.sin(xs * T * 3 - y * T * 2)
    if band > 1.7:
        return 'water3' if (x + y) % 3 == 0 else 'water2'
    if band > 0.9:
        return 'water2'
    if band < -1.4:
        return 'water0'
    return 'water1'


_POOL = {}


def _pool(pal):
    if 'sets' not in _POOL:
        _POOL['sets'] = [autotile16(lambda x, y, f=f: water_name(x, y, f), ['stone0', 'stone1', 'stone2', 'water2'], inset=5,
                                    pal=pal, seed=11, fringe=lambda x, y, k: ('moss1' if (x * 7 + y * 13) % 4 == 0 else 'moss0' if (x + y) % 5 == 0 else None) if k == -1 else None)
                         for f in range(FRAMES)]
    return _POOL['sets']


def _koi(c, x, y, f, col):
    """A small fish: body + tail, wiggling with the frame."""
    w = 1 if f % 2 else 0
    for dx in range(0, 4):
        if c.get(x + dx, y + w) in ('water0', 'water1', 'water2', 'water3'):
            c.put(x + dx, y + w, col)
    if c.get(x + 4, y + w + (1 if w else -1)) in ('water0', 'water1', 'water2', 'water3'):
        c.put(x + 4, y + w + (1 if w else -1), 'koi1')
    if c.get(x + 1, y + w - 1) in ('water0', 'water1', 'water2', 'water3'):
        c.put(x + 1, y + w - 1, 'koi2')


def _mask_sprite(mask):
    def fn(pal, seed):
        sets = _pool(pal)
        frames = []
        rr = None
        for f in range(FRAMES):
            c = sets[f][mask].copy()
            c.outline()
            from random import Random
            rr = Random(mask * 31 + 7)
            if rr.random() < 0.5:                                      # lily pad: fixed
                x, y = rr.randint(9, 20), rr.randint(9, 20)
                if c.get(x, y) in ('water1', 'water2', 'water0') and c.get(x + 3, y + 2) is not None:
                    c.ellipse(x, y, 3, 2, 'leaf2'); c.put(x - 1, y - 1, 'leaf3'); c.put(x + 1, y, 'water1'); c.put(x, y - 1, 'flowerP')
            if mask in (15, 14, 11, 7, 13) or mask == 15:
                kx = (8 + f * 4 + mask * 3) % 20 + 4
                _koi(c, kx, 14 + (mask % 5), f, 'koi0' if mask % 2 else 'koi1')
            frames.append(c)
        return Anim(frames, fps=3)
    return fn


for _m in range(16):
    sprite(f'zen.pond{_m}', note='koi pond autotile mask %d (N=1 E=2 S=4 W=8 = water neighbour present), 4 frames' % _m)(_mask_sprite(_m))
