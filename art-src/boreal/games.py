"""Boreal game area: TV and console (2x1), chess table, VR stand."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('boreal.tv', tw=2, note='wide TV on a low timber cabinet with a console and two controllers (2x1)')
def tv(pal, seed):
    c = new(pal, seed, 2, 1)
    # cabinet
    c.rect(2, 19, 61, 28, 'bark2'); c.hline(2, 61, 19, 'bark3'); c.hline(2, 61, 28, 'bark0'); c.vline(2, 19, 28, 'bark3'); c.vline(61, 19, 28, 'bark0')
    c.vline(31, 20, 28, 'bark1'); c.vline(32, 20, 28, 'bark3')
    c.rect(6, 22, 26, 26, 'bark0'); c.rect(37, 22, 57, 26, 'bark0')
    c.rect(9, 23, 22, 25, 'metalD'); c.hline(9, 22, 23, 'metalM'); c.put(20, 24, 'lampGlow')        # console
    c.rect(41, 23, 43, 25, 'chairG1'); c.rect(47, 23, 49, 25, 'arcB1'); c.put(42, 23, 'chairG2'); c.put(48, 23, 'arcB2')   # controllers
    # TV on the cabinet
    c.rect(8, 2, 55, 17, 'ink'); c.hline(8, 55, 2, 'metalM'); c.vline(8, 2, 17, 'metalM')
    c.rect(10, 4, 53, 15, 'screenD')
    c.dither_band(10, 4, 53, 6, 'screenM', 'screenD')
    c.rect(12, 7, 30, 13, 'screenM'); c.hline(12, 30, 7, 'screenL')
    c.poly([(14, 13), (20, 8), (26, 13)], 'pine2'); c.poly([(18, 13), (24, 9), (30, 13)], 'pine3'); c.ellipse(36, 9, 3, 3, 'fire2')   # game scene
    for x in range(33, 52, 4):
        c.put(x, 12, 'screenL')
    c.rect(26, 17, 37, 18, 'metalD'); c.hline(26, 37, 18, 'metalM')
    c.put(52, 16, 'lampGlow')
    c.outline(); c.ground_shadow(2, 61, 30)
    return c


@sprite('boreal.boardGame', note='low timber table with a chess set and two stools')
def board_game(pal, seed):
    c = new(pal, seed)
    for sx in (1, 25):
        c.rect(sx, 16, sx + 5, 18, 'wool1'); c.hline(sx, sx + 5, 16, 'wool2'); c.rect(sx, 19, sx + 5, 21, 'wool0')
        c.rect(sx + 1, 22, sx + 1, 27, 'bark1'); c.rect(sx + 4, 22, sx + 4, 27, 'bark0')
    c.rect(6, 8, 25, 21, 'bark3'); c.hline(6, 25, 8, 'wood4'); c.rect(6, 22, 25, 25, 'bark1'); c.hline(6, 25, 22, 'bark2')
    c.vline(6, 8, 21, 'wood4'); c.vline(25, 9, 21, 'bark2')
    for x in (8, 22):
        c.rect(x, 26, x + 1, 29, 'bark1'); c.vline(x + 1, 26, 29, 'bark0')
    for i in range(8):                                                       # checkerboard
        for j in range(4):
            c.rect(8 + i * 2, 10 + j * 2, 9 + i * 2, 11 + j * 2, 'cream1' if (i + j) % 2 == 0 else 'bark0')
    c.put(10, 11, 'ink'); c.put(10, 12, 'ink'); c.put(20, 17, 'white'); c.put(12, 17, 'white'); c.put(18, 12, 'ink'); c.put(18, 11, 'ink')
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


@sprite('boreal.vr', note='VR stand on a woven play mat')
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
