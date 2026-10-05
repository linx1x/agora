#!/usr/bin/env python3
"""Compose a small preview room from built sheets next to a concept-board crop (Q04)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
import pxl
from pxl import Canvas, load_palette

ROOT = pxl.ROOT
A = os.path.join(ROOT, 'apps/web/public/assets/agora')
pal = load_palette('jungle')
sheet = Image.open(os.path.join(A, 'jungle.png')).convert('RGBA')
man = json.load(open(os.path.join(A, 'jungle.json')))['sprites']


def tile(name):
    m = man[name]
    return sheet.crop((m['x'], m['y'], m['x'] + m['w'], m['y'] + m['h']))


def floor(i=0):
    return tile(['jungle.floor', 'jungle.floorB', 'jungle.floorC'][i])


W, H = 10, 6
scene = Image.new('RGBA', (W * 32, H * 32))
import random
rr = random.Random(5)
for y in range(H):
    for x in range(W):
        scene.alpha_composite(floor(rr.choice([0, 0, 0, 1, 1, 2])), (x * 32, y * 32))


def put(name, x, y):
    scene.alpha_composite(tile(name), (x * 32, y * 32))


for yy in (4, 5):
    for xx in (3, 4):
        scene.alpha_composite(tile('jungle.dirt' if (xx+yy)%2 else 'jungle.dirtB'), (xx*32, yy*32))
for x in range(1, 7):
    put('jungle.deskH' if x in (1, 6) else 'jungle.deskMonitor', x, 2)
for x in (2, 4):
    put('jungle.chairDown', x, 1)
put('jungle.deskMonitorBack', 3, 3) if False else None
put('jungle.plantA', 8, 1)
put('jungle.plantA', 0, 4)
put('jungle.lamp', 8, 3)
put('jungle.lamp', 7, 0)
scene = scene.resize((W * 32 * 3, H * 32 * 3), Image.NEAREST)
ref = Image.open('/root/.claude/uploads/37513673-6723-5786-8742-45376f371a73/b680689c-image.png').convert('RGB').crop((270, 120, 520, 330))
ref = ref.resize((int(ref.width * 2.8), int(ref.height * 2.8)), Image.LANCZOS)
out = Image.new('RGB', (scene.width + ref.width + 30, max(scene.height, ref.height) + 20), (40, 46, 54))
out.paste(scene.convert('RGB'), (10, 10))
out.paste(ref, (scene.width + 20, 10))
os.makedirs(os.path.join(ROOT, 'art-src/preview'), exist_ok=True)
out.save(os.path.join(ROOT, 'art-src/preview/probe-scene.png'))
print(out.size)
