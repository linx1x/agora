"""Jungle lantern post."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('jungle.lamp', note='wooden post with amber lantern')
def lamp(pal, seed):
    c = new(pal, seed)
    # base stone with moss
    c.rect(10, 26, 21, 30, 'stone2'); c.hline(10, 21, 26, 'stone3'); c.rect(10, 29, 21, 30, 'stone1')
    c.vline(21, 26, 30, 'stone1'); c.vline(10, 26, 29, 'stone3')
    for x in (11, 13, 18, 20):
        c.put(x, 26, 'moss3'); c.put(x, 27, 'moss2')
    # post: lit left, dark right, grain
    c.rect(14, 12, 17, 26, 'wood2'); c.vline(14, 12, 26, 'wood3'); c.vline(17, 12, 26, 'wood0'); c.vline(16, 12, 26, 'wood1')
    for y in (15, 19, 23):
        c.hline(14, 17, y, 'wood1')
    # vine wrapped around the post
    for y, x in ((25, 13), (22, 18), (19, 13), (16, 18), (13, 13)):
        c.rect(x, y, x + 1, y + 1, 'leaf3'); c.put(x, y - 1, 'leaf4'); c.put(x + 1, y + 1, 'leaf2')
    # lantern: chain, cage, glowing glass, flame
    c.vline(15, 0, 1, 'metalD'); c.vline(16, 0, 1, 'metalM')
    c.hline(10, 21, 2, 'wood1'); c.hline(11, 20, 3, 'wood2')
    c.rect(11, 4, 20, 11, 'lantern')
    c.rect(12, 5, 19, 10, 'lanternL')
    c.rect(13, 6, 18, 9, 'lampCore')
    c.rect(15, 7, 16, 9, 'white')
    for x in (11, 15, 20):
        c.vline(x, 4, 11, 'wood1')
    c.vline(11, 4, 11, 'wood2')
    c.hline(10, 21, 12, 'wood1'); c.hline(11, 20, 11, 'wood2')
    c.put(15, 12, 'wood0')
    c.outline()
    return c
