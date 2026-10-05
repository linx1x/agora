"""Zen quiet-play pieces: go board table, jigsaw puzzle table, stone water basin (animated), folding screen."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Anim, Canvas


@sprite('zen.boardGame', note='low go table with a goban and two zabuton')
def board_game(pal, seed):
    c = new(pal, seed)
    for sx in (1, 25):
        c.rect(sx, 16, sx + 5, 18, 'indigo1'); c.hline(sx, sx + 5, 16, 'indigo2'); c.rect(sx, 19, sx + 5, 21, 'indigo0')
        c.put(sx, 16, 'terra'); c.put(sx + 5, 16, 'terra')
    c.rect(6, 8, 25, 21, 'wood2'); c.hline(6, 25, 8, 'wood4'); c.rect(6, 22, 25, 25, 'wood1'); c.hline(6, 25, 22, 'wood2')
    c.vline(6, 8, 21, 'wood4'); c.vline(25, 9, 21, 'wood1')
    for x in (8, 22):
        c.rect(x, 26, x + 1, 29, 'wood1'); c.vline(x + 1, 26, 29, 'wood0')
    c.rect(8, 10, 23, 19, 'wood3')                                                  # goban grid
    for x in range(9, 23, 3):
        c.vline(x, 10, 19, 'wood0')
    for y in (11, 14, 17):
        c.hline(8, 23, y, 'wood0')
    for x, y, col in ((11, 11, 'ink'), (14, 14, 'white'), (17, 14, 'ink'), (14, 17, 'ink'), (20, 11, 'white'), (11, 17, 'white'), (20, 17, 'ink')):
        c.put(x, y, col); c.put(x + 1, y, col) if col == 'ink' else None
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


@sprite('zen.puzzle', note='low table with a half-finished landscape jigsaw puzzle')
def puzzle(pal, seed):
    c = new(pal, seed)
    c.rect(4, 18, 6, 27, 'wood1'); c.rect(25, 18, 27, 27, 'wood1'); c.vline(6, 18, 27, 'wood0'); c.vline(27, 18, 27, 'wood0')
    c.rect(2, 8, 29, 22, 'wood2'); c.hline(2, 29, 8, 'wood4'); c.rect(2, 21, 29, 23, 'wood1'); c.hline(2, 29, 23, 'wood0')
    c.rect(5, 10, 26, 19, 'shoji2')                                                 # puzzle frame
    c.rect(5, 10, 26, 14, 'indigo3'); c.rect(5, 15, 26, 19, 'bons2')                # sky and field
    c.poly([(9, 15), (15, 10), (21, 15)], 'indigo1'); c.poly([(13, 15), (15, 12), (17, 15)], 'white')   # mountain
    for x, y in ((8, 17), (13, 16), (18, 18), (23, 16)):
        c.rect(x, y, x + 1, y + 1, 'bons3')
    for (x, y) in ((6, 11), (17, 12), (22, 18), (10, 18)):                          # missing pieces
        c.rect(x, y, x + 2, y + 2, 'wood1')
    c.rect(24, 12, 26, 14, 'maple2'); c.put(25, 13, 'maple3')                      # loose piece beside the board
    c.rect(6, 20, 8, 21, 'sakura2')
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


def tsukubai_frame(pal, f):
    c = Canvas(32, 32, pal, 3)
    c.ellipse(16, 27, 12, 3.5, 'moss0'); c.ellipse(16, 26.5, 10, 2.8, 'moss1'); c.ellipse(12, 26, 4, 1.2, 'moss2')
    # stone basin
    c.ellipse(16, 22, 11, 6, 'stone0'); c.ellipse(16, 21, 11, 6, 'stone2'); c.ellipse(16, 20.5, 8.5, 4, 'stone0')
    c.ellipse(16, 20.5, 7.5, 3.4, 'water1'); c.ellipse(16, 20, 5.5, 2.2, 'water2')
    ripple = f % 4
    c.hline(14 - ripple // 2, 18 + ripple // 2, 20, 'water3') if ripple % 2 == 0 else c.put(16, 20, 'foam')
    c.rect(4, 22, 7, 24, 'stone1'); c.hline(4, 7, 22, 'stone3')
    # bamboo spout dripping into the basin
    c.rect(22, 4, 24, 15, 'bamboo1'); c.vline(22, 4, 15, 'bamboo2'); c.vline(24, 4, 15, 'bamboo0'); c.hline(22, 24, 9, 'bamboo0')
    c.poly([(21, 15), (25, 15), (17, 17)], 'bamboo1'); c.line(21, 15, 17, 17, 'bamboo2')
    c.rect(20, 14, 26, 14, 'bamboo0')
    drop = (f * 2) % 8
    c.put(17, 17 + drop // 2 if drop < 6 else 18, 'water3'); c.put(17, 17 + drop // 2 + 1, 'foam') if drop < 4 else None
    c.vline(17, 16, 17, 'water2')
    c.outline(); c.ground_shadow(4, 28, 30)
    return c


@sprite('zen.tsukubai', note='stone water basin with a dripping bamboo spout, 4 frames')
def tsukubai(pal, seed):
    return Anim([tsukubai_frame(pal, f) for f in range(4)], fps=4)


@sprite('zen.screen', note='folding byobu screen with an ink mountain landscape')
def screen(pal, seed):
    c = new(pal, seed)
    for i, x0 in enumerate((2, 12, 22)):
        top = 6 + (i % 2)
        c.rect(x0, top, x0 + 7, 28, 'bark1'); c.rect(x0 + 1, top + 1, x0 + 6, 27, 'shoji2')
        c.vline(x0, top, 28, 'bark2'); c.vline(x0 + 7, top, 28, 'bark0'); c.hline(x0, x0 + 7, top, 'bark2')
    c.rect(3, 8, 8, 27, 'shoji2')
    c.poly([(3, 20), (6, 12), (9, 20)], 'indigo1'); c.poly([(11, 22), (16, 13), (21, 22)], 'indigo2'); c.poly([(21, 21), (26, 14), (30, 21)], 'indigo1')
    c.poly([(14, 16), (16, 13), (18, 16)], 'white')
    c.ellipse(24, 10, 2.4, 2.4, 'terra')
    c.line(5, 25, 9, 23, 'moss1'); c.line(25, 26, 29, 24, 'moss1')
    c.outline(); c.ground_shadow(2, 29, 30)
    return c
