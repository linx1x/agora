/** Pixel wardrobe frames retain the established sheet geometry and animation contract. */
import { type Avatar } from '@agora/shared';
import { wardrobeFrame } from '../game/wardrobeArt';
import type { AvatarMotion } from '../game/avatarMotion';
import {
  PAPER_FRAMES,
  PAPER_PAD,
  paperCell,
  paperCellSize,
  paperSheetSize,
  type PaperDir,
  type PaperPose,
  type PaperScale,
} from './paperLayout';
const DIRS: readonly PaperDir[] = ['down', 'left', 'right', 'up'];
export function paperFrame(
  a: Avatar,
  dir: PaperDir,
  pose: PaperPose,
  frame: number,
  scale: PaperScale,
): HTMLCanvasElement {
  const { cw, ch } = paperCellSize(scale);
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const art = wardrobeFrame(a, dir, pose, ((frame % PAPER_FRAMES) + PAPER_FRAMES) % PAPER_FRAMES);
  c.drawImage(art, PAPER_PAD * scale, PAPER_PAD * scale, art.width * scale, art.height * scale);
  return cv;
}

/** Whole sheet, sized `paperSheetSize(scale)`: walk rows, then crouch and sit, one column per direction. */
export function makePaperSheet(a: Avatar, scale: PaperScale): HTMLCanvasElement {
  const { width, height } = paperSheetSize(scale);
  const { cw, ch } = paperCellSize(scale);
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const c = cv.getContext('2d')!;
  const cells: Array<[PaperDir, PaperPose, number]> = [
    ...DIRS.flatMap((dir) =>
      [0, 1, 2, 3].map((f): [PaperDir, PaperPose, number] => [dir, 'walk', f]),
    ),
    ...DIRS.map((dir): [PaperDir, PaperPose, number] => [dir, 'crouch', 0]),
    ...DIRS.map((dir): [PaperDir, PaperPose, number] => [dir, 'sit', 0]),
  ];
  for (const [dir, pose, frame] of cells) {
    const { col, row } = paperCell(dir, pose, frame);
    c.drawImage(paperFrame(a, dir, pose, frame, scale), col * cw, row * ch);
  }
  return cv;
}

/** Data URL of one standing frame for the avatar editor (drawn at 2×). */
export function paperPreviewDataUrl(a: Avatar, dir: PaperDir = 'down'): string {
  return paperFrame(a, dir, 'walk', 0, 2).toDataURL();
}

/** Expanded transparent bounds fit gestures and tools without shrinking the character. */
export function paperMotionFrame(
  a: Avatar,
  dir: PaperDir,
  pose: PaperPose,
  motion: AvatarMotion,
  scale: PaperScale,
): HTMLCanvasElement {
  const art = wardrobeFrame(a, dir, pose, 0, motion);
  const cv = document.createElement('canvas');
  cv.width = (art.width + PAPER_PAD * 2) * scale;
  cv.height = (art.height + PAPER_PAD * 2) * scale;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.drawImage(art, PAPER_PAD * scale, PAPER_PAD * scale, art.width * scale, art.height * scale);
  return cv;
}
