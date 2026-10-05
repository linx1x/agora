"""Jungle floors: calm dark mossy grass (soft dithered patches), flower variants, packed-earth dirt."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new

MOSS = ['moss0', 'moss1', 'moss2', 'moss1', 'moss2']


def grass(pal, seed, tufts=5):
    c = new(pal, seed)
    c.fill_gradient(['moss0', 'moss1', 'moss2'], seed=seed, scale=6, gain=9.0)
    r = c.rng
    for _ in range(tufts):                      # small 3-blade tufts, only 2 tones so they stay calm
        x, y = r.randint(2, 29), r.randint(3, 30)
        c.put(x, y, 'moss3'); c.put(x, y - 1, 'moss3')
        c.put(x - 1, y, 'moss2'); c.put(x + 1, y - 1, 'moss3')
    return c


def flower(c, x, y, col, col2=None):
    c.put(x, y, col)
    if col2:
        c.put(x + 1, y, col2); c.put(x, y - 1, col2)
    c.put(x, y + 1, 'leaf2')


def flowers(c, n_clusters, palette):
    r = c.rng
    for _ in range(n_clusters):
        cx, cy = r.randint(4, 27), r.randint(5, 27)
        for _ in range(r.randint(3, 5)):
            fx, fy = cx + r.randint(-4, 4), cy + r.randint(-3, 3)
            col = r.choice(palette)
            flower(c, fx, fy, col, 'flowerW' if col != 'flowerW' else 'flowerY')


@sprite('jungle.floor', note='mossy grass, seamless')
def floor(pal, seed):
    return grass(pal, seed)


@sprite('jungle.floorB', note='grass + white/yellow wildflowers')
def floor_b(pal, seed):
    c = grass(pal, seed + 1, tufts=4)
    flowers(c, 2, ['flowerW', 'flowerY'])
    return c


@sprite('jungle.floorC', note='grass + coral/purple wildflowers')
def floor_c(pal, seed):
    c = grass(pal, seed + 2, tufts=4)
    flowers(c, 2, ['flower', 'flowerP', 'flowerO'])
    return c


def dirt(pal, seed, pebbles=5):
    c = new(pal, seed)
    c.fill_gradient(['dirt1', 'dirt2', 'dirt3'], seed=seed, scale=5, gain=8.0, center=0.45)
    r = c.rng
    for _ in range(pebbles):
        x, y = r.randint(1, 29), r.randint(1, 29)
        c.put(x, y, 'pebble'); c.put(x + 1, y, 'dirt3'); c.put(x, y + 1, 'dirt0'); c.put(x + 1, y + 1, 'dirt0')
    for _ in range(7):                          # fine dark grit
        c.put(r.randint(0, 31), r.randint(0, 31), 'dirt0')
    return c


@sprite('jungle.dirt', note='packed earth path, seamless')
def dirt_a(pal, seed):
    return dirt(pal, seed)


@sprite('jungle.dirtB', note='packed earth with roots/pebbles')
def dirt_b(pal, seed):
    c = dirt(pal, seed + 1, pebbles=8)
    r = c.rng
    x, y = r.randint(4, 12), r.randint(6, 24)
    for i in range(10):                        # a root crossing the path
        c.put((x + i) % 32, y + (1 if i % 4 > 1 else 0), 'wood1')
        c.put((x + i) % 32, y + (2 if i % 4 > 1 else 1), 'dirt0')
    return c


@sprite('jungle.floorAlt', note='warm wood deck planks, calm (desk pods / aisles)')
def floor_alt(pal, seed):
    c = new(pal, seed)
    r = c.rng
    plank_h = 8
    for row in range(4):
        y0 = row * plank_h
        base = 'wood2' if row % 2 == 0 else 'wood1'
        hi = 'wood3' if row % 2 == 0 else 'wood2'
        c.rect(0, y0, 31, y0 + plank_h - 1, base)
        c.hline(0, 31, y0, 'wood0')                     # seam
        c.hline(0, 31, y0 + 1, hi)                      # soft lit edge
        for _ in range(4):                              # grain, tone-on-tone
            x = r.randint(0, 27)
            c.hline(x, x + r.randint(2, 6), y0 + r.randint(3, 6), 'wood1' if base == 'wood2' else 'wood0')
        sx = (row * 11 + 6) % 32                        # staggered end seams (wrap-safe)
        c.vline(sx, y0, y0 + plank_h - 1, 'wood0')
        c.put((sx + 2) % 32, y0 + 3, 'wood0'); c.put((sx - 2) % 32, y0 + 3, 'wood0')
        for _ in range(2):
            mx = r.randint(0, 31)
            c.put(mx, y0, 'moss1'); c.put((mx + 1) % 32, y0, 'moss2')
    return c


@sprite('jungle.rug', note='calm woven leaf-green mat')
def rug(pal, seed):
    c = new(pal, seed)
    for y in range(32):
        for x in range(32):
            c.put(x, y, 'leaf2' if ((x + y) // 2) % 2 == 0 else 'leaf1')
    for y in range(32):
        for x in range(32):
            if (x + y) % 8 == 0:
                c.put(x, y, 'leaf3')
    for cx, cy in ((8, 8), (24, 24)):                    # tiny pale leaf motifs
        c.put(cx, cy, 'leaf3'); c.put(cx + 1, cy - 1, 'leaf3'); c.put(cx + 1, cy, 'leaf4'); c.put(cx, cy + 1, 'leaf2')
    return c
