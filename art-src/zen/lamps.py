"""Zen stone lantern (toro) with a glowing paper window."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('zen.lamp', note='stone toro lantern with a warm glowing window')
def lamp(pal, seed):
    c = new(pal, seed)
    c.rect(9, 27, 22, 30, 'stone1'); c.hline(9, 22, 27, 'stone3'); c.hline(9, 22, 30, 'stone0')            # base
    c.rect(13, 19, 18, 27, 'stone2'); c.vline(13, 19, 27, 'stone3'); c.vline(18, 19, 27, 'stone0')          # shaft
    c.rect(10, 16, 21, 19, 'stone2'); c.hline(10, 21, 16, 'stone3'); c.hline(10, 21, 19, 'stone0')          # platform
    c.rect(12, 9, 19, 16, 'stone1'); c.vline(12, 9, 16, 'stone2'); c.vline(19, 9, 16, 'stone0')             # lamp box
    c.rect(14, 10, 17, 14, 'lantern'); c.rect(14, 11, 17, 13, 'lanternL'); c.rect(15, 11, 16, 12, 'lampCore')
    c.poly([(7, 9), (24, 9), (15.5, 3)], 'stone1'); c.poly([(9, 9), (22, 9), (15.5, 4)], 'stone2'); c.hline(7, 24, 9, 'stone0')
    c.put(15, 2, 'stone3'); c.put(16, 2, 'stone2'); c.rect(14, 0, 17, 1, 'stone2')                          # finial
    c.put(14, 4, 'moss1'); c.put(20, 8, 'moss2')
    c.outline()
    return c
