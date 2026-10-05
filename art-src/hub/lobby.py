"""Lobby / shared fixtures drawn in the hub palette. Names are the GLOBAL tile keys from tileset.ts."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Anim, Canvas

B = 'hub'


def hexagon(c, cx, cy, r, col, fill=None):
    pts = [(cx + r * math.cos(math.radians(60 * i + 30)), cy + r * math.sin(math.radians(60 * i + 30))) for i in range(6)]
    if fill:
        c.poly(pts, fill)
    for i in range(6):
        a, b = pts[i], pts[(i + 1) % 6]
        c.line(round(a[0]), round(a[1]), round(b[0]), round(b[1]), col)


def counter_top(c, y0=6, y1=14):
    c.rect(0, y0, 31, y1, 'wood3'); c.hline(0, 31, y0, 'wood4' if 'wood4' in c.pal else 'cream'); c.hline(0, 31, y0 + 1, 'wood3')
    c.hline(0, 31, y1, 'wood1'); c.dither_band(0, y0 + 2, 31, y0 + 2, 'wood3', 'wood2')
    for x in range(2, 30, 6):
        c.hline(x, x + 3, y0 + 4, 'wood2')


@sprite('reception', biome=B, note='reception desk: wood counter, hexagon logo, bell, tablet')
def reception(pal, seed):
    c = new(pal, seed)
    counter_top(c, 8, 16)
    c.rect(0, 17, 31, 28, 'wood1'); c.hline(0, 31, 17, 'wood3'); c.rect(0, 26, 31, 28, 'wood0')
    c.vline(0, 17, 28, 'wood2'); c.vline(31, 17, 28, 'wood0')
    hexagon(c, 15.5, 22, 5, 'brass1', fill='navy'); c.put(15, 22, 'brass2'); c.put(16, 22, 'brass2')
    c.rect(4, 4, 11, 8, 'metalD'); c.rect(5, 5, 10, 7, 'screenM'); c.hline(5, 10, 5, 'screenL')       # tablet
    c.rect(22, 6, 25, 8, 'brass1'); c.hline(22, 25, 6, 'brass2'); c.put(23, 5, 'brass2')              # bell
    c.rect(27, 4, 29, 8, 'mugW'); c.hline(27, 29, 4, 'coffee')
    c.outline(); c.ground_shadow(0, 31, 30)
    return c


@sprite('counter', biome=B, note='cafe counter with espresso machine and cups')
def counter(pal, seed):
    c = new(pal, seed)
    c.rect(0, 12, 31, 18, 'stone2'); c.hline(0, 31, 12, 'plaza3'); c.hline(0, 31, 18, 'stone1')     # stone top
    c.dither_band(0, 13, 31, 13, 'plaza3', 'stone2')
    c.rect(0, 19, 31, 29, 'wood1'); c.hline(0, 31, 19, 'wood3'); c.rect(0, 28, 31, 29, 'wood0')
    for x in (10, 21):
        c.vline(x, 20, 27, 'wood0'); c.vline(x + 1, 20, 27, 'wood2')
    # espresso machine
    c.rect(3, 3, 14, 12, 'metalM'); c.rect(3, 3, 14, 4, 'metalL'); c.rect(3, 12, 14, 12, 'metalD')
    c.rect(5, 6, 7, 8, 'ink'); c.put(6, 7, 'redL'); c.rect(10, 6, 12, 8, 'metalD'); c.put(11, 7, 'greenL')
    c.rect(6, 10, 7, 12, 'metalD'); c.rect(10, 10, 11, 12, 'metalD')
    # cups + grinder + plant
    c.rect(18, 8, 20, 12, 'mugW'); c.hline(18, 20, 8, 'coffee'); c.rect(22, 8, 24, 12, 'mugW'); c.hline(22, 24, 8, 'coffee')
    c.rect(26, 4, 29, 12, 'dateB'); c.hline(26, 29, 4, 'dateL'); c.rect(27, 2, 28, 3, 'metalD')
    c.outline(); c.ground_shadow(0, 31, 30)
    return c


@sprite('fridge', biome=B, note='silver two-door fridge')
def fridge(pal, seed):
    c = new(pal, seed)
    c.rect(5, 1, 26, 29, 'silver'); c.vline(5, 1, 29, 'silver'); c.vline(26, 1, 29, 'silverD'); c.vline(25, 1, 29, 'silverD') if False else None
    c.hline(5, 26, 1, 'white'); c.hline(5, 26, 29, 'silverD')
    c.hline(6, 25, 10, 'metalM'); c.hline(6, 25, 11, 'silverD')
    c.rect(8, 5, 9, 8, 'metalD'); c.rect(8, 14, 9, 19, 'metalD')                              # handles
    c.rect(13, 14, 17, 18, 'paper'); c.put(14, 15, 'red'); c.put(16, 16, 'blue')              # note + magnets
    c.rect(19, 4, 23, 6, 'redL'); c.rect(20, 18, 22, 20, 'greenL')
    c.dither_band(6, 22, 25, 28, 'silver', 'silverD')
    c.outline(); c.ground_shadow(4, 27, 30)
    return c


@sprite('whiteboard', biome=B, note='wall whiteboard with scribbles and sticky notes')
def whiteboard(pal, seed):
    c = new(pal, seed)
    c.rect(1, 4, 30, 25, 'metalM'); c.hline(1, 30, 4, 'metalL'); c.rect(2, 5, 29, 24, 'board')
    c.hline(2, 29, 24, 'boardD'); c.vline(29, 5, 24, 'boardD')
    c.line(5, 9, 12, 9, 'marker2'); c.line(5, 12, 10, 12, 'marker2'); c.line(5, 15, 14, 15, 'marker3')
    c.line(18, 18, 22, 8, 'marker1'); c.line(22, 8, 26, 18, 'marker1'); c.line(20, 14, 24, 14, 'marker1')
    for x, y, col in ((15, 6, 'gold'), (24, 20, 'pink'), (4, 19, 'greenL')):
        c.rect(x, y, x + 3, y + 3, col); c.put(x + 1, y + 1, 'wood1')
    c.rect(8, 26, 23, 27, 'metalD'); c.rect(10, 25, 11, 25, 'marker1'); c.rect(13, 25, 14, 25, 'marker2'); c.rect(16, 25, 17, 25, 'marker3')
    c.outline()
    return c


@sprite('coffeeTable', biome=B, note='low wooden coffee table with books and a cup')
def coffee_table(pal, seed):
    c = new(pal, seed)
    c.rect(3, 9, 28, 20, 'wood3'); c.hline(3, 28, 9, 'cream'); c.rect(3, 21, 28, 24, 'wood1'); c.hline(3, 28, 21, 'wood2')
    c.vline(3, 9, 20, 'cream'); c.vline(28, 10, 20, 'wood2')
    for x in (5, 25):
        c.rect(x, 25, x + 1, 28, 'wood1'); c.vline(x + 1, 25, 28, 'wood0')
    c.rect(6, 11, 14, 16, 'blue'); c.hline(6, 14, 11, 'blueL'); c.rect(7, 13, 15, 17, 'red'); c.hline(7, 15, 13, 'redL')
    c.rect(20, 12, 24, 16, 'mugW'); c.hline(20, 24, 12, 'coffee')
    c.outline(); c.ground_shadow(3, 28, 30)
    return c


@sprite('glassDoor', biome=B, note='glass door, closed')
def glass_door(pal, seed):
    c = new(pal, seed)
    c.rect(0, 0, 31, 31, 'metalD'); c.rect(2, 2, 29, 30, 'metalM')
    c.rect(4, 4, 27, 29, 'glassA'); c.rect(4, 4, 27, 14, 'glassB'); c.dither_band(4, 15, 27, 16, 'glassB', 'glassA')
    c.line(6, 14, 14, 5, 'white'); c.line(9, 20, 20, 5, 'glassB'); c.line(15, 27, 26, 12, 'glassB')
    c.vline(15, 4, 29, 'metalM'); c.vline(16, 4, 29, 'metalD')
    c.rect(11, 15, 12, 20, 'metalL'); c.rect(19, 15, 20, 20, 'metalL')                             # handles
    c.hline(0, 31, 0, 'metalL'); c.rect(0, 30, 31, 31, 'metalD')
    return c


@sprite('glassDoorOpen', biome=B, note='glass door, open (frame only, dark opening)')
def glass_door_open(pal, seed):
    c = new(pal, seed)
    c.rect(0, 0, 31, 31, 'metalD'); c.rect(2, 2, 29, 30, 'wood0')
    c.rect(2, 2, 6, 30, 'glassA'); c.rect(2, 2, 6, 10, 'glassB'); c.vline(6, 2, 30, 'metalM')
    c.rect(25, 2, 29, 30, 'glassA'); c.rect(25, 2, 29, 10, 'glassB'); c.vline(25, 2, 30, 'metalM')
    c.rect(7, 4, 24, 30, 'plaza1'); c.dither_band(7, 24, 24, 30, 'plaza1', 'plaza2'); c.hline(7, 24, 4, 'plaza0')
    c.hline(0, 31, 0, 'metalL'); c.rect(0, 30, 31, 31, 'metalD')
    return c


@sprite('waterCooler', biome=B, note='water cooler with blue jug')
def water_cooler(pal, seed):
    c = new(pal, seed)
    c.rect(9, 2, 22, 13, 'jug'); c.vline(9, 2, 13, 'jugL'); c.vline(22, 2, 13, 'jugD'); c.hline(9, 22, 2, 'jugL')
    c.rect(11, 5, 14, 9, 'jugL'); c.rect(12, 0, 19, 1, 'jugD')
    c.rect(8, 14, 23, 28, 'silver'); c.vline(8, 14, 28, 'white'); c.vline(23, 14, 28, 'silverD'); c.hline(8, 23, 14, 'white')
    c.rect(11, 17, 13, 19, 'blueL'); c.rect(18, 17, 20, 19, 'redL'); c.rect(14, 21, 17, 22, 'metalD')
    c.rect(10, 24, 21, 27, 'metalD'); c.rect(14, 23, 17, 23, 'mugW')
    c.outline(); c.ground_shadow(7, 24, 30)
    return c


@sprite('sign', biome=B, note='wooden info sign with arrows and hexagon')
def sign(pal, seed):
    c = new(pal, seed)
    c.rect(14, 12, 17, 29, 'wood2'); c.vline(14, 12, 29, 'wood3'); c.vline(17, 12, 29, 'wood0')
    c.rect(3, 3, 28, 15, 'wood1'); c.rect(4, 4, 27, 14, 'wood3'); c.hline(4, 27, 4, 'cream'); c.hline(4, 27, 14, 'wood2')
    hexagon(c, 9, 9, 3, 'navy', fill='brass1')
    c.hline(14, 24, 7, 'navy'); c.hline(14, 22, 9, 'navy'); c.hline(14, 23, 11, 'navy'); c.put(25, 9, 'navy'); c.put(24, 8, 'navy'); c.put(24, 10, 'navy')
    c.rect(11, 28, 20, 30, 'stone2'); c.hline(11, 20, 28, 'stone1' if False else 'plaza3')
    c.outline(); c.ground_shadow(10, 21, 30) if False else None
    return c


@sprite('mat', biome=B, note='seamless coir weave (the map tiles this as a floor rug)')
def mat(pal, seed):
    c = new(pal, seed)
    for y in range(32):
        for x in range(32):
            c.put(x, y, 'coir1' if ((x // 2 + y // 2) % 2 == 0) else 'coir2')
    for y in range(32):
        for x in range(32):
            if (x + y) % 8 == 0:
                c.put(x, y, 'coir0')
    c.hline(0, 31, 0, 'coir0'); c.hline(0, 31, 31, 'coir0')
    return c


@sprite('bookshelf', biome=B, note='warm wooden bookshelf')
def bookshelf(pal, seed):
    c = new(pal, seed)
    r = c.rng
    c.rect(1, 2, 30, 30, 'wood1'); c.rect(2, 3, 29, 29, 'wood0')
    for y0 in (3, 12, 21):
        c.rect(2, y0, 29, y0 + 7, 'wood0')
        x = 3
        while x < 28:
            w = r.randint(2, 4); h = r.randint(5, 7)
            col = r.choice(['blue', 'red', 'greenL', 'gold', 'pink', 'cream', 'blueL', 'orange'])
            c.rect(x, y0 + 7 - h, x + w - 1, y0 + 7, col); c.vline(x, y0 + 7 - h, y0 + 7, 'white' if col in ('cream', 'gold') else col)
            x += w + (2 if r.random() < 0.15 else 0)
        c.rect(1, y0 + 8, 30, y0 + 9, 'wood2'); c.hline(1, 30, y0 + 8, 'wood3')
    c.hline(1, 30, 2, 'wood3'); c.vline(1, 2, 30, 'wood2'); c.vline(30, 2, 30, 'wood0')
    c.outline()
    return c


def _water(x, y, f):
    xs = (x + 8 * f) % 32
    T = math.tau / 32
    band = math.sin(xs * T * 2 + 1.4 * math.sin(y * T * 2)) + 0.8 * math.sin(y * T * 4 + xs * T)
    return 'water2' if band > 1.35 else 'water0' if band < -1.5 else 'water1'


@sprite('water', biome=B, note='plain water tile (fountain ring / pools), 4 frames')
def water(pal, seed):
    frames = []
    for f in range(4):
        c = new(pal, seed)
        for y in range(32):
            for x in range(32):
                c.put(x, y, _water(x, y, f))
        frames.append(c)
    return Anim(frames, fps=4)
