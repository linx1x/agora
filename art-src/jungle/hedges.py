"""Jungle borders: dense hedge rows (tile horizontally)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new

RAMP = ['leaf0', 'leaf1', 'leaf2', 'leaf3']


def hedge(pal, seed, flowers=None):
    c = new(pal, seed)
    r = c.rng
    c.rect(0, 12, 31, 30, 'leaf1')                       # dark mass so no gaps show floor
    # clusters, each drawn three times so the row wraps seamlessly
    spots = [(4, 10, 6), (14, 8, 6), (24, 11, 6), (30, 9, 5), (9, 19, 7), (21, 20, 7), (1, 21, 6), (15, 27, 6), (28, 27, 6), (5, 28, 5)]
    for cx, cy, rad in sorted(spots, key=lambda s: s[1]):
        for off in (-32, 0, 32):
            c.shaded_ellipse(cx + off, cy, rad, rad - 1, RAMP, bias=-0.05)
    # tiny sparkle leaves
    for _ in range(10):
        x, y = r.randint(0, 31), r.randint(8, 28)
        c.put(x, y, 'leaf4')
    if flowers:
        for _ in range(7):
            x, y = r.randint(1, 30), r.randint(9, 26)
            col = r.choice(flowers)
            c.put(x, y, col); c.put(x + 1, y, 'flowerW' if col != 'flowerW' else 'flowerY')
    # outline only the top edge (left/right continue into neighbours)
    m = c.mask()
    for x in range(32):
        for y in range(1, 32):
            if m[y][x] and not m[y - 1][x] and c.get(x, y - 1) is None:
                c.put(x, y - 1, 'leaf0')
    c.ground_shadow(0, 31, 30) if False else None
    for x in range(32):
        c.put(x, 31, 'leaf0'); c.put(x, 30, c.get(x, 30) if c.get(x, 30) in ('leaf0', 'leaf1') else 'leaf1')
    return c


@sprite('jungle.border', note='hedge row')
def border(pal, seed):
    return hedge(pal, seed)


@sprite('jungle.borderPlant', note='hedge row with wildflowers')
def border_plant(pal, seed):
    return hedge(pal, seed + 3, flowers=['flower', 'flowerY', 'flowerW', 'flowerP'])
