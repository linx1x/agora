"""Zen plants: pine bonsai (A), potted bamboo (B), moss ball kokedama (C)."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def tray(c, x0, x1, y0, y1):
    c.rect(x0, y0, x1, y1, 'indigo1'); c.hline(x0 - 1, x1 + 1, y0, 'indigo3'); c.hline(x0, x1, y1, 'indigo0')
    c.vline(x0, y0 + 1, y1, 'indigo2'); c.vline(x1, y0 + 1, y1, 'indigo0')
    c.rect(x0 + 1, y0 - 1, x1 - 1, y0 - 1, 'dirt1')
    c.put(x0 + 2, y0 - 1, 'moss1'); c.put(x1 - 3, y0 - 1, 'moss2')


@sprite('zen.plantA', note='pine bonsai in a glazed tray')
def bonsai(pal, seed):
    c = new(pal, seed)
    tray(c, 8, 23, 24, 30)
    # twisted trunk
    for i, (x, y) in enumerate(((15, 23), (14, 20), (14, 17), (16, 14), (17, 11), (16, 9))):
        c.rect(x, y, x + 2, y + 3, 'bark2'); c.put(x, y, 'bark3'); c.put(x + 2, y + 3, 'bark0')
    # cloud-pruned pads
    for cx, cy, rx, ry in ((9, 19, 6, 3), (22, 15, 6, 3.4), (12, 11, 6.5, 3.6), (19, 6, 7, 3.8)):
        c.shaded_ellipse(cx, cy, rx, ry, ['leaf0', 'leaf1', 'leaf2', 'leaf3'], bias=-0.1)
        c.ellipse(cx - 1, cy - 1, rx * 0.5, ry * 0.4, 'leaf4')
    c.outline(); c.ground_shadow(8, 24, 31)
    return c


@sprite('zen.plantB', note='lucky bamboo in a round pot')
def bamboo(pal, seed):
    c = new(pal, seed)
    c.ellipse(16, 28, 9, 3, 'indigo0'); c.rect(8, 22, 24, 28, 'indigo1'); c.hline(7, 25, 22, 'indigo3')
    c.vline(8, 23, 28, 'indigo2'); c.vline(24, 23, 28, 'indigo0'); c.ellipse(16, 22, 9, 2, 'indigo2'); c.ellipse(16, 22, 7.5, 1.4, 'dirt1')
    for x, h in ((11, 17), (15, 21), (19, 15)):
        c.rect(x, 22 - h, x + 2, 22, 'bamboo1'); c.vline(x, 22 - h, 22, 'bamboo2'); c.vline(x + 2, 22 - h, 22, 'bamboo0')
        for y in range(22 - h + 4, 22, 5):
            c.hline(x, x + 2, y, 'bamboo0')
        top = 22 - h
        c.leaf(x - 3, top + 2, 6, 1.8, 200, ['leaf1', 'leaf2', 'leaf3', 'leaf4'], rib=True)
        c.leaf(x + 5, top + 1, 6, 1.8, -20, ['leaf1', 'leaf2', 'leaf3', 'leaf4'], rib=True)
        c.leaf(x + 1, top - 2, 5, 1.6, -95, ['leaf1', 'leaf2', 'leaf3', 'leaf4'], rib=True)
    c.outline(); c.ground_shadow(7, 25, 31)
    return c


@sprite('zen.plantC', note='kokedama moss ball with a tiny fern on a stone dish')
def kokedama(pal, seed):
    c = new(pal, seed)
    c.ellipse(16, 27, 11, 3.4, 'stone1'); c.ellipse(16, 26, 11, 3, 'stone2'); c.ellipse(16, 25.5, 9, 2.2, 'stone3')
    c.shaded_ellipse(16, 20, 8, 7, ['moss0', 'moss1', 'moss2', 'leaf4'], bias=-0.1)
    for _ in range(3):
        pass
    for a, L in ((-150, 9), (-120, 11), (-90, 12), (-60, 11), (-30, 9)):
        tx, ty = 16 + math.cos(math.radians(a)) * L, 14 + math.sin(math.radians(a)) * L
        c.line(16, 14, int(tx), int(ty), 'leaf2')
        c.leaf((16 + tx) / 2, (14 + ty) / 2, L * 0.5, 2.2, a, ['leaf1', 'leaf2', 'leaf3', 'leaf4'], rib=True)
    c.put(16, 1, 'sakura2'); c.put(17, 1, 'sakura3')
    c.outline(); c.ground_shadow(6, 26, 30)
    return c
