"""Shared chairs (neutral charcoal) + stool + the seated-avatar chair-back overlay."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Canvas

R = ('seat0', 'seat1', 'seat2', 'seat3')


def star_base(c, cx=16, top=26):
    c.line(cx, top + 1, 6, 29, 'metalD'); c.line(cx, top + 1, 26, 29, 'metalD'); c.line(cx, top + 1, cx, 30, 'metalD')
    c.line(cx, top, 9, 28, 'metalM'); c.line(cx, top, 23, 28, 'metalM')
    for x in (5, cx, 26):
        c.rect(x, 29, x + 1, 30, 'metalD'); c.put(x, 29, 'metalM')


def lift(c, y0, y1=26):
    c.rect(15, y0, 16, y1, 'metalM'); c.vline(15, y0, y1, 'metalL'); c.vline(16, y0, y1, 'metalD')


def mesh(c, x0, y0, x1, y1, r):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x + y) % 3 == 0:
                c.put(x, y, r[0] if y > (y0 + y1) // 2 else r[2])


def chair_front(pal, seed, r=R):
    c = new(pal, seed)
    star_base(c); lift(c, 21)
    c.rect(6, 14, 25, 22, r[1])
    c.hline(7, 24, 14, r[2]); c.rect(6, 15, 7, 21, r[2]); c.dither_band(8, 15, 9, 21, r[2], r[1])
    c.hline(7, 25, 22, r[0]); c.rect(24, 15, 25, 22, r[0]); c.dither_band(22, 15, 23, 21, r[1], r[0])
    for x in range(9, 23, 2):
        c.put(x, 20, r[0])
    for x in (3, 27):
        c.rect(x, 13, x + 1, 20, 'metalD'); c.vline(x, 13, 20, 'metalM')
        c.rect(x - 1, 11, x + 2, 12, r[0]); c.hline(x - 1, x + 2, 11, r[1])
    c.rect(8, 1, 23, 13, r[1])
    c.hline(9, 22, 1, r[2]); c.vline(8, 2, 12, r[2]); c.vline(23, 2, 13, r[0]); c.hline(8, 23, 13, r[0])
    mesh(c, 10, 3, 21, 11, r)
    c.rect(11, 9, 20, 11, r[2]); c.hline(11, 20, 11, r[1])
    c.rect(14, 12, 17, 13, 'metalM')
    c.outline(); c.ground_shadow(6, 26, 30)
    return c


def chair_back(pal, seed, r=R):
    c = new(pal, seed)
    star_base(c, top=27)
    # seat top, visible behind the back-rest
    c.rect(6, 4, 25, 15, r[1]); c.hline(7, 24, 4, r[2]); c.rect(6, 5, 7, 14, r[2])
    c.rect(24, 5, 25, 15, r[0])
    # armrests
    for x in (3, 27):
        c.rect(x, 6, x + 1, 17, 'metalD'); c.vline(x, 6, 17, 'metalM')
        c.rect(x - 1, 4, x + 2, 5, r[0]); c.hline(x - 1, x + 2, 4, r[1])
    # back-rest in front (lower)
    c.rect(8, 15, 23, 27, r[1])
    c.hline(9, 22, 15, r[2]); c.vline(8, 16, 26, r[2]); c.vline(23, 16, 27, r[0]); c.hline(8, 23, 27, r[0])
    mesh(c, 10, 17, 21, 25, r)
    c.rect(11, 21, 20, 24, r[2]); c.hline(11, 20, 24, r[1])
    c.rect(14, 27, 17, 28, 'metalM')
    c.outline(); c.ground_shadow(6, 26, 30)
    return c


def chair_side(pal, seed, r=R):
    """Facing left: back-rest on the right."""
    c = new(pal, seed)
    star_base(c); lift(c, 21)
    c.rect(5, 15, 22, 22, r[1]); c.hline(6, 21, 15, r[2]); c.vline(5, 16, 21, r[2]); c.hline(5, 22, 22, r[0]) if False else None
    c.hline(6, 22, 22, r[0]); c.dither_band(8, 16, 20, 16, r[2], r[1])
    for x in range(8, 21, 2):
        c.put(x, 20, r[0])
    c.rect(20, 3, 25, 21, r[1]); c.vline(20, 4, 20, r[2]); c.vline(25, 3, 21, r[0]); c.hline(20, 25, 3, r[2])
    mesh(c, 21, 5, 24, 18, r)
    c.rect(21, 12, 24, 15, r[2])
    c.rect(7, 11, 19, 12, 'metalD'); c.rect(6, 9, 11, 10, r[0]); c.hline(6, 11, 9, r[1])     # arm
    c.rect(18, 12, 19, 15, 'metalD')
    c.outline(); c.ground_shadow(6, 26, 30)
    return c


@sprite('chairDown', note='neutral office chair, sitter faces down (camera)')
def chair_down(pal, seed):
    return chair_front(pal, seed)


@sprite('chairUp', note='neutral office chair, sitter faces up (we see the back-rest)')
def chair_up(pal, seed):
    return chair_back(pal, seed)


@sprite('chairLeft', note='neutral office chair, sitter faces left')
def chair_left(pal, seed):
    return chair_side(pal, seed)


@sprite('chairRight', note='neutral office chair, sitter faces right')
def chair_right(pal, seed):
    return chair_side(pal, seed).flip_h()


@sprite('chairBackOverlay', note='lower back-rest drawn over a seated avatar facing up (replaces makeChairBackCanvas)')
def chair_back_overlay(pal, seed):
    c = chair_back(pal, seed)
    c.where(lambda x, y, v: y < 17, None)
    return c


@sprite('stool', note='round wooden stool')
def stool(pal, seed):
    c = new(pal, seed)
    for x in (9, 21):
        c.rect(x, 18, x + 1, 28, 'cwood1'); c.vline(x + 1, 18, 28, 'cwood0'); c.vline(x, 18, 28, 'cwood2')
    c.rect(15, 18, 16, 29, 'cwood1'); c.vline(16, 18, 29, 'cwood0')
    c.hline(9, 22, 24, 'cwood1')
    c.ellipse(15.5, 17, 11, 6, 'cwood1')
    c.ellipse(15.5, 15.5, 11, 5.5, 'cwood3')
    c.ellipse(15.5, 15, 8, 3.5, 'cwood4')
    c.hline(10, 21, 15, 'cwood3'); c.put(13, 13, 'cwood4')
    c.outline(); c.ground_shadow(7, 25, 30)
    return c
