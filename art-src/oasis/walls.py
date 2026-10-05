"""Oasis walls: cream plaster with a terracotta cap, arched windows with turquoise shutters, bougainvillea."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def plaster(c, y0=0, y1=31):
    c.fill_gradient(['plaster1', 'plaster2', 'plaster1'], seed=31, scale=5, gain=4.0, region=(0, y0, 31, y1))
    r = c.rng
    for _ in range(30):                                   # trowel marks
        x, y = r.randint(0, 28), r.randint(y0, y1)
        c.hline(x, x + r.randint(1, 3), y, 'plaster3' if r.random() < 0.5 else 'plaster0')


@sprite('oasis.wallFront', note='plaster face with a clay-tile eave shadow and bougainvillea')
def wall_front(pal, seed):
    c = new(pal, seed)
    plaster(c)
    c.rect(0, 0, 31, 3, 'terraD'); c.hline(0, 31, 0, 'terra'); c.dither_band(0, 4, 31, 5, 'terraD', 'plaster0')   # eave + shadow
    for x in range(0, 32, 8):
        c.vline(x, 0, 3, 'terra')
    c.dither_band(0, 26, 31, 31, 'plaster1', 'plaster0')                                                              # warm base
    c.rect(0, 29, 31, 31, 'stone1'); c.hline(0, 31, 29, 'stone2'); c.hline(0, 31, 31, 'stone0')                        # sandstone plinth
    r = c.rng
    for x0 in (6, 22):                                                                                                  # bougainvillea drips
        ln = r.randint(8, 14)
        for i in range(ln):
            c.put(x0 + (1 if i % 4 == 2 else 0), 6 + i, 'leaf1')
            if i % 2 == 0:
                c.put(x0 - 1, 6 + i, 'flowerP'); c.put(x0 + 2, 6 + i + 1, 'noteP')
        c.put(x0, 6 + ln, 'flowerP')
    return c


@sprite('oasis.wallTop', note='sandstone coping seen from above')
def wall_top(pal, seed):
    c = new(pal, seed)
    r = c.rng
    c.rect(0, 0, 31, 31, 'terra')
    for row in range(4):                                  # rows of barrel clay tiles
        y = row * 8
        c.rect(0, y, 31, y + 7, 'terra')
        c.hline(0, 31, y, 'terraD')
        for x in range(0, 32, 6):
            c.vline((x + row * 3) % 32, y + 1, y + 7, 'terraD')
            c.vline((x + row * 3 + 1) % 32, y + 1, y + 6, 'sand3' if False else 'terra')
        c.hline(0, 31, y + 1, 'wood2')
    for _ in range(22):
        c.put(r.randint(0, 31), r.randint(0, 31), r.choice(['terraD', 'sand1', 'wood1']))
    return c


@sprite('oasis.window', note='plaster wall with an arched window and turquoise shutters')
def window(pal, seed):
    c = new(pal, seed)
    plaster(c)
    c.rect(0, 0, 31, 2, 'terraD'); c.hline(0, 31, 0, 'terra')
    c.rect(0, 29, 31, 31, 'stone1'); c.hline(0, 31, 29, 'stone2'); c.hline(0, 31, 31, 'stone0')
    # arch frame (stone), glass inside
    c.rect(7, 8, 24, 27, 'stone2'); c.ellipse(15.5, 9, 8.5, 6.5, 'stone2')
    c.rect(9, 10, 22, 27, 'plaster0'); c.ellipse(15.5, 11, 6.5, 5, 'plaster0')
    c.rect(10, 11, 21, 26, 'glassA'); c.ellipse(15.5, 12, 5.5, 4.5, 'glassA')
    c.rect(10, 11, 21, 17, 'glassB'); c.ellipse(15.5, 12, 5.5, 4.5, 'glassB')
    c.rect(10, 20, 21, 26, 'palm1'); c.dither_band(10, 18, 21, 19, 'glassA', 'palm1')       # palms outside
    for x, h in ((12, 4), (15, 6), (19, 5)):
        c.rect(x, 26 - h, x + 1, 26, 'palm0')
    c.line(11, 17, 17, 11, 'white'); c.line(11, 20, 20, 12, 'glassB')
    c.vline(15, 8, 26, 'stone2'); c.vline(16, 8, 26, 'stone3')                                # mullion
    c.rect(3, 12, 6, 26, 'tile0'); c.rect(25, 12, 28, 26, 'tile0')                            # open turquoise shutters
    for y in range(13, 26, 3):
        c.hline(4, 5, y, 'tile1'); c.hline(26, 27, y, 'tile1')
    c.vline(3, 12, 26, 'tile1'); c.vline(28, 12, 26, 'tile0')
    c.rect(5, 27, 26, 28, 'stone3'); c.hline(5, 26, 28, 'stone1')                             # sill
    c.rect(8, 25, 10, 26, 'pot'); c.put(9, 24, 'palm3'); c.put(10, 24, 'flowerP')              # tiny planter
    return c


@sprite('oasis.hanging', note='bougainvillea hanging from above (above layer)')
def hanging(pal, seed):
    c = new(pal, seed)
    r = c.rng
    for x0, ln in ((5, 19), (13, 9), (20, 16), (27, 23)):
        for i in range(ln):
            c.put(x0 + (1 if (i // 4) % 2 else 0), i, 'leaf1')
            if i % 3 == 1:
                c.rect(x0 - 2, i, x0 - 1, i + 1, 'leaf2'); c.put(x0 - 2, i, 'leaf3')
            if i % 3 == 2:
                c.rect(x0 + 2, i, x0 + 3, i + 1, 'flowerP'); c.put(x0 + 3, i, 'noteP')
        c.rect(x0 - 1, ln, x0 + 2, ln + 1, 'flowerP'); c.put(x0 + 1, ln + 1, 'noteP'); c.put(x0, ln, 'noteP')
    c.outline()
    return c
