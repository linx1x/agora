"""Jungle game area: arcade cabinets (1x2), board-game table, VR rig."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Canvas


def arcade(pal, seed, d, m, l, accent):
    c = new(pal, seed, 1, 2)
    # body
    c.rect(4, 4, 27, 60, m)
    c.vline(4, 4, 60, l); c.vline(5, 4, 60, l); c.vline(27, 4, 60, d); c.vline(26, 4, 60, d)
    # marquee (lit sign)
    c.rect(6, 4, 25, 11, 'metalD'); c.rect(7, 5, 24, 10, 'lampCore')
    c.rect(8, 6, 23, 9, accent)
    for x in (10, 14, 18):
        c.rect(x, 7, x + 2, 8, 'white')
    # screen bezel + screen
    c.rect(7, 13, 24, 31, 'metalD')
    c.rect(8, 14, 23, 30, 'screenD')
    c.rect(9, 15, 22, 29, 'ink')
    # tiny invaders game
    for gx, gy in ((10, 17), (14, 17), (18, 17), (12, 21), (16, 21), (20, 21)):
        c.rect(gx, gy, gx + 2, gy, 'leaf4'); c.put(gx, gy + 1, 'leaf4'); c.put(gx + 2, gy + 1, 'leaf4'); c.put(gx + 1, gy + 1, 'ink')
    c.rect(15, 27, 16, 28, 'screenL'); c.put(15, 25, 'arcY'); c.hline(9, 22, 29, 'leaf3')
    c.line(9, 15, 12, 15, 'screenM') if False else None
    # control panel (slanted look)
    c.rect(5, 33, 26, 40, d)
    c.rect(5, 33, 26, 34, l)
    c.rect(7, 35, 24, 39, 'metalD')
    c.rect(10, 36, 11, 38, 'metalM'); c.put(10, 35, 'arcR1'); c.put(11, 35, 'arcR1'); c.put(10, 36, 'arcR2')   # joystick ball
    for bx, col in ((15, 'arcY'), (18, 'leaf4'), (21, 'arcR1')):
        c.rect(bx, 36, bx + 1, 37, col); c.put(bx, 36, 'white')
    # coin door
    c.rect(10, 44, 21, 52, 'metalD'); c.rect(11, 45, 20, 51, 'metalM'); c.hline(11, 20, 45, 'metalL')
    c.rect(13, 47, 14, 49, 'ink'); c.put(13, 47, 'arcY'); c.rect(17, 47, 18, 49, 'ink'); c.put(17, 47, 'arcY')
    # side art stripe + base
    for y in range(14, 58, 4):
        c.put(5, y, accent); c.put(26, y, accent)
    c.rect(4, 56, 27, 60, d); c.hline(4, 27, 56, l)
    c.outline(); c.ground_shadow(4, 28, 62)
    return c


@sprite('jungle.arcadeA', th=2, note='blue arcade cabinet (1x2)')
def arcade_a(pal, seed):
    return arcade(pal, seed, 'arcB0', 'arcB1', 'arcB2', 'arcR1')


@sprite('jungle.arcadeB', th=2, note='red arcade cabinet (1x2)')
def arcade_b(pal, seed):
    return arcade(pal, seed, 'arcR0', 'arcR1', 'arcR2', 'arcY')


@sprite('jungle.boardGame', note='table with board game, dice, two stools')
def board_game(pal, seed):
    c = new(pal, seed)
    # stools
    for sx in (1, 25):
        c.rect(sx, 16, sx + 5, 18, 'wood3'); c.hline(sx, sx + 5, 16, 'wood4'); c.rect(sx, 19, sx + 5, 21, 'wood1')
        c.rect(sx + 1, 22, sx + 1, 27, 'wood1'); c.rect(sx + 4, 22, sx + 4, 27, 'wood0')
    # table
    c.rect(6, 8, 25, 21, 'wood3'); c.hline(6, 25, 8, 'wood4'); c.rect(6, 22, 25, 25, 'wood1'); c.hline(6, 25, 22, 'wood2')
    c.vline(6, 8, 21, 'wood4'); c.vline(25, 9, 21, 'wood2')
    for x in (8, 22):
        c.rect(x, 26, x + 1, 29, 'wood1'); c.vline(x + 1, 26, 29, 'wood0')
    # board 4x3 checker
    for j in range(3):
        for i in range(4):
            col = 'cream' if (i + j) % 2 == 0 else 'leaf2'
            c.rect(8 + i * 4, 10 + j * 3, 11 + i * 4, 12 + j * 3, col)
    c.rect(7, 9, 24, 9, 'wood1'); c.rect(7, 19, 24, 19, 'wood1'); c.vline(7, 9, 19, 'wood1'); c.vline(24, 9, 19, 'wood1')
    # pieces + dice
    c.put(10, 11, 'arcR1'); c.put(10, 10, 'arcR2'); c.put(14, 14, 'arcB1'); c.put(14, 13, 'arcB2'); c.put(18, 11, 'arcR1'); c.put(22, 17, 'arcB1')
    c.rect(20, 15, 21, 16, 'white'); c.put(20, 15, 'ink')
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


@sprite('jungle.vr', note='VR stand on a play mat')
def vr(pal, seed):
    c = new(pal, seed)
    # play mat
    c.ellipse(12, 25, 11, 5.5, 'metalD'); c.ellipse(12, 25, 9.5, 4.5, 'leaf2'); c.ellipse(12, 25, 6.5, 3, 'leaf1')
    c.ellipse(12, 24, 4.5, 1.8, 'leaf3'); c.put(11, 24, 'leaf4')
    # stand: post + base
    c.rect(23, 14, 25, 29, 'metalM'); c.vline(23, 14, 29, 'metalL'); c.vline(25, 14, 29, 'metalD')
    c.rect(19, 28, 29, 30, 'metalD'); c.hline(19, 29, 28, 'metalM')
    # headset (big visor, lens glow, head strap)
    c.rect(15, 3, 30, 12, 'metalD'); c.hline(16, 29, 3, 'metalM'); c.vline(15, 4, 11, 'metalM')
    c.rect(17, 5, 28, 10, 'screenD'); c.hline(17, 28, 5, 'screenM')
    c.rect(18, 6, 21, 9, 'screenL'); c.rect(24, 6, 27, 9, 'screenL'); c.put(18, 6, 'white'); c.put(24, 6, 'white')
    c.rect(12, 6, 14, 10, 'chairG1'); c.vline(12, 6, 10, 'chairG2'); c.rect(31, 6, 31, 10, 'chairG0')
    c.hline(18, 27, 1, 'chairG1'); c.vline(18, 1, 3, 'chairG1'); c.vline(27, 1, 3, 'chairG1'); c.hline(19, 26, 1, 'chairG2')
    c.rect(22, 12, 26, 14, 'metalM')
    # controllers on the mat
    c.rect(6, 21, 8, 25, 'metalD'); c.put(7, 22, 'leaf4'); c.put(7, 24, 'arcR1'); c.put(6, 21, 'metalM')
    c.rect(15, 22, 17, 26, 'metalD'); c.put(16, 23, 'leaf4'); c.put(16, 25, 'arcR1'); c.put(15, 22, 'metalM')
    c.outline()
    return c
