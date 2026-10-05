"""Jungle walls: mossy stone with vines. wallTop = cap seen from above, wallFront = the face."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


def bricks(c, y0=0, y1=31, with_moss=True):
    r = c.rng
    rows = (y1 - y0 + 1) // 8
    for row in range(rows):
        y = y0 + row * 8
        off = 8 if row % 2 else 0
        for bx in (-16 + off, off, 16 + off):
            x0, x1 = bx + 1, bx + 15
            if x1 < 0 or x0 > 31:
                continue
            col = r.choice(['stone2', 'stone2', 'stone1'])
            c.rect(max(0, x0), y + 1, min(31, x1), y + 6, col)
            c.hline(max(0, x0), min(31, x1), y + 1, 'stone3')          # lit top edge
            c.hline(max(0, x0), min(31, x1), y + 6, 'stone1')          # shaded bottom
            if 0 <= x0 <= 31:
                c.vline(x0, y + 1, y + 6, 'stone3')
            if 0 <= x1 <= 31:
                c.vline(x1, y + 1, y + 6, 'stone1')
            for _ in range(2):                                          # speckle
                c.put(r.randint(max(0, x0), min(31, x1)), r.randint(y + 2, y + 5), r.choice(['stone1', 'stone3']))
        c.hline(0, 31, y, 'stone0'); c.hline(0, 31, y + 7, 'stone0')
        for bx in (off, 16 + off, off - 16):
            if 0 <= bx <= 31:
                c.vline(bx, y, y + 7, 'stone0')
    if with_moss:
        for _ in range(16):
            x, y = r.randint(0, 31), r.randint(y0, y1)
            c.put(x, y, 'moss2'); c.put(x, y + 1, 'moss1') if y < 31 else None


@sprite('jungle.wallFront', note='mossy stone brick face with hanging vines')
def wall_front(pal, seed):
    c = new(pal, seed)
    bricks(c)
    c.dither_band(0, 0, 31, 1, 'stone0', 'stone1')        # top shadow
    c.dither_band(0, 28, 31, 31, 'stone1', 'stone0')      # dark base
    r = c.rng
    for x0 in (4, 13, 22, 28):                             # vines trailing down
        ln = r.randint(8, 18)
        for i in range(ln):
            c.put(x0 + (1 if i % 5 == 3 else 0), i, 'leaf1')
            if i % 3 == 1:
                c.put(x0 - 1, i, 'leaf2'); c.put(x0 + 2, i, 'leaf3')
        c.put(x0, ln, 'leaf4'); c.put(x0 + 1, ln - 1, 'leaf3')
    for x in range(0, 32, 3):                              # moss lip at the bottom
        c.put(x, 30, 'moss2'); c.put(x + 1, 29, 'moss3')
    return c


@sprite('jungle.wallTop', note='stone cap with moss, seen from above')
def wall_top(pal, seed):
    c = new(pal, seed)
    r = c.rng
    c.rect(0, 0, 31, 31, 'stone2')
    for row in range(2):                                    # two courses of 16x16 slabs
        y = row * 16
        off = 8 if row else 0
        for bx in (off - 16, off, off + 16):
            c.rect(bx + 1, y + 1, bx + 14, y + 14, r.choice(['stone2', 'stone2', 'stone3']))
            c.hline(bx + 1, bx + 14, y + 1, 'stone3'); c.vline(bx + 1, y + 1, y + 14, 'stone3')
            c.hline(bx + 1, bx + 14, y + 14, 'stone1'); c.vline(bx + 14, y + 1, y + 14, 'stone1')
        c.hline(0, 31, y, 'stone0'); c.hline(0, 31, y + 15, 'stone0')
        for bx in (off, off + 16, off - 16):
            c.vline(bx % 32, y, y + 15, 'stone0')
    for _ in range(24):
        x, y = r.randint(0, 31), r.randint(0, 31)
        c.put(x, y, 'moss2'); c.put((x + 1) % 32, y, 'moss3')
    for _ in range(3):
        x, y = r.randint(2, 28), r.randint(2, 28)
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1), (2, 1)):
            c.put(x + dx, y + dy, 'moss2')
        c.put(x, y, 'moss3')
    return c


@sprite('jungle.window', note='stone wall with wooden-framed window, vines')
def window(pal, seed):
    c = new(pal, seed)
    bricks(c, with_moss=False)
    # frame
    c.rect(5, 3, 26, 26, 'wood1'); c.rect(6, 4, 25, 25, 'wood2')
    c.hline(6, 25, 4, 'wood4'); c.vline(6, 4, 25, 'wood3')
    c.rect(8, 6, 23, 23, 'wood0')
    # glass with sky + trees reflection and a diagonal glare
    c.rect(9, 7, 22, 22, 'glassA')
    c.rect(9, 7, 22, 12, 'glassB')
    c.dither_band(9, 13, 22, 14, 'glassB', 'glassA')
    c.rect(9, 18, 22, 22, 'leaf2'); c.dither_band(9, 16, 22, 17, 'glassA', 'leaf2')
    for x, h in ((11, 3), (14, 5), (18, 4), (21, 6)):
        c.rect(x, 22 - h, x + 1, 22, 'leaf1')
    c.line(10, 12, 16, 7, 'white'); c.line(10, 15, 19, 7, 'glassB')
    c.vline(15, 7, 22, 'wood1'); c.vline(16, 7, 22, 'wood2'); c.hline(9, 22, 14, 'wood1'); c.hline(9, 22, 15, 'wood2')  # muntins
    # sill
    c.rect(3, 26, 28, 28, 'stone3'); c.hline(3, 28, 28, 'stone1')
    # vines at the corners
    for (x, y) in ((4, 3), (27, 4), (4, 12), (27, 18)):
        c.rect(x, y, x + 1, y + 3, 'leaf2'); c.put(x - 1, y + 1, 'leaf3'); c.put(x + 2, y + 2, 'leaf4')
    for i in range(10):
        c.put(24 + (i % 2), i + 4 if False else 2 + i, 'leaf1') if False else None
    return c


@sprite('jungle.hanging', note='vines hanging from above (above layer)')
def hanging(pal, seed):
    c = new(pal, seed)
    r = c.rng
    for x0, ln in ((6, 20), (14, 10), (21, 17), (27, 24)):
        for i in range(ln):
            c.put(x0 + (1 if (i // 4) % 2 else 0), i, 'leaf1')
            if i % 3 == 1:
                c.rect(x0 - 2, i, x0 - 1, i + 1, 'leaf2'); c.put(x0 - 2, i, 'leaf3')
            if i % 3 == 2:
                c.rect(x0 + 2, i, x0 + 3, i + 1, 'leaf3'); c.put(x0 + 3, i, 'leaf4')
        c.rect(x0 - 1, ln, x0 + 2, ln + 1, 'leaf3'); c.put(x0 + 1, ln + 1, 'leaf4')
        if r.random() < 0.6:
            col = r.choice(['flower', 'flowerY', 'flowerP'])
            c.put(x0 + 1, ln - 2, col)
    c.outline()
    return c
