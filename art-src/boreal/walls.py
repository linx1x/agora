"""Boreal walls: dark log-cabin wall with a snowy eave, glass wall windows with a pine view, pine garland."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def logs(c, y0=0, y1=31):
    r = c.rng
    for y in range(y0, y1 + 1, 6):
        h = min(5, y1 - y)
        c.rect(0, y, 31, y + h, 'bark1')
        c.hline(0, 31, y, 'bark2'); c.hline(0, 31, y + 1, 'bark3')
        c.hline(0, 31, y + h, 'bark0')
        for _ in range(3):
            x = r.randint(0, 26)
            c.hline(x, x + r.randint(2, 5), y + 3, 'bark2')
        c.put(r.randint(1, 30), y + 3, 'bark0')


@sprite('boreal.wallFront', note='log wall with a snowy eave and a stone plinth')
def wall_front(pal, seed):
    c = new(pal, seed)
    logs(c)
    c.rect(0, 0, 31, 3, 'snow1'); c.hline(0, 31, 0, 'white'); c.dither_band(0, 4, 31, 5, 'snow0', 'bark1')
    for x in range(0, 32, 8):
        c.put(x + 2, 4, 'snow1'); c.put(x + 3, 5, 'snow1')           # icicles
    c.rect(0, 28, 31, 31, 'stone1'); c.hline(0, 31, 28, 'stone2'); c.hline(0, 31, 31, 'stone0')
    for x in range(0, 32, 8):
        c.vline(x, 28, 31, 'stone0')
    return c


@sprite('boreal.wallTop', note='snow-capped log ends seen from above')
def wall_top(pal, seed):
    c = new(pal, seed)
    r = c.rng
    c.rect(0, 0, 31, 31, 'snow1')
    for row in range(4):
        y = row * 8
        for x in range(0, 32, 8):
            cx = x + 4 + (4 if row % 2 else 0)
            c.ellipse(cx % 32, y + 4, 4, 3.4, 'bark2'); c.ellipse(cx % 32, y + 4, 2.4, 2, 'bark3'); c.put(cx % 32, y + 4, 'bark1')
    for _ in range(26):
        c.put(r.randint(0, 31), r.randint(0, 31), r.choice(['snow0', 'white', 'snow2']))
    return c


@sprite('boreal.window', note='log wall with a tall glass window onto the pines')
def window(pal, seed):
    c = new(pal, seed)
    logs(c)
    c.rect(0, 0, 31, 2, 'snow1'); c.hline(0, 31, 0, 'white')
    c.rect(0, 28, 31, 31, 'stone1'); c.hline(0, 31, 28, 'stone2'); c.hline(0, 31, 31, 'stone0')
    c.rect(5, 6, 26, 27, 'bark0'); c.rect(6, 7, 25, 26, 'bark2')             # frame
    c.rect(7, 8, 24, 25, 'glass2')
    c.rect(7, 8, 24, 14, 'glass1'); c.dither_band(7, 15, 24, 16, 'glass1', 'glass2')
    c.rect(7, 22, 24, 25, 'snow1')                                           # snow bank outside
    for x, h in ((9, 8), (14, 12), (19, 9), (22, 6)):                         # pines outside
        c.poly([(x - 3, 22), (x + 3, 22), (x, 22 - h)], 'pine1'); c.put(x, 22 - h + 1, 'pine3')
    c.line(8, 12, 12, 9, 'white'); c.line(8, 15, 15, 9, 'glass2')
    c.vline(15, 8, 25, 'bark2'); c.vline(16, 8, 25, 'bark1'); c.hline(7, 24, 17, 'bark2')   # mullions
    c.rect(4, 26, 27, 27, 'bark3'); c.hline(4, 27, 27, 'bark1')                # sill
    c.rect(9, 25, 11, 26, 'pot'); c.put(10, 24, 'pine3'); c.put(11, 24, 'flower')
    return c


@sprite('boreal.hanging', note='pine garland with fairy lights and berries (above layer)')
def hanging(pal, seed):
    c = new(pal, seed)
    r = c.rng
    for x0, ln in ((5, 15), (13, 8), (20, 13), (27, 18)):
        for i in range(ln):
            c.put(x0 + (1 if (i // 3) % 2 else 0), i, 'pine1')
            if i % 2 == 1:
                c.rect(x0 - 2, i, x0 - 1, i + 1, 'pine2'); c.put(x0 - 2, i, 'pine3')
            if i % 3 == 2:
                c.rect(x0 + 2, i, x0 + 3, i + 1, 'pine2'); c.put(x0 + 3, i, 'pine3')
        c.put(x0, ln, 'fire2'); c.put(x0 + 1, ln, 'fire3')                    # warm light at the tip
        c.put(x0 - 2, 3, 'fire0'); c.put(x0 + 2, 6, 'fire0')                  # berries
    c.outline()
    return c
