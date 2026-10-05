#!/usr/bin/env python3
"""
Build sprite sheets from art-src/<biome>/*.py.

  python3 scripts/art/build.py jungle            # sheet + manifest + contact sheet
  python3 scripts/art/build.py jungle --json     # also pixel-art-gen JSON per sprite
  python3 scripts/art/build.py jungle --only jungle.deskH,jungle.floor
  python3 scripts/art/build.py all

Outputs
  apps/web/public/assets/agora/<biome>.png      sprite sheet (512 px wide, 32 px cells)
  apps/web/public/assets/agora/<biome>.json     manifest {name: {x,y,w,h,frames,fps}}
  art-src/preview/<biome>.png                   4x contact sheet with labels (not shipped)
"""
from __future__ import annotations

import argparse
import glob
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from PIL import Image, ImageDraw  # noqa: E402

import pxl  # noqa: E402
from pxl import Anim, Canvas, load_palette, seed_of  # noqa: E402
from registry import SPRITES  # noqa: E402

ROOT = pxl.ROOT
OUT = os.path.join(ROOT, 'apps', 'web', 'public', 'assets', 'agora')
SRC = os.path.join(ROOT, 'art-src')
SHEET_W = 512
CELL = 32
MAX_COLORS = 16


def load_modules(biome: str) -> None:
    for path in sorted(glob.glob(os.path.join(SRC, biome, '*.py'))):
        spec = importlib.util.spec_from_file_location(f'art_{biome}_{os.path.basename(path)[:-3]}', path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # registers sprites


def frames_of(obj) -> tuple[list[Canvas], int]:
    if isinstance(obj, Anim):
        return obj.frames, obj.fps
    if isinstance(obj, list):
        return obj, 0
    return [obj], 0


def build_biome(biome: str, only: set[str] | None, emit_json: bool) -> None:
    SPRITES.clear()
    load_modules(biome)
    pal = load_palette(biome)
    defs = [d for d in SPRITES.values() if d.biome == biome and (not only or d.name in only)]
    if not defs:
        print(f'[{biome}] no sprites'); return
    placed = []  # (def, frames, fps, x, y)
    x = y = row_h = 0
    for d in defs:
        obj = d.fn(pal, seed_of(d.name))
        frames, fps = frames_of(obj)
        fw, fh = frames[0].w, frames[0].h
        for f in frames:
            assert (f.w, f.h) == (fw, fh), f'{d.name}: frames differ in size'
        assert fw % 16 == 0 and fh % 16 == 0, f'{d.name}: {fw}x{fh} not a multiple of 16'
        tw = fw * len(frames)
        if x + tw > SHEET_W:
            x, y, row_h = 0, y + row_h, 0
        placed.append((d, frames, fps, x, y))
        x += tw
        row_h = max(row_h, fh)
        used = set().union(*(f.colors_used() for f in frames)) - {'shade', 'ink'}
        if len(used) > MAX_COLORS:
            print(f'  warn {d.name}: {len(used)} colours (> {MAX_COLORS})')
    sheet_h = y + row_h
    sheet = Image.new('RGBA', (SHEET_W, sheet_h), (0, 0, 0, 0))
    manifest = {}
    for d, frames, fps, px_, py_ in placed:
        for i, f in enumerate(frames):
            sheet.paste(f.to_image(pal), (px_ + i * f.w, py_))
        manifest[d.name] = {'x': px_, 'y': py_, 'w': frames[0].w, 'h': frames[0].h,
                            'frames': len(frames), 'fps': fps}
    os.makedirs(OUT, exist_ok=True)
    if only:
        print(f'[{biome}] --only given: sheet NOT overwritten, preview only')
    else:
        sheet.save(os.path.join(OUT, f'{biome}.png'))
        json.dump({'sheet': f'{biome}.png', 'cell': CELL, 'sprites': manifest},
                  open(os.path.join(OUT, f'{biome}.json'), 'w'), indent=1)
    contact(biome, placed, pal)
    if emit_json:
        jd = os.path.join(SRC, 'json', biome)
        os.makedirs(jd, exist_ok=True)
        for d, frames, fps, *_ in placed:
            for i, f in enumerate(frames):
                nm = d.name.split('.', 1)[-1] + (f'_f{i}' if len(frames) > 1 else '')
                json.dump(f.to_pixelart_json(pal), open(os.path.join(jd, nm + '.json'), 'w'))
    print(f'[{biome}] {len(placed)} sprites, sheet {SHEET_W}x{sheet_h}')


def contact(biome: str, placed, pal, scale: int = 4) -> None:
    pad = 10
    cols = 6
    cells = []
    for d, frames, fps, *_ in placed:
        cw = frames[0].w * len(frames)
        cells.append((d, frames, cw, frames[0].h))
    # layout rows
    rows, cur, cw_sum = [], [], 0
    maxw = 900
    for c in cells:
        w = c[2] * scale + pad
        if cw_sum + w > maxw and cur:
            rows.append(cur); cur, cw_sum = [], 0
        cur.append(c); cw_sum += w
    if cur:
        rows.append(cur)
    H = sum(max(c[3] for c in r) * scale + 28 for r in rows) + pad
    img = Image.new('RGB', (maxw + pad, H), (46, 52, 60))
    dr = ImageDraw.Draw(img)
    y = pad
    for r in rows:
        x = pad
        rh = max(c[3] for c in r) * scale
        for d, frames, cw, ch in r:
            # checkerboard behind transparency
            for i, f in enumerate(frames):
                im = f.to_image(pal).resize((f.w * scale, f.h * scale), Image.NEAREST)
                bg = Image.new('RGBA', im.size, (0, 0, 0, 0))
                chk = ImageDraw.Draw(bg)
                for yy in range(0, im.size[1], 8):
                    for xx in range(0, im.size[0], 8):
                        chk.rectangle([xx, yy, xx + 7, yy + 7],
                                      fill=(70, 78, 88, 255) if (xx // 8 + yy // 8) % 2 == 0 else (58, 65, 74, 255))
                bg.alpha_composite(im)
                img.paste(bg.convert('RGB'), (x + i * f.w * scale, y))
            dr.text((x, y + rh + 3), d.name.split('.', 1)[-1], fill=(220, 226, 232))
            x += cw * scale + pad
        y += rh + 28
    os.makedirs(os.path.join(SRC, 'preview'), exist_ok=True)
    img.save(os.path.join(SRC, 'preview', f'{biome}.png'))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('biome')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    only = set(filter(None, a.only.split(','))) or None
    biomes = [os.path.basename(p) for p in sorted(glob.glob(os.path.join(SRC, '*'))) if os.path.isdir(p)
              and os.path.basename(p) not in ('json', 'preview')] if a.biome == 'all' else [a.biome]
    for b in biomes:
        build_biome(b, only, a.json)


if __name__ == '__main__':
    main()
