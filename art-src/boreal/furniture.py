"""Boreal furniture: cosy wine-red sofa sections, round timber table, log pile and a snowy cairn."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Canvas

CUSH = ['chairG0', 'chairG1', 'chairG2']


def sofa_seat(c: Canvas, x0: int, x1: int, left_arm: bool, right_arm: bool):
    # back rest (rows 4-14), seat (15-23), base (24-27)
    c.rect(x0, 4, x1, 14, 'wood1')                    # timber frame behind
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
    c.put(x + 2, y + 2, 'wool3'); c.put(x + 3, y + 3, 'wool3'); c.put(x + 2, y + 3, 'wool2'); c.put(x + 3, y + 2, 'white')


@sprite('boreal.sofa', note='rattan loveseat with teal cushions (single tile, both arms)')
def sofa(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 1, 30, True, True)
    pillow(c, 6, 14)
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


@sprite('boreal.sofaL', note='sectional left end')
def sofa_l(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 1, 31, True, False)
    c.outline(); c.ground_shadow(2, 31, 30)
    return c


@sprite('boreal.sofaM', note='sectional middle')
def sofa_m(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 0, 31, False, False)
    c.outline(); c.ground_shadow(0, 31, 30)
    return c


@sprite('boreal.sofaR', note='sectional right end')
def sofa_r(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 0, 30, False, True)
    pillow(c, 20, 14)
    c.outline(); c.ground_shadow(0, 29, 30)
    return c


@sprite('boreal.table', note='round timber table with a steaming mug and a candle')
def table(pal, seed):
    c = new(pal, seed)
    c.rect(14, 19, 17, 26, 'bark1'); c.vline(14, 19, 26, 'bark2'); c.vline(17, 19, 26, 'bark0')
    c.ellipse(15.5, 27, 8, 2.5, 'bark1'); c.ellipse(15.5, 26.5, 7, 2, 'bark2')
    c.ellipse(15.5, 14, 14, 8.5, 'bark1')
    c.ellipse(15.5, 12.5, 14, 8, 'wood2')
    c.ellipse(15.5, 12, 11, 6, 'wood3')
    for y in (10, 12, 14):                              # wood grain
        c.hline(7, 24, y, 'wood2')
    for x in range(8, 24, 3):
        c.put(x, 11, 'wood2'); c.put(x + 1, 13, 'wood4')
    c.ellipse(15.5, 12, 6, 3, 'wool1')                  # little runner
    c.rect(12, 8, 15, 12, 'mugW'); c.hline(12, 15, 8, 'white'); c.put(16, 9, 'mugW'); c.put(16, 10, 'mugW'); c.put(13, 9, 'coffee'); c.put(14, 9, 'coffee')
    c.put(13, 6, 'snow0'); c.put(14, 5, 'stone3')        # steam
    c.rect(20, 10, 21, 12, 'cream1'); c.put(20, 9, 'fire2'); c.put(21, 8, 'fire3')   # candle
    c.outline(); c.ground_shadow(5, 27, 30)
    return c


@sprite('boreal.decorA', note='stacked firewood under a snow cap, with an axe')
def decor_a(pal, seed):
    c = new(pal, seed)
    c.ellipse(16, 28, 13, 3, 'stone0')
    rows = ((24, 5), (18, 4), (12, 3))
    for y, n in rows:
        x0 = 16 - n * 3
        for i in range(n):
            x = x0 + i * 6 + 1
            c.ellipse(x + 2.5, y, 3.2, 3, 'bark1'); c.ellipse(x + 2.5, y, 2.4, 2.2, 'bark3'); c.ellipse(x + 2.5, y, 1.2, 1.1, 'bark2')
            c.put(x + 2, y, 'bark1')
    c.poly([(5, 10), (27, 10), (16, 4)], 'snow1'); c.hline(7, 25, 10, 'snow0'); c.hline(9, 23, 8, 'white')
    c.rect(26, 20, 27, 28, 'wood3'); c.rect(24, 19, 28, 21, 'metalM'); c.hline(24, 28, 19, 'metalL')   # axe in the stack
    c.outline(); c.ground_shadow(2, 30, 30)
    return c


@sprite('boreal.decorB', note='snow-capped cairn of boulders with a tiny pine')
def decor_b(pal, seed):
    c = new(pal, seed)
    for cx, cy, rx, ry, col in ((11, 23, 9, 6, 'stone1'), (22, 24, 7, 5, 'stone2'), (16, 17, 7, 5, 'stone2')):
        c.ellipse(cx, cy + 1.5, rx + 0.5, ry, 'stone0'); c.ellipse(cx, cy, rx, ry, col); c.ellipse(cx - 1.5, cy - 1.5, rx * 0.55, ry * 0.5, 'stone3')
    for cx, cy, rx in ((11, 18, 7), (22, 20, 5), (16, 12, 5)):
        c.ellipse(cx, cy, rx, 2.6, 'snow1'); c.ellipse(cx - 1, cy - 1, rx * 0.6, 1.4, 'white')
    c.poly([(14, 12), (20, 12), (17, 3)], 'pine1'); c.poly([(15, 11), (19, 11), (17, 5)], 'pine2'); c.put(17, 4, 'snow1')
    c.outline(); c.ground_shadow(2, 30, 30)
    return c
