"""Boreal lantern post: black iron with a warm glass lantern and a snow cap."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('boreal.lamp', note='iron post with a glowing glass lantern and a snow cap')
def lamp(pal, seed):
    c = new(pal, seed)
    c.rect(10, 26, 21, 30, 'stone1'); c.hline(10, 21, 26, 'stone3'); c.rect(10, 29, 21, 30, 'stone0')
    c.ellipse(16, 25.5, 6, 1.6, 'snow1')
    c.rect(14, 14, 17, 26, 'metalD'); c.vline(14, 14, 26, 'metalM'); c.vline(17, 14, 26, 'ink')
    c.rect(12, 13, 19, 14, 'metalD'); c.hline(12, 19, 13, 'metalM')
    c.vline(15, 0, 2, 'metalD'); c.vline(16, 0, 2, 'metalM')
    c.poly([(11, 6), (20, 6), (15.5, 2)], 'metalD'); c.poly([(12, 6), (19, 6), (15.5, 3)], 'snow1'); c.hline(11, 20, 6, 'metalM')
    c.rect(11, 7, 20, 12, 'metalD')
    c.rect(12, 7, 19, 12, 'lantern')
    c.rect(13, 8, 18, 11, 'lanternL'); c.rect(14, 8, 17, 10, 'lampCore')
    for x in (12, 15, 19):
        c.vline(x, 7, 12, 'metalD')
    c.hline(11, 20, 13, 'metalD')
    c.outline()
    return c
