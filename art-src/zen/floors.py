"""Zen floors: woven tatami, raked gravel, light wood engawa planks, indigo wave rug, zabuton cushion."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def tatami(pal, seed, petals=0, mats=False):
    c = new(pal, seed)
    r = c.rng
    for y in range(32):                            # soft woven rush: alternating bands with fine ticks
        band = (y // 2) % 2
        base = 'sand2' if band == 0 else 'sand1'
        for x in range(32):
            c.put(x, y, base)
    c.fill_gradient(['sand1', 'sand2', 'sand2', 'sand3'], seed=seed, scale=8, gain=3.0, center=0.5)
    for y in range(0, 32, 2):
        c.hline(0, 31, y, 'sand2')
    for _ in range(40):
        x, y = r.randint(0, 31), r.randint(0, 31)
        c.put(x, y, r.choice(['sand3', 'sand0', 'sand1']))
    for _ in range(petals):                        # fallen pink petals
        x, y = r.randint(2, 29), r.randint(2, 29)
        c.put(x, y, 'sakura2'); c.put(x + 1, y, 'sakura3'); c.put(x, y + 1, 'sakura1')
    return c


@sprite('zen.floor', note='pale woven tatami, seamless')
def floor(pal, seed):
    return tatami(pal, seed)


@sprite('zen.floorB', note='tatami with a darker mat edge and a faint herringbone join')
def floor_b(pal, seed):
    c = tatami(pal, seed + 1)
    c.hline(0, 31, 0, 'sand0'); c.hline(0, 31, 1, 'sand3')
    c.vline(0, 0, 31, 'sand0'); c.vline(16, 2, 31, 'sand1')
    for y in range(4, 28, 8):
        c.put(16, y, 'sand0')
    return c


@sprite('zen.floorC', note='tatami with a few fallen cherry petals')
def floor_c(pal, seed):
    return tatami(pal, seed + 2, petals=4)


def gravel(pal, seed, rock=False):
    c = new(pal, seed)
    r = c.rng
    c.fill_gradient(['dirt2', 'dirt3', 'dirt2', 'dirt1'], seed=seed, scale=5, gain=3.0, center=0.5)
    for y in range(2, 32, 4):                      # raked lines, gently wavy (periodic)
        for x in range(32):
            yy = y + int(round(1.2 * math.sin(x / 32 * math.tau * 2 + y)))
            c.put(x, yy % 32, 'dirt1')
            c.put(x, (yy + 1) % 32, 'dirt3')
    for _ in range(30):
        c.put(r.randint(0, 31), r.randint(0, 31), r.choice(['dirt0', 'dirt1', 'white']))
    return c


@sprite('zen.dirt', note='raked white gravel, seamless')
def dirt_a(pal, seed):
    return gravel(pal, seed)


@sprite('zen.dirtB', note='raked gravel swirling around a small stone')
def dirt_b(pal, seed):
    c = gravel(pal, seed + 1)
    cx, cy = 16, 16
    for rad in (9, 12):                            # ripples around the stone
        for a in range(0, 360, 6):
            x = int(cx + math.cos(math.radians(a)) * rad); y = int(cy + math.sin(math.radians(a)) * rad * 0.8)
            c.put(x, y, 'dirt0' if rad == 9 else 'dirt1')
    c.ellipse(cx, cy + 1, 5.5, 4, 'stone0'); c.ellipse(cx, cy, 5, 3.6, 'stone1'); c.ellipse(cx - 1, cy - 1, 2.8, 1.6, 'stone2')
    c.put(cx + 2, cy + 2, 'moss1'); c.put(cx + 3, cy + 2, 'moss0')
    return c


@sprite('zen.floorAlt', note='light wood engawa planks (desk platforms, aisles)')
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
    return c


@sprite('zen.rug', note='indigo seigaiha wave mat with a cream border')
def rug(pal, seed):
    c = new(pal, seed)
    c.rect(0, 0, 31, 31, 'indigo0')
    for row in range(-1, 5):
        for col in range(-1, 5):
            cx = col * 8 + (4 if row % 2 else 0)
            cy = row * 5 + 4
            for rad, colr in ((7, 'indigo2'), (5, 'indigo1'), (3, 'indigo2'), (1.4, 'indigo1')):
                c.ellipse(cx, cy, rad, rad * 0.8, colr)
    for y in range(32):
        for x in range(32):
            if x < 2 or y < 2 or x > 29 or y > 29:
                c.put(x, y, 'cream1' if (x + y) % 2 == 0 else 'cream0')
    return c


@sprite('zen.zabuton', note='indigo zabuton cushion on the tatami (walkable floor decoration)')
def zabuton(pal, seed):
    c = tatami(pal, seed + 5)
    c.rect(7, 8, 24, 23, 'indigo0'); c.rect(8, 9, 23, 22, 'indigo1'); c.hline(8, 23, 9, 'indigo2'); c.vline(8, 9, 22, 'indigo2')
    c.rect(11, 12, 20, 19, 'indigo2'); c.hline(11, 20, 12, 'indigo3'); c.put(15, 15, 'cream1'); c.put(16, 15, 'cream1'); c.put(15, 16, 'cream0')
    c.put(7, 8, 'terra'); c.put(24, 8, 'terra'); c.put(7, 23, 'terra'); c.put(24, 23, 'terra')   # corner tassels
    return c
