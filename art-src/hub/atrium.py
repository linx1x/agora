"""Atrium (hub) tiles: polished stone lobby floor, parquet, navy rug, plaster walls with glass windows, ficus trees, plants, lamp, table, sofa, planters."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new

B = 'hub'


@sprite('hub.floor', biome=B, note='polished warm stone slabs, seamless')
def floor(pal, seed):
    c = new(pal, seed)
    r = c.rng
    c.fill_gradient(['plaza1', 'plaza2', 'plaza1', 'plaza2'], seed=seed, scale=8, gain=3.0, center=0.5)
    for y in (0, 16):
        c.hline(0, 31, y, 'plaza0')
    for x, y0 in ((0, 0), (16, 16)):                       # staggered 16 px slabs
        c.vline(x, y0, y0 + 15, 'plaza0')
    c.hline(0, 31, 1, 'plaza3'); c.hline(0, 31, 17, 'plaza3')
    for _ in range(26):
        c.put(r.randint(0, 31), r.randint(0, 31), r.choice(['plaza3', 'plaza1', 'plaza2']))
    return c


@sprite('hub.floorAlt', biome=B, note='warm herringbone parquet (library, plaza, doors), seamless')
def floor_alt(pal, seed):
    c = new(pal, seed)
    r = c.rng
    # 8x16 blocks laid in alternating vertical/horizontal pairs
    for by in range(0, 32, 8):
        for bx in range(0, 32, 8):
            vertical = ((bx // 8) + (by // 8)) % 2 == 0
            base = 'wood2' if r.random() < 0.7 else 'wood3'
            hi = 'wood3' if base == 'wood2' else 'wood2'
            c.rect(bx, by, bx + 7, by + 7, base)
            if vertical:
                for x in (bx, bx + 4):
                    c.vline(x, by, by + 7, 'wood1'); c.vline(x + 1, by, by + 7, hi)
            else:
                for y in (by, by + 4):
                    c.hline(bx, bx + 7, y, 'wood1'); c.hline(bx, bx + 7, y + 1, hi)
            c.put(bx + r.randint(2, 5), by + r.randint(2, 5), 'wood1')
    return c


@sprite('hub.rug', biome=B, note='navy wool rug, fine weave and a small brass diamond motif; tiles seamlessly')
def rug(pal, seed):
    c = new(pal, seed)
    c.rect(0, 0, 31, 31, 'navy')
    for y in range(0, 32, 2):                              # fine weave
        for x in range((y // 2) % 2, 32, 2):
            c.put(x, y, 'stone0')
    r = c.rng
    for _ in range(14):
        c.put(r.randint(0, 31), r.randint(0, 31), 'stone0')
    for cx, cy in ((16, 16),):                             # brass diamond, one per tile
        for d in range(7):
            for (x, y) in ((cx - 6 + d, cy - d), (cx + 6 - d, cy - d), (cx - 6 + d, cy + d), (cx + 6 - d, cy + d)):
                c.put(x, y, 'brass0')
        c.put(cx, cy, 'brass1'); c.put(cx - 1, cy, 'brass0'); c.put(cx + 1, cy, 'brass0')
        c.put(cx, cy - 1, 'brass0'); c.put(cx, cy + 1, 'brass0')
    return c


def plaster(c, y0=0, y1=31):
    c.fill_gradient(['white', 'cream', 'white'], seed=7, scale=6, gain=2.5, region=(0, y0, 31, y1))
    r = c.rng
    for _ in range(18):
        x, y = r.randint(0, 28), r.randint(y0, y1)
        c.hline(x, x + r.randint(1, 3), y, 'paper' if r.random() < 0.6 else 'cream')


@sprite('hub.wallFront', biome=B, note='plaster wall with a navy cap rail and dark wood wainscot')
def wall_front(pal, seed):
    c = new(pal, seed)
    plaster(c)
    c.rect(0, 0, 31, 3, 'navy'); c.hline(0, 31, 0, 'stone2'); c.hline(0, 31, 3, 'stone0')
    c.dither_band(0, 4, 31, 5, 'paperD', 'cream')
    c.rect(0, 20, 31, 31, 'wood1'); c.hline(0, 31, 20, 'wood3'); c.hline(0, 31, 21, 'wood2')
    for x in range(0, 32, 8):                                   # raised panels
        c.rect(x + 1, 23, x + 6, 29, 'wood0'); c.hline(x + 1, x + 6, 23, 'wood2'); c.vline(x + 1, 23, 29, 'wood2')
    c.hline(0, 31, 31, 'wood0')
    return c


@sprite('hub.wallTop', biome=B, note='plaster coping with a navy cap seen from above')
def wall_top(pal, seed):
    c = new(pal, seed)
    r = c.rng
    c.rect(0, 0, 31, 31, 'cream')
    c.rect(0, 4, 31, 27, 'paper')
    c.hline(0, 31, 4, 'white'); c.hline(0, 31, 27, 'paperD')
    c.rect(0, 0, 31, 3, 'navy'); c.rect(0, 28, 31, 31, 'navy')
    c.hline(0, 31, 1, 'stone2'); c.hline(0, 31, 30, 'stone2')
    for _ in range(14):
        c.put(r.randint(0, 31), r.randint(5, 26), r.choice(['white', 'paperD']))
    return c


@sprite('hub.window', biome=B, note='plaster wall with a tall steel-framed glass window and a sill plant')
def window(pal, seed):
    c = new(pal, seed)
    plaster(c)
    c.rect(0, 0, 31, 3, 'navy'); c.hline(0, 31, 0, 'stone2'); c.hline(0, 31, 3, 'stone0')
    c.rect(0, 29, 31, 31, 'wood1'); c.hline(0, 31, 29, 'wood3')
    c.rect(4, 6, 27, 27, 'metalD'); c.rect(5, 7, 26, 26, 'glassA')
    c.rect(5, 7, 26, 14, 'glassB'); c.dither_band(5, 15, 26, 16, 'glassB', 'glassA')
    c.rect(5, 22, 26, 26, 'leaf2'); c.dither_band(5, 20, 26, 21, 'glassA', 'leaf2')       # garden outside
    for x, h in ((8, 5), (14, 8), (20, 6), (24, 4)):
        c.rect(x, 22 - h, x + 1, 22, 'leaf1')
    c.line(7, 12, 12, 8, 'white'); c.line(8, 15, 15, 8, 'glassB')
    c.vline(15, 7, 26, 'metalM'); c.vline(16, 7, 26, 'metalD'); c.hline(5, 26, 17, 'metalM')
    c.rect(3, 27, 28, 28, 'stone2'); c.hline(3, 28, 28, 'stone1')
    c.rect(8, 25, 11, 27, 'cream'); c.put(9, 24, 'leaf3'); c.put(10, 23, 'leaf4')
    return c


def pot(c, x0, x1, y0, y1):
    c.rect(x0, y0, x1, y1, 'white'); c.hline(x0 - 1, x1 + 1, y0, 'paper'); c.vline(x0, y0 + 1, y1, 'paper'); c.vline(x1, y0 + 1, y1, 'paperD')
    c.hline(x0, x1, y1, 'paperD'); c.hline(x0 + 1, x1 - 1, y0 + 3, 'brass1')


@sprite('hub.plantA', biome=B, note='monstera in a white planter with a brass band')
def plant_a(pal, seed):
    c = new(pal, seed)
    pot(c, 9, 22, 23, 30)
    ox, oy = 16, 23
    for a, L in ((-165, 11), (-135, 12), (-105, 13), (-75, 13), (-45, 12), (-15, 11)):
        mx, my = ox + math.cos(math.radians(a)) * L * 0.6, oy + math.sin(math.radians(a)) * L * 0.6
        c.line(ox, oy, int(ox + math.cos(math.radians(a)) * L * 0.5), int(oy + math.sin(math.radians(a)) * L * 0.5), 'leaf1')
        c.leaf(mx, my, L * 0.55, 3.8, a, ['leaf0', 'leaf1', 'leaf2', 'leaf3', 'leaf4'], slits=(-0.4, 0.0, 0.4), rib=True, cut_v=0.5, cut_w=0.08)
    c.outline(); c.ground_shadow(8, 24, 31)
    return c


@sprite('hub.plantB', biome=B, note='tall fern in a brass pot')
def plant_b(pal, seed):
    c = new(pal, seed)
    c.rect(10, 22, 21, 30, 'brass0'); c.hline(9, 22, 22, 'brass2'); c.vline(10, 23, 30, 'brass1'); c.vline(21, 23, 30, 'wood0'); c.hline(10, 21, 30, 'wood0')
    c.hline(10, 21, 25, 'brass1')
    ox, oy = 16, 22
    for a, L in ((-170, 12), (-145, 14), (-120, 15), (-95, 16), (-70, 15), (-45, 14), (-20, 12)):
        tx, ty = ox + math.cos(math.radians(a)) * L, oy + math.sin(math.radians(a)) * L * 0.9
        c.line(ox, oy, int(tx), int(ty), 'leaf1')
        c.leaf((ox + tx) / 2, (oy + ty) / 2, L * 0.55, 2.2, a, ['leaf1', 'leaf2', 'leaf3', 'leaf4'], slits=(-0.5, -0.2, 0.1, 0.4), rib=True, cut_v=0.4, cut_w=0.07)
    c.outline(); c.ground_shadow(9, 23, 31)
    return c


@sprite('hub.plantC', biome=B, note='snake plant in a grey stone planter')
def plant_c(pal, seed):
    c = new(pal, seed)
    c.rect(8, 22, 23, 30, 'stone2'); c.hline(8, 23, 22, 'stone1'); c.hline(8, 23, 23, 'plaza3'); c.vline(8, 23, 30, 'plaza3'); c.vline(23, 23, 30, 'stone0')
    c.hline(8, 23, 30, 'stone0'); c.hline(9, 22, 26, 'stone1')
    for x0, h in ((10, 15), (13, 20), (16, 17), (19, 13), (21, 9)):
        c.poly([(x0, 22), (x0 + 3, 22), (x0 + 1.5, 22 - h)], 'leaf2'); c.line(x0 + 1, 22, x0 + 1, 22 - h + 2, 'leaf3')
        c.line(x0, 22, x0 + 1, 22 - h + 3, 'leaf1')
    c.outline(); c.ground_shadow(7, 24, 31)
    return c


@sprite('hub.treeTop', biome=B, note='ficus crown, broad and rounded (drawn above avatars)')
def tree_top(pal, seed):
    c = new(pal, seed)
    r = c.rng
    for bx, by, br in ((9, 20, 9), (23, 20, 9), (16, 11, 11), (8, 10, 8), (24, 10, 8), (16, 21, 11)):
        c.shaded_ellipse(bx, by, br, br * 0.85, ['leaf0', 'leaf1', 'leaf2', 'leaf3'], bias=-0.1)
    for _ in range(40):
        x, y = r.randint(2, 29), r.randint(2, 29)
        if c.get(x, y) in ('leaf2', 'leaf3'):
            c.put(x, y, 'leaf4')
    for _ in range(12):
        x, y = r.randint(2, 29), r.randint(2, 29)
        if c.get(x, y) is not None:
            c.put(x, y, 'leaf0')
    c.outline()
    return c


@sprite('hub.treeBase', biome=B, note='ficus trunk in a round brick planter')
def tree_base(pal, seed):
    c = new(pal, seed)
    c.ellipse(16, -2, 13, 7, 'leaf1'); c.ellipse(16, -3, 11, 5.5, 'leaf2')
    for y in range(0, 22):
        x0 = 14 + int(1.2 * math.sin(y / 6.0))
        c.rect(x0, y, x0 + 3, y, 'trunk1'); c.put(x0, y, 'trunk2'); c.put(x0 + 3, y, 'trunk0')
    # round planter
    c.ellipse(16, 27, 12, 4.4, 'stone0'); c.ellipse(16, 26, 12, 4.4, 'stone2')
    c.rect(4, 22, 27, 27, 'stone2'); c.vline(4, 22, 27, 'plaza3'); c.vline(27, 22, 27, 'stone0')
    c.ellipse(16, 22, 12, 4, 'stone1'); c.ellipse(16, 22, 10.5, 3.2, 'trunk0'); c.ellipse(16, 21.6, 9, 2.4, 'trunk1')
    c.rect(14, 12, 17, 22, 'trunk1'); c.vline(14, 12, 22, 'trunk2'); c.vline(17, 12, 22, 'trunk0')
    c.hline(5, 26, 25, 'stone1'); c.hline(5, 26, 27, 'stone0')
    c.outline(); c.ground_shadow(4, 28, 31)
    return c


@sprite('hub.lamp', biome=B, note='brass floor lamp with a cream drum shade')
def lamp(pal, seed):
    c = new(pal, seed)
    c.ellipse(16, 29, 6, 2, 'brass0'); c.ellipse(16, 28.5, 5, 1.6, 'brass1')
    c.rect(15, 14, 16, 28, 'brass1'); c.vline(15, 14, 28, 'brass2'); c.vline(16, 14, 28, 'brass0')
    c.rect(9, 3, 22, 14, 'cream'); c.hline(9, 22, 3, 'white'); c.vline(9, 4, 14, 'white'); c.vline(22, 4, 14, 'paperD'); c.hline(9, 22, 14, 'paperD')
    c.rect(11, 6, 20, 12, 'lanternL'); c.rect(13, 7, 18, 10, 'lampCore')
    c.hline(10, 21, 2, 'brass1')
    c.outline()
    return c


@sprite('hub.table', biome=B, note='wood table segment (tiles side by side into a long table)')
def table(pal, seed):
    c = new(pal, seed)
    c.rect(0, 6, 31, 22, 'wood3'); c.hline(0, 31, 6, 'wood4'); c.hline(0, 31, 7, 'wood4')
    for y in (11, 15, 19):
        c.hline(0, 31, y, 'wood2')
    r = c.rng
    for _ in range(5):
        x = r.randint(0, 26); c.hline(x, x + r.randint(2, 5), r.choice((9, 13, 17, 21)), 'wood4')
    c.rect(0, 23, 31, 27, 'wood1'); c.hline(0, 31, 23, 'wood2'); c.hline(0, 31, 27, 'wood0')
    c.rect(1, 28, 3, 30, 'wood0'); c.rect(28, 28, 30, 30, 'wood0')
    c.hline(0, 31, 31, 'shade')
    return c


def sofa_pad(c, x0, x1, left_arm, right_arm):
    c.rect(x0, 4, x1, 14, 'navy')
    c.rect(x0 + (3 if left_arm else 0), 5, x1 - (3 if right_arm else 0), 14, 'seat1')
    c.hline(x0 + 1, x1 - 1, 5, 'seat3'); c.dither_band(x0 + 4, 6, x1 - 4, 7, 'seat3', 'seat2')
    c.hline(x0, x1, 14, 'seat0')
    c.rect(x0, 15, x1, 23, 'seat2'); c.hline(x0, x1, 15, 'seat3'); c.hline(x0, x1, 23, 'seat0')
    c.vline((x0 + x1) // 2, 16, 22, 'seat1')
    c.rect(x0, 24, x1, 27, 'wood2'); c.hline(x0, x1, 24, 'wood3'); c.hline(x0, x1, 27, 'wood0')
    if left_arm:
        c.rect(x0, 8, x0 + 3, 24, 'seat1'); c.vline(x0, 8, 24, 'seat3'); c.vline(x0 + 3, 8, 24, 'seat0'); c.hline(x0, x0 + 3, 8, 'seat3')
    if right_arm:
        c.rect(x1 - 3, 8, x1, 24, 'seat1'); c.vline(x1 - 3, 8, 24, 'seat3'); c.vline(x1, 8, 24, 'seat0'); c.hline(x1 - 3, x1, 8, 'seat3')
    for x in (x0 + 1, x1 - 2):
        c.rect(x, 28, x + 1, 29, 'wood0')


@sprite('hub.sofa', biome=B, note='navy fabric loveseat with brass-brown legs (single tile, both arms)')
def sofa(pal, seed):
    c = new(pal, seed)
    sofa_pad(c, 1, 30, True, True)
    c.rect(6, 14, 11, 19, 'cream'); c.hline(6, 11, 14, 'white'); c.put(8, 16, 'brass1'); c.put(9, 17, 'brass1')
    c.outline(); c.ground_shadow(2, 29, 30)
    return c


@sprite('hub.border', biome=B, note='white stone planter wall with clipped box hedge')
def border(pal, seed):
    c = new(pal, seed)
    c.rect(0, 15, 31, 30, 'plaza2'); c.hline(0, 31, 14, 'plaza3'); c.hline(0, 31, 15, 'plaza3'); c.hline(0, 31, 16, 'plaza1')
    for y in (21, 27):
        c.hline(0, 31, y, 'plaza1')
    for bx in range(0, 32, 16):
        c.vline(bx, 17, 20, 'plaza1'); c.vline((bx + 8) % 32, 22, 26, 'plaza1')
    c.hline(0, 31, 30, 'plaza0'); c.hline(0, 31, 31, 'plaza0')
    for cx in (3, 11, 19, 27):
        for off in (-32, 0, 32):
            c.shaded_ellipse(cx + off, 9, 5, 4.4, ['leaf0', 'leaf1', 'leaf2', 'leaf3'], bias=-0.05)
    return c


@sprite('hub.borderPlant', biome=B, note='stone planter wall with flowering box hedge')
def border_plant(pal, seed):
    c = border(pal, seed + 1)
    r = c.rng
    for _ in range(9):
        x, y = r.randint(1, 30), r.randint(4, 12)
        col = r.choice(['pink', 'orange', 'gold', 'white'])
        c.put(x, y, col); c.put(x + 1, y, 'white')
    return c
