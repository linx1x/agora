"""Shared desk-top props. Each is drawn centred in its own 32x32 cell (used as decals / decor)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('prop.laptopOpen', note='open laptop, screen toward the camera')
def laptop_open(pal, seed):
    c = new(pal, seed)
    c.rect(6, 6, 25, 20, 'silverD'); c.rect(7, 7, 24, 19, 'screenD')
    c.rect(8, 8, 23, 18, 'screenM'); c.hline(8, 23, 8, 'screenL')
    c.rect(9, 10, 15, 16, 'screenD'); c.hline(10, 14, 12, 'leaf4' if False else 'greenL'); c.hline(10, 13, 14, 'screenL')
    c.rect(17, 10, 22, 16, 'screenD'); c.vline(18, 14, 16, 'greenL'); c.vline(20, 12, 16, 'greenL'); c.vline(22, 11, 16, 'blueL')
    c.line(8, 17, 11, 14, 'screenL')
    c.poly([(4, 21), (27, 21), (29, 26), (2, 26)], 'silver')
    c.hline(4, 27, 21, 'white'); c.hline(2, 29, 26, 'silverD')
    for y in (22, 24):
        for x in range(6, 26, 2):
            c.put(x, y, 'silverD')
    c.rect(13, 25, 18, 25, 'silverD')
    c.outline(); c.ground_shadow(3, 28, 28) if False else None
    return c


@sprite('prop.laptopClosed', note='closed laptop, lid with logo')
def laptop_closed(pal, seed):
    c = new(pal, seed)
    c.poly([(5, 14), (26, 14), (29, 24), (2, 24)], 'silver')
    c.hline(5, 26, 14, 'white'); c.vline(5, 14, 24, 'white') if False else None
    c.rect(2, 24, 29, 26, 'silverD'); c.hline(2, 29, 24, 'silver')
    c.rect(14, 18, 17, 21, 'silverD'); c.put(15, 19, 'white')
    c.outline(); c.ground_shadow(3, 28, 27)
    return c


@sprite('prop.monitorFront', note='stand-alone monitor, screen visible')
def monitor_front(pal, seed):
    c = new(pal, seed)
    c.rect(4, 3, 27, 20, 'metalD'); c.rect(5, 4, 26, 18, 'screenD'); c.rect(6, 5, 25, 17, 'screenM'); c.hline(6, 25, 5, 'screenL')
    c.rect(8, 7, 17, 15, 'screenD'); c.hline(9, 14, 9, 'greenL'); c.hline(9, 16, 11, 'screenL'); c.hline(9, 13, 13, 'orange')
    c.rect(19, 7, 24, 15, 'screenD'); c.vline(20, 12, 15, 'greenL'); c.vline(22, 9, 15, 'blueL'); c.vline(24, 11, 15, 'greenL')
    c.line(7, 15, 12, 6, 'screenL') if False else None
    c.rect(14, 21, 17, 24, 'metalM'); c.vline(17, 21, 24, 'metalD'); c.rect(10, 25, 21, 26, 'metalD'); c.hline(10, 21, 25, 'metalM')
    c.outline(); c.ground_shadow(7, 24, 28)
    return c


@sprite('prop.monitorBack', note='stand-alone monitor seen from behind')
def monitor_back(pal, seed):
    c = new(pal, seed)
    c.rect(4, 3, 27, 20, 'metalD'); c.rect(5, 4, 26, 19, 'metalM'); c.hline(5, 26, 4, 'metalL'); c.vline(5, 4, 19, 'metalL')
    c.rect(14, 9, 17, 12, 'metalL'); c.rect(15, 10, 16, 11, 'greenL')
    for x in range(8, 24, 2):
        c.put(x, 17, 'metalD')
    c.rect(14, 21, 17, 24, 'metalM'); c.vline(17, 21, 24, 'metalD'); c.rect(10, 25, 21, 26, 'metalD'); c.hline(10, 21, 25, 'metalM')
    c.outline(); c.ground_shadow(7, 24, 28)
    return c


@sprite('prop.keyboard', note='keyboard + mouse')
def keyboard(pal, seed):
    c = new(pal, seed)
    c.rect(3, 14, 22, 21, 'silverD'); c.hline(3, 22, 14, 'silver'); c.rect(4, 15, 21, 20, 'silver')
    for y in (16, 18):
        for x in range(5, 21, 2):
            c.put(x, y, 'silverD')
    c.hline(7, 17, 20, 'silverD')
    c.rect(24, 15, 27, 21, 'silver'); c.rect(24, 15, 27, 15, 'white'); c.vline(25, 16, 17, 'silverD'); c.put(26, 19, 'silverD')
    c.outline(); c.ground_shadow(4, 26, 23)
    return c


@sprite('prop.notebook', note='notebook with pen')
def notebook(pal, seed):
    c = new(pal, seed)
    c.rect(7, 8, 22, 22, 'blue'); c.hline(7, 22, 8, 'blueL'); c.vline(7, 8, 22, 'blueL'); c.hline(7, 22, 22, 'blue') if False else None
    c.vline(22, 8, 22, 'blue'); c.rect(6, 9, 6, 21, 'paper')
    c.rect(10, 11, 19, 14, 'paper'); c.hline(11, 17, 12, 'paperD')
    c.vline(21, 8, 22, 'gold')                      # elastic band
    c.line(24, 10, 27, 20, 'red'); c.put(24, 10, 'redL'); c.put(27, 20, 'ink')
    c.outline(); c.ground_shadow(7, 24, 24)
    return c


@sprite('prop.headset', note='headphones with mic')
def headset(pal, seed):
    import math
    c = new(pal, seed)
    for y in range(2, 20):
        for x in range(4, 28):
            d = math.hypot((x - 15.5) / 11.5, (y - 15) / 12)
            if 0.78 < d < 1.0 and y < 18:
                c.put(x, y, 'metalL' if (x < 15 and y < 9) else 'metalM' if d < 0.9 else 'metalD')
    for x in (3, 25):
        c.rect(x, 14, x + 4, 23, 'metalD'); c.vline(x, 14, 23, 'metalM'); c.rect(x + 1, 16, x + 3, 21, 'red'); c.put(x + 1, 16, 'redL')
    c.line(5, 23, 11, 27, 'metalM'); c.rect(11, 27, 13, 28, 'metalD')
    c.outline(); return c


def desk_lamp(pal, seed, on):
    c = new(pal, seed)
    c.rect(7, 26, 18, 28, 'metalD'); c.hline(7, 18, 26, 'metalM')
    c.line(12, 25, 15, 14, 'metalM'); c.line(13, 25, 16, 14, 'metalD')
    c.line(15, 14, 20, 10, 'metalM')
    head = 'lantern' if on else 'metalM'
    c.poly([(16, 6), (27, 8), (28, 12), (18, 13), (15, 10)], head)
    c.hline(17, 27, 6, 'lanternL' if on else 'metalL')
    c.hline(17, 27, 12, 'lantern' if on else 'metalD')
    c.outline()
    if on:
        g = new(pal, seed)
        g.poly([(18, 14), (27, 14), (30, 25), (14, 25)], 'glow')
        for y in range(32):
            for x in range(32):
                if c.get(x, y) is None and g.get(x, y):
                    c.put(x, y, 'glow')
        for x, y in ((20, 17), (25, 20), (18, 22), (23, 23)):
            c.put(x, y, 'lampGlow')
    return c


@sprite('prop.lampOn', note='desk lamp, on')
def lamp_on(pal, seed):
    return desk_lamp(pal, seed, True)


@sprite('prop.lampOff', note='desk lamp, off')
def lamp_off(pal, seed):
    return desk_lamp(pal, seed, False)
