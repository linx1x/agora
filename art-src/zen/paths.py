"""Zen stepping-stone path: 16-mask autotile of mossy flagstones into the gravel/tatami (N=1 E=2 S=4 W=8)."""
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
    for x, y0 in ((10, 0), (26, 0), (2, 16), (18, 16)):
        base.vline(x, y0, y0 + 15, 'stone0')
    for _ in range(18):
        base.put(r.randint(0, 31), r.randint(0, 31), r.choice(['stone3', 'stone2', 'moss2']))
    for _ in range(5):
        x, y = r.randint(1, 29), r.choice((1, 17))
        base.put(x, y, 'moss1'); base.put(x + 1, y, 'moss2')
    return base


def _set(pal):
    if 'tiles' not in _CACHE:
        base = _fill(pal)

        def fringe(x, y, k):
            h = (x * 31 + y * 17) % 7
            return ('dirt3' if h < 2 else 'moss1' if h == 2 else None) if k == -1 else None

        _CACHE['tiles'] = autotile16(lambda x, y: base.get(x, y), ['stone0', 'stone1', 'stone2'], inset=3, pal=pal, seed=5,
                                     jitter=1.6, fringe=fringe, corner_r=7)
    return _CACHE['tiles']


def _mk(mask):
    def fn(pal, seed):
        return _set(pal)[mask].copy()
    return fn


for _m in range(16):
    sprite(f'zen.path{_m}', note='flagstone path autotile mask %d' % _m)(_mk(_m))
