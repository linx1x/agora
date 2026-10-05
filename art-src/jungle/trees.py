"""Jungle tree: treeTop (canopy, above layer) + treeBase (trunk, collides)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new

RAMP = ['leaf0', 'leaf1', 'leaf2', 'leaf3', 'leaf4']


def canopy_blobs(c, y_shift):
    # (cx, cy, r) in tile-local coordinates of the full 32x64 tree, y_shift converts to this tile
    blobs = [(4, 20, 9), (27, 21, 9), (16, 14, 11), (8, 10, 8), (24, 9, 8), (16, 3, 8), (3, 36, 7), (29, 37, 7), (16, 34, 9), (9, 29, 8), (23, 29, 8)]
    for cx, cy, r in sorted(blobs, key=lambda b: b[1]):
        for off in (-32, 0, 32):
            c.shaded_ellipse(cx + off, cy - y_shift, r, r - 1, RAMP, bias=-0.04)


@sprite('jungle.treeTop', note='canopy (drawn above avatars)')
def tree_top(pal, seed):
    c = new(pal, seed)
    canopy_blobs(c, 0)
    r = c.rng
    for _ in range(16):
        x, y = r.randint(0, 31), r.randint(0, 31)
        if c.get(x, y) is not None:
            c.put(x, y, 'leaf5')
    # hanging lianas at the lower edge
    for x in (6, 15, 25):
        for i in range(r.randint(3, 6)):
            if c.get(x, 30 - i) is None or True:
                pass
    c.outline()
    return c


@sprite('jungle.treeBase', note='trunk with buttress roots and lower canopy')
def tree_base(pal, seed):
    c = new(pal, seed)
    canopy_blobs(c, 32)
    # trunk
    c.rect(12, 6, 19, 26, 'wood2')
    c.vline(12, 6, 26, 'wood3'); c.vline(13, 6, 26, 'wood3'); c.vline(18, 6, 26, 'wood1'); c.vline(19, 6, 26, 'wood0')
    for y in range(7, 26, 4):
        c.put(15, y, 'wood1'); c.put(16, y + 1, 'wood1'); c.put(14, y + 2, 'wood3')
    # buttress roots
    c.poly([(12, 22), (8, 30), (13, 28)], 'wood2'); c.poly([(19, 22), (24, 30), (18, 28)], 'wood1')
    c.line(12, 24, 6, 29, 'wood0'); c.line(19, 24, 25, 29, 'wood0')
    c.rect(10, 28, 22, 29, 'wood1'); c.hline(10, 22, 29, 'wood0')
    # vine + moss on the trunk
    for i, y in enumerate(range(8, 26)):
        c.put(14 + (1 if (i // 3) % 2 else 0), y, 'leaf2')
    c.rect(13, 22, 15, 24, 'moss2')
    c.outline()
    c.ground_shadow(6, 26, 30)
    return c
