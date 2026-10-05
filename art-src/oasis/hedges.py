"""Oasis borders: low sandstone planter walls (tile horizontally)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def planter_wall(pal, seed, flowers=False):
    c = new(pal, seed)
    r = c.rng
    # stone body (rows 14-30), coping at the top, greenery spilling over
    c.rect(0, 15, 31, 30, 'stone2')
    c.hline(0, 31, 14, 'stone3'); c.hline(0, 31, 15, 'stone3')
    c.hline(0, 31, 16, 'stone1')
    for y in (21, 27):
        c.hline(0, 31, y, 'stone1')
    for x0, ys in ((0, (17, 22)), (10, (22, 28)), (20, (17, 22)), (5, (28,)), (26, (28,))):
        pass
    for row, (y0, y1) in enumerate(((17, 20), (22, 26), (28, 30))):
        off = 7 if row % 2 else 0
        for bx in range(-16 + off, 40, 16):
            c.vline(bx % 32, y0, y1, 'stone1')
    c.hline(0, 31, 30, 'stone0'); c.hline(0, 31, 31, 'stone0')
    for _ in range(14):
        c.put(r.randint(0, 31), r.randint(17, 29), r.choice(['stone1', 'stone3']))
    # planting on top: succulents and trailing greenery
    for cx in (3, 11, 19, 27):
        for off in (-32, 0, 32):
            c.shaded_ellipse(cx + off, 9, 5, 4, ['palm0', 'palm1', 'palm2', 'palm3'], bias=-0.05)
    for x in range(0, 32, 4):
        c.put(x, 15, 'palm2'); c.put(x + 1, 16, 'palm1') if x % 8 == 0 else None
    if flowers:
        for _ in range(8):
            x, y = r.randint(1, 30), r.randint(4, 12)
            col = r.choice(['flowerP', 'flower', 'flowerY', 'noteP'])
            c.put(x, y, col); c.put(x + 1, y, 'flowerW')
    m = c.mask()
    for x in range(32):
        for y in range(1, 32):
            if m[y][x] and not m[y - 1][x] and c.get(x, y - 1) is None:
                c.put(x, y - 1, 'palm0')
    return c


@sprite('oasis.border', note='sandstone planter wall with succulents')
def border(pal, seed):
    return planter_wall(pal, seed)


@sprite('oasis.borderPlant', note='planter wall with bougainvillea')
def border_plant(pal, seed):
    return planter_wall(pal, seed + 3, flowers=True)
