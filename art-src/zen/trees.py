"""Zen maple: treeTop (flame-coloured crown, above layer) + treeBase (twisted trunk on a mossy mound, collides)."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def crown(c, cx, cy, spread):
    r = c.rng
    blobs = [(cx - 9, cy + 2, 8), (cx + 9, cy + 2, 8), (cx, cy - 5, 9), (cx - 4, cy + 5, 8), (cx + 5, cy + 5, 8), (cx, cy + 1, 10)]
    for bx, by, br in blobs:
        c.shaded_ellipse(bx, by, br, br * 0.8, ['maple0', 'maple1', 'maple2', 'maple3'], bias=-0.1)
    for _ in range(46):                              # sparkle of lit leaf tips
        x, y = r.randint(2, 29), r.randint(2, 28)
        if c.get(x, y) in ('maple2', 'maple3'):
            c.put(x, y, 'maple4' if r.random() < 0.5 else 'maple3')
    for _ in range(14):
        x, y = r.randint(2, 29), r.randint(2, 28)
        if c.get(x, y) is not None:
            c.put(x, y, 'maple0')


@sprite('zen.treeTop', note='japanese maple crown (drawn above avatars)')
def tree_top(pal, seed):
    c = new(pal, seed)
    crown(c, 16, 16, 14)
    c.outline()
    return c


@sprite('zen.treeBase', note='maple trunk with a mossy mound and two stones')
def tree_base(pal, seed):
    c = new(pal, seed)
    c.ellipse(16, -2, 13, 7, 'maple1'); c.ellipse(16, -3, 11, 5.5, 'maple2'); c.ellipse(13, -4, 5, 3, 'maple3')   # lowest leaves
    for y in range(0, 27):
        x0 = 13 + int(2.0 * math.sin(y / 7.0))
        c.rect(x0, y, x0 + 4, y, 'bark2'); c.put(x0, y, 'bark3'); c.put(x0 + 4, y, 'bark0'); c.put(x0 + 3, y, 'bark1')
        if y % 5 == 3:
            c.hline(x0 + 1, x0 + 3, y, 'bark1')
    c.ellipse(16, 28, 11, 3.4, 'moss0'); c.ellipse(16, 27.5, 9, 2.6, 'moss1'); c.ellipse(15, 27, 5, 1.4, 'moss2')
    c.ellipse(24, 29, 3, 2, 'stone1'); c.ellipse(24, 28.5, 2.4, 1.4, 'stone2'); c.ellipse(8, 29, 2.4, 1.6, 'stone1'); c.put(8, 28, 'stone3')
    c.outline()
    c.ground_shadow(7, 25, 31)
    return c
