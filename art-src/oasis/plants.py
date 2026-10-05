"""Oasis plants: areca palm (A), agave (B), bird-of-paradise (C), in clay and sandstone pots."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new

LEAF = ['leaf1', 'leaf2', 'leaf3', 'leaf4', 'leaf5']


def clay_pot(c, x0=9, x1=22, y0=23, y1=30):
    c.rect(x0, y0, x1, y1, 'terra')
    c.hline(x0 - 1, x1 + 1, y0, 'wood2'); c.hline(x0 - 1, x1 + 1, y0 + 1, 'terra')
    c.vline(x0, y0 + 1, y1, 'wood2'); c.vline(x1, y0 + 1, y1, 'terraD'); c.vline(x1 - 1, y0 + 1, y1, 'terraD')
    c.hline(x0, x1, y1, 'terraD')
    c.hline(x0 + 1, x1 - 1, y0 + 3, 'terraD')                   # painted band
    for x in range(x0 + 2, x1 - 1, 3):
        c.put(x, y0 + 4, 'turq1')
    c.rect(x0 + 1, y0 - 1, x1 - 1, y0 - 1, 'dirt1')


def stone_planter(c, x0=7, x1=24, y0=22, y1=30):
    c.rect(x0, y0, x1, y1, 'stone2')
    c.hline(x0, x1, y0, 'stone3'); c.hline(x0, x1, y0 + 1, 'stone3')
    c.rect(x0, y1 - 1, x1, y1, 'stone1')
    c.vline(x0, y0, y1, 'stone3'); c.vline(x1, y0, y1, 'stone1'); c.vline(x1 - 1, y0 + 2, y1 - 2, 'stone1')
    for y in (y0 + 4, y1 - 3):
        c.hline(x0, x1, y, 'stone1')
    c.hline(x0 + 1, x1 - 1, y0 - 1, 'dirt1')


@sprite('oasis.plantA', note='areca palm in a clay pot')
def areca(pal, seed):
    c = new(pal, seed)
    clay_pot(c, 8, 23, 23, 30)
    ox, oy = 16, 22
    for a in (-160, -125, -95, -65, -30, 5):
        c.line(ox, oy, int(ox + math.cos(math.radians(a)) * 9), int(oy + math.sin(math.radians(a)) * 9), 'leaf1')
    for a, L in ((-165, 12), (-135, 13), (-100, 14), (-72, 13), (-42, 13), (-12, 12)):
        mx = ox + math.cos(math.radians(a)) * L * 0.55
        my = oy + math.sin(math.radians(a)) * L * 0.6
        c.leaf(mx, my, L * 0.6, 2.8, a, LEAF, slits=(-0.6, -0.3, 0.0, 0.3, 0.6), rib=True, cut_v=0.4, cut_w=0.07)
    c.outline(); c.ground_shadow(8, 24, 31)
    return c


@sprite('oasis.plantB', note='agave in a clay pot')
def agave(pal, seed):
    c = new(pal, seed)
    clay_pot(c, 9, 22, 24, 30)
    ox, oy = 16, 24
    # fat spiky blades fanning out, blue-green tips
    for a, L in ((-175, 12), (-150, 13), (-120, 14), (-95, 15), (-65, 14), (-35, 13), (-8, 12), (-108, 11), (-78, 11)):
        tx, ty = ox + math.cos(math.radians(a)) * L, oy + math.sin(math.radians(a)) * L * 0.95
        c.poly([(ox - 2, oy), (ox + 2, oy), (tx, ty)], 'palm2')
        c.line(ox, oy, int(tx), int(ty), 'palm3')
        c.put(int(tx), int(ty), 'leaf5')
    c.put(16, 14, 'palm3'); c.put(16, 11, 'flowerO'); c.put(17, 10, 'flower')
    c.outline(); c.ground_shadow(9, 23, 31)
    return c


@sprite('oasis.plantC', note='bird-of-paradise in a sandstone planter')
def bird_of_paradise(pal, seed):
    c = new(pal, seed)
    stone_planter(c, 8, 23, 24, 31)
    ox, oy = 16, 24
    for a, L in ((-150, 12), (-120, 13), (-90, 14), (-60, 13), (-30, 12)):
        tx, ty = ox + math.cos(math.radians(a)) * L, oy + math.sin(math.radians(a)) * L
        c.line(ox, oy, int(tx), int(ty), 'leaf1')
        c.leaf((ox + tx) / 2, (oy + ty) / 2, L * 0.55, 3.6, a, LEAF, slits=(-0.4, 0.0, 0.4), rib=True, cut_v=0.5, cut_w=0.07)
    # orange crane-flower
    c.line(20, 14, 23, 8, 'leaf2')
    c.poly([(22, 8), (26, 6), (24, 10)], 'flowerO'); c.put(25, 6, 'flowerY'); c.put(23, 8, 'flower'); c.put(22, 7, 'turq1')
    c.outline(); c.ground_shadow(8, 24, 31)
    return c
