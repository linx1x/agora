"""Oasis floors: warm sand with soft dune ripples, pebbles, dry-garden variants, sandstone slabs, light deck, woven rug."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def sand(pal, seed, ripples=3, specks=10):
    c = new(pal, seed)
    c.fill_gradient(['sand1', 'sand2', 'sand3', 'sand2'], seed=seed, scale=6, gain=7.0, center=0.48)
    r = c.rng
    for _ in range(ripples):                     # soft dune ripple: two tones, wrap-safe
        y = r.randint(3, 28); x0 = r.randint(0, 31); ln = r.randint(7, 13)
        for i in range(ln):
            x = (x0 + i) % 32
            yy = y + (1 if (i // 4) % 2 else 0)
            c.put(x, yy % 32, 'sand3')
            c.put(x, (yy + 1) % 32, 'sand1')
    for _ in range(specks):
        c.put(r.randint(0, 31), r.randint(0, 31), 'sand0' if r.random() < 0.6 else 'sand4')
    return c


@sprite('oasis.floor', note='warm sand, seamless')
def floor(pal, seed):
    return sand(pal, seed)


@sprite('oasis.floorB', note='sand with pebbles and a shell')
def floor_b(pal, seed):
    c = sand(pal, seed + 1, ripples=2)
    r = c.rng
    for _ in range(5):
        x, y = r.randint(2, 28), r.randint(2, 28)
        c.put(x, y, 'stone2'); c.put(x + 1, y, 'stone3'); c.put(x, y + 1, 'stone0'); c.put(x + 1, y + 1, 'stone1')
    x, y = r.randint(6, 22), r.randint(6, 22)                    # little spiral shell
    c.put(x, y, 'cream1'); c.put(x + 1, y, 'cream1'); c.put(x, y + 1, 'terra'); c.put(x + 1, y + 1, 'cream0')
    return c


@sprite('oasis.floorC', note='sand with dry grass tufts and a flowering succulent')
def floor_c(pal, seed):
    c = sand(pal, seed + 2, ripples=2, specks=6)
    r = c.rng
    for _ in range(4):                          # dry grass tufts
        x, y = r.randint(2, 29), r.randint(4, 29)
        for dx, dy in ((0, 0), (0, -1), (-1, -1), (1, -2), (0, -2)):
            c.put(x + dx, y + dy, 'wood2' if dy < -1 else 'wood1')
        c.put(x, y, 'wood0')
    x, y = r.randint(6, 24), r.randint(8, 24)    # agave-like rosette with a coral bloom
    for dx, dy in ((0, 0), (-1, 1), (1, 1), (-2, 0), (2, 0), (0, 1)):
        c.put(x + dx, y + dy, 'palm2')
    c.put(x, y - 1, 'palm3'); c.put(x, y - 2, 'flowerO'); c.put(x + 1, y - 2, 'flower')
    return c


def slab(pal, seed, damp=False):
    c = new(pal, seed)
    r = c.rng
    cols = ('stone1', 'stone2') if not damp else ('sand0', 'stone1')
    for ry in range(2):                                    # two courses of 16x16 sandstone slabs
        y = ry * 16
        off = 8 if ry else 0
        for bx in (off - 16, off, off + 16):
            col = r.choice(cols)
            c.rect(bx + 1, y + 1, bx + 14, y + 14, col)
            c.hline(bx + 1, bx + 14, y + 1, 'stone3'); c.vline(bx + 1, y + 1, y + 14, 'stone3')
            c.hline(bx + 1, bx + 14, y + 14, 'stone0' if damp else 'stone1')
            for _ in range(3):
                c.put(r.randint(bx + 2, bx + 13) % 32, r.randint(y + 2, y + 13), 'stone2' if col == 'stone1' else 'stone1')
        c.hline(0, 31, y, 'stone0'); c.hline(0, 31, y + 15, 'stone0')
        for bx in (off, off + 16, off - 16):
            c.vline(bx % 32, y, y + 15, 'stone0')
    return c


@sprite('oasis.dirt', note='sandstone slab paving, seamless')
def dirt_a(pal, seed):
    return slab(pal, seed)


@sprite('oasis.dirtB', note='damp, darker slab with a crack')
def dirt_b(pal, seed):
    c = slab(pal, seed + 1, damp=True)
    c.line(4, 6, 12, 12, 'stone0'); c.line(12, 12, 13, 18, 'stone0'); c.put(5, 6, 'sand3')
    return c


@sprite('oasis.floorAlt', note='light bleached deck planks (desk platforms, aisles)')
def floor_alt(pal, seed):
    c = new(pal, seed)
    r = c.rng
    plank_h = 8
    for row in range(4):
        y0 = row * plank_h
        base = 'wood3' if row % 2 == 0 else 'wood2'
        hi = 'wood4' if row % 2 == 0 else 'wood3'
        c.rect(0, y0, 31, y0 + plank_h - 1, base)
        c.hline(0, 31, y0, 'wood1')
        c.hline(0, 31, y0 + 1, hi)
        for _ in range(4):
            x = r.randint(0, 27)
            c.hline(x, x + r.randint(2, 6), y0 + r.randint(3, 6), 'wood2' if base == 'wood3' else 'wood1')
        sx = (row * 11 + 6) % 32
        c.vline(sx, y0, y0 + plank_h - 1, 'wood1')
        c.put((sx + 2) % 32, y0 + 3, 'wood1'); c.put((sx - 2) % 32, y0 + 3, 'wood1')
        for _ in range(2):                                   # sand dusted in the seams
            mx = r.randint(0, 31)
            c.put(mx, y0, 'sand2'); c.put((mx + 1) % 32, y0, 'sand3')
    return c


@sprite('oasis.rug', note='woven cream mat with turquoise diamonds')
def rug(pal, seed):
    c = new(pal, seed)
    for y in range(32):
        for x in range(32):
            c.put(x, y, 'cream1' if ((x + y) // 2) % 2 == 0 else 'cream0')
    for y in range(32):
        for x in range(32):
            if (x + y) % 8 == 0:
                c.put(x, y, 'sand2')
    for cx, cy in ((8, 8), (24, 24), (24, 8), (8, 24)):      # small turquoise diamond motifs
        for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
            c.put(cx + dx, cy + dy, 'turq1')
        c.put(cx, cy, 'turq2')
    return c
