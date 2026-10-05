"""Jungle plants: monstera in a wooden planter."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new

LEAF = ['leaf1', 'leaf2', 'leaf3', 'leaf4', 'leaf5']


def planter(c, x0=7, x1=24, y0=22, y1=30):
    c.rect(x0, y0, x1, y1, 'wood2')
    c.hline(x0, x1, y0, 'wood4'); c.hline(x0, x1, y0 + 1, 'wood3')
    c.rect(x0, y1 - 1, x1, y1, 'wood1')
    c.vline(x1, y0, y1, 'wood1'); c.vline(x1 - 1, y0 + 2, y1 - 2, 'wood1'); c.vline(x0, y0, y1, 'wood3')
    for x in (x0 + 5, x0 + 11):                 # plank seams
        c.vline(x, y0 + 2, y1 - 2, 'wood1')
    for y in (y0 + 3, y1 - 3):                  # metal bands
        c.hline(x0, x1, y, 'wood1')
    c.rect(x0 + 1, y0 - 1, x1 - 1, y0 - 1, 'dirt1')    # soil
    c.put(x0 + 3, y0 - 1, 'dirt3'); c.put(x1 - 4, y0 - 1, 'dirt0')


@sprite('jungle.plantA', note='monstera in wooden planter')
def monstera(pal, seed):
    c = new(pal, seed)
    planter(c)
    ox, oy = 16, 21
    for tx, ty in ((5, 15), (27, 14), (8, 7), (24, 6), (16, 8)):
        c.line(ox, oy, tx, ty, 'leaf1'); c.line(ox + 1, oy, tx + 1, ty, 'leaf2') if False else None
    # leaves back to front; deep slits and a hole so they read as monstera, not a bush
    c.leaf(6, 15, 7.5, 5.8, 172, LEAF, slits=(-0.3, 0.1, 0.5, 0.8))
    c.leaf(26, 14, 7.5, 5.8, 8, LEAF, slits=(-0.3, 0.1, 0.5, 0.8))
    c.leaf(9, 6, 7.5, 5.8, -142, LEAF, slits=(-0.25, 0.15, 0.55, 0.85))
    c.leaf(23, 5, 7.5, 5.8, -38, LEAF, slits=(-0.25, 0.15, 0.55, 0.85))
    c.leaf(16, 9, 6.5, 5.2, -90, LEAF, slits=(0.0, 0.4, 0.75))
    c.outline()
    c.ground_shadow(7, 25, 31)
    return c


def small_pot(c, x0=9, x1=22, y0=23, y1=30):
    c.rect(x0, y0, x1, y1, 'pot')
    c.hline(x0 - 1, x1 + 1, y0, 'potL'); c.hline(x0 - 1, x1 + 1, y0 + 1, 'pot')
    c.vline(x0, y0 + 1, y1, 'potL'); c.vline(x1, y0 + 1, y1, 'potD'); c.vline(x1 - 1, y0 + 1, y1, 'potD')
    c.hline(x0, x1, y1, 'potD')
    c.hline(x0 + 1, x1 - 1, y0 + 3, 'potD') if False else None
    c.rect(x0 + 1, y0 - 1, x1 - 1, y0 - 1, 'dirt1')


@sprite('jungle.plantB', note='fern in terracotta pot')
def fern(pal, seed):
    c = new(pal, seed)
    small_pot(c)
    ox, oy = 16, 22
    angles = [-165, -140, -115, -90, -65, -40, -15, 160, 20]
    for i, a in enumerate(angles):
        import math
        L = 12 if i not in (3,) else 14
        cx = ox + math.cos(math.radians(a)) * L * 0.55
        cy = oy + math.sin(math.radians(a)) * L * 0.55
        c.leaf(cx, cy, L * 0.6, 2.6, a, LEAF, slits=(-0.7, -0.45, -0.2, 0.05, 0.3, 0.55, 0.8), rib=True, cut_v=0.32, cut_w=0.07)
    c.outline()
    c.ground_shadow(8, 23, 31)
    return c


@sprite('jungle.plantC', note='banana palm in wooden tub')
def palm(pal, seed):
    c = new(pal, seed)
    planter(c, 8, 23, 24, 31)
    import math
    ox, oy = 16, 24
    c.rect(15, 14, 16, 24, 'wood2'); c.vline(16, 14, 24, 'wood1')               # trunk stub
    for a, L in ((-170, 12), (-135, 13), (-100, 13), (-70, 13), (-40, 13), (-10, 12)):
        tipx, tipy = ox + math.cos(math.radians(a)) * L, 14 + math.sin(math.radians(a)) * L * 0.9
        c.line(16, 15, int(tipx * 0.5 + 8), int(tipy * 0.5 + 7.5), 'leaf1')
        c.leaf((16 + tipx) / 2, (15 + tipy) / 2, L * 0.62, 3.4, a, LEAF, slits=(-0.5, -0.2, 0.1, 0.4, 0.7), cut_v=0.55, cut_w=0.06)
    c.outline()
    c.ground_shadow(8, 24, 31) if False else None
    return c
