"""Jungle dirt path: 16-mask autotile into the grass (N=1 E=2 S=4 W=8 = path neighbour present)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import autotile16, Canvas

_CACHE = {}


def _dirt_fill(pal):
    base = new(pal, 77)
    base.fill_gradient(['dirt1', 'dirt2', 'dirt3'], seed=77, scale=3, gain=2.4, center=0.5)
    r = base.rng
    for _ in range(9):
        x, y = r.randint(1, 29), r.randint(1, 29)
        base.put(x, y, 'pebble'); base.put(x + 1, y + 1, 'dirt0')
    for _ in range(14):
        base.put(r.randint(0, 31), r.randint(0, 31), 'dirt0' if r.random() < 0.6 else 'dirt3')
    return base


def _set(pal):
    if 'tiles' not in _CACHE:
        base = _dirt_fill(pal)

        def fringe(x, y, k):
            h = (x * 31 + y * 17) % 7
            if k == -1:
                return ('moss3' if h < 2 else 'leaf3' if h == 2 else None)
            return None

        _CACHE['tiles'] = autotile16(lambda x, y: base.get(x, y), ['dirt0', 'dirt1', 'dirt2'], inset=3, pal=pal, seed=5,
                                     jitter=1.6, fringe=fringe, corner_r=7)
    return _CACHE['tiles']


def _mk(mask):
    def fn(pal, seed):
        return _set(pal)[mask].copy()
    return fn


for _m in range(16):
    sprite(f'jungle.path{_m}', note='dirt path autotile mask %d' % _m)(_mk(_m))
