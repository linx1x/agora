"""Jungle ergonomic green chair. Facing down = we see the seat front, back-rest above."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('jungle.chairDown', note='ergonomic green chair, sitter faces camera')
def chair_down(pal, seed):
    c = new(pal, seed)
    # star base, gas lift, casters
    c.line(16, 27, 6, 29, 'metalD'); c.line(16, 27, 26, 29, 'metalD'); c.line(16, 27, 16, 30, 'metalD')
    c.line(16, 26, 9, 28, 'metalM'); c.line(16, 26, 23, 28, 'metalM')
    c.rect(15, 21, 16, 26, 'metalM'); c.vline(15, 21, 26, 'metalL'); c.vline(16, 21, 26, 'metalD')
    for x in (5, 16, 26):
        c.rect(x, 29, x + 1, 30, 'metalD'); c.put(x, 29, 'metalM')
    # seat cushion (lit left/top, dark right/bottom, stitch line)
    c.rect(6, 14, 25, 22, 'chairG1')
    c.hline(7, 24, 14, 'chairG2'); c.rect(6, 15, 7, 21, 'chairG2'); c.dither_band(8, 15, 9, 21, 'chairG2', 'chairG1')
    c.hline(7, 25, 22, 'chairG0'); c.rect(24, 15, 25, 22, 'chairG0'); c.dither_band(22, 15, 23, 21, 'chairG1', 'chairG0')
    c.hline(9, 22, 19, 'chairG0') if False else None
    for x in range(9, 23, 2):
        c.put(x, 20, 'chairG0')               # stitching
    # armrests: pole + pad
    for x in (3, 27):
        c.rect(x, 13, x + 1, 20, 'metalD'); c.vline(x, 13, 20, 'metalM')
        c.rect(x - 1, 11, x + 2, 12, 'chairG0'); c.hline(x - 1, x + 2, 11, 'chairG1')
    # back-rest with mesh crosshatch and lumbar support
    c.rect(8, 1, 23, 13, 'chairG1')
    c.hline(9, 22, 1, 'chairG2'); c.vline(8, 2, 12, 'chairG2'); c.vline(9, 2, 12, 'chairG2') if False else None
    c.vline(23, 2, 13, 'chairG0'); c.hline(8, 23, 13, 'chairG0')
    for y in range(3, 12):
        for x in range(10, 22):
            if (x + y) % 3 == 0:
                c.put(x, y, 'chairG0' if y > 6 else 'chairG2')
    c.rect(11, 9, 20, 11, 'chairG2'); c.hline(11, 20, 11, 'chairG1')   # lumbar pad
    c.rect(14, 12, 17, 13, 'metalM')
    c.outline()
    c.ground_shadow(6, 26, 30)
    return c
