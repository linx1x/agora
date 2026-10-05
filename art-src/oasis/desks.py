"""Oasis desks: light blond wood, 3/4 view. Desk top rows 8-20, front lip 21-22, apron 23-26, legs to 30."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from pxl import Canvas
from registry import sprite, new


def desk_body(c: Canvas) -> Canvas:
    r = c.rng
    # top surface: lit back edge, 3 planks with grain, bevel on the left/right
    c.rect(0, 8, 31, 20, 'wood3')
    c.hline(0, 31, 8, 'wood4'); c.hline(0, 31, 9, 'wood4')
    c.dither_band(0, 10, 31, 10, 'wood4', 'wood3')
    for y in (12, 16):                       # plank seams (dark line + light line below)
        c.hline(0, 31, y, 'wood2')
        c.hline(0, 31, y + 1, 'wood4') if y == 12 else c.hline(0, 31, y + 1, 'wood3')
    for y in (11, 14, 15, 18, 19):           # grain dashes
        x = r.randint(0, 6)
        while x < 31:
            ln = r.randint(2, 5)
            c.hline(x, min(31, x + ln), y, 'wood2' if y % 2 else 'wood4')
            x += ln + r.randint(5, 10)
    for kx, ky in ((r.randint(3, 8), 14), (r.randint(20, 27), 18)):   # knots
        c.put(kx, ky, 'wood2'); c.put(kx + 1, ky, 'wood1'); c.put(kx, ky + 1, 'wood2')
    c.vline(0, 8, 20, 'wood4'); c.vline(31, 9, 20, 'wood2')
    c.hline(0, 31, 20, 'wood2')
    # front lip + apron + drawer shadow
    c.hline(0, 31, 21, 'wood4')
    c.rect(0, 22, 31, 22, 'wood3')
    c.rect(0, 23, 31, 26, 'wood2')
    c.hline(0, 31, 23, 'wood1')
    c.dither_band(0, 24, 31, 24, 'wood2', 'wood1')
    c.hline(0, 31, 26, 'wood0')
    # legs with highlight + shadow side, little cross-brace
    for x0 in (1, 27):
        c.rect(x0, 27, x0 + 3, 30, 'wood2')
        c.vline(x0, 27, 30, 'wood3'); c.vline(x0 + 3, 27, 30, 'wood0'); c.vline(x0 + 2, 27, 30, 'wood1')
    for x in range(5, 27):                   # soft shadow under the desk
        c.put(x, 27, 'shade'); c.put(x, 28, 'shade' if x % 2 else None)
    return c


def mug(c: Canvas, x: int, y: int, steam: bool = True) -> None:
    c.rect(x, y + 1, x + 3, y + 4, 'mugW')
    c.hline(x, x + 3, y + 1, 'coffee'); c.put(x + 1, y + 1, 'coffeeL')
    c.vline(x + 4, y + 2, y + 3, 'mugW'); c.put(x + 4, y + 2, 'paperD') if False else None
    c.hline(x, x + 3, y + 5, 'paperD'); c.vline(x + 3, y + 2, y + 4, 'paperD')
    if steam:
        c.put(x + 1, y - 1, 'white'); c.put(x + 2, y - 2, 'paper')


def succulent(c: Canvas, x: int, y: int) -> None:
    c.rect(x, y + 3, x + 4, y + 5, 'pot'); c.hline(x, x + 4, y + 3, 'potL'); c.hline(x, x + 4, y + 5, 'potD')
    c.vline(x + 4, y + 3, y + 5, 'potD')
    for dx, dy, col in ((2, -1, 'leaf4'), (0, 0, 'leaf3'), (4, 0, 'leaf3'), (2, 1, 'leaf3'), (1, 2, 'leaf2'), (3, 2, 'leaf2'), (2, 0, 'leaf5')):
        c.put(x + dx, y + dy + 1, col)


def sticky(c: Canvas, x: int, y: int, col: str) -> None:
    c.rect(x, y, x + 2, y + 2, col); c.hline(x, x + 2, y + 2, 'wood2') if False else None
    c.put(x + 1, y + 1, 'wood1')


@sprite('oasis.deskH', note='plain desk: notebook, pencil, mug, succulent')
def desk_h(pal, seed):
    c = new(pal, seed)
    desk_body(c)
    # open notebook
    c.rect(4, 11, 15, 18, 'paper')
    c.vline(9, 11, 18, 'paperD')
    c.rect(4, 11, 4, 18, 'leaf2'); c.hline(4, 15, 18, 'paperD')
    for yy in (13, 15, 17):
        c.hline(5, 8, yy, 'paperD'); c.hline(10, 14, yy, 'paperD')
    c.line(17, 11, 19, 18, 'wood1'); c.put(17, 11, 'flowerO')   # pencil
    mug(c, 22, 10)
    succulent(c, 27, 8) if False else None
    sticky(c, 20, 18, 'note')
    c.outline()
    return c


def monitor_front(c: Canvas) -> None:
    c.rect(5, 0, 26, 14, 'metalD')            # bezel
    c.hline(6, 25, 1, 'metalM')
    c.rect(6, 2, 25, 12, 'screenD')
    c.rect(7, 3, 24, 11, 'screenM')
    c.hline(7, 24, 3, 'screenL')              # lit top edge
    # window with title bar + code lines
    c.rect(8, 4, 17, 10, 'screenD')
    c.hline(8, 17, 4, 'screenL')
    c.hline(9, 12, 6, 'leaf4'); c.hline(9, 15, 7, 'screenL'); c.hline(10, 14, 8, 'flowerO'); c.hline(9, 16, 9, 'screenL')
    c.rect(19, 4, 23, 10, 'screenD')          # chart panel
    for i, h in enumerate((2, 4, 3, 5)):
        c.vline(19 + i + (1 if i else 0) * 0, 10 - h, 10, 'leaf4' if i % 2 else 'leaf3')
    c.line(8, 11, 11, 8, 'screenL') if False else None
    c.put(25, 11, 'lampGlow')                  # power led
    c.put(15, 0, 'metalL')                     # webcam
    # neck + base
    c.rect(14, 15, 17, 16, 'metalM'); c.vline(14, 15, 16, 'metalL'); c.vline(17, 15, 16, 'metalD')
    c.rect(10, 17, 21, 17, 'metalM'); c.hline(10, 21, 17, 'metalL'); c.hline(11, 21, 18, 'metalD') if False else None


@sprite('oasis.deskMonitor', note='screen facing camera')
def desk_monitor(pal, seed):
    c = new(pal, seed)
    desk_body(c)
    monitor_front(c)
    # keyboard (3 rows of keys) + mouse + headphones
    c.rect(7, 18, 23, 20, 'metalM'); c.hline(7, 23, 18, 'metalL')
    for x in range(8, 23, 2):
        c.put(x, 19, 'metalL'); 
    for x in range(9, 22, 2):
        c.put(x, 20, 'metalD')
    c.rect(25, 18, 27, 20, 'metalL'); c.put(25, 18, 'white'); c.put(26, 19, 'metalM')
    c.put(3, 12, 'chairG1'); c.rect(2, 13, 4, 16, 'chairG0'); c.put(3, 12, 'chairG2')  # headphones
    c.outline()
    return c


@sprite('oasis.deskMonitorBack', note='monitor seen from behind')
def desk_monitor_back(pal, seed):
    c = new(pal, seed)
    desk_body(c)
    c.rect(5, 0, 26, 14, 'metalD')
    c.rect(6, 1, 25, 13, 'metalM')
    c.hline(6, 25, 1, 'metalL'); c.vline(6, 1, 13, 'metalL')
    c.hline(6, 25, 13, 'metalD'); c.vline(25, 1, 13, 'metalD')
    c.dither_band(7, 10, 24, 12, 'metalM', 'metalD') if False else None
    c.rect(14, 5, 17, 8, 'metalL'); c.rect(15, 6, 16, 7, 'leaf3'); c.put(15, 6, 'leaf5')   # leaf sticker
    for x in range(8, 24, 2):                 # vent slots
        c.put(x, 11, 'metalD')
    c.rect(14, 15, 17, 17, 'metalM'); c.vline(17, 15, 17, 'metalD'); c.vline(14, 15, 17, 'metalL')
    c.rect(10, 18, 21, 18, 'metalD')
    c.rect(9, 19, 22, 20, 'wood2'); c.hline(9, 22, 19, 'wood3')       # desk mat
    c.rect(24, 17, 26, 19, 'note'); c.put(25, 18, 'wood1')
    c.outline()
    return c


def arm_top(c: Canvas, y0: int, y1: int) -> None:
    """Vertical desk arm (top surface seen from above), x 3..27."""
    r = c.rng
    c.rect(3, y0, 27, y1, 'wood3')
    c.vline(3, y0, y1, 'wood4'); c.vline(4, y0, y1, 'wood4')
    c.vline(27, y0, y1, 'wood2')
    for x in (10, 17, 23):                     # plank seams
        c.vline(x, y0, y1, 'wood2'); c.vline(x + 1, y0, y1, 'wood4' if x == 10 else 'wood3')
    for x in (7, 14, 20, 25):                  # grain
        y = y0 + r.randint(0, 4)
        while y < y1:
            ln = r.randint(2, 5)
            c.vline(x, y, min(y1, y + ln), 'wood2')
            y += ln + r.randint(5, 9)
    c.vline(28, y0, y1, 'wood1'); c.vline(29, y0, y1, 'wood0')          # shaded side face
    for y in range(y0, y1 + 1):
        c.put(30, y, 'shade'); c.put(31, y, 'shade' if y % 2 else None)


def lamp_on_desk(c: Canvas, x: int, y: int) -> None:
    c.rect(x, y + 6, x + 4, y + 7, 'metalD'); c.hline(x, x + 4, y + 6, 'metalM')
    c.line(x + 2, y + 6, x + 4, y + 2, 'metalM')
    c.rect(x + 2, y, x + 7, y + 3, 'lantern'); c.hline(x + 2, x + 7, y, 'lanternL'); c.rect(x + 3, y + 3, x + 6, y + 4, 'lampCore')


@sprite('oasis.deskCorner', note='L desk corner: horizontal run + arm going DOWN (top pods)')
def desk_corner(pal, seed):
    c = new(pal, seed)
    t = desk_body(new(pal, seed))
    for y in range(8, 27):
        for x in range(3, 32):
            if y <= 20 or x >= 28:
                c.put(x, y, t.get(x, y))
    for y in range(27, 31):                      # right leg only
        for x in range(27, 31):
            c.put(x, y, t.get(x, y))
    arm_top(c, 21, 31)
    c.vline(3, 8, 20, 'wood4'); c.vline(4, 8, 20, 'wood3')
    lamp_on_desk(c, 6, 8)
    # papers on the arm
    c.rect(10, 24, 18, 29, 'paper'); c.hline(10, 18, 29, 'paperD'); c.hline(11, 17, 26, 'paperD'); c.hline(11, 15, 27, 'paperD')
    c.outline()
    return c


@sprite('oasis.deskCornerUp', note='L desk corner: horizontal run + arm going UP (bottom pods)')
def desk_corner_up(pal, seed):
    c = new(pal, seed)
    t = desk_body(new(pal, seed))
    for y in range(8, 31):
        for x in range(3, 32):
            c.put(x, y, t.get(x, y))
    arm_top(c, 0, 7)
    c.vline(3, 8, 20, 'wood4'); c.vline(4, 8, 20, 'wood3')
    lamp_on_desk(c, 6, 2) if False else None
    c.rect(10, 1, 18, 6, 'paper'); c.hline(10, 18, 6, 'paperD'); c.hline(11, 17, 3, 'paperD'); c.hline(11, 15, 4, 'paperD')
    mug(c, 21, 10)
    c.outline()
    return c


@sprite('oasis.deskV', note='vertical desk arm segment')
def desk_v(pal, seed):
    c = new(pal, seed)
    arm_top(c, 0, 31)
    # items: tablet + sticky + plant pot
    c.rect(9, 6, 19, 14, 'metalD'); c.rect(10, 7, 18, 13, 'screenM'); c.hline(10, 18, 7, 'screenL')
    c.hline(11, 15, 9, 'screenD'); c.hline(11, 17, 11, 'screenD'); c.put(17, 12, 'leaf4')
    succulent(c, 20, 20)
    c.rect(8, 22, 14, 27, 'paper'); c.hline(8, 14, 27, 'paperD'); c.hline(9, 13, 24, 'paperD'); c.put(8, 22, 'leaf2')
    c.outline()
    return c
