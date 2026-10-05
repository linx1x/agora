"""Jungle furniture: sofa pieces, round table, hammock, bookshelf, decor."""
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
    c.put(x + 2, y + 2, 'leaf3'); c.put(x + 3, y + 3, 'leaf3'); c.put(x + 2, y + 3, 'leaf2'); c.put(x + 3, y + 2, 'leaf4')


@sprite('jungle.sofa', note='rattan loveseat with green cushions (single tile, both arms)')
def sofa(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 1, 30, True, True)
    pillow(c, 6, 14)
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


@sprite('jungle.sofaL', note='sectional left end')
def sofa_l(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 1, 31, True, False)
    c.outline(); c.ground_shadow(2, 31, 30)
    return c


@sprite('jungle.sofaM', note='sectional middle')
def sofa_m(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 0, 31, False, False)
    c.outline(); c.ground_shadow(0, 31, 30)
    return c


@sprite('jungle.sofaR', note='sectional right end')
def sofa_r(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 0, 30, False, True)
    pillow(c, 20, 14)
    c.outline(); c.ground_shadow(0, 29, 30)
    return c


@sprite('jungle.table', note='round wooden table with tea set')
def table(pal, seed):
    c = new(pal, seed)
    # pedestal + foot
    c.rect(14, 19, 17, 26, 'wood1'); c.vline(14, 19, 26, 'wood2'); c.vline(17, 19, 26, 'wood0')
    c.ellipse(15.5, 27, 8, 2.5, 'wood1'); c.ellipse(15.5, 26.5, 7, 2, 'wood2')
    # top: front edge ring then lit top
    c.ellipse(15.5, 14, 14, 8.5, 'wood1')
    c.ellipse(15.5, 12.5, 14, 8, 'wood3')
    c.ellipse(15.5, 12, 11, 6, 'wood4')
    c.dither_band(10, 8, 22, 8, 'wood4', 'wood3')
    c.arc if False else None
    for y in (11, 13):                              # grain
        c.hline(7, 24, y, 'wood3')
    # tea set: tray, teapot, two cups
    c.ellipse(15.5, 12, 6, 3, 'wood2')
    c.rect(13, 9, 17, 12, 'mugW'); c.hline(13, 17, 9, 'white'); c.put(18, 10, 'mugW'); c.put(12, 10, 'mugW'); c.hline(14, 16, 8, 'mugW')
    c.rect(8, 11, 10, 13, 'mugW'); c.put(9, 11, 'tea')
    c.rect(21, 11, 23, 13, 'mugW'); c.put(22, 11, 'leaf3')
    c.outline(); c.ground_shadow(5, 27, 30)
    return c


@sprite('jungle.bookshelf', note='wooden shelves, books, small plant, vines')
def bookshelf(pal, seed):
    c = new(pal, seed)
    r = c.rng
    c.rect(1, 2, 30, 30, 'wood1')
    c.rect(2, 3, 29, 29, 'wood0')
    for y0 in (3, 12, 21):                          # three shelves
        c.rect(2, y0, 29, y0 + 7, 'wood0')
        x = 3
        while x < 28:
            w = r.randint(2, 4)
            h = r.randint(5, 7)
            col = r.choice(['arcB1', 'arcR', 'leaf3', 'lantern', 'flowerP', 'cream', 'wood3', 'chairG1'])
            c.rect(x, y0 + 7 - h, x + w - 1, y0 + 7, col)
            c.vline(x, y0 + 7 - h, y0 + 7, 'white' if col in ('cream', 'lantern') else col)
            c.put(x + 1, y0 + 7 - h + 1, 'paper') if w > 2 else None
            x += w
            if r.random() < 0.15:
                x += 2
        c.rect(1, y0 + 8, 30, y0 + 9, 'wood2'); c.hline(1, 30, y0 + 8, 'wood4')
    c.hline(1, 30, 2, 'wood4'); c.vline(1, 2, 30, 'wood3'); c.vline(30, 2, 30, 'wood0')
    # plant on top + vines creeping down the side
    c.rect(24, 0, 28, 2, 'pot'); c.put(25, 0, 'leaf4'); c.put(27, 0, 'leaf3'); c.put(26, -1, 'leaf4')
    for y in range(3, 20):
        c.put(2 + (1 if (y // 3) % 2 else 0), y, 'leaf2')
        if y % 4 == 0:
            c.put(4, y, 'leaf3')
    c.outline(); c.ground_shadow(1, 30, 30) if False else None
    return c


@sprite('jungle.decorA', note='low planter box with ferns and flowers')
def decor_a(pal, seed):
    c = new(pal, seed)
    c.rect(2, 18, 29, 29, 'wood2'); c.hline(2, 29, 18, 'wood4'); c.hline(2, 29, 19, 'wood3')
    c.rect(2, 28, 29, 29, 'wood1'); c.vline(29, 18, 29, 'wood1'); c.vline(2, 18, 29, 'wood3')
    for x in (10, 18, 25):
        c.vline(x, 21, 27, 'wood1')
    c.rect(3, 17, 28, 17, 'dirt1')
    for cx, cy, r_, col in ((8, 13, 5, 'leaf3'), (16, 11, 6, 'leaf3'), (24, 13, 5, 'leaf3')):
        c.shaded_ellipse(cx, cy, r_, r_ - 1, ['leaf1', 'leaf2', 'leaf3', 'leaf4'])
    for x, y, col in ((6, 9, 'flower'), (13, 6, 'flowerY'), (20, 7, 'flowerP'), (25, 10, 'flowerO'), (10, 11, 'flowerW'), (17, 10, 'flower')):
        c.put(x, y, col); c.put(x + 1, y, col); c.put(x, y - 1, 'flowerW')
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


@sprite('jungle.decorB', note='crate with matcha set and books')
def decor_b(pal, seed):
    c = new(pal, seed)
    c.rect(4, 14, 27, 28, 'wood2'); c.rect(4, 14, 27, 16, 'wood3'); c.hline(4, 27, 14, 'wood4')
    c.rect(4, 26, 27, 28, 'wood1')
    for x in (4, 27):
        c.vline(x, 14, 28, 'wood1')
    c.hline(5, 26, 21, 'wood1'); c.hline(5, 26, 22, 'wood3')
    c.line(5, 17, 26, 25, 'wood1') if False else None
    # books stack
    c.rect(6, 11, 14, 13, 'arcB1'); c.hline(6, 14, 11, 'arcB0') if False else None
    c.rect(7, 8, 14, 10, 'lantern'); c.rect(6, 5, 13, 7, 'leaf3')
    c.hline(6, 14, 13, 'white'); c.vline(6, 11, 13, 'arcB0')
    # matcha set: bowl, whisk, cup
    c.ellipse(21, 12, 5, 3, 'mugW'); c.ellipse(21, 11.5, 4, 2, 'leaf4'); c.hline(18, 24, 10, 'leaf5')
    c.rect(19, 13, 23, 14, 'paperD')
    c.rect(25, 10, 26, 13, 'wood3'); c.put(25, 9, 'wood4')
    c.outline(); c.ground_shadow(4, 27, 30)
    return c


@sprite('jungle.hammock', tw=2, note='hammock between two posts (2x1)')
def hammock(pal, seed):
    c = new(pal, seed, 2, 1)
    # posts
    for x in (2, 59):
        c.rect(x, 4, x + 2, 29, 'wood2'); c.vline(x, 4, 29, 'wood3'); c.vline(x + 2, 4, 29, 'wood0')
        c.rect(x - 1, 3, x + 3, 4, 'wood1')
        c.rect(x - 2, 28, x + 4, 30, 'stone2'); c.hline(x - 2, x + 4, 28, 'stone3'); c.hline(x - 2, x + 4, 30, 'stone1')
    # ropes
    c.line(5, 8, 12, 16, 'cream'); c.line(58, 8, 52, 16, 'cream')
    # fabric curve (sagging): rows by parabola
    import math
    for x in range(10, 55):
        t = (x - 32) / 22.0
        top = int(15 + 7 * (1 - t * t) * 0.0 + 6 * (1 - t * t))
        top = int(13 + 8 * (1 - t * t))
        for y in range(top, top + 7):
            col = 'chairG1' if (x // 4 + (y - top)) % 5 else 'chairG2'
            c.put(x, y, col)
        c.put(x, top, 'chairG2'); c.put(x, top + 6, 'chairG0'); c.put(x, top + 5, 'chairG0' if x % 2 else 'chairG1')
    for x in range(14, 52, 4):                      # weave stripes
        t = (x - 32) / 22.0
        top = int(13 + 8 * (1 - t * t))
        c.vline(x, top + 1, top + 4, 'cream')
    # pillow + book
    c.rect(18, 15, 24, 20, 'cream'); c.hline(18, 24, 15, 'white'); c.put(21, 17, 'leaf3')
    c.outline(); c.ground_shadow(14, 50, 30)
    return c
