/**
 * Procedural placeholder tileset (original, Vincent-owned; ADR-011). One palette per
 * biome; every TILE_DEFS entry has a drawer here. Pixel art is drawn with
 * integer rects on a 32×32 cell.
 */
import { EXTRA_LAYER, TILE, TILESET_COLUMNS, TILE_DEFS, type Biome } from '@agora/shared';
import { art, drawArt, drawArtSlice, drawSprite, type Sprite } from './sprites';

export type Ctx = CanvasRenderingContext2D;
const T = TILE;

export const rect = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
};
/** Deterministic noise so textures are stable between reloads. */
export const noise = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
const circle = (c: Ctx, x: number, y: number, r: number, col: string) => {
  c.fillStyle = col;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
};
const ellipse = (c: Ctx, x: number, y: number, rx: number, ry: number, col: string, rot = 0) => {
  c.fillStyle = col;
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  c.fill();
};

interface Pal {
  floor: string;
  floorLine: string;
  alt: string;
  altLine: string;
  rugA: string;
  rugB: string;
  wallTop: string;
  wallFront: string;
  wallBase: string;
  wallAccent: string;
  wood: string;
  border: string;
  borderTop: string;
  leaf: string;
  leafLight: string;
  leafDark: string;
  pot: string;
  sofa: string;
  table: string;
  lampShade: string;
}

export const PALETTES: Record<Biome, Pal> = {
  hub: {
    floor: '#cdb89a',
    floorLine: '#b9a283',
    alt: '#dfe3e6',
    altLine: '#c9d0d6',
    rugA: '#5e7896',
    rugB: '#6b86a4',
    wallTop: '#334455',
    wallFront: '#c9d3dc',
    wallBase: '#8796a4',
    wallAccent: '#dfe6ec',
    wood: '#a87b51',
    border: '#7d5939',
    borderTop: '#5f4129',
    leaf: '#2f7d5b',
    leafLight: '#4fae7f',
    leafDark: '#21573f',
    pot: '#e7e1d6',
    sofa: '#1f4a70',
    table: '#eef1f3',
    lampShade: '#f3e3b5',
  },
  jungle: {
    floor: '#6e4b2f',
    floorLine: '#5a3c24',
    alt: '#5d7a3a',
    altLine: '#4e6a2f',
    rugA: '#c0763a',
    rugB: '#e3b25a',
    wallTop: '#1d3526',
    wallFront: '#2f5a3f',
    wallBase: '#1b3324',
    wallAccent: '#3f8a4f',
    wood: '#8a5a32',
    border: '#5a3a22',
    borderTop: '#3f2816',
    leaf: '#2e8b45',
    leafLight: '#5cc46a',
    leafDark: '#1c5a2c',
    pot: '#b8643a',
    sofa: '#2f6b45',
    table: '#c8955a',
    lampShade: '#e6b263',
  },
  boreal: {
    floor: '#dcc6a0',
    floorLine: '#c7ae84',
    alt: '#9aa3a8',
    altLine: '#858e94',
    rugA: '#9e2b2b',
    rugB: '#1f1a1a',
    wallTop: '#4a3526',
    wallFront: '#8b5e3c',
    wallBase: '#5c3d27',
    wallAccent: '#a7774f',
    wood: '#c9a77a',
    border: '#7a5232',
    borderTop: '#a87a50',
    leaf: '#2f5e46',
    leafLight: '#4f8a63',
    leafDark: '#1f3f30',
    pot: '#6f7b85',
    sofa: '#8e2b2b',
    table: '#b48a5c',
    lampShade: '#2b2b2b',
  },
  oasis: {
    floor: '#c46a42',
    floorLine: '#a85633',
    alt: '#e3c48d',
    altLine: '#d1af74',
    rugA: '#9e2f3a',
    rugB: '#2c4a8a',
    wallTop: '#9c5b33',
    wallFront: '#d9a066',
    wallBase: '#b47b45',
    wallAccent: '#e8bb85',
    wood: '#9e5a35',
    border: '#cf9561',
    borderTop: '#2e7f8a',
    leaf: '#5f8f4a',
    leafLight: '#8fbf6a',
    leafDark: '#3f6a33',
    pot: '#c4643a',
    sofa: '#c2364b',
    table: '#2e7f8a',
    lampShade: '#c9a03a',
  },
  zen: {
    floor: '#cbbf86',
    floorLine: '#b3a76e',
    alt: '#d8d5cb',
    altLine: '#c2bfb4',
    rugA: '#9a9a94',
    rugB: '#b5b5ae',
    wallTop: '#3b2f2a',
    wallFront: '#efe9dc',
    wallBase: '#4a3b30',
    wallAccent: '#4a3b30',
    wood: '#2d2624',
    border: '#9fb35a',
    borderTop: '#7e9142',
    leaf: '#4f7a3a',
    leafLight: '#7fae5a',
    leafDark: '#33552a',
    pot: '#5a5f66',
    sofa: '#5a6b4a',
    table: '#6b4a32',
    lampShade: '#f3e6c4',
  },
};

// ───────────────────────────────────────────────────────── plant painters
type Painter = (c: Ctx, p: Pal, seed: number) => void;

const potBase = (c: Ctx, p: Pal, w = 14) => {
  const x = 16 - w / 2;
  rect(c, x, 22, w, 9, p.pot);
  rect(c, x - 1, 21, w + 2, 3, shade(p.pot, 0.08));
  rect(c, x, 29, w, 2, shade(p.pot, -0.12));
};

export const monstera: Painter = (c, p) => {
  potBase(c, p);
  for (const [x, y, r, rot] of [
    [10, 13, 7, -0.6],
    [22, 12, 7, 0.6],
    [16, 7, 7, 0],
    [8, 6, 5, -1],
    [25, 5, 5, 1],
  ] as const) {
    ellipse(c, x, y, r, r * 0.75, p.leaf, rot);
    rect(c, x - 1, y - 1, 2, 2, p.leafDark);
    rect(c, x + 2, y - 3, 1, 3, p.leafDark);
  }
  ellipse(c, 16, 6, 3, 2, p.leafLight);
  ellipse(c, 9, 12, 2, 1.5, p.leafLight);
};
export const fern: Painter = (c, p) => {
  potBase(c, p, 12);
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI + (i / 8) * Math.PI;
    c.strokeStyle = i % 2 ? p.leaf : p.leafLight;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(16, 21);
    c.quadraticCurveTo(
      16 + Math.cos(a) * 8,
      14 + Math.sin(a) * 6,
      16 + Math.cos(a) * 14,
      18 + Math.sin(a) * 14,
    );
    c.stroke();
  }
};
export const cactus: Painter = (c, p) => {
  potBase(c, p, 12);
  rect(c, 13, 4, 6, 18, '#4f8a4a');
  rect(c, 14, 3, 4, 2, '#4f8a4a');
  rect(c, 7, 10, 4, 3, '#4f8a4a');
  rect(c, 7, 6, 3, 6, '#4f8a4a');
  rect(c, 21, 12, 4, 3, '#4f8a4a');
  rect(c, 22, 7, 3, 7, '#4f8a4a');
  for (let y = 5; y < 21; y += 3) rect(c, 15, y, 1, 1, '#d9f0c0');
  rect(c, 15, 1, 2, 2, '#ff8fa3');
};
export const bonsai: Painter = (c) => {
  rect(c, 7, 24, 18, 6, '#3d4a55');
  rect(c, 6, 23, 20, 2, '#55636f');
  rect(c, 15, 14, 3, 10, '#5a3a22');
  rect(c, 12, 16, 4, 2, '#5a3a22');
  ellipse(c, 11, 12, 7, 4, '#3f7a3a');
  ellipse(c, 21, 10, 7, 4, '#4f8a4a');
  ellipse(c, 16, 6, 6, 3, '#5fa35a');
};
export const orchid: Painter = (c, p) => {
  potBase(c, p, 10);
  ellipse(c, 12, 20, 6, 2, p.leaf, -0.3);
  ellipse(c, 20, 20, 6, 2, p.leaf, 0.3);
  rect(c, 15, 6, 1, 14, '#3f5a2a');
  for (const [x, y] of [
    [12, 6],
    [18, 8],
    [13, 11],
    [19, 3],
  ] as const) {
    circle(c, x, y, 3, '#f2a2d0');
    rect(c, x, y, 1, 1, '#c2364b');
  }
};
export const succulent: Painter = (c, p) => {
  rect(c, 6, 22, 20, 8, p.pot);
  rect(c, 5, 21, 22, 2, shade(p.pot, 0.08));
  for (const [x, y] of [
    [10, 19],
    [16, 17],
    [22, 19],
    [13, 14],
    [19, 14],
  ] as const) {
    circle(c, x, y, 4, '#7fb59a');
    circle(c, x, y, 2, '#a7d6bd');
  }
};
const birdOfParadise: Painter = (c, p) => {
  potBase(c, p);
  for (const [x, rot] of [
    [11, -0.4],
    [21, 0.4],
    [16, 0],
  ] as const)
    ellipse(c, x, 10, 3, 10, p.leaf, rot);
  rect(c, 18, 3, 6, 2, '#ff8a2a');
  rect(c, 21, 1, 3, 2, '#3d6fb6');
};
const spruce: Painter = (c, p) => {
  potBase(c, p, 12);
  for (let i = 0; i < 4; i++)
    rect(c, 9 + i * 2, 4 + i * 4, 14 - i * 4 + i * 4, 4, i % 2 ? p.leaf : p.leafDark);
  c.fillStyle = p.leaf;
  c.beginPath();
  c.moveTo(16, 0);
  c.lineTo(26, 21);
  c.lineTo(6, 21);
  c.fill();
  c.fillStyle = p.leafLight;
  c.beginPath();
  c.moveTo(16, 3);
  c.lineTo(20, 11);
  c.lineTo(12, 11);
  c.fill();
  rect(c, 12, 15, 2, 1, '#f3f6f8');
  rect(c, 19, 9, 2, 1, '#f3f6f8');
};
const agave: Painter = (c, p) => {
  potBase(c, p);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 0.9;
    c.fillStyle = i % 2 ? '#6f9f8a' : '#87b5a0';
    c.beginPath();
    c.moveTo(14, 21);
    c.lineTo(18, 21);
    c.lineTo(16 + Math.cos(a) * 14, 20 + Math.sin(a) * 16);
    c.fill();
  }
};
const bambooPot: Painter = (c, p) => {
  potBase(c, p, 12);
  for (const x of [11, 15, 19]) {
    rect(c, x, 2, 3, 20, '#9fb35a');
    for (let y = 5; y < 22; y += 6) rect(c, x, y, 3, 1, '#6f7f3a');
  }
  ellipse(c, 8, 6, 5, 2, p.leaf, -0.4);
  ellipse(c, 24, 4, 5, 2, p.leaf, 0.4);
  ellipse(c, 22, 12, 4, 2, p.leafLight, 0.3);
};
const mossBall: Painter = (c) => {
  ellipse(c, 16, 28, 10, 3, 'rgba(0,0,0,0.25)');
  circle(c, 16, 20, 9, '#4f7a3a');
  circle(c, 13, 17, 3, '#6f9f4a');
  rect(c, 10, 26, 12, 2, '#6b4a32');
};
const anthurium: Painter = (c, p) => {
  potBase(c, p, 12);
  ellipse(c, 11, 13, 5, 6, p.leaf, -0.3);
  ellipse(c, 21, 12, 5, 6, p.leaf, 0.3);
  ellipse(c, 16, 8, 4, 4, '#d83a3a');
  rect(c, 16, 6, 1, 4, '#f2d36b');
};

export const DECOR_PLANTS: Painter[] = [monstera, fern, cactus, bonsai, orchid, succulent];

const BIOME_PLANTS: Record<Biome, [Painter, Painter, Painter]> = {
  hub: [monstera, fern, succulent],
  jungle: [monstera, birdOfParadise, fern],
  boreal: [spruce, fern, mossBall],
  oasis: [cactus, agave, succulent],
  zen: [bonsai, bambooPot, mossBall],
};

// ───────────────────────────────────────────────────────── per-biome drawers
type Drawer = (c: Ctx, p: Pal, b: Biome) => void;

const floorDrawers: Record<Biome, Drawer> = {
  hub: (c, p) => {
    rect(c, 0, 0, T, T, p.floor);
    for (let i = 0; i < 4; i++) {
      rect(c, i * 8, 0, 1, 16, p.floorLine);
      rect(c, i * 8 + 4, 16, 1, 16, p.floorLine);
    }
    rect(c, 0, 15, T, 1, p.floorLine);
    rect(c, 0, 31, T, 1, p.floorLine);
  },
  jungle: (c, p) => {
    rect(c, 0, 0, T, T, p.floor);
    for (let row = 0; row < 4; row++) {
      rect(c, 0, row * 8 + 7, T, 1, p.floorLine);
      rect(c, (row * 13 + 5) % T, row * 8, 1, 7, p.floorLine);
      for (let i = 0; i < 4; i++)
        rect(
          c,
          Math.floor(noise(row * 9 + i) * T),
          row * 8 + 2 + (i % 4),
          3,
          1,
          shade(p.floor, 0.05),
        );
    }
  },
  boreal: (c, p) => {
    rect(c, 0, 0, T, T, p.floor);
    for (let row = 0; row < 4; row++) {
      rect(c, 0, row * 8 + 7, T, 1, p.floorLine);
      rect(c, (row * 11 + 9) % T, row * 8, 1, 7, p.floorLine);
      rect(c, Math.floor(noise(row + 3) * 26), row * 8 + 3, 2, 2, shade(p.floor, -0.12));
    }
  },
  oasis: (c, p) => {
    rect(c, 0, 0, T, T, p.floor);
    rect(c, 0, 15, T, 2, p.floorLine);
    rect(c, 15, 0, 2, T, p.floorLine);
    rect(c, 6, 6, 4, 4, shade(p.floor, 0.08));
    rect(c, 22, 22, 4, 4, shade(p.floor, 0.08));
  },
  zen: (c, p) => {
    rect(c, 0, 0, T, T, p.floor);
    for (let x = 1; x < T; x += 3) rect(c, x, 0, 1, T, p.floorLine);
    rect(c, 0, 0, T, 2, '#3b4a35');
    rect(c, 0, 30, T, 2, '#3b4a35');
  },
};

const altDrawers: Record<Biome, Drawer> = {
  hub: (c, p) => {
    rect(c, 0, 0, T, T, p.alt);
    rect(c, 0, 0, T, 1, p.altLine);
    rect(c, 0, 0, 1, T, p.altLine);
    for (let i = 0; i < 10; i++)
      rect(c, Math.floor(noise(i + 7) * T), Math.floor(noise(i + 17) * T), 2, 1, p.altLine);
  },
  jungle: (c, p) => {
    rect(c, 0, 0, T, T, p.alt);
    for (let i = 0; i < 40; i++)
      rect(
        c,
        Math.floor(noise(i) * T),
        Math.floor(noise(i + 99) * T),
        2,
        1,
        i % 2 ? p.altLine : shade(p.alt, 0.06),
      );
  },
  boreal: (c, p) => {
    rect(c, 0, 0, T, T, p.altLine);
    for (const [x, y, w, h] of [
      [1, 1, 14, 9],
      [17, 1, 14, 13],
      [1, 12, 12, 19],
      [15, 16, 16, 15],
    ] as const)
      rect(c, x, y, w, h, p.alt);
  },
  oasis: (c, p) => {
    rect(c, 0, 0, T, T, p.alt);
    for (let i = 0; i < 20; i++)
      rect(c, Math.floor(noise(i + 5) * T), Math.floor(noise(i + 55) * T), 1, 1, p.altLine);
  },
  zen: (c, p) => {
    rect(c, 0, 0, T, T, p.alt);
    for (let y = 3; y < T; y += 5) rect(c, 0, y, T, 1, p.altLine);
  },
};

const rugDrawers: Record<Biome, Drawer> = {
  hub: (c, p) => {
    rect(c, 0, 0, T, T, p.rugA);
    for (let i = 0; i < 30; i++)
      rect(c, Math.floor(noise(i) * T), Math.floor(noise(i + 9) * T), 1, 1, p.rugB);
  },
  jungle: (c, p) => {
    rect(c, 0, 0, T, T, p.rugA);
    for (let y = 0; y < T; y += 4)
      for (let x = (y / 4) % 2 ? 0 : 2; x < T; x += 4) rect(c, x, y, 2, 2, p.rugB);
  },
  boreal: (c, p) => {
    rect(c, 0, 0, T, T, p.rugA);
    for (let i = 0; i < 4; i++) {
      rect(c, i * 8, 0, 4, T, 'rgba(20,10,10,0.55)');
      rect(c, 0, i * 8, T, 4, 'rgba(20,10,10,0.55)');
    }
  },
  oasis: (c, p) => {
    rect(c, 0, 0, T, T, p.rugA);
    c.fillStyle = p.rugB;
    c.beginPath();
    c.moveTo(16, 4);
    c.lineTo(28, 16);
    c.lineTo(16, 28);
    c.lineTo(4, 16);
    c.fill();
    rect(c, 14, 14, 4, 4, '#e3b25a');
  },
  zen: (c, p) => {
    rect(c, 0, 0, T, T, PALETTES.zen.alt);
    ellipse(c, 16, 16, 12, 9, p.rugA);
    ellipse(c, 14, 14, 8, 5, p.rugB);
  },
};

const wallFront: Drawer = (c, p, b) => {
  rect(c, 0, 0, T, 8, p.wallTop);
  rect(c, 0, 8, T, 20, p.wallFront);
  if (b === 'boreal')
    for (let y = 10; y < 28; y += 6) rect(c, 0, y, T, 1, shade(p.wallFront, -0.18));
  else if (b === 'zen') {
    rect(c, 0, 8, T, 2, p.wallAccent);
    for (let x = 0; x < T; x += 8) rect(c, x, 8, 1, 20, p.wallAccent);
    rect(c, 0, 18, T, 1, p.wallAccent);
  } else if (b === 'jungle') {
    for (const x of [3, 12, 22, 28]) rect(c, x, 8, 2, 6 + (x % 7), p.wallAccent);
    for (const x of [4, 23]) ellipse(c, x, 14 + (x % 5), 3, 2, '#5cc46a');
  } else if (b === 'oasis') rect(c, 0, 8, T, 2, p.wallAccent);
  else rect(c, 0, 8, T, 2, p.wallAccent);
  rect(c, 0, 26, T, 6, p.wallBase);
  rect(c, 0, 26, T, 1, shade(p.wallBase, -0.1));
};

const windowDrawer: Drawer = (c, p, b) => {
  wallFront(c, p, b);
  if (b === 'zen') {
    circle(c, 16, 17, 9, '#a9cbe3');
    circle(c, 16, 17, 9, 'rgba(255,255,255,0)');
    c.strokeStyle = p.wallAccent;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(16, 17, 9, 0, Math.PI * 2);
    c.stroke();
    return;
  }
  const glass = b === 'boreal' ? '#bcd6ea' : b === 'oasis' ? '#f2d9a3' : '#8fb8d8';
  if (b === 'oasis') {
    rect(c, 6, 14, 20, 11, glass);
    ellipse(c, 16, 14, 10, 5, glass);
  } else rect(c, 4, 11, 24, 13, glass);
  rect(c, 4, 11, 24, 2, 'rgba(255,255,255,0.5)');
  rect(c, 15, 11, 2, 13, p.wallAccent);
  if (b === 'boreal') rect(c, 4, 22, 24, 2, '#ffffff');
  if (b === 'jungle') ellipse(c, 8, 19, 4, 3, '#2e8b45');
};

const border: Drawer = (c, p, b) => {
  if (b === 'boreal') {
    for (let y = 8; y < 30; y += 7) {
      rect(c, 0, y, T, 6, p.border);
      circle(c, 3, y + 3, 3, p.borderTop);
      circle(c, 29, y + 3, 3, p.borderTop);
    }
    return;
  }
  if (b === 'zen') {
    for (let x = 1; x < T; x += 5) {
      rect(c, x, 4, 4, 26, p.border);
      rect(c, x, 12, 4, 1, p.borderTop);
      rect(c, x, 22, 4, 1, p.borderTop);
    }
    rect(c, 0, 8, T, 2, '#6b4a32');
    rect(c, 0, 24, T, 2, '#6b4a32');
    return;
  }
  rect(c, 1, 12, 30, 18, p.border);
  rect(c, 0, 10, 32, 4, p.borderTop);
  rect(c, 1, 28, 30, 2, shade(p.border, -0.12));
  if (b === 'oasis') for (let x = 2; x < 30; x += 6) rect(c, x, 11, 3, 2, '#e8bb85');
  else {
    rect(c, 2, 8, 28, 4, '#4a3324');
    for (let x = 3; x < 30; x += 5) ellipse(c, x, 9, 3, 2, p.leaf);
  }
};

const borderPlant: Drawer = (c, p, b) => {
  border(c, p, b);
  const leaves = b === 'oasis' ? '#5f8f4a' : p.leaf;
  if (b === 'oasis') {
    rect(c, 13, 0, 6, 12, '#4f8a4a');
    rect(c, 8, 4, 3, 5, '#4f8a4a');
    rect(c, 21, 2, 3, 6, '#4f8a4a');
    return;
  }
  if (b === 'zen') {
    ellipse(c, 16, 6, 10, 5, '#4f7a3a');
    ellipse(c, 12, 4, 5, 3, '#7fae5a');
    return;
  }
  for (const [x, y, r] of [
    [8, 8, 7],
    [22, 7, 7],
    [15, 3, 6],
    [27, 11, 4],
    [4, 12, 4],
  ] as const)
    ellipse(c, x, y, r, r * 0.7, leaves);
  for (const [x, y] of [
    [9, 6],
    [20, 5],
    [15, 1],
  ] as const)
    ellipse(c, x, y, 3, 2, p.leafLight);
  if (b === 'jungle') {
    rect(c, 25, 4, 3, 2, '#ff8a2a');
    rect(c, 6, 3, 2, 2, '#f2d36b');
  }
};

const desk = (c: Ctx, p: Pal) => {
  rect(c, 0, 2, T, 24, p.wood);
  rect(c, 0, 2, T, 2, shade(p.wood, 0.1));
  rect(c, 0, 24, T, 5, shade(p.wood, -0.18));
  rect(c, 0, 29, T, 3, 'rgba(0,0,0,0.18)');
};
const deskH: Drawer = (c, p) => {
  desk(c, p);
  rect(c, 6, 9, 10, 7, '#f1f1ec');
  rect(c, 6, 9, 10, 1, '#d5d5cf');
  rect(c, 20, 10, 5, 6, shade(p.wood, -0.25));
  rect(c, 21, 9, 3, 1, '#9aa6b1');
};
const deskMonitor: Drawer = (c, p) => {
  desk(c, p);
  rect(c, 5, 3, 22, 15, '#1d232b');
  rect(c, 7, 5, 18, 11, '#4a8bc2');
  rect(c, 7, 5, 18, 3, '#6aa6d6');
  rect(c, 9, 10, 8, 1, '#cfe3f2');
  rect(c, 9, 12, 12, 1, '#cfe3f2');
  rect(c, 14, 18, 4, 3, '#1d232b');
  rect(c, 8, 21, 16, 3, '#3a3f45');
};
const deskMonitorBack: Drawer = (c, p) => {
  desk(c, p);
  rect(c, 8, 20, 16, 3, '#3a3f45');
  rect(c, 5, 6, 22, 13, '#2b3036');
  rect(c, 5, 6, 22, 1, '#40464d');
  rect(c, 14, 19, 4, 3, '#2b3036');
};
const deskCorner: Drawer = (c, p) => {
  desk(c, p);
  rect(c, 22, 4, 3, 10, '#6aa6d6');
  rect(c, 6, 12, 6, 6, shade(p.wood, -0.3));
  circle(c, 9, 8, 3, '#f2a900');
};
const deskV: Drawer = (c, p) => {
  rect(c, 2, 0, 26, T, p.wood);
  rect(c, 2, 0, 2, T, shade(p.wood, 0.1));
  rect(c, 26, 0, 4, T, shade(p.wood, -0.2));
  rect(c, 8, 8, 12, 9, '#e8e3d6');
  rect(c, 9, 10, 8, 1, '#9aa6b1');
  rect(c, 9, 12, 6, 1, '#9aa6b1');
};

const treeBase: Drawer = (c, p, b) => {
  ellipse(c, 16, 28, 11, 4, 'rgba(0,0,0,0.3)');
  if (b === 'boreal') {
    rect(c, 13, 0, 7, 29, '#eceae4');
    for (const [y, w] of [
      [5, 4],
      [12, 3],
      [19, 5],
      [25, 3],
    ] as const)
      rect(c, 13 + (y % 3), y, w, 2, '#2b2b2b');
  } else if (b === 'zen') {
    rect(c, 13, 0, 6, 29, '#4a3226');
    rect(c, 10, 8, 4, 3, '#4a3226');
  } else {
    for (let y = 0; y < 29; y += 4)
      rect(c, 13 - (y % 8 ? 0 : 1), y, 7, 3, b === 'oasis' ? '#8a6a3f' : '#7a5636');
    rect(c, 13, 0, 1, 29, 'rgba(0,0,0,0.2)');
  }
  rect(c, 9, 26, 15, 5, p.pot);
  ellipse(c, 8, 22, 5, 3, p.leaf);
  ellipse(c, 24, 23, 4, 3, p.leafLight);
};
const treeTop: Drawer = (c, p, b) => {
  if (b === 'boreal') {
    for (const [x, y, r] of [
      [16, 14, 12],
      [8, 20, 7],
      [24, 19, 8],
      [14, 6, 8],
    ] as const)
      circle(c, x, y, r, 'rgba(184,196,72,0.92)');
    for (const [x, y] of [
      [12, 10],
      [20, 16],
      [9, 21],
    ] as const)
      circle(c, x, y, 3, 'rgba(226,214,96,0.95)');
    rect(c, 13, 24, 7, 8, '#eceae4');
    return;
  }
  if (b === 'zen') {
    for (const [x, y, r] of [
      [16, 14, 12],
      [6, 20, 7],
      [26, 20, 7],
    ] as const)
      circle(c, x, y, r, 'rgba(194,65,47,0.92)');
    for (const [x, y] of [
      [12, 10],
      [21, 16],
      [7, 19],
    ] as const)
      circle(c, x, y, 3, 'rgba(232,110,72,0.95)');
    rect(c, 13, 26, 6, 6, '#4a3226');
    return;
  }
  // palms (jungle, oasis, hub)
  const fr = b === 'oasis' ? '#5f8f4a' : p.leaf;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    c.strokeStyle = i % 2 ? fr : p.leafLight;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(16, 22);
    c.quadraticCurveTo(
      16 + Math.cos(a) * 10,
      14 + Math.sin(a) * 8,
      16 + Math.cos(a) * 16,
      22 + Math.sin(a) * 12,
    );
    c.stroke();
  }
  circle(c, 16, 22, 3, '#7a5636');
  rect(c, 13, 25, 7, 7, b === 'oasis' ? '#8a6a3f' : '#7a5636');
};

const lamp: Drawer = (c, p, b) => {
  ellipse(c, 16, 29, 8, 3, 'rgba(0,0,0,0.25)');
  if (b === 'boreal') {
    rect(c, 15, 0, 2, 4, '#2b2b2b');
    rect(c, 10, 4, 12, 16, '#2b2b2b');
    rect(c, 12, 6, 8, 12, '#ffcf73');
    rect(c, 15, 6, 2, 12, '#2b2b2b');
    rect(c, 9, 20, 14, 2, '#2b2b2b');
    rect(c, 14, 22, 4, 8, '#3d3d3d');
    return;
  }
  if (b === 'zen') {
    rect(c, 10, 4, 12, 20, '#f3e6c4');
    for (let y = 8; y < 24; y += 5) rect(c, 10, y, 12, 1, '#c9b98f');
    rect(c, 9, 3, 14, 2, '#2d2624');
    rect(c, 9, 24, 14, 2, '#2d2624');
    rect(c, 11, 26, 2, 4, '#2d2624');
    rect(c, 19, 26, 2, 4, '#2d2624');
    return;
  }
  if (b === 'oasis') {
    c.fillStyle = '#c9a03a';
    c.beginPath();
    c.moveTo(16, 1);
    c.lineTo(23, 10);
    c.lineTo(21, 22);
    c.lineTo(11, 22);
    c.lineTo(9, 10);
    c.fill();
    for (const [x, y] of [
      [13, 9],
      [18, 9],
      [15, 14],
      [12, 17],
      [19, 17],
    ] as const)
      rect(c, x, y, 2, 2, '#ffd27a');
    rect(c, 14, 22, 4, 8, '#8a6a2a');
    return;
  }
  // hub / jungle: floor lamp with fabric or rattan shade
  c.fillStyle = p.lampShade;
  c.beginPath();
  c.moveTo(10, 3);
  c.lineTo(22, 3);
  c.lineTo(25, 13);
  c.lineTo(7, 13);
  c.fill();
  if (b === 'jungle') for (let x = 9; x < 24; x += 3) rect(c, x, 4, 1, 9, shade(p.lampShade, -0.2));
  rect(c, 7, 12, 18, 2, shade(p.lampShade, -0.15));
  rect(c, 15, 14, 2, 14, '#3a3f45');
  rect(c, 10, 28, 12, 3, '#3a3f45');
};

const decorA: Drawer = (c, p, b) => {
  ellipse(c, 16, 29, 9, 3, 'rgba(0,0,0,0.25)');
  if (b === 'jungle') {
    // tiki totem
    rect(c, 10, 2, 12, 28, '#7a5636');
    rect(c, 12, 6, 3, 3, '#f2d36b');
    rect(c, 17, 6, 3, 3, '#f2d36b');
    rect(c, 12, 12, 8, 3, '#3f2816');
    rect(c, 10, 18, 12, 2, '#c0763a');
    rect(c, 13, 22, 6, 4, '#3f2816');
  } else if (b === 'boreal') {
    // snowshoes on a stand
    ellipse(c, 11, 15, 5, 12, '#a87a50');
    ellipse(c, 21, 15, 5, 12, '#a87a50');
    for (let y = 6; y < 26; y += 4) {
      rect(c, 8, y, 7, 1, '#e8dcc0');
      rect(c, 18, y, 7, 1, '#e8dcc0');
    }
  } else if (b === 'oasis') {
    // amphora
    ellipse(c, 16, 18, 9, 11, '#c4643a');
    rect(c, 12, 3, 8, 6, '#c4643a');
    rect(c, 11, 2, 10, 2, '#a85633');
    rect(c, 8, 16, 16, 2, '#2e7f8a');
  } else if (b === 'zen') {
    // stone lantern (toro)
    rect(c, 13, 20, 6, 10, '#8f8f88');
    rect(c, 9, 12, 14, 8, '#a5a59d');
    rect(c, 12, 14, 8, 4, '#ffcf73');
    rect(c, 6, 8, 20, 4, '#8f8f88');
    rect(c, 13, 4, 6, 4, '#8f8f88');
  } else {
    // hub: sculpture / globe
    circle(c, 16, 14, 9, '#3d6fb6');
    rect(c, 10, 10, 6, 4, p.leaf);
    rect(c, 18, 16, 5, 3, p.leaf);
    rect(c, 14, 23, 4, 4, '#4a5866');
    rect(c, 10, 27, 12, 3, '#4a5866');
  }
};
const decorB: Drawer = (c, p, b) => {
  if (b === 'boreal') {
    // log stump with axe
    ellipse(c, 16, 28, 11, 3, 'rgba(0,0,0,0.25)');
    rect(c, 7, 12, 18, 16, '#7a5232');
    ellipse(c, 16, 12, 9, 4, '#c9a77a');
    ellipse(c, 16, 12, 5, 2, '#a87a50');
    rect(c, 18, 2, 2, 11, '#5a3a22');
    rect(c, 15, 2, 7, 4, '#9aa3a8');
    return;
  }
  if (b === 'zen') {
    // bamboo water spout over a stone basin
    ellipse(c, 16, 24, 10, 5, '#8f8f88');
    ellipse(c, 16, 23, 7, 3, '#5fa3c4');
    rect(c, 22, 6, 3, 18, '#9fb35a');
    rect(c, 10, 8, 14, 3, '#9fb35a');
    return;
  }
  if (b === 'oasis') {
    ellipse(c, 16, 26, 12, 4, '#2e7f8a');
    ellipse(c, 16, 25, 9, 2, '#5fd3c6');
    rect(c, 14, 10, 4, 14, '#cf9561');
    ellipse(c, 16, 10, 6, 3, '#5fd3c6');
    return;
  }
  BIOME_PLANTS[b][1](c, p, 1);
  if (b === 'jungle') anthurium(c, p, 2);
};

const table: Drawer = (c, p, b) => {
  rect(c, 0, 0, T, T, p.table);
  rect(c, 0, 0, T, 2, shade(p.table, 0.12));
  rect(c, 0, T - 3, T, 3, shade(p.table, -0.15));
  if (b === 'oasis')
    for (let x = 2; x < T; x += 6)
      for (let y = 4; y < 28; y += 6) rect(c, x, y, 3, 3, (x + y) % 4 ? '#e3b25a' : '#f3f6f8');
  if (b === 'jungle') for (let y = 3; y < 29; y += 4) rect(c, 0, y, T, 1, shade(p.table, -0.08));
};
const sofa: Drawer = (c, p, b) => {
  rect(c, 0, 4, T, 26, shade(p.sofa, -0.08));
  rect(c, 0, 4, T, 8, shade(p.sofa, -0.2));
  rect(c, 1, 13, 14, 14, p.sofa);
  rect(c, 17, 13, 14, 14, p.sofa);
  rect(c, 1, 13, 14, 2, shade(p.sofa, 0.12));
  rect(c, 17, 13, 14, 2, shade(p.sofa, 0.12));
  if (b === 'boreal') for (let i = 0; i < 4; i++) rect(c, i * 8, 13, 3, 14, 'rgba(20,10,10,0.35)');
  if (b === 'zen') rect(c, 0, 4, T, 2, '#2d2624');
};
const hanging: Drawer = (c, p, b) => {
  if (b === 'zen' || b === 'oasis' || b === 'hub') {
    rect(c, 15, 0, 1, 6, '#2b2b2b');
    const col = b === 'zen' ? '#f3e6c4' : b === 'oasis' ? '#c9a03a' : '#f3e3b5';
    ellipse(c, 16, 10, 5, 5, col);
    rect(c, 13, 14, 6, 1, shade(col, -0.25));
    return;
  }
  if (b === 'boreal') {
    for (let x = 0; x < T; x += 4)
      ellipse(c, x + 2, 3 + Math.abs(16 - x) / 6, 3, 2, 'rgba(47,94,70,0.9)');
    circle(c, 10, 5, 1.5, '#c2364b');
    circle(c, 22, 5, 1.5, '#f2a900');
    return;
  }
  // jungle vines
  for (const [x, len] of [
    [5, 14],
    [14, 9],
    [24, 16],
  ] as const) {
    rect(c, x, 0, 1, len, 'rgba(46,139,69,0.9)');
    for (let y = 2; y < len; y += 4)
      ellipse(c, x + (y % 8 ? 2 : -2), y, 2.5, 1.6, 'rgba(92,196,106,0.9)');
  }
};

// ───────────────────────────────────────────────────────── globals
const chairBase = (c: Ctx) => ellipse(c, 16, 28, 9, 3, 'rgba(0,0,0,0.22)');
const chairDrawers = {
  chairDown: (c: Ctx) => {
    chairBase(c);
    rect(c, 8, 4, 16, 8, '#2b333b');
    rect(c, 7, 12, 18, 12, '#3a4550');
    rect(c, 9, 14, 14, 8, '#4a5866');
    rect(c, 15, 24, 2, 4, '#2b333b');
  },
  chairUp: (c: Ctx) => {
    chairBase(c);
    rect(c, 7, 6, 18, 12, '#3a4550');
    rect(c, 9, 8, 14, 8, '#4a5866');
    rect(c, 8, 18, 16, 8, '#2b333b');
    rect(c, 10, 20, 12, 4, '#3a4550');
  },
  chairLeft: (c: Ctx) => {
    chairBase(c);
    rect(c, 8, 8, 14, 16, '#3a4550');
    rect(c, 10, 10, 10, 12, '#4a5866');
    rect(c, 22, 4, 5, 22, '#2b333b');
  },
  chairRight: (c: Ctx) => {
    chairBase(c);
    rect(c, 10, 8, 14, 16, '#3a4550');
    rect(c, 12, 10, 10, 12, '#4a5866');
    rect(c, 5, 4, 5, 22, '#2b333b');
  },
};

const hubPal = PALETTES.hub;
const globals: Record<string, (c: Ctx) => void> = {
  empty: () => {},
  slot: () => {},
  ...chairDrawers,
  portal: (c) => {
    circle(c, 16, 16, 15, '#17324d');
    circle(c, 16, 16, 12, '#24476b');
    c.strokeStyle = '#5fd3c6';
    c.lineWidth = 2;
    for (const r of [5, 9, 13]) {
      c.beginPath();
      c.arc(16, 16, r, 0, Math.PI * 2);
      c.stroke();
    }
    circle(c, 16, 16, 3, '#bff5ee');
  },
  mat: (c) => {
    rect(c, 0, 0, T, T, '#3c4650');
    for (let y = 1; y < T; y += 3) rect(c, 0, y, T, 1, '#46525d');
  },
  water: (c) => {
    rect(c, 0, 0, T, T, '#2f7fa8');
    for (const [x, y] of [
      [4, 6],
      [18, 12],
      [8, 22],
      [22, 26],
    ] as const)
      rect(c, x, y, 8, 1, '#7cc4e6');
    rect(c, 0, 0, T, 2, '#1f5f80');
  },
  bookshelf: (c) => {
    rect(c, 0, 0, T, T, '#6b4a30');
    const cols = ['#c2364b', '#17324d', '#2f7d5b', '#f2a900', '#8a5a9e', '#e0e4e8', '#3d6fb6'];
    for (let shelf = 0; shelf < 3; shelf++) {
      const y = 2 + shelf * 10;
      rect(c, 2, y, 28, 8, '#4b331f');
      let x = 3;
      let i = shelf * 5;
      while (x < 29) {
        const w = 2 + Math.floor(noise(i) * 3);
        rect(c, x, y + 1 + Math.floor(noise(i + 9) * 2), w, 7, cols[i % cols.length]!);
        x += w + 1;
        i++;
      }
    }
  },
  counter: (c) => {
    rect(c, 0, 0, T, T, '#e9edf0');
    rect(c, 2, 0, 28, T, '#d5dbe0');
    rect(c, 8, 8, 16, 14, '#aeb8c1');
    rect(c, 10, 10, 12, 10, '#93a1ad');
    rect(c, 15, 4, 2, 6, '#7d8a96');
  },
  fridge: (c) => {
    rect(c, 3, 0, 26, T, '#f4f6f8');
    rect(c, 3, 13, 26, 1, '#c6ced5');
    rect(c, 24, 4, 2, 6, '#9aa6b1');
    rect(c, 24, 17, 2, 8, '#9aa6b1');
    rect(c, 3, 30, 26, 2, '#9aa6b1');
  },
  whiteboard: (c) => {
    rect(c, 1, 3, 30, 22, '#9aa6b1');
    rect(c, 2, 4, 28, 20, '#ffffff');
    rect(c, 5, 8, 10, 1, '#3d6fb6');
    rect(c, 5, 12, 16, 1, '#c2364b');
    rect(c, 5, 16, 7, 1, '#2f7d5b');
    rect(c, 20, 8, 6, 6, '#f2a900');
    rect(c, 6, 25, 2, 7, '#6f7b85');
    rect(c, 24, 25, 2, 7, '#6f7b85');
  },
  coffeeTable: (c) => {
    rect(c, 2, 6, 28, 18, '#7d5939');
    rect(c, 3, 7, 26, 15, '#a87b51');
    rect(c, 8, 10, 6, 6, '#f3f6f8');
    rect(c, 18, 12, 6, 4, '#c2364b');
  },
  reception: (c) => {
    rect(c, 0, 4, T, 28, '#17324d');
    rect(c, 0, 4, T, 6, '#a87b51');
    rect(c, 0, 10, T, 2, '#0f2236');
  },
  glassDoor: (c) => {
    rect(c, 0, 0, T, 8, hubPal.wallTop);
    rect(c, 0, 8, T, 24, '#7b8b98');
    rect(c, 2, 9, 28, 22, '#a9cbe3');
    rect(c, 15, 9, 2, 22, '#7b8b98');
  },
  waterCooler: (c) => {
    rect(c, 10, 2, 12, 12, '#8fc3e8');
    rect(c, 8, 14, 16, 18, '#e8ecef');
    rect(c, 12, 18, 3, 3, '#3d6fb6');
    rect(c, 17, 18, 3, 3, '#c2364b');
  },
  stool: (c) => {
    rect(c, 9, 10, 14, 10, '#a87b51');
    rect(c, 9, 10, 14, 2, '#bf9065');
    rect(c, 10, 20, 2, 8, '#5a4029');
    rect(c, 20, 20, 2, 8, '#5a4029');
  },
  fireplace: (c) => {
    rect(c, 1, 2, 30, 30, '#8f8f88');
    for (let y = 4; y < 30; y += 6)
      for (let x = (y / 6) % 2 ? 2 : 6; x < 30; x += 8) rect(c, x, y, 6, 4, '#a5a59d');
    rect(c, 6, 12, 20, 18, '#2b2b2b');
    ellipse(c, 16, 26, 7, 4, '#f2a900');
    ellipse(c, 16, 23, 4, 5, '#ff8a2a');
    ellipse(c, 16, 22, 2, 3, '#ffe08a');
    rect(c, 9, 27, 14, 3, '#5a3a22');
  },
  sign: (c) => {
    rect(c, 14, 14, 4, 16, '#4a5866');
    rect(c, 4, 4, 24, 12, '#17324d');
    rect(c, 6, 6, 20, 8, '#24476b');
  },
};

const perBiome: Record<string, Drawer> = {
  floor: (c, p, b) => floorDrawers[b](c, p, b),
  floorAlt: (c, p, b) => altDrawers[b](c, p, b),
  rug: (c, p, b) => rugDrawers[b](c, p, b),
  wallTop: (c, p) => {
    rect(c, 0, 0, T, T, p.wallTop);
    rect(c, 2, 2, T - 4, T - 4, shade(p.wallTop, 0.04));
  },
  wallFront,
  window: windowDrawer,
  border,
  borderPlant,
  deskH,
  deskMonitor,
  deskMonitorBack,
  deskCorner,
  deskV,
  plantA: (c, p, b) => BIOME_PLANTS[b][0](c, p, 0),
  plantB: (c, p, b) => BIOME_PLANTS[b][1](c, p, 1),
  plantC: (c, p, b) => BIOME_PLANTS[b][2](c, p, 2),
  treeBase,
  treeTop,
  lamp,
  decorA,
  decorB,
  table,
  sofa,
  hanging,
};

/**
 * Kenney CC0 sprites used in place of the procedural drawers (ADR-020).
 * `under: true` draws the procedural tile first (e.g. a planter box under a hedge).
 * Tiles without an entry keep procedural art (modern office items have no CC0 match).
 */
const KENNEY: Record<string, { s: Sprite[]; under?: boolean; dy?: number }> = {
  // seating (modern grey chairs from Roguelike Indoors)
  chairDown: { s: [['ind', 0, 8]] },
  chairUp: { s: [['ind', 1, 8]] },
  chairRight: { s: [['ind', 2, 8]] },
  chairLeft: { s: [['ind', 3, 8]] },
  water: { s: [['rpg', 0, 0]] },
  bookshelf: { s: [['rpg', 46, 14]] },
  fireplace: { s: [['rpg', 54, 8]] },
  // hub
  'hub.plantA': { s: [['ind', 16, 0]] },
  'hub.plantB': { s: [['ind', 17, 0]] },
  'hub.plantC': { s: [['rpg', 29, 9]] },
  'hub.treeBase': { s: [['rpg', 15, 11]] },
  'hub.treeTop': { s: [['rpg', 15, 10]] },
  'hub.border': { s: [['rpg', 20, 11]] },
  'hub.borderPlant': { s: [['rpg', 20, 10]] },
  // jungle
  'jungle.plantA': { s: [['rpg', 19, 9]] },
  'jungle.plantB': { s: [['rpg', 24, 10]] },
  'jungle.plantC': { s: [['ind', 16, 0]] },
  'jungle.decorB': { s: [['rpg', 25, 10]] },
  'jungle.treeBase': { s: [['rpg', 13, 11]] },
  'jungle.treeTop': { s: [['rpg', 13, 10]] },
  'jungle.border': { s: [['rpg', 20, 11]] },
  'jungle.borderPlant': { s: [['rpg', 23, 9]] },
  // boreal forest
  'boreal.plantA': { s: [['rpg', 18, 9]] },
  'boreal.plantB': { s: [['rpg', 16, 9]] },
  'boreal.plantC': { s: [['rpg', 26, 11]] },
  'boreal.treeBase': { s: [['rpg', 18, 11]] },
  'boreal.treeTop': { s: [['rpg', 18, 10]] },
  'boreal.borderPlant': { s: [['rpg', 28, 11]], under: true, dy: -8 },
  // oasis
  'oasis.plantA': { s: [['rpg', 22, 9]] },
  'oasis.plantB': { s: [['rpg', 26, 10]] },
  'oasis.plantC': { s: [['rpg', 26, 9]] },
  'oasis.borderPlant': { s: [['rpg', 22, 10]], under: true, dy: -10 },
  // zen garden
  'zen.plantA': { s: [['rpg', 25, 9]] },
  'zen.plantB': { s: [['rpg', 24, 11]] },
  'zen.plantC': { s: [['rpg', 25, 11]] },
  'zen.treeBase': { s: [['rpg', 14, 11]] },
  'zen.treeTop': { s: [['rpg', 14, 10]] },
  'zen.borderPlant': { s: [['rpg', 26, 11]], under: true, dy: -10 },
};

/** Personalised desk plants (same order as PLANT_STYLES). */
export const DECOR_SPRITES: Sprite[] = [
  ['ind', 16, 0],
  ['ind', 17, 0],
  ['rpg', 22, 9],
  ['rpg', 25, 9],
  ['rpg', 30, 9],
  ['rpg', 26, 9],
];

/** Jungle tiles cut from a bigger hand-drawn sprite: tile name → [sprite, col, row] (32 px cells). */
const ART_SLICES: Record<string, [string, number, number]> = {
  'jungle.hammockL': ['jungle.hammock', 0, 0],
  'jungle.hammockR': ['jungle.hammock', 1, 0],
  'jungle.arcadeATop': ['jungle.arcadeA', 0, 0],
  'jungle.arcadeABot': ['jungle.arcadeA', 0, 1],
  'jungle.arcadeBTop': ['jungle.arcadeB', 0, 0],
  'jungle.arcadeBBot': ['jungle.arcadeB', 0, 1],
  ...Object.fromEntries(
    [0, 1, 2, 3].flatMap((r) =>
      [0, 1, 2].map((c) => [`jungle.fall${r}${c}`, ['jungle.waterfall', c, r]] as const),
    ),
  ),
  // Oasis (ADR-024): wall fountain 3x3, cabana 3x2, pool table and ping-pong 2x1
  ...Object.fromEntries(
    [0, 1, 2].flatMap((r) =>
      [0, 1, 2].map((c) => [`oasis.fall${r}${c}`, ['oasis.fall', c, r]] as const),
    ),
  ),
  ...Object.fromEntries(
    [0, 1].flatMap((r) =>
      [0, 1, 2].map((c) => [`oasis.cabana${r}${c}`, ['oasis.cabana', c, r]] as const),
    ),
  ),
  'oasis.poolTableL': ['oasis.poolTable', 0, 0],
  'oasis.poolTableR': ['oasis.poolTable', 1, 0],
  'oasis.pingPongL': ['oasis.pingPong', 0, 0],
  'oasis.pingPongR': ['oasis.pingPong', 1, 0],
  // Boreal (ADR-025): fire pit 4x4, TV and console 2x1
  ...Object.fromEntries(
    [0, 1, 2, 3].flatMap((r) =>
      [0, 1, 2, 3].map((c) => [`boreal.firepit${r}${c}`, ['boreal.firepit', c, r]] as const),
    ),
  ),
  'boreal.tvL': ['boreal.tv', 0, 0],
  'boreal.tvR': ['boreal.tv', 1, 0],
};

/** Art behind a tile (whole sprite or a slice), with its frame count and speed. */
function tileArt(name: string) {
  const sl = ART_SLICES[name];
  const a = art[sl ? sl[0] : name];
  if (!a) return null;
  return { sprite: sl ? sl[0] : name, col: sl?.[1] ?? 0, row: sl?.[2] ?? 0, a, slice: !!sl };
}

/** Draw one animation frame of a tile's original art at (0,0). False if no art is loaded. */
function drawTileArt(c: Ctx, name: string, frame = 0): boolean {
  const t = tileArt(name);
  if (!t) return false;
  return t.slice
    ? drawArtSlice(c, t.sprite, t.col, t.row, 0, 0, frame)
    : drawArt(c, t.sprite, 0, 0, frame);
}

/** Tiles whose art has several frames (water, pond, waterfall, fire, portal). */
export function animatedTiles(): { name: string; index: number; frames: number; fps: number }[] {
  const out: { name: string; index: number; frames: number; fps: number }[] = [];
  TILE_DEFS.forEach((d, index) => {
    const t = tileArt(d.name);
    if (t && t.a.frames > 1) out.push({ name: d.name, index, frames: t.a.frames, fps: t.a.fps });
  });
  return out;
}

/** Strip sheet of every animation frame: row = animated tile, column = frame. */
export function makeAnimCanvas(list: ReturnType<typeof animatedTiles>): HTMLCanvasElement {
  const cols = Math.max(1, ...list.map((l) => l.frames));
  const cv = document.createElement('canvas');
  cv.width = cols * T;
  cv.height = Math.max(1, list.length) * T;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  list.forEach((l, row) => {
    for (let f = 0; f < l.frames; f++) {
      c.save();
      c.translate(f * T, row * T);
      c.beginPath();
      c.rect(0, 0, T, T);
      c.clip();
      drawTileArt(c, l.name, f);
      c.restore();
    }
  });
  return cv;
}

/** Stand-in for wing-only tiles when the art sheet is missing. */
function extraFallback(c: Ctx, biome: Biome, base: string) {
  const pal = PALETTES[biome];
  if (/^(pond|fall)/.test(base)) rect(c, 0, 0, T, T, '#3a7fb0');
  else if (/^(floor|dirt|path)/.test(base)) perBiome.floor!(c, pal, biome);
  else if (base.startsWith('sofa')) perBiome.sofa!(c, pal, biome);
  else if (base === 'deskCornerUp') perBiome.deskCorner!(c, pal, biome);
  else perBiome.decorA!(c, pal, biome);
}

export function makeTilesetCanvas(): HTMLCanvasElement {
  const rows = Math.ceil(TILE_DEFS.length / TILESET_COLUMNS);
  const cv = document.createElement('canvas');
  cv.width = TILESET_COLUMNS * T;
  cv.height = rows * T;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  TILE_DEFS.forEach((t, i) => {
    c.save();
    c.translate((i % TILESET_COLUMNS) * T, Math.floor(i / TILESET_COLUMNS) * T);
    c.beginPath();
    c.rect(0, 0, T, T);
    c.clip();
    // Original Agora art (ADR-022) wins over Kenney / procedural when the sprite is loaded.
    if (drawTileArt(c, t.name, 0)) {
      c.restore();
      return;
    }
    const k = KENNEY[t.name];
    const drawProcedural = () => {
      if (t.biome) perBiome[t.base]!(c, PALETTES[t.biome], t.biome);
      else globals[t.base]!(c);
    };
    if (k) {
      if (k.under) drawProcedural();
      let ok = true;
      for (const sp of k.s) ok = drawSprite(c, sp, 0, k.dy ?? 0) && ok;
      if (!ok && !k.under) drawProcedural();
    } else if (t.biome) {
      const d = perBiome[t.base];
      if (d) d(c, PALETTES[t.biome], t.biome);
      else if (EXTRA_LAYER[t.name]) extraFallback(c, t.biome, t.base);
      else throw new Error(`no drawer for ${t.name}`);
    } else {
      const d = globals[t.base];
      if (d) d(c);
      else if (t.prop) {
        // stand-in for a prop whose art sheet is missing: a small item resting at row 20
        rect(c, 11, 12, 10, 8, '#c9d0d6');
        rect(c, 11, 19, 10, 1, '#6f7b85');
      } else throw new Error(`no drawer for ${t.name}`);
    }
    c.restore();
  });
  return cv;
}

/** Overlay drawn over a seated avatar facing up (chair back in front of them). */
export function makeChairBackCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = T;
  cv.height = T;
  const c = cv.getContext('2d')!;
  // lower part of the chair back, drawn over a seated avatar's legs
  if (!drawArt(c, 'chairBackOverlay') && !drawSprite(c, ['ind', 1, 8], 0, 0, 2, 9, 7)) {
    rect(c, 8, 18, 16, 8, '#2b333b');
    rect(c, 10, 20, 12, 4, '#3a4550');
  }
  return cv;
}

let tilesetCache: HTMLCanvasElement | null = null;
/** The tileset canvas, drawn once per page (sprite sheets must be loaded first). */
export function tilesetCanvas(): HTMLCanvasElement {
  return (tilesetCache ??= makeTilesetCanvas());
}

const thumbs = new Map<string, string>();
/** Data URL preview of a tile for the build palette (trees include their canopy). */
export function tileThumb(name: string): string {
  const hit = thumbs.get(name);
  if (hit) return hit;
  const src = tilesetCanvas();
  const idx = TILE_DEFS.findIndex((d) => d.name === name);
  const tall = name.endsWith('.treeBase');
  const cv = document.createElement('canvas');
  cv.width = T;
  cv.height = tall ? T * 2 : T;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const blit = (i: number, dy: number) =>
    i >= 0 &&
    c.drawImage(
      src,
      (i % TILESET_COLUMNS) * T,
      Math.floor(i / TILESET_COLUMNS) * T,
      T,
      T,
      0,
      dy,
      T,
      T,
    );
  if (tall)
    blit(
      TILE_DEFS.findIndex((d) => d.name === name.replace('treeBase', 'treeTop')),
      0,
    );
  blit(idx, tall ? T : 0);
  const url = cv.toDataURL();
  thumbs.set(name, url);
  return url;
}
