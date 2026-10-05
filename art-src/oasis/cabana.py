"""Oasis cabana: striped canvas awning over a daybed (3x2 tiles)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('oasis.cabana', tw=3, th=2, note='beach cabana: striped awning, daybed, pillows, lantern (3x2)')
def cabana(pal, seed):
    c = new(pal, seed, 3, 2)
    # posts
    for x in (3, 90):
        c.rect(x, 12, x + 2, 58, 'wood2'); c.vline(x, 12, 58, 'wood3'); c.vline(x + 2, 12, 58, 'wood0')
    # awning: vertical stripes turquoise / cream, scalloped valance
    c.rect(0, 2, 95, 24, 'cream1')
    for x in range(0, 96, 12):
        c.rect(x, 2, x + 5, 24, 'turq1'); c.vline(x, 2, 24, 'turq2'); c.vline(x + 5, 2, 24, 'turq0')
    c.hline(0, 95, 2, 'white')
    for x in range(0, 96, 6):                              # scallops
        col = 'turq1' if (x // 6) % 2 == 0 else 'cream1'
        c.ellipse(x + 3, 25, 3.2, 3, col)
    c.dither_band(0, 20, 95, 23, 'cream0', 'turq0') if False else None
    # daybed: wooden frame, thick cream mattress, teal and terracotta pillows
    c.rect(6, 40, 89, 56, 'wood1'); c.hline(6, 89, 40, 'wood3'); c.hline(6, 89, 56, 'wood0')
    c.rect(8, 33, 87, 46, 'cream1'); c.hline(8, 87, 33, 'white'); c.hline(8, 87, 46, 'cream0')
    c.dither_band(10, 34, 85, 35, 'white', 'cream1')
    for x in range(12, 86, 10):
        c.put(x, 40, 'turq1'); c.put(x + 1, 40, 'turq2')
    for x0, col, hi in ((11, 'chairG1', 'chairG2'), (24, 'terra', 'flowerO'), (62, 'chairG1', 'chairG2'), (75, 'flower', 'flowerO')):
        c.rect(x0, 29, x0 + 9, 37, col); c.hline(x0, x0 + 9, 29, hi); c.vline(x0 + 9, 29, 37, 'terraD' if col != 'chairG1' else 'chairG0')
    c.rect(40, 36, 55, 41, 'turq2'); c.hline(40, 55, 36, 'white')                   # folded throw
    # hanging lantern + side table
    c.vline(47, 25, 28, 'brass0'); c.rect(45, 28, 49, 32, 'brass1'); c.rect(46, 29, 48, 31, 'lanternL'); c.put(47, 30, 'lampCore')
    c.rect(1, 50, 5, 60, 'wood1')
    c.outline(); c.ground_shadow(4, 92, 62)
    return c
