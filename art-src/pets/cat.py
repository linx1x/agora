"""
The Agora cat (ADR-040, P14.3): one set of poses drawn in ginger, dressed into six coats.

Frames are 32x32 with the cat about 22 px tall, anchored at the bottom with a 2 px contact
shadow. The walk (right) and the front sit are the approved probe, kept as ASCII below
(a ink, b base, c highlight, h shade, g cream, d eye, e pupil, f nose, i shadow). Left is the
right pose mirrored by the client. Coats are palette swaps plus pattern layers (`dress`).
  python3 scripts/art/build.py pets
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Canvas, Anim

# ───────────────────────────────────────────── probe frames (walk right x4, sit front)
WALK_R0 = (3, 9, [
    '.aa........................',
    '.aba.......................',
    '.aba..............aa..aa...',
    '.aba.............aba.aba...',
    '..aba...........abbaaabba..',
    '..aba...........abccbbbbba.',
    '...aba.........abcbbbbbbba.',
    '...aba.........abbbbbbdeba.',
    '....abaaaaaaaaabbbbbbbdeba.',
    '....abcccccccccbbbbbbbbbbfa',
    '....abbbbbbbbbbbbbbbbbbbgga',
    '.....abbbbbbbbbbbbbbbbbggga',
    '.....abbbbbbbbbbbbbbagggga.',
    '.....abbbbbbbbbbbbbbbaaaa..',
    '.....ahbbbbbbbbbbbbggga....',
    '.....ahbbbbbbbbbbbbggga....',
    '......ahbbbbbbbbbbhhga.....',
    '...aba.aha...aha.aba.......',
    '...aba.aha...aha.aba.......',
    '...aba.aha...aha.aba.......',
    '...aaa.aaa...aaa.aaa.......',
    '....iiiiiiiiiiiiiiiiiiii...',
])
WALK_R1 = (3, 9, [
    '.aba.......................',
    '.aba..............aa..aa...',
    '.aba.............aba.aba...',
    '..aba...........abbaaabba..',
    '..aba...........abccbbbbba.',
    '...aba.........abcbbbbbbba.',
    '...aba.........abbbbbbdeba.',
    '....abaaaaaaaaabbbbbbbdeba.',
    '....abcccccccccbbbbbbbbbbfa',
    '....abbbbbbbbbbbbbbbbbbbgga',
    '.....abbbbbbbbbbbbbbbbbggga',
    '.....abbbbbbbbbbbbbbagggga.',
    '.....abbbbbbbbbbbbbbbaaaa..',
    '.....ahbbbbbbbbbbbbggga....',
    '.....ahbbbbbbbbbbbbggga....',
    '......ahbbbbbbbbbbhhga.....',
    '.....abaa.....aaba.........',
    '.....abaa.....aaba.........',
    '.....abaa.....aaba.........',
    '.....abaa.....aaba.........',
    '.....aaaa.....aaaa.........',
    '....iiiiiiiiiiiiiiiiiiii...',
])
WALK_R2 = (3, 9, [
    '.aa........................',
    '.aba.......................',
    '.aba..............aa..aa...',
    '.aba.............aba.aba...',
    '..aba...........abbaaabba..',
    '..aba...........abccbbbbba.',
    '...aba.........abcbbbbbbba.',
    '...aba.........abbbbbbdeba.',
    '....abaaaaaaaaabbbbbbbdeba.',
    '....abcccccccccbbbbbbbbbbfa',
    '....abbbbbbbbbbbbbbbbbbbgga',
    '.....abbbbbbbbbbbbbbbbbggga',
    '.....abbbbbbbbbbbbbbagggga.',
    '.....abbbbbbbbbbbbbbbaaaa..',
    '.....ahbbbbbbbbbbbbggga....',
    '.....ahbbbbbbbbbbbbggga....',
    '......ahbbbbbbbbbbhhga.....',
    '...aha.aba...aba.aha.......',
    '...aha.aba...aba.aha.......',
    '...aha.aba...aba.aha.......',
    '...aaa.aaa...aaa.aaa.......',
    '....iiiiiiiiiiiiiiiiiiii...',
])
WALK_R3 = (3, 9, [
    '.aba.......................',
    '.aba..............aa..aa...',
    '.aba.............aba.aba...',
    '..aba...........abbaaabba..',
    '..aba...........abccbbbbba.',
    '...aba.........abcbbbbbbba.',
    '...aba.........abbbbbbdeba.',
    '....abaaaaaaaaabbbbbbbdeba.',
    '....abcccccccccbbbbbbbbbbfa',
    '....abbbbbbbbbbbbbbbbbbbgga',
    '.....abbbbbbbbbbbbbbbbbggga',
    '.....abbbbbbbbbbbbbbagggga.',
    '.....abbbbbbbbbbbbbbbaaaa..',
    '.....ahbbbbbbbbbbbbggga....',
    '.....ahbbbbbbbbbbbbggga....',
    '......ahbbbbbbbbbbhhga.....',
    '.....aaba.....abaa.........',
    '.....aaba.....abaa.........',
    '.....aaba.....abaa.........',
    '.....aaba.....abaa.........',
    '.....aaaa.....aaaa.........',
    '....iiiiiiiiiiiiiiiiiiii...',
])
SIT = (6, 10, [
    '..aa............aa.....',
    '..aba..........aba.....',
    '..abbaaaaaaaaaabba.....',
    '..abcbbbbbbbbbbcba.....',
    '.abcbbbbbbbbbbbbcba....',
    '.abdebbbbbbbbbbedba....',
    '.abdebbbbffbbbbedba....',
    '.abbgggggffgggggbba....',
    '..abbggggggggggbba.....',
    '...abbbbbbbbbbbba......',
    '..abcbbbbbbbbbbcba.....',
    '.abcbbbggggggbbbcba.aaa',
    '.abbbbggggggggbbbba.hha',
    '.abbbbggggggggbbbba.hha',
    '.abbbbggggggggbbbba.bba',
    '.abbhbbggggggbbhbba.hha',
    'abbhhbbbbbbbbbbhhbbabba',
    'abbbbbbbbbbbbbbbbbbabba',
    'agggbbbbbbbbbbbbgggabba',
    'aaaaaaaaaaaaaaaaaaaaaaa',
    'iiiiiiiiiiiiiiiiiiii...',
])


# ───────────────────────────────────────────── drawing helpers
KEY = {'a': 'catInk', 'b': 'catBase', 'c': 'catHi', 'h': 'catLo', 'g': 'catCream',
       'd': 'catEye', 'e': 'catPupil', 'f': 'catNose', 'i': 'shade', 's': 'catStripe'}
INK, BASE, HI, LO, CREAM = 'catInk', 'catBase', 'catHi', 'catLo', 'catCream'


def paint(c, rows, x0, y0):
    """Stamp an ASCII block (see KEY) with its top-left at (x0, y0); '.' is transparent."""
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch != '.':
                c.put(x0 + i, y0 + j, KEY[ch])
    return c


def crop(block, x0, y0, x1, y1):
    """Sub-block of a probe block in sheet coordinates (x0..x1, y0..y1 inclusive)."""
    bx, by, rows = block
    return [r[x0 - bx:x1 - bx + 1] for r in rows[y0 - by:y1 - by + 1]]


def body(c, cx, cy, rx, ry, hi=True):
    """A shaded oval of fur, no outline: base, a lighter top edge, a darker underside."""
    c.ellipse(cx, cy, rx, ry, BASE)
    if hi:
        for x in range(int(cx - rx + 2), int(cx + rx - 1)):
            for y in range(int(cy - ry - 1), int(cy + ry + 2)):
                if c.get(x, y) == BASE and c.get(x, y - 1) is None:
                    c.put(x, y, HI)
    for x in range(int(cx - rx - 1), int(cx + rx + 2)):
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            if c.get(x, y) == BASE and c.get(x, y + 1) is None:
                c.put(x, y, LO)
    return c


def finish(c, shadow=(5, 26, 30)):
    c.outline(lambda _n: INK)
    if shadow:
        c.ground_shadow(*shadow)
    return c


# The head and chest of the walking cat (facing right), from the approved probe.
HEAD_R = crop(WALK_R0, 17, 11, 29, 22)
# The front of the sitting cat (head with both ears, chest and paws).
HEAD_F = crop(SIT, 8, 10, 26, 20)


# ───────────────────────────────────────────── poses (ginger; coats are made from these)
def walk_right(pal, seed):
    out = []
    for blk in (WALK_R0, WALK_R1, WALK_R2, WALK_R3):
        c = new(pal, seed)
        paint(c, blk[2], blk[0], blk[1])
        out.append(c)
    return out


def sit_front(pal, seed):
    c = new(pal, seed)
    paint(c, SIT[2], SIT[0], SIT[1])
    return [c]


def _legs_front(c, planted, lift, y_top=23):
    """Two front/back legs: `planted` reaches the ground, `lift` is raised 2 px."""
    for (x0, x1), end in (((11, 14), 29 - 0 if planted == 'L' else 27), ((18, 21), 29 if planted == 'R' else 27)):
        c.rect(x0, y_top, x1, end, BASE)
        c.vline(x0, y_top, end, HI)
        c.vline(x1, y_top, end, LO)
        c.rect(x0, end - 1, x1, end, CREAM)


def walk_down(pal, seed):
    out = []
    for planted, bob in (('L', 0), ('L', -1), ('R', 0), ('R', -1)):
        c = new(pal, seed)
        _legs_front(c, planted, None)
        body(c, 16, 20 + bob, 7, 6)
        c.rect(14, 17 + bob, 18, 23 + bob, CREAM)
        c.outline(lambda _n: INK)
        paint(c, HEAD_F[:10], 7, 6 + bob)
        c.ground_shadow(7, 25, 30)
        out.append(c)
    return out


def _back_of_head(rows):
    """The sitting cat's head seen from behind: no eyes, nose or muzzle."""
    out = []
    for r in rows:
        out.append(r.replace('d', 'b').replace('e', 'b').replace('f', 'b').replace('g', 'b'))
    return out


def walk_up(pal, seed):
    out = []
    for planted, bob in (('L', 0), ('L', -1), ('R', 0), ('R', -1)):
        c = new(pal, seed)
        _legs_front(c, planted, None)
        for x0, x1 in ((11, 14), (18, 21)):
            c.rect(x0, 28, x1, 29, LO)
        body(c, 16, 21 + bob, 8, 6)
        c.vline(16, 16 + bob, 22 + bob, HI)
        pts = [(22, 22 + bob), (25, 19 + bob), (26, 14 + bob), (25, 9 + bob), (23, 6 + bob)]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            c.line(x0, y0, x1, y1, BASE)
            c.line(x0 + 1, y0, x1 + 1, y1, LO)
        c.outline(lambda _n: INK)
        paint(c, _back_of_head(HEAD_F[:10]), 7, 6 + bob)
        c.ground_shadow(7, 25, 30)
        out.append(c)
    return out


def loaf(pal, seed):
    c = new(pal, seed)
    body(c, 14, 23, 9.5, 5.5)
    # the tail tucked along the front, a paw peeking out
    c.hline(7, 20, 27, LO)
    c.rect(19, 26, 22, 27, CREAM)
    c.outline(lambda _n: INK)
    paint(c, HEAD_R, 17, 14)
    c.ground_shadow(5, 27, 29)
    return [c]


def sleep(pal, seed):
    """Lying down with the head on the paws, eye closed; the second frame is the breath in."""
    out = []
    for rise in (0, 1):
        c = new(pal, seed)
        body(c, 14, 24 - rise, 10, 4.5 + rise * 0.7)
        c.hline(6, 22, 28, LO)                   # tail wrapped along the belly
        c.rect(5, 26, 9, 28, LO)
        c.rect(18, 27, 24, 28, CREAM)            # paws in front, under the chin
        c.outline(lambda _n: INK)
        head = [r.replace('d', 'b').replace('e', 'b') for r in HEAD_R]
        paint(c, head, 15, 16)
        c.put(23, 22, INK); c.put(24, 22, INK)    # closed eye
        c.ground_shadow(4, 28, 29)
        out.append(c)
    return out


def drink(pal, seed):
    out = []
    for tongue in (False, True):
        c = new(pal, seed)
        paint(c, WALK_R0[2], WALK_R0[0], WALK_R0[1])
        for y in range(9, 22):
            for x in range(19, 32):
                c.put(x, y, None)
        # neck down to the lowered head
        c.rect(19, 18, 23, 24, BASE)
        c.vline(19, 18, 24, HI)
        c.outline(lambda _n: INK) if False else None
        paint(c, HEAD_R, 17, 17)
        if tongue:
            c.put(29, 27, 'catNose')
        out.append(c)
    return out


def _bow(c, lean):
    """Play-bow, facing right: hips high, back sloping down to low shoulders. lean 0 = barely, 1 = full."""
    hip = 18 - lean
    c.poly([(4, hip), (12, hip - 2), (21, 22 + lean), (24, 27), (11, 26), (4, hip + 7)], BASE)
    c.line(5, hip, 12, hip - 2, HI); c.line(12, hip - 2, 20, 22 + lean, HI)
    c.line(5, hip + 7, 11, 26, LO)
    c.rect(5, hip + 5, 8, 29, BASE); c.rect(10, hip + 5, 12, 29, BASE)       # hind legs, straight
    c.vline(5, hip + 5, 29, HI); c.vline(8, hip + 5, 29, LO)
    c.rect(18, 27, 28, 29, BASE); c.hline(25, 28, 29, CREAM); c.hline(18, 28, 27, HI)  # front legs out
    for i in range(7 + lean):                                                 # tail straight up
        c.put(2, hip - 1 - i, BASE); c.put(3, hip - 1 - i, LO)


def stretch(pal, seed):
    out = []
    for step in range(3):
        c = new(pal, seed)
        _bow(c, (0, 2, 2)[step])
        c.outline(lambda _n: INK)
        head = list(HEAD_R)
        paint(c, head, 17, (15, 17, 17)[step])
        if step == 2:                      # a yawn
            c.put(28, 22, 'catNose'); c.put(27, 23, INK); c.put(28, 23, INK)
        c.ground_shadow(1, 29, 30)
        out.append(c)
    return out


ANIMS = {
    'walk': (walk_right, 8),
    'walkUp': (walk_up, 8),
    'walkDown': (walk_down, 8),
    'sit': (sit_front, 0),
    'loaf': (loaf, 0),
    'sleep': (sleep, 2),
    'drink': (drink, 4),
    'stretch': (stretch, 3),
}


# ───────────────────────────────────────────── coats
COATS = ('ginger', 'grey', 'black', 'tabby', 'tuxedo', 'calico')

_BLACK = {'catInk': 'blackInk', 'catBase': 'blackBase', 'catHi': 'blackHi', 'catLo': 'blackLo',
          'catCream': 'blackCream', 'catEye': 'blackEye', 'catNose': 'blackNose'}
REMAP = {
    'ginger': {},
    'grey': {'catInk': 'greyInk', 'catBase': 'greyBase', 'catHi': 'greyHi', 'catLo': 'greyLo',
             'catCream': 'greyCream', 'catEye': 'greyEye', 'catNose': 'greyNose'},
    'black': _BLACK,
    'tabby': {'catInk': 'tabbyInk', 'catBase': 'tabbyBase', 'catHi': 'tabbyHi', 'catLo': 'tabbyLo',
              'catCream': 'tabbyCream'},
    # black with a white chest, muzzle and paws; the eyes stay green
    'tuxedo': {**_BLACK, 'catCream': 'tuxWhite', 'catEye': 'catEye', 'catNose': 'catNose'},
}
_FUR = ('catBase', 'catHi', 'catLo')
_LYING = ('loaf', 'sleep')


def _noise(x: int, y: int) -> int:
    return ((x * 73856093) ^ (y * 19349663)) % 100


def dress(c, coat: str, anim: str):
    """A copy of a ginger frame in `coat`: palette swap, then the coat's pattern."""
    n = c.copy()
    if coat == 'calico':
        # white with orange and black patches: 7x6 px blocks, picked by a fixed hash
        for y in range(n.h):
            for x in range(n.w):
                v = n.px[y][x]
                if v in _FUR:
                    k = _noise(x // 7, y // 6)
                    ramp = 'cat' if k < 30 else ('black' if k < 48 else None)
                    if ramp == 'cat':
                        continue
                    if ramp == 'black':
                        n.px[y][x] = {'catBase': 'blackBase', 'catHi': 'blackHi', 'catLo': 'blackLo'}[v]
                    else:
                        n.px[y][x] = {'catBase': 'calicoWhite', 'catHi': 'calicoWhite', 'catLo': 'calicoWhiteLo'}[v]
                elif v == 'catCream':
                    n.px[y][x] = 'calicoWhite'
                elif v == 'catEye':
                    n.px[y][x] = 'greyEye'
        return n
    n.recolor(REMAP[coat])
    if coat == 'tabby':
        for y in range(n.h):
            for x in range(n.w):
                if n.px[y][x] in ('tabbyBase', 'tabbyHi', 'tabbyLo') and (x + y // 2) % 6 == 0:
                    n.px[y][x] = 'tabbyStripe'
    elif coat == 'tuxedo' and anim not in _LYING:
        # white socks: the last rows of every leg
        for y in range(26, 30):
            for x in range(n.w):
                if n.px[y][x] in ('blackBase', 'blackHi', 'blackLo'):
                    n.px[y][x] = 'tuxWhite'
    return n


def _register():
    for coat in COATS:
        for anim, (fn, fps) in ANIMS.items():
            def make(pal, seed, fn=fn, coat=coat, anim=anim, fps=fps):
                frames = [dress(f, coat, anim) for f in fn(pal, seed)]
                return Anim(frames, fps) if len(frames) > 1 else frames[0]
            sprite(f'cat.{coat}.{anim}', biome='pets', note=f'{coat} cat, {anim}')(make)


_register()
