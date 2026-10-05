/**
 * Procedural avatars (placeholder for LPC layers, ADR-011) and personalised desk
 * decor sprites. Avatar sheet: 32×40 frames; rows 0–3 walk (down, left, right, up)
 * × 4 frames; row 4 crouch and row 5 seated, one column per direction.
 */
import {
  ACCESSORIES,
  BOTTOM_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  LAMP_COLORS,
  POSTERS,
  SKIN_TONES,
  TOP_COLORS,
  type Avatar,
} from '@agora/shared';
import { DECOR_PLANTS, DECOR_SPRITES, PALETTES, rect, shade, type Ctx } from './tiles';
import { drawSprite } from './sprites';

export const AV_W = 32;
export const AV_H = 40;
export const AV_FRAMES = 4;
export const DIR_ROW = { down: 0, left: 1, right: 2, up: 3 } as const;

function drawAvatarFrame(
  c: Ctx,
  a: Avatar,
  dir: keyof typeof DIR_ROW,
  frame: number,
  pose: 'walk' | 'crouch' | 'sit' = 'walk',
) {
  const skin = SKIN_TONES[a.skin]!;
  const hairCol = HAIR_COLORS[a.hairColor]!;
  const top = TOP_COLORS[a.top]!;
  const bottom = BOTTOM_COLORS[a.bottom]!;
  const style = HAIR_STYLES[a.hair]!;
  const acc = ACCESSORIES[a.accessory]!;
  const side = dir === 'left' || dir === 'right';
  const flip = dir === 'left';
  const X = (x: number, w = 1) => (flip ? AV_W - x - w : x);
  const R = (x: number, y: number, w: number, h: number, col: string) =>
    rect(c, X(x, w), y, w, h, col);
  // walk cycle: 0 stand, 1 left step, 2 stand, 3 right step
  const stepL = frame === 1 ? -2 : frame === 3 ? 1 : 0;
  const stepR = frame === 3 ? -2 : frame === 1 ? 1 : 0;
  const low = pose === 'sit' ? 5 : pose === 'crouch' ? 3 : 0;
  const bob = (frame === 1 || frame === 3 ? -1 : 0) + low;

  // shadow
  c.fillStyle = 'rgba(16,24,32,0.28)';
  c.beginPath();
  c.ellipse(16, 38, 9, 3, 0, 0, Math.PI * 2);
  c.fill();

  // legs + shoes
  if (pose === 'sit') {
    if (dir === 'down') {
      R(11, 31, 4, 4, bottom);
      R(17, 31, 4, 4, bottom);
      R(11, 35, 4, 2, '#22262b');
      R(17, 35, 4, 2, '#22262b');
    } else if (side) {
      R(14, 31, 9, 4, bottom);
      R(20, 33, 4, 4, shade(bottom, -0.05));
      R(20, 36, 6, 2, '#22262b');
    }
  } else {
    const k = low;
    if (side) {
      R(13, 30 + bob, 4, 6 + stepL - k, shade(bottom, -0.05));
      R(16, 30 + bob, 4, 6 + stepR - k, bottom);
      R(13, 35 + bob + stepL - k, 5, 2, '#22262b');
      R(16, 35 + bob + stepR - k, 6, 2, '#2b3036');
    } else {
      R(11, 30 + bob, 4, 6 + stepL - k, bottom);
      R(17, 30 + bob, 4, 6 + stepR - k, bottom);
      R(11, 35 + bob + stepL - k, 4, 2, '#22262b');
      R(17, 35 + bob + stepR - k, 4, 2, '#22262b');
    }
  }
  // torso
  const ty = 20 + bob;
  R(10, ty, 12, 11, top);
  R(10, ty, 12, 2, shade(top, 0.08));
  R(10, ty + 9, 12, 2, shade(top, -0.1));
  // arms
  if (side) {
    const swing = pose !== 'walk' ? 0 : frame === 1 ? -1 : frame === 3 ? 1 : 0;
    R(14 + swing, ty + 1, 4, 8, shade(top, -0.08));
    R(14 + swing, ty + 9, 4, 2, skin);
  } else {
    const sw = pose !== 'walk' ? 0 : frame === 1 ? 1 : frame === 3 ? -1 : 0;
    R(7, ty + 1 + sw, 3, 8, shade(top, -0.08));
    R(22, ty + 1 - sw, 3, 8, shade(top, -0.08));
    R(7, ty + 9 + sw, 3, 2, skin);
    R(22, ty + 9 - sw, 3, 2, skin);
  }
  // head
  const hy = 7 + bob;
  R(9, hy + 1, 14, 12, skin);
  R(10, hy, 12, 14, skin);
  R(10, hy + 12, 12, 1, shade(skin, -0.08));
  // face
  if (dir === 'down') {
    R(12, hy + 7, 2, 2, '#1d2228');
    R(18, hy + 7, 2, 2, '#1d2228');
    R(14, hy + 10, 4, 1, shade(skin, -0.2));
  } else if (side) {
    R(18, hy + 7, 2, 2, '#1d2228');
    R(21, hy + 8, 2, 2, shade(skin, -0.06));
  }
  // hair
  const H = (x: number, y: number, w: number, h: number) => R(x, hy + y, w, h, hairCol);
  const Hd = (x: number, y: number, w: number, h: number) =>
    R(x, hy + y, w, h, shade(hairCol, -0.08));
  if (style !== 'none') {
    if (style === 'buzz') {
      H(10, -1, 12, 3);
      if (dir === 'up') H(9, 1, 14, 6);
      else {
        H(9, 1, 2, 3);
        H(21, 1, 2, 3);
      }
    } else {
      H(10, -2, 12, 3);
      H(9, 0, 14, 4);
      if (dir === 'up') H(9, 2, 14, 9);
      else if (side) {
        H(9, 3, 7, 4);
        H(9, 3, 3, 7);
      } else {
        H(9, 3, 2, 4);
        H(21, 3, 2, 4);
        H(11, 3, 5, 2);
      }
      if (style === 'long') {
        if (dir === 'up') H(9, 2, 14, 16);
        else if (side) H(9, 3, 4, 15);
        else {
          H(8, 3, 3, 14);
          H(21, 3, 3, 14);
        }
      }
      if (style === 'bun') {
        H(13, -6, 6, 5);
        Hd(14, -5, 4, 1);
      }
      if (style === 'curly') {
        for (const [x, y] of [
          [8, -1],
          [12, -3],
          [16, -3],
          [20, -1],
          [8, 4],
          [22, 4],
        ] as const)
          H(x, y, 3, 3);
        Hd(11, -1, 2, 1);
        Hd(18, -1, 2, 1);
      }
    }
  }
  // accessories
  if (acc === 'glasses' && dir !== 'up') {
    if (side) {
      R(17, hy + 6, 5, 4, '#1d2228');
      R(18, hy + 7, 3, 2, '#9fd0ee');
      R(12, hy + 7, 5, 1, '#1d2228');
    } else {
      R(11, hy + 6, 4, 4, '#1d2228');
      R(17, hy + 6, 4, 4, '#1d2228');
      R(12, hy + 7, 2, 2, '#9fd0ee');
      R(18, hy + 7, 2, 2, '#9fd0ee');
      R(15, hy + 7, 2, 1, '#1d2228');
    }
  } else if (acc === 'beanie') {
    R(9, hy - 3, 14, 6, '#c2364b');
    R(9, hy + 2, 14, 2, '#9e2a3c');
    R(14, hy - 5, 4, 2, '#f3f6f8');
  } else if (acc === 'headphones') {
    R(9, hy - 3, 14, 2, '#2b333b');
    if (side) R(13, hy + 4, 4, 6, '#2b333b');
    else {
      R(7, hy + 4, 3, 6, '#2b333b');
      R(22, hy + 4, 3, 6, '#2b333b');
    }
  }
}

export function makeAvatarCanvas(a: Avatar): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = AV_W * AV_FRAMES;
  cv.height = AV_H * 6;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const cellDraw = (col: number, row: number, fn: () => void) => {
    c.save();
    c.translate(col * AV_W, row * AV_H);
    c.beginPath();
    c.rect(0, 0, AV_W, AV_H);
    c.clip();
    fn();
    c.restore();
  };
  for (const [dir, row] of Object.entries(DIR_ROW) as [keyof typeof DIR_ROW, number][]) {
    for (let f = 0; f < AV_FRAMES; f++) cellDraw(f, row, () => drawAvatarFrame(c, a, dir, f));
    // row 4: crouch (sit-down / stand-up transition), row 5: seated — one column per direction
    cellDraw(row, 4, () => drawAvatarFrame(c, a, dir, 0, 'crouch'));
    cellDraw(row, 5, () => drawAvatarFrame(c, a, dir, 0, 'sit'));
  }
  return cv;
}

/** Single front-facing frame, scaled, for the avatar editor and presence list. */
export function avatarPreviewDataUrl(a: Avatar, scale = 3): string {
  const sheet = makeAvatarCanvas(a);
  const cv = document.createElement('canvas');
  cv.width = AV_W * scale;
  cv.height = AV_H * scale;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.drawImage(sheet, 0, 0, AV_W, AV_H, 0, 0, AV_W * scale, AV_H * scale);
  return cv.toDataURL();
}

const urlCache = new Map<string, string>();
/** Cached preview data-URL (avatars are re-rendered often in React lists). */
export function avatarUrl(a: Avatar, scale = 1): string {
  const k = `${JSON.stringify(a)}@${scale}`;
  let u = urlCache.get(k);
  if (!u) {
    u = avatarPreviewDataUrl(a, scale);
    urlCache.set(k, u);
  }
  return u;
}

/** Desk decor sheet: row 0 plants (32×40), row 1 desk lamps (by colour), row 2 poster easels. */
export const DECOR_W = 32;
export const DECOR_H = 40;
export function makeDecorCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = DECOR_W * 6;
  cv.height = DECOR_H * 3;
  const c = cv.getContext('2d')!;
  const at = (col: number, row: number, fn: () => void) => {
    c.save();
    c.translate(col * DECOR_W, row * DECOR_H + 8);
    fn();
    c.restore();
  };
  DECOR_PLANTS.forEach((p, i) =>
    at(i, 0, () => drawSprite(c, DECOR_SPRITES[i]!) || p(c, PALETTES.jungle, i)),
  );
  LAMP_COLORS.forEach((col, i) =>
    at(i, 1, () => {
      // desk lamp: base, arm, shade glowing in the chosen colour
      rect(c, 8, 24, 10, 3, '#2b2b2b');
      rect(c, 12, 12, 2, 12, '#3a3f45');
      rect(c, 12, 12, 10, 2, '#3a3f45');
      c.fillStyle = '#2b2b2b';
      c.beginPath();
      c.moveTo(18, 10);
      c.lineTo(28, 10);
      c.lineTo(30, 18);
      c.lineTo(16, 18);
      c.fill();
      rect(c, 17, 17, 12, 2, col);
      c.fillStyle = col + '66';
      c.beginPath();
      c.moveTo(17, 19);
      c.lineTo(29, 19);
      c.lineTo(31, 26);
      c.lineTo(15, 26);
      c.fill();
    }),
  );
  POSTERS.forEach((name, i) =>
    at(i, 2, () => {
      rect(c, 8, 26, 2, 6, '#5a3a22');
      rect(c, 22, 26, 2, 6, '#5a3a22');
      rect(c, 6, 0, 20, 27, '#5a3a22');
      rect(c, 8, 2, 16, 22, '#f3f6f8');
      const art: Record<string, () => void> = {
        mountains: () => {
          rect(c, 8, 2, 16, 22, '#bcd6ea');
          c.fillStyle = '#4a5866';
          c.beginPath();
          c.moveTo(8, 24);
          c.lineTo(14, 10);
          c.lineTo(18, 16);
          c.lineTo(21, 12);
          c.lineTo(24, 24);
          c.fill();
          rect(c, 13, 10, 2, 2, '#ffffff');
        },
        waves: () => {
          rect(c, 8, 2, 16, 22, '#e6f2f7');
          for (let y = 8; y < 24; y += 5) rect(c, 8, y, 16, 3, y % 2 ? '#3d6fb6' : '#5fa3c4');
        },
        sun: () => {
          rect(c, 8, 2, 16, 22, '#f7e3c4');
          c.fillStyle = '#f2a900';
          c.beginPath();
          c.arc(16, 13, 5, 0, Math.PI * 2);
          c.fill();
          rect(c, 8, 18, 16, 6, '#c2364b');
        },
        aurora: () => {
          rect(c, 8, 2, 16, 22, '#12202e');
          rect(c, 8, 8, 16, 3, '#5fd3c6');
          rect(c, 10, 12, 12, 2, '#a6e36b');
          rect(c, 8, 20, 16, 4, '#1f3f30');
        },
        leaf: () => {
          rect(c, 8, 2, 16, 22, '#eef5ea');
          c.fillStyle = '#2f7d5b';
          c.beginPath();
          c.ellipse(16, 13, 5, 9, 0.4, 0, Math.PI * 2);
          c.fill();
          rect(c, 15, 6, 1, 15, '#21573f');
        },
        city: () => {
          rect(c, 8, 2, 16, 22, '#24476b');
          for (const [x, h] of [
            [9, 10],
            [12, 15],
            [16, 8],
            [19, 13],
            [22, 6],
          ] as const)
            rect(c, x, 24 - h, 3, h, '#0f2236');
          rect(c, 13, 12, 1, 1, '#f2a900');
          rect(c, 20, 14, 1, 1, '#f2a900');
        },
      };
      art[name]!();
    }),
  );
  return cv;
}

/** Soft radial glow (white) used for additive lamp halos, tinted per light. */
export function makeGlowCanvas(size = 128): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  return cv;
}

/** Preview data-URL of a decor frame (desk personalisation dialog). */
export function decorPreview(row: number, col: number, scale = 2): string {
  const sheet = makeDecorCanvas();
  const cv = document.createElement('canvas');
  cv.width = DECOR_W * scale;
  cv.height = DECOR_H * scale;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.drawImage(
    sheet,
    col * DECOR_W,
    row * DECOR_H,
    DECOR_W,
    DECOR_H,
    0,
    0,
    DECOR_W * scale,
    DECOR_H * scale,
  );
  return cv.toDataURL();
}
export { shade };
