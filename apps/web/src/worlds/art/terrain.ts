import { canvas } from './pixels';

const PALETTES: Record<string, readonly [string, string, string]> = {
  meadow_grass: ['#819a50', '#708d48', '#a7b76a'],
  meadow_dirt: ['#9c8056', '#7c674b', '#b69b70'],
  jungle_grass: ['#729751', '#567948', '#8caa67'],
  jungle_mud: ['#776042', '#594e39', '#93825d'],
  desert_sand: ['#c8b684', '#b4a174', '#e0cf9b'],
  desert_sandstone: ['#b69b71', '#958362', '#d2bd8d'],
  sand: ['#c8b684', '#b4a174', '#e0cf9b'],
  taiga_moss: ['#718b72', '#536b59', '#92a68a'],
  taiga_podzol: ['#705b44', '#574b39', '#92815f'],
  taiga_snow: ['#d7e1d8', '#b5c8c3', '#eef2e4'],
  stone: ['#879184', '#69786e', '#a3aca1'],
  gravel: ['#8b9385', '#68766d', '#b0b4a5'],
  tilled_soil: ['#806044', '#624833', '#99714a'],
  water: ['#397e88', '#306774', '#75b8b5'],
  wood_floor: ['#987149', '#745738', '#b49160'],
  wood_wall: ['#987149', '#745738', '#b49160'],
  cave_floor: ['#686d66', '#505954', '#82877d'],
  cave_rock: ['#66726b', '#4a5753', '#829184'],
};

/** Quiet, tileable surface art in the approved biome palettes. Grain never changes collision. */
export function terrainTexture(id: string, variant = 0): HTMLCanvasElement | undefined {
  const palette = PALETTES[id];
  if (!palette) return undefined;
  const out = canvas(64),
    c = out.getContext('2d')!;
  let seed = 413 + variant * 931;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  c.fillStyle = palette[0];
  c.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 2)
    for (let x = 0; x < 64; x += 2) {
      const f =
        Math.sin((x * Math.PI) / 32 + Math.sin((y * Math.PI) / 32)) * Math.cos((y * Math.PI) / 32);
      c.globalAlpha = Math.abs(f) * 0.18;
      c.fillStyle = palette[f < 0 ? 1 : 2];
      c.fillRect(x, y, 2, 2);
    }
  const grass = /grass|moss/.test(id),
    sand = /sand/.test(id),
    water = id === 'water';
  for (let i = 0; i < (water ? 18 : 125); i++) {
    const x = Math.floor(rand() * 64),
      y = Math.floor(rand() * 64);
    c.globalAlpha = water ? 0.12 : 0.15 + rand() * 0.22;
    c.fillStyle = palette[i % 3 ? 1 : 2];
    c.fillRect(
      x,
      y,
      water ? 3 + rand() * 9 : sand ? 3 + rand() * 5 : 1 + rand() * 3,
      1 + (water || sand ? 0 : rand() * 2),
    );
    if (grass && i % 5 === 0) c.fillRect(x + 1, y - 2, 1, 3);
  }
  if (id === 'tilled_soil' || id === 'wood_floor' || id === 'wood_wall') {
    for (let y = 8; y < 64; y += 16)
      for (let x = 0; x < 64; x += 3) {
        c.globalAlpha = id === 'tilled_soil' ? 0.25 + rand() * 0.2 : 0.55;
        c.fillStyle = palette[1];
        c.fillRect(x, y + (id === 'tilled_soil' ? Math.floor(rand() * 3) : 0), 3, 2);
        c.fillStyle = palette[2];
        c.fillRect(x, y + 3, 3, 1);
      }
  }
  c.globalAlpha = 1;
  return out;
}
