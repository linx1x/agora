"""Zen furniture: low indigo futon sofas, a round tea table, stacked stones and a tea tray."""
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
    c.put(x + 2, y + 2, 'cream1'); c.put(x + 3, y + 3, 'cream1'); c.put(x + 2, y + 3, 'cream0'); c.put(x + 3, y + 2, 'white')


@sprite('zen.sofa', note='rattan loveseat with teal cushions (single tile, both arms)')
def sofa(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 1, 30, True, True)
    pillow(c, 6, 14)
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


@sprite('zen.sofaL', note='sectional left end')
def sofa_l(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 1, 31, True, False)
    c.outline(); c.ground_shadow(2, 31, 30)
    return c


@sprite('zen.sofaM', note='sectional middle')
def sofa_m(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 0, 31, False, False)
    c.outline(); c.ground_shadow(0, 31, 30)
    return c


@sprite('zen.sofaR', note='sectional right end')
def sofa_r(pal, seed):
    c = new(pal, seed)
    sofa_seat(c, 0, 30, False, True)
    pillow(c, 20, 14)
    c.outline(); c.ground_shadow(0, 29, 30)
    return c


@sprite('zen.table', note='low round tea table with a teapot and two cups')
def table(pal, seed):
    c = new(pal, seed)
    c.rect(10, 20, 12, 26, 'wood1'); c.rect(19, 20, 21, 26, 'wood1'); c.vline(12, 20, 26, 'wood0'); c.vline(21, 20, 26, 'wood0')
    c.ellipse(15.5, 27, 9, 2.4, 'wood1')
    c.ellipse(15.5, 15, 14, 8, 'wood1')
    c.ellipse(15.5, 13.5, 14, 7.5, 'wood2')
    c.ellipse(15.5, 13, 12, 6, 'wood3')
    for x in range(6, 26, 3):
        c.put(x, 12, 'wood2'); c.put(x + 1, 14, 'wood4')
    c.ellipse(15.5, 13, 5, 2.5, 'indigo1')                         # runner
    c.rect(13, 8, 17, 12, 'stone3'); c.hline(13, 17, 8, 'white'); c.put(18, 9, 'stone3'); c.put(18, 10, 'stone3'); c.put(14, 7, 'stone2'); c.put(15, 7, 'stone3')   # teapot
    c.rect(8, 12, 10, 14, 'mugW'); c.put(9, 13, 'tea'); c.rect(21, 11, 23, 13, 'mugW'); c.put(22, 12, 'tea')
    c.outline(); c.ground_shadow(5, 27, 30)
    return c


@sprite('zen.decorA', note='balanced stack of river stones on a moss patch')
def decor_a(pal, seed):
    c = new(pal, seed)
    c.ellipse(16, 27, 12, 3.4, 'moss0'); c.ellipse(16, 26.5, 10, 2.8, 'moss1'); c.ellipse(13, 26, 4, 1.2, 'moss2')
    for cx, cy, rx, ry, col in ((15, 23, 9, 5, 'stone1'), (16, 16, 7, 4.2, 'stone2'), (16, 10, 5, 3.4, 'stone2'), (17, 5.5, 3, 2.3, 'stone3')):
        c.ellipse(cx, cy + 1.2, rx + 0.4, ry, 'stone0'); c.ellipse(cx, cy, rx, ry, col); c.ellipse(cx - 1.4, cy - 1.2, rx * 0.5, ry * 0.4, 'stone3')
    c.put(10, 22, 'moss1'); c.put(11, 22, 'moss2'); c.put(21, 16, 'moss1')
    c.outline(); c.ground_shadow(3, 29, 30)
    return c


@sprite('zen.decorB', note='lacquer tea tray with a kettle and a sweet, between two cushions')
def decor_b(pal, seed):
    c = new(pal, seed)
    for x0 in (0, 22):
        c.ellipse(x0 + 5, 24, 5.5, 3.5, 'indigo0'); c.ellipse(x0 + 5, 23, 4.5, 2.5, 'indigo1'); c.put(x0 + 5, 22, 'indigo3'); c.put(x0 + 3, 23, 'indigo2')
    c.ellipse(15.5, 20, 11, 5, 'bark0'); c.ellipse(15.5, 19, 11, 5, 'terraD'); c.ellipse(15.5, 18.5, 9, 3.5, 'terra'); c.ellipse(15.5, 18, 7, 2.4, 'bark1')
    c.rect(8, 22, 9, 27, 'bark1'); c.rect(22, 22, 23, 27, 'bark1'); c.vline(9, 22, 27, 'bark0'); c.vline(23, 22, 27, 'bark0')
    c.rect(11, 12, 15, 17, 'metalD'); c.hline(11, 15, 12, 'metalM'); c.hline(12, 14, 11, 'metalD'); c.put(16, 13, 'metalD'); c.put(16, 14, 'metalD'); c.vline(11, 13, 17, 'metalM')
    c.put(13, 9, 'white'); c.put(14, 8, 'stone3')                                      # steam
    c.rect(18, 16, 20, 18, 'mugW'); c.put(19, 17, 'tea'); c.rect(21, 15, 22, 17, 'sakura2'); c.put(21, 15, 'sakura3')
    c.outline(); c.ground_shadow(2, 29, 30)
    return c
