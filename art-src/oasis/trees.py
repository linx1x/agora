"""Oasis palm: treeTop (crown, above layer) + treeBase (trunk with a sand mound, collides)."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new

RAMP = ['leaf0', 'leaf1', 'leaf2', 'leaf3', 'leaf4']


def fronds(c, cx, cy, y_shift, rr=16):
    # drooping palm fronds radiating from the crown; drawn back to front
    spec = [(-172, 1.05), (-8, 1.05), (-145, 1.0), (-35, 1.0), (-112, 0.9), (-68, 0.9), (158, 1.0), (22, 1.0), (125, 0.8), (55, 0.8), (-90, 0.75)]
    for a, k in spec:
        L = rr * k
        mx = cx + math.cos(math.radians(a)) * L * 0.55
        my = cy - y_shift + math.sin(math.radians(a)) * L * 0.5
        c.leaf(mx, my, L * 0.66, 2.3, a, RAMP, slits=(-0.7, -0.45, -0.2, 0.05, 0.3, 0.55, 0.8), rib=True, cut_v=0.4, cut_w=0.08)


@sprite('oasis.treeTop', note='palm crown (drawn above avatars)')
def tree_top(pal, seed):
    c = new(pal, seed)
    fronds(c, 16, 22, 0)
    r = c.rng
    for _ in range(12):
        x, y = r.randint(2, 29), r.randint(2, 28)
        if c.get(x, y) is not None:
            c.put(x, y, 'leaf5')
    # coconut cluster at the crown centre
    for dx, dy in ((0, 0), (2, 1), (-2, 1), (1, 2)):
        c.put(15 + dx, 24 + dy, 'wood1'); c.put(16 + dx, 24 + dy, 'wood0')
    c.outline()
    return c


@sprite('oasis.treeBase', note='palm trunk, leaning slightly, on a sand mound')
def tree_base(pal, seed):
    c = new(pal, seed)
    fronds(c, 16, -2, 32, rr=15)                  # lower drooping tips reach into this tile
    # trunk: slight curve, banded rings
    for y in range(0, 28):
        x0 = 14 + int(1.4 * math.sin(y / 9.0))
        c.rect(x0, y, x0 + 3, y, 'wood2')
        c.put(x0, y, 'wood3'); c.put(x0 + 3, y, 'wood0'); c.put(x0 + 2, y, 'wood1')
        if y % 3 == 0:
            c.hline(x0, x0 + 3, y, 'wood1')
    # flared base + sand mound with a few fallen leaves and pebbles
    c.ellipse(16, 28, 10, 3.2, 'sand2'); c.ellipse(16, 27.5, 8, 2.4, 'sand3')
    c.rect(13, 22, 19, 27, 'wood2'); c.vline(13, 22, 27, 'wood3'); c.vline(19, 22, 27, 'wood0'); c.vline(18, 22, 27, 'wood1')
    c.put(9, 29, 'palm2'); c.put(10, 29, 'palm1'); c.put(22, 29, 'stone2'); c.put(23, 29, 'stone1')
    c.outline()
    c.ground_shadow(7, 25, 31)
    return c
