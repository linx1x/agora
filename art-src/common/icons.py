"""UI / brand icons: biome glyphs (16 and 32 px), lobby hexagon, hex compass minimap."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite
from pxl import Canvas


def icon16(pal, seed):
    return Canvas(16, 16, pal, seed)


def leaf16(pal, seed):
    c = icon16(pal, seed)
    c.poly([(2, 12), (3, 6), (7, 2), (13, 1), (14, 2), (13, 8), (9, 13), (4, 14)], 'icLeaf')
    c.line(3, 13, 12, 3, 'icLeafL'); c.put(5, 8, 'icLeafL'); c.put(7, 6, 'icLeafL'); c.put(9, 9, 'icLeafL'); c.put(10, 5, 'icLeafL')
    c.line(1, 15, 3, 13, 'icLeafD')
    c.outline(mapper=lambda n: 'icLeafD')
    return c


def sun16(pal, seed):
    c = icon16(pal, seed)
    c.ellipse(7.5, 7.5, 3.5, 3.5, 'icSun'); c.put(6, 6, 'icSunL'); c.put(7, 6, 'icSunL'); c.put(6, 7, 'icSunL')
    for k in range(8):
        a = math.radians(45 * k)
        for r in (5.5, 6.5):
            x, y = round(7.5 + math.cos(a) * r), round(7.5 + math.sin(a) * r)
            c.put(x, y, 'icSunL' if k % 2 == 0 else 'icSun')
    c.outline(mapper=lambda n: 'icSunD') if False else None
    return c


def pine16(pal, seed):
    c = icon16(pal, seed)
    c.poly([(7.5, 0), (11, 5), (4, 5)], 'icPine')
    c.poly([(7.5, 3), (12, 8), (3, 8)], 'icPine')
    c.poly([(7.5, 6), (14, 12), (1, 12)], 'icPine')
    c.line(7, 1, 5, 4, 'icPineL'); c.line(6, 5, 4, 8, 'icPineL'); c.line(6, 9, 3, 11, 'icPineL')
    c.rect(7, 12, 8, 15, 'icTrunk')
    c.outline(mapper=lambda n: 'icPineD' if n.startswith('icPine') else 'icPineD')
    return c


def lotus16(pal, seed):
    c = icon16(pal, seed)
    c.poly([(7.5, 1), (10.5, 6), (9.5, 11), (5.5, 11), (4.5, 6)], 'icLotus')
    c.poly([(1, 5), (6, 8), (6, 12), (3, 11)], 'icLotus')
    c.poly([(14, 5), (9, 8), (9, 12), (12, 11)], 'icLotus')
    c.line(7, 3, 7, 10, 'icLotusL'); c.line(2, 6, 5, 9, 'icLotusL'); c.line(13, 6, 10, 9, 'icLotusL')
    c.hline(2, 13, 13, 'icLotusD'); c.hline(4, 11, 14, 'icLotusD')
    c.outline(mapper=lambda n: 'icLotusD')
    return c


def hex16(pal, seed):
    c = icon16(pal, seed)
    pts = [(7.5 + 6.5 * math.cos(math.radians(60 * i + 30)), 7.5 + 6.5 * math.sin(math.radians(60 * i + 30))) for i in range(6)]
    for i in range(6):
        a, b = pts[i], pts[(i + 1) % 6]
        c.line(round(a[0]), round(a[1]), round(b[0]), round(b[1]), 'icHex')
    c.rect(6, 6, 9, 9, 'icHexL'); c.rect(7, 7, 8, 8, 'icHex')
    return c


ICONS = {'leaf': leaf16, 'sun': sun16, 'pine': pine16, 'lotus': lotus16, 'lobby': hex16}
for _n, _f in ICONS.items():
    sprite(f'ui.{_n}16', note=f'{_n} icon 16px')(lambda pal, seed, f=_f: f(pal, seed))
    sprite(f'ui.{_n}32', tw=1, th=1, note=f'{_n} icon 32px (2x)')(lambda pal, seed, f=_f: f(pal, seed).scaled(2))


@sprite('ui.compass', note='hexagon compass minimap: Jungle / Oasis / Boreal / Zen quadrants')
def compass(pal, seed):
    c = Canvas(32, 32, pal, seed)
    cx, cy, R = 15.5, 15.5, 14.5
    pts = [(cx + R * math.cos(math.radians(60 * i + 30)), cy + R * math.sin(math.radians(60 * i + 30))) for i in range(6)]
    c.poly(pts, 'icInk')
    pts2 = [(cx + (R - 2) * math.cos(math.radians(60 * i + 30)), cy + (R - 2) * math.sin(math.radians(60 * i + 30))) for i in range(6)]
    c.poly(pts2, 'icBg')
    for y in range(32):
        for x in range(32):
            if c.get(x, y) == 'icBg':
                left, top = x < cx, y < cy
                c.put(x, y, 'icQ1' if left and top else 'icQ2' if (not left and top) else 'icQ3' if left else 'icQ4')
    c.hline(2, 29, 15, 'icBg'); c.hline(2, 29, 16, 'icBg'); c.vline(15, 2, 29, 'icBg'); c.vline(16, 2, 29, 'icBg')
    c.ellipse(15.5, 15.5, 3.5, 3.5, 'icBg'); c.ellipse(15.5, 15.5, 2, 2, 'icHex')
    return c
