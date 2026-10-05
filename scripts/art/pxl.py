"""
pxl: tiny pixel-art drawing toolkit for Agora (Q02).

Sprites are drawn in code against a *named* palette (art-src/palettes.json) and
rendered to RGBA PNG. Shapes are drawn without outline; `outline()` adds a 1 px
selective outline in a dark tint of the neighbouring material.

Coordinates are inclusive pixels, (0,0) top-left, x right, y down.
"""
from __future__ import annotations

import json
import math
import os
import random
import zlib
from typing import Callable, Iterable, Sequence

from PIL import Image, ImageColor

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
PAL_PATH = os.path.join(ROOT, 'art-src', 'palettes.json')

_BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def load_palette(biome: str) -> dict[str, str]:
    data = json.load(open(PAL_PATH, encoding='utf-8'))
    pal = {k: v for k, v in data['common'].items()}
    if biome != 'common':
        pal.update(data[biome])
    return pal


def hex_rgba(v: str) -> tuple[int, int, int, int]:
    if v == 'transparent':
        return (0, 0, 0, 0)
    s = v.lstrip('#')
    if len(s) == 8:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), int(s[6:8], 16))
    return ImageColor.getcolor(v, 'RGBA')


def seed_of(name: str) -> int:
    return zlib.crc32(name.encode()) & 0xFFFFFFFF


def darker_name(name: str, pal: dict[str, str]) -> str:
    """Outline colour for a material: index 0 of the same ramp, else a sensible default."""
    base = name.rstrip('0123456789')
    suffix = name[len(base):]
    if suffix and suffix != '0' and f'{base}0' in pal:
        return f'{base}0'
    if suffix == '0':
        return name
    for fam, out in (('metal', 'metalD'), ('screen', 'screenD'), ('glass', 'metalD')):
        if name.startswith(fam):
            return out
    if name.endswith('D') and name in pal:
        return name
    if f'{name}D' in pal:
        return f'{name}D'
    return 'ink'


class Canvas:
    def __init__(self, w: int = 32, h: int = 32, pal: dict[str, str] | None = None, seed: int = 1):
        self.w, self.h = w, h
        self.pal = pal or {}
        self.px: list[list[str | None]] = [[None] * w for _ in range(h)]
        self.rng = random.Random(seed)

    # ---------- basics ----------
    def inside(self, x: int, y: int) -> bool:
        return 0 <= x < self.w and 0 <= y < self.h

    def put(self, x: int, y: int, c: str | None) -> 'Canvas':
        if self.inside(x, y):
            self.px[y][x] = c
        return self

    def get(self, x: int, y: int) -> str | None:
        return self.px[y][x] if self.inside(x, y) else None

    def rect(self, x0: int, y0: int, x1: int, y1: int, c: str | None) -> 'Canvas':
        for y in range(min(y0, y1), max(y0, y1) + 1):
            for x in range(min(x0, x1), max(x0, x1) + 1):
                self.put(x, y, c)
        return self

    def hline(self, x0: int, x1: int, y: int, c: str | None) -> 'Canvas':
        return self.rect(x0, y, x1, y, c)

    def vline(self, x: int, y0: int, y1: int, c: str | None) -> 'Canvas':
        return self.rect(x, y0, x, y1, c)

    def line(self, x0: int, y0: int, x1: int, y1: int, c: str | None) -> 'Canvas':
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.put(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy
        return self

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, c: str | None) -> 'Canvas':
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                if ((x - cx) / (rx + 0.01)) ** 2 + ((y - cy) / (ry + 0.01)) ** 2 <= 1.0:
                    self.put(x, y, c)
        return self

    def poly(self, pts: Sequence[tuple[float, float]], c: str | None) -> 'Canvas':
        ys = [p[1] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            xs = []
            n = len(pts)
            for i in range(n):
                (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
                if (y0 <= y < y1) or (y1 <= y < y0):
                    xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(math.ceil(xs[i] - 0.5), math.floor(xs[i + 1] - 0.5) + 1):
                    self.put(x, y, c)
        return self

    def where(self, pred: Callable[[int, int, str | None], bool], c: str | None) -> 'Canvas':
        for y in range(self.h):
            for x in range(self.w):
                if pred(x, y, self.px[y][x]):
                    self.px[y][x] = c
        return self

    def replace(self, a: str, b: str | None) -> 'Canvas':
        return self.where(lambda x, y, v: v == a, b)

    def recolor(self, mapping: dict[str, str | None]) -> 'Canvas':
        for y in range(self.h):
            for x in range(self.w):
                v = self.px[y][x]
                if v in mapping:
                    self.px[y][x] = mapping[v]
        return self

    def copy(self) -> 'Canvas':
        n = Canvas(self.w, self.h, self.pal)
        n.px = [row[:] for row in self.px]
        return n

    def blit(self, src: 'Canvas', x: int, y: int, flip: bool = False) -> 'Canvas':
        for j in range(src.h):
            for i in range(src.w):
                v = src.px[j][(src.w - 1 - i) if flip else i]
                if v is not None:
                    self.put(x + i, y + j, v)
        return self

    def flip_h(self) -> 'Canvas':
        n = self.copy()
        n.px = [row[::-1] for row in n.px]
        return n

    def scaled(self, k: int = 2) -> 'Canvas':
        n = Canvas(self.w * k, self.h * k, self.pal)
        for y in range(self.h):
            for x in range(self.w):
                v = self.px[y][x]
                for j in range(k):
                    for i in range(k):
                        n.px[y * k + j][x * k + i] = v
        return n

    def crop(self, x: int, y: int, w: int, h: int) -> 'Canvas':
        n = Canvas(w, h, self.pal)
        for j in range(h):
            for i in range(w):
                n.px[j][i] = self.get(x + i, y + j)
        return n

    # ---------- shading helpers ----------
    def mask(self) -> list[list[bool]]:
        return [[v is not None for v in row] for row in self.px]

    def outline(self, mapper: Callable[[str], str] | None = None, diagonal: bool = False,
                only: Callable[[str], bool] | None = None) -> 'Canvas':
        """1 px selective outline around the opaque pixels (drawn into transparent cells)."""
        m = self.mask()
        out = [row[:] for row in self.px]
        nb = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        if diagonal:
            nb += [(1, 1), (-1, 1), (1, -1), (-1, -1)]
        for y in range(self.h):
            for x in range(self.w):
                if m[y][x]:
                    continue
                best = None
                for dx, dy in nb:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < self.w and 0 <= ny < self.h and m[ny][nx]:
                        v = self.px[ny][nx]
                        if v == 'shade':
                            continue
                        if only and not only(v):
                            continue
                        best = v
                        break
                if best is not None:
                    out[y][x] = (mapper or (lambda n: darker_name(n, self.pal)))(best)
        self.px = out
        return self

    def inner_outline(self, c: str) -> 'Canvas':
        """Recolour opaque pixels touching transparency (used when the sprite fills the cell)."""
        m = self.mask()
        for y in range(self.h):
            for x in range(self.w):
                if not m[y][x]:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < self.w and 0 <= ny < self.h) or not m[ny][nx]:
                        self.px[y][x] = c
                        break
        return self

    def shadow(self, dx: int = 2, dy: int = 2, c: str = 'shade') -> 'Canvas':
        """Drop shadow into transparent cells, offset (dx, dy)."""
        m = self.mask()
        out = [row[:] for row in self.px]
        for y in range(self.h):
            for x in range(self.w):
                if not m[y][x]:
                    continue
                for k in range(1, max(abs(dx), abs(dy)) + 1):
                    sx = x + (dx * k // max(abs(dx), abs(dy), 1))
                    sy = y + (dy * k // max(abs(dx), abs(dy), 1))
                    if 0 <= sx < self.w and 0 <= sy < self.h and not m[sy][sx]:
                        out[sy][sx] = c
        self.px = out
        return self

    def ground_shadow(self, x0: int, x1: int, y: int, c: str = 'shade') -> 'Canvas':
        """Flat contact shadow strip (2 px high) under an object, only on empty cells."""
        for yy in (y, y + 1):
            for x in range(x0, x1 + 1):
                if self.get(x, yy) is None:
                    self.put(x, yy, c)
        return self

    # ---------- textures ----------
    def noise_field(self, w: int, h: int, scale: int = 3, seed: int | None = None) -> list[list[float]]:
        """Seamless (toroidal) blurred value noise in [0,1)."""
        r = random.Random(seed if seed is not None else self.rng.random())
        f = [[r.random() for _ in range(w)] for _ in range(h)]
        for _ in range(2):
            g = [[0.0] * w for _ in range(h)]
            for y in range(h):
                for x in range(w):
                    s = 0.0
                    n = 0
                    for dy in range(-scale // 2, scale // 2 + 1):
                        for dx in range(-scale // 2, scale // 2 + 1):
                            s += f[(y + dy) % h][(x + dx) % w]
                            n += 1
                    g[y][x] = s / n
            f = g
        flat = sorted(v for row in f for v in row)
        lo, hi = flat[0], flat[-1]
        return [[(v - lo) / (hi - lo + 1e-9) for v in row] for row in f]

    def fill_noise(self, names: Sequence[str], seed: int | None = None, scale: int = 3,
                   region: tuple[int, int, int, int] | None = None, weights: Sequence[float] | None = None) -> 'Canvas':
        """Fill region with seamless blotchy bands (quantiles) of `names` (dark to light)."""
        x0, y0, x1, y1 = region or (0, 0, self.w - 1, self.h - 1)
        w, h = x1 - x0 + 1, y1 - y0 + 1
        f = self.noise_field(w, h, scale, seed)
        flat = sorted(v for row in f for v in row)
        wts = list(weights or [1.0] * len(names))
        tot = sum(wts)
        cuts = []
        acc = 0.0
        for wv in wts[:-1]:
            acc += wv / tot
            cuts.append(flat[min(len(flat) - 1, int(acc * len(flat)))])
        for y in range(h):
            for x in range(w):
                v = f[y][x]
                idx = sum(1 for c in cuts if v >= c)
                self.put(x0 + x, y0 + y, names[idx])
        return self


    def fill_gradient(self, names: Sequence[str], seed: int | None = None, scale: int = 6, gain: float = 10.0,
                      region: tuple[int, int, int, int] | None = None, center: float = 0.5) -> 'Canvas':
        """Soft seamless patches: toroidal blurred noise -> ordered-dither ramp (calm, low contrast).
        Raw (un-normalised) noise is used so neighbouring tiles share the same statistics."""
        x0, y0, x1, y1 = region or (0, 0, self.w - 1, self.h - 1)
        w, h = x1 - x0 + 1, y1 - y0 + 1
        r = random.Random(seed if seed is not None else self.rng.random())
        f = [[r.random() for _ in range(w)] for _ in range(h)]
        k = max(1, scale // 2)
        for _ in range(2):
            g = [[0.0] * w for _ in range(h)]
            for y in range(h):
                for x in range(w):
                    s = 0.0
                    n = 0
                    for dy in range(-k, k + 1):
                        for dx in range(-k, k + 1):
                            s += f[(y + dy) % h][(x + dx) % w]
                            n += 1
                    g[y][x] = s / n
            f = g
        n = len(names)
        for y in range(h):
            for x in range(w):
                t = min(0.999, max(0.0, center + (f[y][x] - 0.5) * gain))
                pos = t * (n - 1)
                idx = int(pos)
                if idx < n - 1 and (pos - idx) > _BAYER4[(y + y0) % 4][(x + x0) % 4] / 16:
                    idx += 1
                self.put(x0 + x, y0 + y, names[idx])
        return self

    def speckle(self, names: Sequence[str], count: int, region: tuple[int, int, int, int] | None = None,
                only_over: Sequence[str] | None = None, wrap: bool = False) -> 'Canvas':
        x0, y0, x1, y1 = region or (0, 0, self.w - 1, self.h - 1)
        for _ in range(count):
            x = self.rng.randint(x0, x1)
            y = self.rng.randint(y0, y1)
            if only_over is not None and self.get(x, y) not in only_over:
                continue
            self.put(x, y, self.rng.choice(list(names)))
        return self

    def shaded_ellipse(self, cx: float, cy: float, rx: float, ry: float, ramp: Sequence[str],
                       light: tuple[float, float] = (-0.55, -0.75), dither: bool = True,
                       bias: float = 0.0) -> 'Canvas':
        """Sphere-ish lit ellipse. ramp dark->light. Light comes from top-left by default."""
        n = len(ramp)
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                nx = (x - cx) / (rx + 0.01)
                ny = (y - cy) / (ry + 0.01)
                d2 = nx * nx + ny * ny
                if d2 > 1.0:
                    continue
                nz = math.sqrt(max(0.0, 1 - d2))
                lx, ly = light
                lz = math.sqrt(max(0.0, 1 - lx * lx - ly * ly))
                lam = nx * lx + ny * ly + nz * lz  # -1..1
                t = (lam + 1) / 2 + bias
                t = min(0.999, max(0.0, t))
                pos = t * n
                idx = int(pos)
                if dither and idx < n - 1:
                    frac = pos - idx
                    if frac > _BAYER4[y % 4][x % 4] / 16:
                        idx += 1
                self.put(x, y, ramp[min(n - 1, idx)])
        return self

    def dither_band(self, x0: int, y0: int, x1: int, y1: int, a: str, b: str, vertical: bool = True) -> 'Canvas':
        """Checker-dither between a and b across a strip."""
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, a if (x + y) % 2 == 0 else b)
        return self


    def leaf(self, cx: float, cy: float, rx: float, ry: float, angle: float, ramp: Sequence[str],
             slits: Sequence[float] = (), rib: bool = True, light: tuple[float, float] = (-0.55, -0.75),
             pointy: bool = True, cut_v: float = 0.38, cut_w: float = 0.09) -> 'Canvas':
        """Rotated lit leaf blade. u runs along the leaf axis (stem -> tip), v across it.
        angle in degrees, 0 = pointing right, 90 = pointing down, -90 = pointing up.
        slits: u fractions (-1..1) where monstera-style cuts run in from the edge."""
        ca, sa = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        n = len(ramp)
        R = max(rx, ry)
        lx, ly = light
        for y in range(int(cy - R - 2), int(cy + R + 3)):
            for x in range(int(cx - R - 2), int(cx + R + 3)):
                dx, dy = x - cx, y - cy
                u = dx * ca + dy * sa
                v = -dx * sa + dy * ca
                uu = u / rx
                vv = v / ry
                # pointed tip on +u: squash v near the tip
                width = (1 - uu * uu) if not pointy else (1 - uu) * (1 + uu) * (1.0 if uu < 0 else 1.15 - 0.15 * uu)
                if abs(uu) > 1 or abs(vv) > max(0.0, width) ** 0.5 * 1.0:
                    continue
                cut = False
                for s in slits:
                    if abs(uu - s) < cut_w and abs(vv) > cut_v:
                        cut = True
                if cut:
                    continue
                dot = (dx * -lx - dy * -ly) / R if False else (dx * lx + dy * ly) / R
                t = 0.5 - 0.5 * dot
                idx_f = t * (n - 1)
                idx = int(idx_f)
                if idx < n - 1 and (idx_f - idx) > _BAYER4[y % 4][x % 4] / 16:
                    idx += 1
                if rib and abs(vv) < 0.12 and -0.9 < uu < 0.85:
                    idx = min(n - 1, idx + 1)
                self.put(x, y, ramp[max(0, min(n - 1, idx))])
        return self

    # ---------- output ----------
    def to_image(self, pal: dict[str, str] | None = None) -> Image.Image:
        pal = pal or self.pal
        img = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0))
        cache: dict[str, tuple[int, int, int, int]] = {}
        for y in range(self.h):
            for x in range(self.w):
                v = self.px[y][x]
                if v is None:
                    continue
                if v not in cache:
                    if v in pal:
                        cache[v] = hex_rgba(pal[v])
                    elif v.startswith('#'):
                        cache[v] = hex_rgba(v)
                    else:
                        raise KeyError(f'unknown palette name {v!r}')
                img.putpixel((x, y), cache[v])
        return img

    def to_pixelart_json(self, pal: dict[str, str] | None = None, pixel_size: int = 16) -> dict:
        """Sparse JSON understood by the pixel-art-gen render script."""
        pal = pal or self.pal
        pixels = []
        for y in range(self.h):
            for x in range(self.w):
                v = self.px[y][x]
                if v is None:
                    continue
                col = pal.get(v, v)
                pixels.append({'x': x, 'y': y, 'color': col})
        return {'width': self.w, 'height': self.h, 'background': 'transparent', 'grid_lines': False,
                'pixel_size': pixel_size, 'pixels': pixels}

    def colors_used(self) -> set[str]:
        return {v for row in self.px for v in row if v is not None}

    def is_seamless(self) -> bool:
        """True when left/right and top/bottom edge columns are fully opaque (floor tiles)."""
        return all(v is not None for v in self.px[0]) and all(v is not None for v in self.px[-1])


class Anim:
    """A sprite made of several same-size frames laid out left to right."""

    def __init__(self, frames: Sequence[Canvas], fps: int = 6):
        self.frames = list(frames)
        self.fps = fps
        self.w, self.h = frames[0].w, frames[0].h


def seamless_tile_check(c: Canvas) -> float:
    """Mean RGB difference across wrap seams (lower = more seamless). Used by tests."""
    img = c.to_image().convert('RGB')
    w, h = img.size
    d = 0.0
    for y in range(h):
        a, b = img.getpixel((0, y)), img.getpixel((w - 1, y))
        d += sum(abs(a[i] - b[i]) for i in range(3))
    for x in range(w):
        a, b = img.getpixel((x, 0)), img.getpixel((x, h - 1))
        d += sum(abs(a[i] - b[i]) for i in range(3))
    return d / (2 * (w + h) * 3)


def _periodic(n: int, seed: int, amp: float = 1.0) -> list[float]:
    """1-D noise that wraps at n (so shared tile edges match)."""
    r = random.Random(seed)
    a = [r.uniform(-amp, amp) for _ in range(n)]
    # light smoothing, wrapped
    return [(a[(i - 1) % n] + 2 * a[i] + a[(i + 1) % n]) / 4 for i in range(n)]


def autotile16(fill: Callable[[int, int], str | None], rim: Sequence[str], inset: int = 4, size: int = 32,
               pal: dict[str, str] | None = None, seed: int = 1, jitter: float = 1.4,
               corner_r: int | None = None, fringe: Callable[[int, int, int], str | None] | None = None) -> list[Canvas]:
    """
    16-mask edge autotile (4-bit, N=1 E=2 S=4 W=8 set when the neighbour of the same kind is present).
    Interior pixels use fill(x, y); the outermost `inset` px along a missing edge become the rim
    (rim[0] = outermost lip ... rim[-1] = innermost) and anything beyond is transparent.
    Edge wobble is periodic along the tile so neighbouring tiles line up.
    fringe(x, y, k) may add decoration (k = -1 for just-outside pixels, else rim index).
    """
    jx = _periodic(size, seed, jitter)      # wobble for horizontal edges (indexed by x)
    jy = _periodic(size, seed + 99, jitter)  # wobble for vertical edges (indexed by y)
    R = corner_r if corner_r is not None else inset + 4
    tiles = []
    for mask in range(16):
        c = Canvas(size, size, pal or {}, seed + mask)
        n, e, s, w = bool(mask & 1), bool(mask & 2), bool(mask & 4), bool(mask & 8)
        for y in range(size):
            for x in range(size):
                ds = []
                if not n:
                    ds.append(y - jx[x])
                if not s:
                    ds.append(size - 1 - y - jx[x])
                if not w:
                    ds.append(x - jy[y])
                if not e:
                    ds.append(size - 1 - x - jy[y])
                d = min(ds) if ds else 99.0
                for cond, lx, ly in ((not n and not w, x, y), (not n and not e, size - 1 - x, y),
                                     (not s and not w, x, size - 1 - y), (not s and not e, size - 1 - x, size - 1 - y)):
                    if cond and lx < R and ly < R:
                        dc = R - math.hypot(R - 0.5 - lx, R - 0.5 - ly)
                        d = min(d, dc)
                if d >= inset:
                    c.put(x, y, fill(x, y))
                elif d >= 0:
                    k = min(len(rim) - 1, int(d * len(rim) / max(1, inset)))
                    c.put(x, y, rim[k])
                    if fringe:
                        v = fringe(x, y, k)
                        if v:
                            c.put(x, y, v)
                else:
                    if fringe and d > -1.5:
                        v = fringe(x, y, -1)
                        if v:
                            c.put(x, y, v)
        tiles.append(c)
    return tiles
