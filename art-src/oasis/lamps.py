"""Oasis Moroccan lantern post."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('oasis.lamp', note='sandstone post with a brass Moroccan lantern')
def lamp(pal, seed):
    c = new(pal, seed)
    c.rect(10, 26, 21, 30, 'stone2'); c.hline(10, 21, 26, 'stone3'); c.rect(10, 29, 21, 30, 'stone1')
    c.vline(21, 26, 30, 'stone1'); c.vline(10, 26, 29, 'stone3')
    c.rect(14, 14, 17, 26, 'stone2'); c.vline(14, 14, 26, 'stone3'); c.vline(17, 14, 26, 'stone0'); c.vline(16, 14, 26, 'stone1')
    for y in (17, 21, 24):
        c.hline(14, 17, y, 'stone1')
    c.rect(12, 13, 19, 14, 'brass1'); c.hline(12, 19, 13, 'brass2')                         # bracket
    # hook + lantern body: pointed crown, brass frame, glowing cut-outs
    c.vline(15, 0, 2, 'brass0'); c.vline(16, 0, 2, 'brass1')
    c.poly([(11, 6), (20, 6), (15.5, 2)], 'brass1'); c.put(15, 3, 'brass2')
    c.rect(11, 6, 20, 7, 'brass1'); c.hline(11, 20, 6, 'brass2')
    c.rect(11, 8, 20, 12, 'brass1')
    c.rect(12, 8, 19, 12, 'lantern')
    c.rect(13, 9, 18, 11, 'lanternL'); c.rect(14, 9, 17, 10, 'lampCore')
    for x in (12, 15, 19):
        c.vline(x, 8, 12, 'brass0')
    c.put(13, 10, 'brass0'); c.put(18, 10, 'brass0')
    c.poly([(12, 13), (19, 13), (15.5, 15)], 'brass0') if False else None
    c.hline(11, 20, 13, 'brass0')
    c.outline()
    return c
