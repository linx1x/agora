"""Boreal pine: treeTop (snowy tiers, above layer) + treeBase (trunk on a snowy mound, collides)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def tier(c, cx, y, half, h):
    """One drooping branch tier: dark underside, lit upper edge, snow on top."""
    c.poly([(cx - half, y + h), (cx + half, y + h), (cx, y)], 'pine1')
    c.poly([(cx - half + 2, y + h - 1), (cx + half - 2, y + h - 1), (cx, y + 2)], 'pine2')
    c.poly([(cx - half + 4, y + h - 3), (cx + half - 4, y + h - 3), (cx - 1, y + 3)], 'pine3')
    c.hline(cx - half, cx + half, y + h, 'pine0')
    for i in range(-half + 1, half, 3):                       # needle fringe
        c.put(cx + i, y + h + 1, 'pine1')
    c.poly([(cx - 3, y + 4), (cx + 3, y + 4), (cx, y)], 'snow1')   # snow cap
    c.put(cx - 4 + 1, y + h - 1, 'snow0'); c.put(cx + half - 3, y + h - 2, 'snow0')


@sprite('boreal.treeTop', note='pine crown, three snowy tiers (drawn above avatars)')
def tree_top(pal, seed):
    c = new(pal, seed)
    tier(c, 16, 14, 13, 12)
    tier(c, 16, 7, 10, 10)
    tier(c, 16, 1, 7, 8)
    c.outline()
    return c


@sprite('boreal.treeBase', note='pine trunk and lowest skirt on a snowy mound')
def tree_base(pal, seed):
    c = new(pal, seed)
    tier(c, 16, -10, 14, 14)                                  # lowest skirt reaches into this tile
    c.ellipse(16, 28, 10, 3.2, 'snow0'); c.ellipse(16, 27.5, 8, 2.4, 'snow1')
    c.rect(12, 6, 20, 27, 'bark2'); c.vline(12, 6, 27, 'bark3'); c.vline(20, 6, 27, 'bark0'); c.vline(19, 6, 27, 'bark1')
    for y in range(14, 27, 4):
        c.hline(14, 17, y, 'bark1')
    c.put(9, 29, 'pine3'); c.put(10, 29, 'pine2'); c.put(22, 29, 'stone2'); c.put(23, 29, 'stone1')
    c.outline()
    c.ground_shadow(7, 25, 31)
    return c
