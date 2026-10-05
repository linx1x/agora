"""Boreal fire pit: a ring of fieldstones around a crackling fire on a snow-melted patch (4x4 tiles, 4 frames)."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Anim, Canvas

FRAMES = 4


def firepit_frame(pal, f):
    W = H = 128
    c = Canvas(W, H, pal, 3)
    cx, cy = 64, 66
    # melted patch of dark ground and ash
    c.ellipse(cx, cy + 2, 54, 46, 'stone0'); c.ellipse(cx, cy + 1, 50, 42, 'sand0'); c.ellipse(cx, cy + 3, 40, 32, 'stone0')
    c.ellipse(cx, cy + 3, 35, 28, 'sand0')
    # ring of fieldstones (back to front)
    n = 16
    for i in range(n):
        a = math.tau * (i + 0.5) / n
        x = cx + math.cos(a) * 36
        y = cy + 4 + math.sin(a) * 28
        col = ('stone2', 'stone1')[i % 2]
        c.ellipse(x, y + 1.5, 7.5, 6, 'stone0')
        c.ellipse(x, y, 7, 5.5, col)
        c.ellipse(x - 1.5, y - 1.5, 4, 2.6, 'stone3' if i % 3 == 0 else 'stone2')
        if i % 4 == 0 and math.sin(a) < 0:
            c.ellipse(x, y - 3.5, 4.5, 1.8, 'snow1')
    # logs piled in the middle
    for ang, dx in ((-28, -9), (24, 8), (0, 0)):
        lx, ly = cx + dx, cy + 8
        c.rect(lx - 14, ly - 3, lx + 14, ly + 3, 'bark1') if ang == 0 else None
    c.ellipse(cx - 12, cy + 8, 15, 4, 'bark1'); c.ellipse(cx - 12, cy + 7, 14, 3, 'bark2')
    c.ellipse(cx + 11, cy + 9, 15, 4, 'bark1'); c.ellipse(cx + 11, cy + 8, 14, 3, 'bark2')
    c.ellipse(cx - 26, cy + 8, 3, 3.6, 'bark3'); c.ellipse(cx + 25, cy + 9, 3, 3.6, 'bark3')
    c.ellipse(cx, cy + 10, 12, 3.5, 'ember0')
    # fire: three tongues whose height wobbles per frame
    tongues = ((cx - 11, 22, 7), (cx, 33, 9), (cx + 11, 24, 7))
    for k, (fx, h, w) in enumerate(tongues):
        hh = h + (3 if (f + k) % 2 else -2) + int(2 * math.sin((f + k) * 1.6))
        for layer, (col, shrink) in enumerate((('ember0', 0), ('ember1', 3), ('ember2', 6), ('ember3', 9))):
            top = cy + 6 - hh + shrink * 1.4
            bot = cy + 10 - shrink * 0.3
            ww = max(1.5, w - shrink * 0.6)
            sway = math.sin((f * 1.4 + k) * 1.2) * (1.5 - layer * 0.2)
            c.poly([(fx - ww, bot), (fx + ww, bot), (fx + sway, top)], col)
    # sparks and a thread of smoke
    for i in range(4):
        sx = cx - 8 + ((i * 9 + f * 5) % 20)
        sy = cy - 22 - ((i * 7 + f * 6) % 22)
        c.put(sx, sy, 'ember2' if i % 2 else 'ember3')
    for i in range(7):
        c.put(cx + 3 + int(2 * math.sin(i + f)), cy - 36 - i * 3 - f, 'snow0' if i % 2 else 'stone2')
    c.outline()
    return c


@sprite('boreal.firepit', tw=4, th=4, note='stone-ringed fire pit 4x4 tiles, 4 frames')
def firepit(pal, seed):
    return Anim([firepit_frame(pal, f) for f in range(FRAMES)], fps=6)
