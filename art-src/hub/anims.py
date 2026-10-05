"""Shared animated tiles (4 frames, frame 0 = reduced-motion still): portal, fireplace, lamp glow."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new
from pxl import Anim, Canvas

B = 'hub'


@sprite('portal', biome=B, note='teleporter pad: glowing ring with rotating arcs and rising sparks, 4 frames')
def portal(pal, seed):
    frames = []
    for f in range(4):
        c = new(pal, seed)
        cx, cy, rx, ry = 15.5, 17, 14, 10.5
        c.ellipse(cx, cy + 2, rx, ry, 'portalA')                    # pad body (thick)
        c.ellipse(cx, cy, rx, ry, 'metalD')
        c.ellipse(cx, cy, rx - 2, ry - 2, 'portalA')
        c.ellipse(cx, cy, rx - 5, ry - 4, 'ink')
        c.shaded_ellipse(cx, cy, rx - 6, ry - 5, ['portalA', 'portalB', 'portalC'], dither=True)
        # rotating bright arcs on the ring
        for k in range(8):
            a = math.radians(45 * k + f * 11.25)
            x = int(round(cx + math.cos(a) * (rx - 1)))
            y = int(round(cy + math.sin(a) * (ry - 1)))
            col = 'portalD' if k % 2 == 0 else 'portalC'
            c.put(x, y, col); c.put(x + 1, y, col)
        # swirl inside
        for k in range(10):
            a = math.radians(36 * k + f * 20)
            rr = 0.25 + 0.06 * k
            x = int(round(cx + math.cos(a) * (rx - 6) * rr * 1.4))
            y = int(round(cy + math.sin(a) * (ry - 5) * rr * 1.4))
            c.put(x, y, 'portalD')
        # rising sparks
        for i, sx in enumerate((8, 14, 20, 24)):
            sy = int(22 - ((f * 3 + i * 4) % 12))
            c.put(sx, sy, 'sp'); c.put(sx, sy - 1, 'portalC')
        frames.append(c)
    return Anim(frames, fps=6)


@sprite('fireplace', biome=B, note='stone fireplace with logs and dancing flames, 4 frames')
def fireplace(pal, seed):
    frames = []
    for f in range(4):
        c = new(pal, seed)
        # surround
        c.rect(1, 2, 30, 30, 'stone1')
        for y in range(3, 30, 6):
            for x in range(1, 30, 8):
                xo = x + (4 if (y // 6) % 2 else 0)
                c.rect(xo, y, min(30, xo + 6), y + 4, 'plaza1' if (x + y) % 3 else 'stone2')
                c.hline(xo, min(30, xo + 6), y, 'plaza2')
        c.rect(0, 1, 31, 4, 'wood2'); c.hline(0, 31, 1, 'wood4'); c.hline(0, 31, 4, 'wood0')          # mantel
        c.rect(6, 9, 25, 29, 'ink')                                                                   # opening
        c.rect(6, 9, 25, 9, 'stone0'); c.vline(6, 9, 29, 'stone0'); c.vline(25, 9, 29, 'stone0')
        # logs
        c.rect(8, 25, 23, 28, 'wood1'); c.hline(8, 23, 25, 'wood2'); c.rect(10, 23, 21, 25, 'wood2'); c.hline(10, 21, 23, 'wood3')
        for x in (9, 14, 19, 22):
            c.put(x, 27, 'wood0')
        # flames: three tongues whose height varies by frame
        sway = (0, 1, 0, -1)[f]
        for cx, h, col in ((11, 9 + (f % 2), 'flame0'), (16, 13 - (f % 3 == 1), 'flame0'), (21, 8 + ((f + 1) % 2), 'flame0')):
            c.poly([(cx - 4, 25), (cx + 4, 25), (cx + 1 + sway, 25 - h), (cx - 1 + sway, 25 - h - 2)], col)
        for cx, h in ((11, 6), (16, 9), (21, 5)):
            c.poly([(cx - 3, 25), (cx + 3, 25), (cx + sway, 25 - h)], 'flame1')
        for cx, h in ((11, 3), (16, 5), (21, 3)):
            c.poly([(cx - 2, 25), (cx + 2, 25), (cx + sway, 25 - h)], 'flame2')
        c.rect(14, 22, 18, 25, 'flame3')
        for k, (sx, sy) in enumerate(((10, 14), (22, 12), (15, 10), (19, 16))):
            c.put(sx + (f + k) % 2, sy - ((f * 2 + k) % 5), 'flame2')                                  # embers
        frames.append(c)
    return Anim(frames, fps=6)


@sprite('lampGlow', biome=B, note='warm glow overlay behind lamps, 4 frames of gentle flicker')
def lamp_glow(pal, seed):
    frames = []
    bay = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    for f in range(4):
        c = new(pal, seed)
        rad = 13.5 + (0, 0.8, 0.2, -0.6)[f]
        for y in range(32):
            for x in range(32):
                d = math.hypot((x - 15.5) / rad, (y - 15.5) / rad)
                if d >= 1:
                    continue
                t = (1 - d) * 4
                idx = int(t) + (1 if (t - int(t)) > bay[y % 4][x % 4] / 16 else 0)
                if idx >= 1:
                    c.put(x, y, ('g1', 'g2', 'g3', 'g4')[min(3, idx - 1)])
        frames.append(c)
    return Anim(frames, fps=5)
