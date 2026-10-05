"""Zen borders: bamboo fences with low shrubs (tile horizontally)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def bamboo_fence(pal, seed, blossom=False):
    c = new(pal, seed)
    r = c.rng
    # vertical bamboo poles (rows 8-30), two horizontal ties, a low shrub row on top
    for x in range(0, 32, 4):
        c.rect(x, 9, x + 2, 30, 'bamboo1'); c.vline(x, 9, 30, 'bamboo2'); c.vline(x + 2, 9, 30, 'bamboo0')
        c.hline(x, x + 2, 9, 'bamboo3')
        for y in (14, 21, 27):
            c.hline(x, x + 2, y, 'bamboo0')
    for y in (15, 24):                                      # rope ties
        c.hline(0, 31, y, 'bark2'); c.hline(0, 31, y + 1, 'bark1')
    for cx in (3, 11, 19, 27):
        for off in (-32, 0, 32):
            c.shaded_ellipse(cx + off, 6, 5, 4, ['leaf0', 'leaf1', 'leaf2', 'leaf3'], bias=-0.05)
    if blossom:
        for _ in range(9):
            x, y = r.randint(1, 30), r.randint(2, 8)
            c.put(x, y, 'sakura2'); c.put(x + 1, y, 'sakura3'); c.put(x, y + 1, 'sakura1')
    c.hline(0, 31, 31, 'bark0')
    m = c.mask()
    for x in range(32):
        for y in range(1, 32):
            if m[y][x] and not m[y - 1][x] and c.get(x, y - 1) is None:
                c.put(x, y - 1, 'leaf0')
    return c


@sprite('zen.border', note='bamboo fence with a clipped shrub')
def border(pal, seed):
    return bamboo_fence(pal, seed)


@sprite('zen.borderPlant', note='bamboo fence with a cherry-blossom shrub')
def border_plant(pal, seed):
    return bamboo_fence(pal, seed + 3, blossom=True)
