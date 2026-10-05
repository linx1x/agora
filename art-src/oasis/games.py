"""Oasis game area: pool table (2x1), ping-pong (2x1), board game, VR stand."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('oasis.poolTable', tw=2, note='billiard table, teal felt, balls and cue (2x1)')
def pool_table(pal, seed):
    c = new(pal, seed, 2, 1)
    # shadow + legs
    for x in (4, 54):
        c.rect(x, 23, x + 4, 29, 'wood1'); c.vline(x, 23, 29, 'wood2'); c.vline(x + 4, 23, 29, 'wood0')
    # rails, felt, pockets
    c.rect(1, 7, 62, 25, 'wood1'); c.hline(1, 62, 7, 'wood3'); c.hline(1, 62, 8, 'wood2')
    c.rect(4, 10, 59, 21, 'felt1'); c.hline(4, 59, 10, 'felt0'); c.vline(4, 10, 21, 'felt0')
    c.dither_band(8, 12, 56, 13, 'felt1', 'felt2')
    c.rect(1, 22, 62, 25, 'wood2'); c.hline(1, 62, 22, 'wood3'); c.hline(1, 62, 25, 'wood0')
    for px, py in ((3, 9), (31, 9), (60, 9), (3, 21), (31, 21), (60, 21)):
        c.rect(px - 1, py - 1, px + 2, py + 2, 'ink')
    # triangle of balls + cue ball + cue
    cols = ['arcR1', 'arcY', 'arcB1', 'flowerO', 'palm2', 'flowerP']
    k = 0
    for col_i in range(4):
        for row in range(col_i + 1):
            c.put(40 + col_i * 2, 13 + row * 2 - col_i, cols[k % len(cols)]); k += 1
    c.put(14, 15, 'white'); c.put(15, 15, 'white')
    c.line(2, 5, 12, 14, 'wood3'); c.line(2, 6, 12, 15, 'wood1')
    c.rect(24, 12, 25, 13, 'felt2')                         # chalk
    c.outline(); c.ground_shadow(2, 61, 30)
    return c


@sprite('oasis.pingPong', tw=2, note='ping-pong table with net, paddles and ball (2x1)')
def ping_pong(pal, seed):
    c = new(pal, seed, 2, 1)
    for x in (6, 54):
        c.rect(x, 22, x + 2, 29, 'metalD'); c.vline(x, 22, 29, 'metalM')
    c.rect(2, 8, 61, 22, 'tile0'); c.hline(2, 61, 8, 'tile1'); c.hline(2, 61, 9, 'tile1')
    c.rect(3, 10, 60, 20, 'tile0'); c.hline(3, 60, 15, 'white')              # centre line
    c.hline(3, 60, 10, 'white'); c.hline(3, 60, 20, 'white'); c.vline(3, 10, 20, 'white'); c.vline(60, 10, 20, 'white')
    c.rect(2, 21, 61, 23, 'turq0'); c.hline(2, 61, 23, 'ink')
    # net
    c.rect(31, 5, 32, 21, 'white'); c.vline(30, 6, 21, 'metalL'); c.vline(33, 6, 21, 'metalD'); c.hline(30, 33, 5, 'metalM')
    for y in range(7, 21, 2):
        c.hline(30, 33, y, 'silver')
    # paddles + ball
    c.ellipse(9, 14, 3, 3, 'arcR1'); c.rect(8, 16, 9, 19, 'wood2'); c.put(8, 13, 'arcR2')
    c.ellipse(54, 14, 3, 3, 'arcB1'); c.rect(53, 16, 54, 19, 'wood2'); c.put(53, 13, 'arcB2')
    c.put(22, 13, 'white'); c.put(23, 13, 'paper')
    c.outline(); c.ground_shadow(3, 60, 30)
    return c


@sprite('oasis.boardGame', note='low table with backgammon board and two stools')
def board_game(pal, seed):
    c = new(pal, seed)
    for sx in (1, 25):
        c.rect(sx, 16, sx + 5, 18, 'terra'); c.hline(sx, sx + 5, 16, 'flowerO'); c.rect(sx, 19, sx + 5, 21, 'terraD')
        c.rect(sx + 1, 22, sx + 1, 27, 'wood1'); c.rect(sx + 4, 22, sx + 4, 27, 'wood0')
    c.rect(6, 8, 25, 21, 'wood3'); c.hline(6, 25, 8, 'wood4'); c.rect(6, 22, 25, 25, 'wood1'); c.hline(6, 25, 22, 'wood2')
    c.vline(6, 8, 21, 'wood4'); c.vline(25, 9, 21, 'wood2')
    for x in (8, 22):
        c.rect(x, 26, x + 1, 29, 'wood1'); c.vline(x + 1, 26, 29, 'wood0')
    c.rect(8, 10, 23, 19, 'wood0')                                           # backgammon board with triangles
    for i in range(6):
        c.poly([(9 + i * 2.5, 10), (11 + i * 2.5, 10), (10 + i * 2.5, 14)], 'cream1' if i % 2 else 'terra')
        c.poly([(9 + i * 2.5, 19), (11 + i * 2.5, 19), (10 + i * 2.5, 15)], 'terra' if i % 2 else 'cream1')
    c.vline(15, 10, 19, 'wood1')
    c.put(10, 11, 'white'); c.put(20, 17, 'ink'); c.put(12, 17, 'white'); c.put(18, 12, 'ink')
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


@sprite('oasis.vr', note='VR stand on a woven play mat')
def vr(pal, seed):
    c = new(pal, seed)
    c.ellipse(12, 25, 11, 5.5, 'wood1'); c.ellipse(12, 25, 9.5, 4.5, 'cream1'); c.ellipse(12, 25, 6.5, 3, 'cream0')
    c.ellipse(12, 24, 4.5, 1.8, 'turq1'); c.put(11, 24, 'turq2')
    c.rect(23, 14, 25, 29, 'metalM'); c.vline(23, 14, 29, 'metalL'); c.vline(25, 14, 29, 'metalD')
    c.rect(19, 28, 29, 30, 'metalD'); c.hline(19, 29, 28, 'metalM')
    c.rect(15, 3, 30, 12, 'metalD'); c.hline(16, 29, 3, 'metalM'); c.vline(15, 4, 11, 'metalM')
    c.rect(17, 5, 28, 10, 'screenD'); c.hline(17, 28, 5, 'screenM')
    c.rect(18, 6, 21, 9, 'screenL'); c.rect(24, 6, 27, 9, 'screenL'); c.put(18, 6, 'white'); c.put(24, 6, 'white')
    c.rect(12, 6, 14, 10, 'chairG1'); c.vline(12, 6, 10, 'chairG2'); c.rect(31, 6, 31, 10, 'chairG0')
    c.hline(18, 27, 1, 'chairG1'); c.vline(18, 1, 3, 'chairG1'); c.vline(27, 1, 3, 'chairG1'); c.hline(19, 26, 1, 'chairG2')
    c.rect(22, 12, 26, 14, 'metalM')
    c.rect(6, 21, 8, 25, 'metalD'); c.put(7, 22, 'turq2'); c.put(7, 24, 'arcR1'); c.put(6, 21, 'metalM')
    c.rect(15, 22, 17, 26, 'metalD'); c.put(16, 23, 'turq2'); c.put(16, 25, 'arcR1'); c.put(15, 22, 'metalM')
    c.outline()
    return c
