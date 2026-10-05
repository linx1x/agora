"""Sprite registry: art-src/<biome>/*.py modules register sprites with @sprite."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Callable

from pxl import Anim, Canvas, seed_of

SPRITES: dict[str, 'Def'] = {}


@dataclass
class Def:
    name: str
    biome: str
    fn: Callable
    tiles_w: int
    tiles_h: int
    note: str


def sprite(name: str, tw: int = 1, th: int = 1, note: str = '', biome: str | None = None):
    """Register `fn(pal, seed) -> Canvas | Anim | list[Canvas]`. Tile key = name (e.g. 'jungle.deskH')."""
    def deco(fn):
        pre = name.split('.')[0] if '.' in name else ''
        b = biome or (pre if pre in ('hub', 'jungle', 'oasis', 'boreal', 'zen') else 'common')
        SPRITES[name] = Def(name, b, fn, tw, th, note)
        return fn
    return deco


def new(pal, seed: int, tw: int = 1, th: int = 1) -> Canvas:
    return Canvas(32 * tw, 32 * th, pal, seed)
