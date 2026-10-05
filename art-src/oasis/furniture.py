"""Oasis furniture: rattan sofa sections with teal cushions, round table, clay decor."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Canvas

CUSH = ['chairG0', 'chairG1', 'chairG2']


def sofa_seat(c: Canvas, x0: int, x1: int, left_arm: bool, right_arm: bool):
    # back rest (rows 4-14), seat (15-23), base (24-27)
    c.rect(x0, 4, x1, 14, 'wood1')                    # rattan frame behind
    c.rect(x0 + (3 if left_arm else 0), 5, x1 - (3 if right_arm else 0), 14, 'chairG1')
    c.hline(x0 + 1, x1 - 1, 5, 'chairG2')
    c.dither_band(x0 + 4, 6, x1 - 4, 7, 'chairG2', 'chairG1')
    c.hline(x0, x1, 14, 'chairG0')
    for x in range(x0 + 6, x1 - 5, 6):                # tufting buttons
        c.put(x, 10, 'chairG0'); c.put(x, 9, 'chairG2')
    c.rect(x0, 15, x1, 23, 'chairG1')
    c.hline(x0, x1, 15, 'chairG2'); c.hline(x0, x1, 23, 'chairG0')
    c.dither_band(x0, 16, x1, 16, 'chairG2', 'chairG1')
    if x1 - x0 > 20:
        c.vline((x0 + x1) // 2, 16, 22, 'chairG0')    # cushion seam
    c.rect(x0, 24, x1, 27, 'wood2'); c.hline(x0, x1, 24, 'wood3'); c.hline(x0, x1, 27, 'wood0')
    # arms
    if left_arm:
        c.rect(x0, 8, x0 + 3, 24, 'wood2'); c.vline(x0, 8, 24, 'wood3'); c.vline(x0 + 3, 8, 24, 'wood1')
        c.rect(x0, 7, x0 + 3, 9, 'chairG1'); c.hline(x0, x0 + 3, 7, 'chairG2')
    if right_arm:
        c.rect(x1 - 3, 8, x1, 24, 'wood2'); c.vline(x1 - 3, 8, 24, 'wood3'); c.vline(x1, 8, 24, 'wood0')
        c.rect(x1 - 3, 7, x1, 9, 'chairG1'); c.hline(x1 - 3, x1, 7, 'chairG2')
    # feet
    for x in (x0 + 1, x1 - 2):
        c.rect(x, 28, x + 1, 29, 'wood0')


def pillow(c: Canvas, x: int, y: int):
    c.rect(x, y, x + 5, y + 5, 'cream'); c.hline(x, x + 5, y, 'white'); c.vline(x + 5, y, y + 5, 'paperD')
    c.put(x + 2, y + 2, 'turq1'); c.put(x + 3, y + 3, 'turq1'); c.put(x + 2, y + 3, 'turq0'); c.put(x + 3, y + 2, 'turq2')


@sprite('oasis.sofa', note='rattan loveseat with teal cushions (single tile, both arms)')
def sofa(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 1, 30, True, True)
    pillow(c, 6, 14)
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


@sprite('oasis.sofaL', note='sectional left end')
def sofa_l(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 1, 31, True, False)
    c.outline(); c.ground_shadow(2, 31, 30)
    return c


@sprite('oasis.sofaM', note='sectional middle')
def sofa_m(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 0, 31, False, False)
    c.outline(); c.ground_shadow(0, 31, 30)
    return c


@sprite('oasis.sofaR', note='sectional right end')
def sofa_r(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 0, 30, False, True)
    pillow(c, 20, 14)
    c.outline(); c.ground_shadow(0, 29, 30)
    return c


@sprite('oasis.table', note='round rattan-top table with a lemonade pitcher')
def table(pal, seed):
    c = new(pal, seed)
    c.rect(14, 19, 17, 26, 'wood1'); c.vline(14, 19, 26, 'wood2'); c.vline(17, 19, 26, 'wood0')
    c.ellipse(15.5, 27, 8, 2.5, 'wood1'); c.ellipse(15.5, 26.5, 7, 2, 'wood2')
    c.ellipse(15.5, 14, 14, 8.5, 'wood1')
    c.ellipse(15.5, 12.5, 14, 8, 'wood3')
    c.ellipse(15.5, 12, 11, 6, 'wood4')
    for y in (10, 12, 14):                              # woven texture
        c.hline(7, 24, y, 'wood3')
    for x in range(8, 24, 3):
        c.put(x, 11, 'wood2'); c.put(x + 1, 13, 'wood2')
    c.ellipse(15.5, 12, 6, 3, 'turq2')                  # tray
    c.rect(13, 8, 17, 12, 'glassB'); c.rect(14, 9, 16, 12, 'juiceO'); c.put(13, 8, 'white'); c.hline(13, 17, 8, 'white'); c.put(18, 9, 'glassB')
    c.rect(8, 11, 10, 13, 'glassB'); c.put(9, 12, 'juiceO')
    c.rect(21, 11, 23, 13, 'glassB'); c.put(22, 12, 'juiceOL'); c.put(23, 10, 'leaf3')
    c.outline(); c.ground_shadow(5, 27, 30)
    return c


@sprite('oasis.decorA', note='cluster of terracotta pots with a cactus and aloe')
def decor_a(pal, seed):
    c = new(pal, seed)
    # three pots of different heights
    for x0, y0, w, h in ((3, 18, 9, 11), (12, 14, 8, 15), (21, 20, 8, 9)):
        c.rect(x0, y0, x0 + w - 1, y0 + h - 1, 'terra')
        c.hline(x0 - 1, x0 + w, y0, 'wood2'); c.vline(x0, y0 + 1, y0 + h - 1, 'wood2'); c.vline(x0 + w - 1, y0 + 1, y0 + h - 1, 'terraD')
        c.hline(x0, x0 + w - 1, y0 + h - 1, 'terraD')
        c.hline(x0 + 1, x0 + w - 2, y0 + 3, 'terraD')
    # cactus (centre), aloe (left), small succulents (right)
    c.rect(14, 3, 17, 14, 'palm2'); c.vline(14, 3, 14, 'palm3'); c.vline(17, 3, 14, 'palm1')
    c.rect(11, 7, 13, 8, 'palm2'); c.rect(11, 5, 12, 8, 'palm2'); c.rect(18, 6, 20, 7, 'palm2'); c.rect(19, 4, 20, 7, 'palm2')
    for y in range(4, 14, 3):
        c.put(15, y, 'cream1')
    c.put(15, 2, 'flowerP'); c.put(16, 2, 'noteP')
    for a in (-30, 0, 30, 60, -60):
        pass
    c.poly([(4, 18), (8, 8), (10, 18)], 'palm3'); c.poly([(7, 18), (11, 10), (12, 18)], 'palm2'); c.poly([(2, 18), (5, 11), (6, 18)], 'palm2')
    c.shaded_ellipse(25, 18, 4, 3, ['palm0', 'palm1', 'palm2', 'palm3']); c.put(25, 15, 'flowerO'); c.put(26, 15, 'flower')
    c.outline(); c.ground_shadow(2, 30, 30)
    return c


@sprite('oasis.decorB', note='low cushion table with dates and mint tea')
def decor_b(pal, seed):
    c = new(pal, seed)
    # floor cushions either side
    for x0 in (0, 22):
        c.ellipse(x0 + 5, 24, 5.5, 3.5, 'terra'); c.ellipse(x0 + 5, 23, 4.5, 2.5, 'flower'); c.put(x0 + 5, 22, 'flowerO'); c.put(x0 + 3, 23, 'terraD')
    # table: brass tray top on short legs
    c.ellipse(15.5, 20, 11, 5, 'wood1'); c.ellipse(15.5, 19, 11, 5, 'wood3'); c.ellipse(15.5, 18.5, 9, 3.5, 'brass1'); c.ellipse(15.5, 18, 8, 3, 'brass2')
    c.rect(8, 22, 9, 27, 'wood1'); c.rect(22, 22, 23, 27, 'wood1'); c.vline(9, 22, 27, 'wood0'); c.vline(23, 22, 27, 'wood0')
    # tea set + dates bowl
    c.rect(11, 13, 14, 17, 'brass2'); c.hline(11, 14, 13, 'white'); c.put(15, 14, 'brass1'); c.hline(11, 14, 12, 'brass1')
    c.rect(17, 16, 19, 18, 'glassB'); c.put(18, 17, 'palm3')
    c.ellipse(21, 17, 3, 1.5, 'cream0'); c.put(20, 16, 'dateB'); c.put(21, 16, 'dateL'); c.put(22, 16, 'dateB')
    c.outline(); c.ground_shadow(2, 29, 30)
    return c
