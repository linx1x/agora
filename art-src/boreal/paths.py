"""Boreal slate-slab trail: 16-mask autotile into the needle floor (N=1 E=2 S=4 W=8 = path neighbour present)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import autotile16

_CACHE = {}


def _fill(pal):
    base = new(pal, 77)
    r = base.rng
    base.fill_gradient(['stone1', 'stone2', 'stone2'], seed=77, scale=3, gain=2.0, center=0.5)
    for y in (0, 16):
        base.hline(0, 31, y, 'stone0')
    for x, y0 in ((8, 0), (24, 0), (0, 16), (16, 16)):
        base.vline(x, y0, y0 + 15, 'stone0')
    for _ in range(18):
        base.put(r.randint(0, 31), r.randint(0, 31), r.choice(['stone3', 'stone1', 'snow0']))
    return base


def _set(pal):
    if 'tiles' not in _CACHE:
        base = _fill(pal)

        def fringe(x, y, k):
            h = (x * 31 + y * 17) % 7
            return ('snow0' if h < 2 else 'sand2' if h == 2 else None) if k == -1 else None

        _CACHE['tiles'] = autotile16(lambda x, y: base.get(x, y), ['stone0', 'stone1', 'stone2'], inset=3, pal=pal, seed=5,
                                     jitter=1.4, fringe=fringe, corner_r=6)
    return _CACHE['tiles']


def _mk(mask):
    def fn(pal, seed):
        return _set(pal)[mask].copy()
    return fn


for _m in range(16):
    sprite(f'boreal.path{_m}', note='slate trail autotile mask %d' % _m)(_mk(_m))
