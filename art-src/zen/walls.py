"""Zen walls: warm plaster between dark posts, shoji paper windows, wisteria hanging from the eave."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def plaster(c, y0=0, y1=31):
    c.fill_gradient(['plaster1', 'plaster2', 'plaster1'], seed=31, scale=6, gain=3.0, region=(0, y0, 31, y1))
    r = c.rng
    for _ in range(26):
        x, y = r.randint(0, 28), r.randint(y0, y1)
        c.hline(x, x + r.randint(1, 3), y, 'plaster3' if r.random() < 0.5 else 'plaster0')


@sprite('zen.wallFront', note='plaster wall with dark timber posts, a beam and a stone plinth')
def wall_front(pal, seed):
    c = new(pal, seed)
    plaster(c)
    c.rect(0, 0, 31, 3, 'bark1'); c.hline(0, 31, 0, 'bark2'); c.hline(0, 31, 3, 'bark0')              # beam
    c.dither_band(0, 4, 31, 5, 'plaster0', 'plaster1')
    for x in (0, 15):                                                                                   # posts
        c.rect(x, 0, x + 1, 27, 'bark1'); c.vline(x, 0, 27, 'bark2'); c.vline(x + 1, 4, 27, 'bark0')
    c.rect(0, 27, 31, 31, 'stone1'); c.hline(0, 31, 27, 'stone2'); c.hline(0, 31, 31, 'stone0')
    c.vline(8, 27, 31, 'stone0'); c.vline(24, 27, 31, 'stone0')
    return c


@sprite('zen.wallTop', note='dark timber coping with grey roof tiles seen from above')
def wall_top(pal, seed):
    c = new(pal, seed)
    r = c.rng
    for row in range(4):
        y = row * 8
        c.rect(0, y, 31, y + 7, 'stone0')
        c.hline(0, 31, y, 'stone1')
        for x in range(0, 32, 4):
            c.vline((x + row * 2) % 32, y + 1, y + 7, 'stone1')
        c.hline(0, 31, y + 7, 'bark0')
    for _ in range(22):
        c.put(r.randint(0, 31), r.randint(0, 31), r.choice(['stone1', 'stone2', 'moss0']))
    return c


@sprite('zen.window', note='plaster wall with a shoji paper window in a dark lattice')
def window(pal, seed):
    c = new(pal, seed)
    plaster(c)
    c.rect(0, 0, 31, 3, 'bark1'); c.hline(0, 31, 0, 'bark2'); c.hline(0, 31, 3, 'bark0')
    c.rect(0, 27, 31, 31, 'stone1'); c.hline(0, 31, 27, 'stone2'); c.hline(0, 31, 31, 'stone0')
    c.rect(4, 6, 27, 26, 'bark0'); c.rect(5, 7, 26, 25, 'bark1')                     # frame
    c.rect(6, 8, 25, 24, 'shoji2')                                                    # paper, lit from outside
    c.dither_band(6, 8, 25, 10, 'shoji1', 'shoji2')
    for x in (10, 15, 20):
        c.vline(x, 8, 24, 'bark1')
    for y in (13, 18):
        c.hline(6, 25, y, 'bark1')
    c.put(8, 20, 'maple2'); c.put(9, 19, 'maple3'); c.put(22, 11, 'sakura2')           # silhouettes of branches through the paper
    c.line(7, 23, 12, 21, 'shoji0'); c.line(18, 12, 24, 9, 'shoji0')
    c.rect(3, 26, 28, 27, 'bark2'); c.hline(3, 28, 27, 'bark0')
    c.rect(8, 24, 10, 25, 'pot'); c.put(9, 23, 'bons2'); c.put(10, 22, 'bons3')
    return c


@sprite('zen.hanging', note='wisteria racemes hanging from above (above layer)')
def hanging(pal, seed):
    c = new(pal, seed)
    r = c.rng
    for x0, ln in ((5, 18), (12, 10), (19, 15), (26, 22)):
        c.vline(x0, 0, 2, 'bark1')
        for i in range(2, ln):
            c.put(x0 + (1 if (i // 3) % 2 else 0), i, 'lotusL' if i % 3 else 'lotus')
            if i % 2:
                c.put(x0 - 1, i, 'lotus'); c.put(x0 + 2, i, 'lotusL')
        c.put(x0, ln, 'lotus'); c.put(x0 + 1, ln + 1, 'lotusL')
        c.put(x0 + 1, 3, 'bons2'); c.put(x0 - 1, 5, 'bons1')
    c.outline()
    return c
