"""Boreal floors: dark slate with pine needles, frosted patches, slate slab paving, plank deck, wool rug."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def slate(pal, seed, needles=7, specks=10):
    c = new(pal, seed)
    c.fill_gradient(['sand1', 'sand2', 'sand1', 'sand0'], seed=seed, scale=6, gain=6.0, center=0.5)
    r = c.rng
    for _ in range(needles):                     # short pine needles, two tones
        x, y = r.randint(1, 29), r.randint(1, 30)
        dx = r.choice((-1, 1))
        for i in range(3):
            c.put(x + dx * i, y + i // 2, 'needle2')
        c.put(x + dx * 3, y + 1, 'needle1')
    for _ in range(specks):
        c.put(r.randint(0, 31), r.randint(0, 31), 'sand3' if r.random() < 0.6 else 'sand0')
    return c


@sprite('boreal.floor', note='dark blue-grey slate with a few pine needles, seamless')
def floor(pal, seed):
    return slate(pal, seed)


@sprite('boreal.floorB', note='slate with pine cones and needle drifts')
def floor_b(pal, seed):
    c = slate(pal, seed + 1, needles=14)
    r = c.rng
    for _ in range(2):
        x, y = r.randint(3, 26), r.randint(3, 26)
        c.rect(x, y, x + 2, y + 3, 'bark2'); c.put(x, y, 'bark3'); c.put(x + 2, y + 3, 'bark1')
        c.hline(x, x + 2, y + 1, 'bark1'); c.hline(x, x + 2, y + 3, 'bark1')
        c.put(x - 1, y + 4, 'needle2')
    return c


@sprite('boreal.floorC', note='slate with a frost patch and snow-dusted rocks')
def floor_c(pal, seed):
    c = slate(pal, seed + 2, needles=3, specks=6)
    r = c.rng
    x, y = r.randint(5, 18), r.randint(6, 20)
    for dy in range(-3, 4):                       # frost patch: dithered, lighter at the core
        for dx in range(-5, 6):
            d = dx * dx / 25.0 + dy * dy / 10.0
            if d < 1.0 and (dx + dy) % 2 == 0:
                c.put(x + dx, y + dy, 'sand3' if d > 0.5 else 'sand4')
    for _ in range(3):
        rx, ry = r.randint(2, 27), r.randint(2, 28)
        c.rect(rx, ry + 1, rx + 2, ry + 2, 'stone1'); c.hline(rx, rx + 2, ry, 'snow1'); c.put(rx + 3, ry + 1, 'stone0')
    return c


def slab(pal, seed, damp=False):
    c = new(pal, seed)
    r = c.rng
    cols = ('stone1', 'stone2') if not damp else ('stone0', 'stone1')
    for ry in range(2):
        y = ry * 16
        off = 8 if ry else 0
        for bx in (off - 16, off, off + 16):
            col = r.choice(cols)
            c.rect(bx + 1, y + 1, bx + 14, y + 14, col)
            c.hline(bx + 1, bx + 14, y + 1, 'stone3'); c.vline(bx + 1, y + 1, y + 14, 'stone3')
            c.hline(bx + 1, bx + 14, y + 14, 'stone0')
            for _ in range(3):
                c.put(r.randint(bx + 2, bx + 13) % 32, r.randint(y + 2, y + 13), 'stone2' if col == 'stone1' else 'stone1')
        c.hline(0, 31, y, 'stone0'); c.hline(0, 31, y + 15, 'stone0')
        for bx in (off, off + 16, off - 16):
            c.vline(bx % 32, y, y + 15, 'stone0')
    for _ in range(4):                             # a little snow in the joints
        c.put(r.randint(0, 31), r.choice((0, 16)), 'snow0')
    return c


@sprite('boreal.dirt', note='slate slab paving, seamless')
def dirt_a(pal, seed):
    return slab(pal, seed)


@sprite('boreal.dirtB', note='darker wet slab with a crack and frost')
def dirt_b(pal, seed):
    c = slab(pal, seed + 1, damp=True)
    c.line(4, 6, 12, 12, 'stone0'); c.line(12, 12, 13, 18, 'stone0'); c.put(5, 6, 'snow1'); c.put(6, 7, 'snow0')
    return c


@sprite('boreal.floorAlt', note='warm timber planks (desk platforms, aisles)')
def floor_alt(pal, seed):
    c = new(pal, seed)
    r = c.rng
    plank_h = 8
    for row in range(4):
        y0 = row * plank_h
        base = 'wood2' if row % 2 == 0 else 'wood3'
        hi = 'wood3' if row % 2 == 0 else 'wood4'
        c.rect(0, y0, 31, y0 + plank_h - 1, base)
        c.hline(0, 31, y0, 'wood1')
        c.hline(0, 31, y0 + 1, hi)
        for _ in range(4):
            x = r.randint(0, 27)
            c.hline(x, x + r.randint(2, 6), y0 + r.randint(3, 6), 'wood3' if base == 'wood2' else 'wood2')
        sx = (row * 11 + 6) % 32
        c.vline(sx, y0, y0 + plank_h - 1, 'wood1')
        c.put((sx + 2) % 32, y0 + 3, 'wood1'); c.put((sx - 2) % 32, y0 + 3, 'wood1')
        for _ in range(2):                                   # snow melt in the seams
            mx = r.randint(0, 31)
            c.put(mx, y0, 'snow0')
    return c


@sprite('boreal.rug', note='wool rug: deep red with a cream border and diamond pattern')
def rug(pal, seed):
    c = new(pal, seed)
    for y in range(32):
        for x in range(32):
            c.put(x, y, 'wool1' if ((x // 2 + y // 2) % 2 == 0) else 'wool0')
    for y in range(32):
        for x in range(32):
            if (x + y) % 8 == 0:
                c.put(x, y, 'wool2')
    for cx, cy in ((8, 8), (24, 24), (24, 8), (8, 24)):      # cream diamond motifs
        for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
            c.put(cx + dx, cy + dy, 'wool3')
        c.put(cx, cy, 'wool2')
    return c
