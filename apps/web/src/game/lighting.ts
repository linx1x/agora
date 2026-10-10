/**
 * Baked 2D lighting with ray-cast shadows (ADR-018).
 *
 * Every light casts rays against occluder edges (walls, bookshelves, tall plants)
 * to build a visibility polygon; its radial falloff is drawn only inside that
 * polygon. Lights never move, so polygons are computed once per map and the
 * light map is re-composited only when the time of day, a desk lamp colour or
 * the settings change. The result is multiplied over the world.
 */
import {
  TILE,
  mapReader,
  propDef,
  resolveProps,
  tileDef,
  type Biome,
  type DeskState,
  LAMP_COLORS,
  type Tmj,
  type WorldMap,
} from '@agora/shared';

export interface Light {
  x: number;
  y: number;
  radius: number; // px
  color: string;
  intensity: number;
  kind: 'lamp' | 'ceiling' | 'window' | 'sky' | 'fire' | 'portal' | 'desk';
  deskId?: string;
  poly?: { x: number; y: number }[];
}

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const LAMP_COLOR: Record<Biome, string> = {
  hub: '#ffe2b0',
  jungle: '#ffb35c',
  boreal: '#ffbf66',
  oasis: '#ffa94d',
  zen: '#ffdca0',
};

/** Occluder edges: solid wall cells as full squares, tall plants as trunks. */
function buildSegments(map: WorldMap): Seg[] {
  const segs: Seg[] = [];
  const W = map.width;
  const occ = (cx: number, cy: number) =>
    cx < 0 || cy < 0 || cx >= W || cy >= map.height || map.occlude[cy * W + cx] === 1;
  const furn = map.layers.furniture ?? [];
  const isTree = (cx: number, cy: number) => tileDef(furn[cy * W + cx] ?? 0)?.base === 'treeBase';
  // Horizontal edges (merged runs)
  for (let cy = 0; cy <= map.height; cy++) {
    let run: number | null = null;
    for (let cx = 0; cx <= W; cx++) {
      const edge =
        cx < W && occ(cx, cy - 1) !== occ(cx, cy) && !isTree(cx, cy - 1) && !isTree(cx, cy);
      if (edge && run === null) run = cx;
      if (!edge && run !== null) {
        segs.push({ ax: run * TILE, ay: cy * TILE, bx: cx * TILE, by: cy * TILE });
        run = null;
      }
    }
  }
  for (let cx = 0; cx <= W; cx++) {
    let run: number | null = null;
    for (let cy = 0; cy <= map.height; cy++) {
      const edge =
        cy < map.height &&
        occ(cx - 1, cy) !== occ(cx, cy) &&
        !isTree(cx - 1, cy) &&
        !isTree(cx, cy);
      if (edge && run === null) run = cy;
      if (!edge && run !== null) {
        segs.push({ ax: cx * TILE, ay: run * TILE, bx: cx * TILE, by: cy * TILE });
        run = null;
      }
    }
  }
  // Tree trunks: small squares so they cast slim shadows
  for (let cy = 0; cy < map.height; cy++)
    for (let cx = 0; cx < W; cx++)
      if (isTree(cx, cy)) {
        const x0 = cx * TILE + 11;
        const x1 = cx * TILE + 21;
        const y0 = cy * TILE + 14;
        const y1 = cy * TILE + 26;
        segs.push(
          { ax: x0, ay: y0, bx: x1, by: y0 },
          { ax: x1, ay: y0, bx: x1, by: y1 },
          { ax: x1, ay: y1, bx: x0, by: y1 },
          { ax: x0, ay: y1, bx: x0, by: y0 },
        );
      }
  return segs;
}

/** Distance along ray (ox,oy)+(dx,dy)*t to segment, or Infinity. */
function hit(ox: number, oy: number, dx: number, dy: number, s: Seg): number {
  const sx = s.bx - s.ax;
  const sy = s.by - s.ay;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-9) return Infinity;
  const t = ((s.ax - ox) * sy - (s.ay - oy) * sx) / den;
  const u = ((s.ax - ox) * dy - (s.ay - oy) * dx) / den;
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}

export function visibility(
  x: number,
  y: number,
  r: number,
  all: Seg[],
): { x: number; y: number }[] {
  const segs = all.filter(
    (s) =>
      Math.max(s.ax, s.bx) >= x - r &&
      Math.min(s.ax, s.bx) <= x + r &&
      Math.max(s.ay, s.by) >= y - r &&
      Math.min(s.ay, s.by) <= y + r,
  );
  const angles: number[] = [];
  for (let i = 0; i < 48; i++) angles.push((i / 48) * Math.PI * 2);
  for (const s of segs)
    for (const [px, py] of [
      [s.ax, s.ay],
      [s.bx, s.by],
    ] as const) {
      const a = Math.atan2(py - y, px - x);
      angles.push(a - 0.0005, a, a + 0.0005);
    }
  const pts = angles.map((a) => {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let t = r;
    for (const s of segs) t = Math.min(t, hit(x, y, dx, dy, s));
    return { a, x: x + dx * t, y: y + dy * t };
  });
  pts.sort((p, q) => p.a - q.a);
  return pts;
}

/** Light sources from tiles (lamps, windows, fireplaces, portals), the `lights` layer and desk lamps. */
function regionBiome(map: WorldMap, cx: number, cy: number): string | undefined {
  const x = cx * TILE + TILE / 2;
  const y = cy * TILE + TILE / 2;
  return map.regions.find((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h)?.biome;
}

export function collectLights(map: WorldMap, tmj: Tmj): Light[] {
  const out: Light[] = [];
  const W = map.width;
  for (const name of ['walls', 'furniture'] as const) {
    const data = map.layers[name] ?? [];
    data.forEach((g, i) => {
      const def = tileDef(g);
      if (!def?.light) return;
      const cx = i % W;
      const cy = Math.floor(i / W);
      const biome = (def.biome ?? 'hub') as Biome;
      const x = cx * TILE + TILE / 2;
      if (def.light === 'lamp')
        out.push({
          kind: 'lamp',
          x,
          y: cy * TILE + 10,
          radius: 4.5 * TILE,
          color: LAMP_COLOR[biome],
          intensity: 0.85,
        });
      else if (def.light === 'window')
        out.push({
          kind: 'window',
          x,
          y: (cy + 1) * TILE + 2,
          radius: 5.5 * TILE,
          color: '#dcecff',
          intensity: 0.55,
        });
      else if (def.light === 'fire')
        out.push({
          kind: 'fire',
          x,
          y: (cy + 1) * TILE + 2,
          radius: 6 * TILE,
          color: '#ff8a3c',
          intensity: 0.95,
        });
      else if (def.light === 'portal')
        out.push({
          kind: 'portal',
          x: x + 16,
          y: cy * TILE + 16,
          radius: 2.6 * TILE,
          color: '#5fd3c6',
          intensity: 0.35,
        });
    });
  }
  // lit desk lamps among the placed props (P9.16): at the lamp head, raised with what holds it
  const rest = resolveProps(mapReader(map), map.props);
  map.props.forEach((p, i) => {
    if (propDef(p.t)?.light !== 'lamp') return;
    const cx = Math.floor(p.x / TILE);
    const cy = Math.floor(p.y / TILE);
    const biome = (regionBiome(map, cx, cy) ?? 'hub') as Biome;
    out.push({
      kind: 'lamp',
      x: p.x,
      y: p.y - rest[i]!.lift - p.z - 7,
      radius: 4.5 * TILE,
      color: LAMP_COLOR[biome] ?? LAMP_COLOR.hub,
      intensity: 0.85,
    });
  });
  // portals are 2×2: keep one light per pad
  const seen = new Set<string>();
  const dedup = out.filter((l) => {
    if (l.kind !== 'portal') return true;
    const k = `${Math.round(l.x / 64)},${Math.round(l.y / 64)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const o of tmj.layers.find((l) => l.name === 'lights')?.objects ?? []) {
    const p = Object.fromEntries((o.properties ?? []).map((q) => [q.name, q.value]));
    dedup.push({
      kind: p.kind === 'sky' ? 'sky' : 'ceiling',
      x: o.x + TILE / 2,
      y: o.y + TILE / 2,
      radius: Number(p.radius ?? 5) * TILE,
      color: String(p.color ?? '#fff1d6'),
      intensity: Number(p.intensity ?? 0.5),
    });
  }
  for (const d of map.desks)
    dedup.push({
      kind: 'desk',
      deskId: d.id,
      x: d.lamp.cx * TILE + 22,
      y: d.lamp.cy * TILE + 18,
      radius: 3.4 * TILE,
      color: LAMP_COLORS[0],
      intensity: 0.8,
    });
  return dedup;
}

export function bakeVisibility(map: WorldMap, lights: Light[]) {
  const segs = buildSegments(map);
  for (const l of lights) l.poly = visibility(l.x, l.y, l.radius, segs);
}

// ───────────────────────────────────────────── time of day (America/Toronto)
interface Key {
  h: number;
  amb: [number, number, number];
  day: number;
  sky: string;
}
const KEYS: Key[] = [
  { h: 0, amb: [0.2, 0.22, 0.34], day: 0, sky: '#9fb8ff' },
  { h: 5.5, amb: [0.22, 0.24, 0.36], day: 0, sky: '#9fb8ff' },
  { h: 7, amb: [0.68, 0.7, 0.8], day: 0.6, sky: '#ffd2b0' },
  { h: 9, amb: [0.86, 0.88, 0.93], day: 1, sky: '#dcecff' },
  { h: 15, amb: [0.9, 0.88, 0.85], day: 1, sky: '#fff3dc' },
  { h: 17, amb: [0.86, 0.7, 0.52], day: 0.7, sky: '#ffc07a' },
  { h: 19, amb: [0.46, 0.38, 0.42], day: 0.15, sky: '#ff9a6a' },
  { h: 21, amb: [0.26, 0.26, 0.38], day: 0, sky: '#9fb8ff' },
  { h: 24, amb: [0.2, 0.22, 0.34], day: 0, sky: '#9fb8ff' },
];

export function quebecHour(now = new Date()): number {
  const override = new URLSearchParams(location.search).get('hour');
  if (override !== null && !Number.isNaN(Number(override))) return Number(override);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

export function timeOfDay(hour: number): {
  amb: [number, number, number];
  day: number;
  sky: string;
  phase: 'night' | 'morning' | 'day' | 'golden' | 'evening';
} {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.h <= hour) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const f = Math.min(1, Math.max(0, (hour - a.h) / (b.h - a.h)));
  const amb = a.amb.map((v, k) => v + (b.amb[k]! - v) * f) as [number, number, number];
  const day = a.day + (b.day - a.day) * f;
  const phase =
    hour < 6 || hour >= 21
      ? 'night'
      : hour < 10
        ? 'morning'
        : hour < 16
          ? 'day'
          : hour < 18.5
            ? 'golden'
            : 'evening';
  return { amb, day, sky: f < 0.5 ? a.sky : b.sky, phase };
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export const LIGHTMAP_SCALE = 0.5;

/**
 * Composite the light overlay (drawn with NORMAL blending, which every GPU path
 * handles cheaply): a tinted darkness layer whose alpha is the ambient shadow,
 * with each light erasing darkness inside its visibility polygon and adding a
 * faint wash of its colour.
 */
export function composite(
  canvas: HTMLCanvasElement,
  map: WorldMap,
  lights: Light[],
  hour: number,
  desks: DeskState[],
) {
  const s = LIGHTMAP_SCALE;
  canvas.width = Math.ceil(map.pxWidth * s);
  canvas.height = Math.ceil(map.pxHeight * s);
  const c = canvas.getContext('2d')!;
  const tod = timeOfDay(hour);
  const [r, g, b] = tod.amb;
  const level = (r + g + b) / 3;
  const dark = Math.max(0, Math.min(0.85, 1 - level));
  // shadow colour: deep blue at night, warm brown at golden hour
  const sr = Math.round(18 + (1 - b) * 10 + (r - b) * 60);
  const sg = Math.round(22 + (g - b) * 30);
  const sb = Math.round(48 - (r - b) * 40);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = `rgba(${Math.max(0, sr)},${Math.max(0, sg)},${Math.max(0, sb)},${dark})`;
  c.fillRect(0, 0, canvas.width, canvas.height);
  const deskMap = new Map(desks.map((d) => [d.id, d]));
  const visible: { l: Light; a: number; color: string }[] = [];
  for (const l of lights) {
    let k: number;
    let color = l.color;
    if (l.kind === 'window' || l.kind === 'sky') {
      k = tod.day;
      color = tod.sky;
    } else if (l.kind === 'portal') k = 1;
    else k = 0.35 + 0.65 * (1 - tod.day);
    if (l.kind === 'desk') {
      const d = deskMap.get(l.deskId!);
      if (!d?.ownerName) k *= 0.35;
      else color = LAMP_COLORS[d.decor.lamp] ?? color;
    }
    const a = Math.min(1, l.intensity * k);
    if (a < 0.02 || !l.poly) continue;
    visible.push({ l, a, color });
  }
  const pass = (
    op: GlobalCompositeOperation,
    fill: (v: (typeof visible)[number]) => CanvasGradient,
  ) => {
    c.globalCompositeOperation = op;
    for (const v of visible) {
      const l = v.l;
      c.save();
      c.beginPath();
      l.poly!.forEach((p, i) => (i ? c.lineTo(p.x * s, p.y * s) : c.moveTo(p.x * s, p.y * s)));
      c.closePath();
      c.clip();
      c.fillStyle = fill(v);
      c.fillRect((l.x - l.radius) * s, (l.y - l.radius) * s, l.radius * 2 * s, l.radius * 2 * s);
      c.restore();
    }
  };
  // 1) lights erase darkness
  pass('destination-out', (v) => {
    const grd = c.createRadialGradient(
      v.l.x * s,
      v.l.y * s,
      0,
      v.l.x * s,
      v.l.y * s,
      v.l.radius * s,
    );
    grd.addColorStop(0, `rgba(0,0,0,${v.a})`);
    grd.addColorStop(0.5, `rgba(0,0,0,${v.a * 0.55})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    return grd;
  });
  // 2) warm colour wash where lit (stronger at night)
  const wash = 0.1 + 0.22 * (1 - tod.day);
  pass('source-over', (v) => {
    const grd = c.createRadialGradient(
      v.l.x * s,
      v.l.y * s,
      0,
      v.l.x * s,
      v.l.y * s,
      v.l.radius * s,
    );
    grd.addColorStop(0, rgba(v.color, wash * v.a));
    grd.addColorStop(0.6, rgba(v.color, wash * v.a * 0.35));
    grd.addColorStop(1, rgba(v.color, 0));
    return grd;
  });
  c.globalCompositeOperation = 'source-over';
  return tod;
}
