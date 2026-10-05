"""Boreal frozen pond: snow-rimmed ice autotile with a slowly moving glint (4 frames)."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Anim, autotile16

FRAMES = 4


def ice_name(x, y, f):
    """Smooth ice with faint swirls (periodic in x and y, period 32); the swirls drift 8 px per frame."""
    xs = (x + 8 * f) % 32
    T = math.tau / 32.0
    band = math.sin(xs * T * 2 + 1.2 * math.sin(y * T * 2)) + 0.7 * math.sin(y * T * 3 + xs * T) + 0.5 * math.sin(xs * T * 3 - y * T * 2)
    if band > 1.7:
        return 'ice3'
    if band > 0.8:
        return 'ice2'
    if band < -1.5:
        return 'ice0'
    return 'ice1'


_POOL = {}


def _pool(pal):
    if 'sets' not in _POOL:
        _POOL['sets'] = [autotile16(lambda x, y, f=f: ice_name(x, y, f), ['stone1', 'stone2', 'snow1', 'ice2'], inset=5,
                                    pal=pal, seed=11, fringe=lambda x, y, k: ('snow0' if (x * 7 + y * 13) % 5 == 0 else None) if k == -1 else None)
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
            for _ in range(2):                                    # fixed cracks
                x, y = rr.randint(7, 24), rr.randint(7, 24)
                if c.get(x, y) in ('ice1', 'ice2', 'ice0'):
                    c.put(x, y, 'ice0'); c.put(x + 1, y + 1, 'ice0'); c.put(x + 2, y + 1, 'ice0')
            for _ in range(3):                                    # moving glints
                x, y = rr.randint(6, 25), rr.randint(6, 25)
                if c.get(x, y) in ('ice1', 'ice2') and (x + y + f) % 4 == 0:
                    c.put(x, y, 'foam')
            frames.append(c)
        return Anim(frames, fps=3)
    return fn


for _m in range(16):
    sprite(f'boreal.pond{_m}', note='frozen pond autotile mask %d (N=1 E=2 S=4 W=8 = ice neighbour present), 4 frames' % _m)(_mask_sprite(_m))
