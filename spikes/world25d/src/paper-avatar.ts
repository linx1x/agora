/**
 * P16.2: the new paper cut-out avatar (ADR-052), drawn in code from the same choices as today's
 * catalog (skin, hair style and colour, top, bottom, accessory), so saved avatars keep working.
 * Two looks: `pixel` (crisp, palette-snapped, 1 px white edge) and `smooth` (painted, 3 px white
 * cut-out edge). Proportions lean Paper Mario: a big head, a short body.
 */
import { ACCESSORIES, BOTTOM_COLORS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, TOP_COLORS, type Avatar } from '@agora/shared';

export type PaperDir = 'down' | 'left' | 'right' | 'up';
export type PaperLook = 'pixel' | 'smooth';

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Draw the figure (no outline) into a W×H box, in units where the box is 100 × 150. */
function figure(c: CanvasRenderingContext2D, a: Avatar, dir: PaperDir, W: number, H: number) {
  const sx = W / 100;
  const sy = H / 150;
  c.save();
  c.scale(sx, sy);
  if (dir === 'left') {
    c.translate(100, 0);
    c.scale(-1, 1);
  }
  const side = dir === 'left' || dir === 'right';
  const skin = SKIN_TONES[a.skin]!;
  const hair = HAIR_COLORS[a.hairColor]!;
  const top = TOP_COLORS[a.top]!;
  const bottom = BOTTOM_COLORS[a.bottom]!;
  const style = HAIR_STYLES[a.hair]!;
  const acc = ACCESSORIES[a.accessory]!;
  const ell = (x: number, y: number, rx: number, ry: number, col: string) => {
    c.fillStyle = col;
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
  };
  const rr = (x: number, y: number, w: number, h: number, r: number, col: string) => {
    c.fillStyle = col;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fill();
  };
  // legs and shoes
  if (side) {
    rr(40, 112, 16, 28, 5, shade(bottom, 0.8));
    rr(50, 112, 16, 28, 5, bottom);
    rr(46, 134, 26, 10, 5, '#2b2f36');
  } else {
    rr(33, 112, 15, 28, 5, bottom);
    rr(52, 112, 15, 28, 5, shade(bottom, 0.85));
    rr(29, 135, 21, 10, 5, '#2b2f36');
    rr(50, 135, 21, 10, 5, '#2b2f36');
  }
  // body (a soft trapezoid) and arms
  c.fillStyle = top;
  c.beginPath();
  if (side) c.roundRect(34, 76, 36, 42, 12);
  else c.roundRect(26, 76, 48, 42, 14);
  c.fill();
  rr(side ? 34 : 26, 104, side ? 36 : 48, 14, 6, shade(top, 0.82));
  if (side) {
    rr(48, 82, 14, 30, 7, shade(top, 0.86));
    ell(56, 112, 7, 6, skin);
  } else {
    rr(16, 80, 13, 30, 6, shade(top, 0.9));
    rr(71, 80, 13, 30, 6, shade(top, 0.9));
    ell(22, 111, 6.5, 6, skin);
    ell(78, 111, 6.5, 6, skin);
  }
  // head
  const hx = side ? 52 : 50;
  ell(hx, 44, 33, 31, skin);
  // hair
  const hc = hair;
  const hd = shade(hair, 0.8);
  if (style !== 'none') {
    if (dir === 'up') {
      ell(hx, 42, 34, 32, hc);
      if (style === 'long') rr(hx - 32, 40, 64, 40, 14, hc);
      if (style === 'bun') ell(hx, 12, 13, 11, hd);
      if (style === 'curly') for (let i = 0; i < 7; i++) ell(hx - 30 + i * 10, 20 + (i % 2) * 4, 9, 9, i % 2 ? hc : hd);
    } else {
      c.fillStyle = hc;
      c.beginPath();
      if (style === 'buzz') c.ellipse(hx, 30, 31, 18, 0, Math.PI, 0);
      else c.ellipse(hx, 32, 35, 24, 0, Math.PI, 0);
      c.fill();
      if (style === 'long') {
        rr(side ? hx - 34 : hx - 36, 30, side ? 26 : 14, 50, 8, hc);
        if (!side) rr(hx + 22, 30, 14, 50, 8, hc);
      }
      if (style === 'curly')
        for (let i = 0; i < 7; i++) ell(hx - 30 + i * 10, 22 + (i % 2) * 4, 9, 9, i % 2 ? hc : hd);
      if (style === 'bun') ell(side ? hx - 22 : hx, 8, 13, 11, hd);
      if (style === 'short' || style === 'bun') {
        // fringe
        c.fillStyle = hc;
        c.beginPath();
        c.ellipse(side ? hx + 8 : hx - 8, 30, 24, 10, -0.15, 0, Math.PI);
        c.fill();
      }
      if (side) rr(hx - 34, 26, 18, 26, 8, hc); // back of the head
    }
  }
  // face
  if (dir === 'down') {
    ell(hx - 12, 48, 4.2, 6, '#22262c');
    ell(hx + 12, 48, 4.2, 6, '#22262c');
    ell(hx - 11, 46, 1.5, 2, '#ffffff');
    ell(hx + 13, 46, 1.5, 2, '#ffffff');
    ell(hx - 22, 58, 6, 3.5, 'rgba(232,120,110,.35)');
    ell(hx + 22, 58, 6, 3.5, 'rgba(232,120,110,.35)');
    c.strokeStyle = shade(skin, 0.55);
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(hx, 56, 5, 0.2 * Math.PI, 0.8 * Math.PI);
    c.stroke();
  } else if (side) {
    ell(hx + 18, 47, 4, 6, '#22262c');
    ell(hx + 19, 45, 1.4, 2, '#ffffff');
    ell(hx + 31, 52, 4, 4, shade(skin, 0.9)); // nose
    ell(hx + 14, 58, 5, 3, 'rgba(232,120,110,.35)');
    ell(hx - 6, 48, 6, 7, shade(skin, 0.9)); // ear
  }
  // accessories
  if (acc === 'glasses' && dir !== 'up') {
    c.strokeStyle = '#1f2328';
    c.lineWidth = 3;
    c.beginPath();
    if (side) {
      c.roundRect(hx + 10, 40, 16, 13, 4);
      c.moveTo(hx + 10, 45);
      c.lineTo(hx - 6, 44);
    } else {
      c.roundRect(hx - 21, 40, 17, 14, 4);
      c.roundRect(hx + 4, 40, 17, 14, 4);
      c.moveTo(hx - 4, 46);
      c.lineTo(hx + 4, 46);
    }
    c.stroke();
  }
  if (acc === 'beanie') {
    c.fillStyle = '#b8443a';
    c.beginPath();
    c.ellipse(hx, 26, 36, 24, 0, Math.PI, 0);
    c.fill();
    rr(hx - 36, 22, 72, 10, 5, '#93352d');
    ell(hx, 2, 7, 7, '#e9e2d6');
  }
  if (acc === 'headphones') {
    c.strokeStyle = '#2b2f36';
    c.lineWidth = 6;
    c.beginPath();
    c.arc(hx, 40, 36, Math.PI * 1.05, Math.PI * 1.95);
    c.stroke();
    if (side) rr(hx - 12, 36, 14, 22, 6, '#3a7bd5');
    else {
      rr(hx - 42, 36, 12, 22, 6, '#3a7bd5');
      rr(hx + 30, 36, 12, 22, 6, '#3a7bd5');
    }
  }
  c.restore();
}

/** Pixel look: draw large, sample down with nearest, snap alpha, then a 1 px white edge. */
function pixelize(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const c = out.getContext('2d', { willReadFrequently: true })!;
  c.imageSmoothingEnabled = false;
  c.drawImage(src, 0, 0, w, h);
  const d = c.getImageData(0, 0, w, h);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i]! > 110 ? 255 : 0;
  c.putImageData(d, 0, 0);
  return out;
}

/** White cut-out edge `px` wide around the alpha shape (drawn under the figure). */
function cutout(fig: HTMLCanvasElement, px: number, pad: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = fig.width + pad * 2;
  out.height = fig.height + pad * 2;
  const c = out.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const mask = document.createElement('canvas');
  mask.width = fig.width;
  mask.height = fig.height;
  const m = mask.getContext('2d')!;
  m.drawImage(fig, 0, 0);
  m.globalCompositeOperation = 'source-in';
  m.fillStyle = '#fbfaf6';
  m.fillRect(0, 0, mask.width, mask.height);
  for (let dy = -px; dy <= px; dy++)
    for (let dx = -px; dx <= px; dx++) if (dx * dx + dy * dy <= px * px + 0.5) c.drawImage(mask, pad + dx, pad + dy);
  // a faint grey line outside the white, so the cut-out reads on pale floors
  c.globalCompositeOperation = 'destination-over';
  c.filter = 'blur(0.6px)';
  c.globalAlpha = 0.35;
  c.drawImage(out, 0, 1);
  c.globalAlpha = 1;
  c.filter = 'none';
  c.globalCompositeOperation = 'source-over';
  c.drawImage(fig, pad, pad);
  return out;
}

/**
 * One frame of the paper avatar. `w × h` is the figure size (48×64 or 64×96); the returned canvas
 * has a margin for the white edge. Smooth frames are drawn at `scale` × for crisp textures.
 */
export function paperFrame(a: Avatar, dir: PaperDir, w: number, h: number, look: PaperLook, scale = 4): HTMLCanvasElement {
  const big = document.createElement('canvas');
  const k = look === 'pixel' ? 8 : scale;
  big.width = w * k;
  big.height = h * k;
  figure(big.getContext('2d')!, a, dir, big.width, big.height);
  if (look === 'pixel') return cutout(pixelize(big, w, h), 1, 2);
  return cutout(big, Math.round(2.5 * scale), Math.round(4 * scale));
}

/** Sheet: 4 directions in a row (down, left, right, up), each cell the same size. */
export function paperSheet(a: Avatar, w: number, h: number, look: PaperLook, scale = 4): { canvas: HTMLCanvasElement; cw: number; ch: number } {
  const dirs: PaperDir[] = ['down', 'left', 'right', 'up'];
  const frames = dirs.map((d) => paperFrame(a, d, w, h, look, scale));
  const cw = frames[0]!.width;
  const ch = frames[0]!.height;
  const cv = document.createElement('canvas');
  cv.width = cw * 4;
  cv.height = ch;
  const c = cv.getContext('2d')!;
  frames.forEach((f, i) => c.drawImage(f, i * cw, 0));
  return { canvas: cv, cw, ch };
}
