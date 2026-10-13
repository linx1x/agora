/**
 * Layered pixel avatars and personalised desk
 * decor sprites. Avatar sheet: 32×40 frames; rows 0–3 walk (down, left, right, up)
 * × 4 frames; row 4 crouch and row 5 seated, one column per direction.
 */
import { LAMP_COLORS, POSTERS, type Avatar } from '@agora/shared';
import { DECOR_PLANTS, DECOR_SPRITES, PALETTES, rect, shade, type Ctx } from './tiles';
import { drawSprite } from './sprites';
import { wardrobeFrame } from './wardrobeArt';

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
  const art = wardrobeFrame(a, dir, pose, frame);
  c.imageSmoothingEnabled = false;
  c.drawImage(art, 0, 0, AV_W, AV_H);
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
  const sheet = document.createElement('canvas');
  sheet.width = AV_W;
  sheet.height = AV_H;
  drawAvatarFrame(sheet.getContext('2d')!, a, 'down', 0);
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
