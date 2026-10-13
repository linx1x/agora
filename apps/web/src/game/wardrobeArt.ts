/** Layered woodland pixel artwork, shared by world cards, portraits and the wardrobe.
 * All coordinates are on a 64×96 grid. Materials use a warm highlight and a dark
 * contour; nearest sampling preserves the same pixel scale as the world artwork.
 */
import {
  ACCESSORIES,
  BOTTOM_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  SHOE_COLORS,
  SKIN_TONES,
  TOP_COLORS,
  VEST_COLORS,
  wardrobe,
  type Avatar,
} from '@agora/shared';

import { motionPose, type AvatarMotion } from './avatarMotion';
import { drawTool, toolGrip } from '../worlds/tools/toolArtwork';
export const MOTION_PAD_X = 32;
export const MOTION_PAD_TOP = 16;

type Dir = 'down' | 'left' | 'right' | 'up';
type Pose = 'walk' | 'crouch' | 'sit';
type Point = readonly [number, number];
const INK = '#302b2b';
const LINEN = '#e4d3a5';
const GOLD = '#c39a50';

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `#${[n >> 16, (n >> 8) & 255, n & 255]
    .map((v) =>
      Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** A complete frame with a stable foot anchor, including crouching and sitting. */
export function wardrobeFrame(
  avatar: Avatar,
  dir: Dir,
  pose: Pose,
  frame: number,
  motion?: AvatarMotion,
): HTMLCanvasElement {
  const a = wardrobe(avatar);
  const cv = document.createElement('canvas');
  cv.width = 64 + (motion ? MOTION_PAD_X * 2 : 0);
  cv.height = 96 + (motion ? MOTION_PAD_TOP : 0);
  const c = cv.getContext('2d')!;
  if (motion) c.translate(MOTION_PAD_X, MOTION_PAD_TOP);
  const motionState = motionPose(motion, dir);
  let waterSpout: Point | undefined;
  const side = dir === 'left' || dir === 'right',
    back = dir === 'up';
  if (dir === 'left') {
    c.translate(64, 0);
    c.scale(-1, 1);
  }
  const step = pose === 'walk' ? (frame === 1 ? -1 : frame === 3 ? 1 : 0) : 0;
  const drop = (pose === 'sit' ? 9 : pose === 'crouch' ? 6 : step ? -1 : 0) + motionState.drop;
  const skin = SKIN_TONES[a.skin]!,
    hair = HAIR_COLORS[a.hairColor]!;
  const top = TOP_COLORS[a.top]!,
    bottom = BOTTOM_COLORS[a.bottom]!;
  const shoe = SHOE_COLORS[a.shoeColor]!,
    vest = VEST_COLORS[a.vestColor]!;
  const style = HAIR_STYLES[a.hair]!,
    acc = ACCESSORIES[a.accessory]!;
  const bodyWidth = a.gender === 1 ? 12 : a.gender === 2 ? 15 : 14;
  const bx = side ? 24 : 32 - bodyWidth,
    bw = side ? 18 : bodyWidth * 2;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const path = (points: readonly Point[]) => {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
  };
  const poly = (points: readonly Point[], color: string) => {
    path(points);
    c.fillStyle = color;
    c.fill();
  };
  // A restrained three-tone material ramp, with a one-pixel outline and woven highlights.
  const material = (points: readonly Point[], color: string, grain = false) => {
    c.save();
    path(points);
    c.fillStyle = color;
    c.fill();
    c.clip();
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    const x = Math.min(...xs),
      y = Math.min(...ys),
      w = Math.max(...xs) - x,
      h = Math.max(...ys) - y;
    rect(x, y, w, 2, shade(color, 0.25));
    rect(x, y + 2, 2, h - 2, shade(color, 0.15));
    rect(x + w - 3, y + 2, 3, h, shade(color, -0.25));
    rect(x, y + h - 2, w, 2, shade(color, -0.28));
    if (grain)
      for (let yy = y + 4; yy < y + h - 2; yy += 4)
        for (let xx = x + 3 + (yy % 3); xx < x + w - 2; xx += 7)
          rect(xx, yy, 2, 1, shade(color, (xx + yy) % 2 ? 0.12 : -0.12));
    c.restore();
    path(points);
    c.lineWidth = 1;
    c.strokeStyle = shade(color, -0.55);
    c.stroke();
  };
  const box = (x: number, y: number, w: number, h: number, color: string, grain = false) =>
    material(
      [
        [x + 2, y],
        [x + w - 2, y],
        [x + w, y + 2],
        [x + w, y + h - 1],
        [x + w - 2, y + h],
        [x + 1, y + h],
        [x, y + h - 2],
        [x, y + 2],
      ],
      color,
      grain,
    );

  // Two-joint arms carry the sleeve, cuff, hand and held object as one layer.
  const drawArm = (x: number, phase: number, near: boolean) => {
    const y = 43 + (side ? 0 : phase),
      reach = side ? phase * 3 : 0;
    let angle = motion
      ? near
        ? motionState.right
        : motionState.left
      : side
        ? phase * 0.22
        : phase * 0.12;
    if (
      side &&
      motion &&
      ['eat', 'clap', 'heart', 'take', 'collect', 'stash', 'ship', 'place', 'buy'].includes(
        motion.clip,
      )
    )
      angle = -Math.abs(angle);
    // Separate the palms in profile, then bring them together at the contact pose.
    if (side && near && motion?.clip === 'clap' && (motion.frame === 1 || motion.frame === 3))
      angle = -1.15;
    const elbow =
      !side && near && (motion?.clip === 'eat' || motion?.clip === 'clap')
        ? -motionState.elbow
        : motionState.elbow;
    c.save();
    c.translate(x + reach + 4, y);
    c.rotate(angle);
    const len = a.topStyle === 1 ? 9 : 17;
    box(-4, 0, 8, 12, skin);
    box(-4, 0, 8, Math.min(len, 12), top, true);
    c.translate(0, 10);
    c.rotate(elbow);
    box(-4, 0, 8, 11, skin);
    if (len > 12) box(-4, 0, 8, len - 10, top, true);
    rect(-3, len - 12, 6, 2, shade(top, 0.3));
    if (near && motion) {
      c.save();
      c.translate(0, 9);
      c.rotate(-angle - elbow);
      const f = motion.frame;
      if (motionState.tool) {
        c.rotate(motionState.toolAngle);
        // A longer north-facing silhouette keeps contact readable above the rear head layer.
        const toolScale = back && f >= 3 && f <= 4 && motionState.tool !== 'can' ? 1.1 : 0.8;
        c.scale(toolScale, toolScale);
        const [gripX, gripY] = toolGrip(motionState.tool);
        c.translate(-gripX, -gripY);
        drawTool(
          c,
          motionState.tool,
          motion.tier === 3 ? '#91d5d3' : motion.tier === 2 ? '#bfc6bc' : '#b89a69',
        );
        if (motionState.tool === 'can' && f === 3 && !back) {
          const transform = c.getTransform();
          waterSpout = [
            transform.a * 30 + transform.c * 10 + transform.e,
            transform.b * 30 + transform.d * 10 + transform.f,
          ];
        }
      } else if (motionState.prop === 'food') {
        box(-3, -5, 8, 7, '#cba05e');
        rect(-2, -4, 5, 1, LINEN);
      } else if (motionState.prop === 'hammer') {
        rect(-1, -14, 3, 17, '#a17449');
        box(-6, -17, 13, 6, '#9bada4');
      } else if (motionState.prop === 'coin') {
        box(-4, -5, 8, 8, GOLD);
        rect(-1, -4, 2, 6, LINEN);
      } else if (motionState.prop === 'crop') {
        box(-4, -5, 8, 9, '#ca7654');
        rect(-1, -10, 2, 5, '#6f9959');
        poly(
          [
            [-1, -7],
            [-6, -12],
            [-1, -10],
            [4, -13],
            [3, -8],
          ],
          '#6f9959',
        );
      } else if (motionState.prop === 'seeds') {
        box(-4, -4, 8, 9, '#c4a77b');
        rect(-2, -1, 4, 2, '#628154');
        if (f === 3) for (let n = 0; n < 4; n++) rect(5 + n * 3, 8 + n * 3, 2, 2, '#d4b172');
      } else if (motionState.prop === 'parcel') {
        box(-8, -10, 16, 13, '#ad8051', true);
        rect(-1, -9, 2, 11, LINEN);
      }
      c.restore();
    }
    // A small rounded grip over the handle.
    box(-3, 7, 6, 5, skin);
    if (near && motion?.clip === 'thumbs' && motion.frame > 0 && motion.frame < 5)
      rect(-3, 3, 2, 6, skin);
    c.restore();
  };
  const bend = motionState.bend * (side ? 1 : back ? -0.35 : 0.35);
  const bodyTransform = () => {
    c.translate(Math.round(motionState.lean), drop);
    c.translate(32, 66);
    c.rotate(bend);
    c.scale(1, motionState.torsoScale);
    c.translate(-32, -66);
  };
  const rearArms = () => {
    if (motion?.clip === 'clap' && !back) return;
    if (side) drawArm(25, -step, false);
    else drawArm(bx - 5, step, false);
    if (back) drawArm(bx + bw - 3, -step, true);
  };
  const frontArm = () => {
    // Both clapping hands pass in front of the chest when viewed from the front/side.
    if (motion?.clip === 'clap' && !back) drawArm(side ? 25 : bx - 5, side ? -step : step, false);
    if (!back) drawArm(side ? 27 : bx + bw - 3, -step, true);
  };

  // Cape is behind the moving limbs. Costume pieces layer over the chosen wardrobe.
  c.save();
  bodyTransform();
  if (a.costume === 2 || a.costume === 3) {
    material(
      [
        [23, 39],
        [40, 39],
        [46, 77],
        [36, 80],
        [21, 77],
        [18, 75],
      ],
      a.costume === 2 ? '#4d6942' : '#65547e',
      true,
    );
    if (back) {
      rect(30, 45, 2, 25, shade(a.costume === 2 ? '#4d6942' : '#65547e', -0.25));
      rect(24, 74, 16, 2, GOLD);
    }
  }
  c.restore();
  // Trousers, bare calves, shoes and soles follow each individual foot.
  const feet = side ? [27, 36] : [25, 38];
  for (let i = 0; i < 2; i++) {
    const swing = i === 0 ? step : -step;
    const x =
        feet[i]! +
        (i === 0 ? -motionState.stance : motionState.stance) +
        (side ? swing * 3 + (pose === 'sit' ? 5 : pose === 'crouch' ? 2 : 0) : 0),
      lift = swing < 0 ? 3 : 0;
    const legTop = 65 + drop,
      ankle = 88 - lift;
    const legColor = a.bottomStyle === 1 || a.bottomStyle === 2 ? skin : bottom;
    if (motion && motionState.knee > 0) {
      const hip = feet[i]! + Math.round(motionState.lean);
      const kneeX = x + motionState.knee * (side ? 1 : i === 0 ? -0.6 : 0.6);
      const kneeY = legTop + (ankle - legTop) * 0.52;
      material(
        [
          [hip - 4, legTop],
          [hip + 5, legTop],
          [kneeX + 5, kneeY],
          [x + 5, ankle],
          [x - 4, ankle],
          [kneeX - 4, kneeY],
        ],
        i === 0 && side ? shade(legColor, -0.15) : legColor,
        true,
      );
      rect(kneeX - 3, kneeY, 6, 1, shade(legColor, -0.22));
    } else
      box(
        x - 4,
        legTop,
        9,
        ankle - legTop,
        i === 0 && side ? shade(legColor, -0.15) : legColor,
        true,
      );
    if (side && pose !== 'walk') box(x - 9, legTop - 1, 13, 7, bottom);
    if (a.bottomStyle === 1) box(x - 5, legTop, 10, 9, bottom);
    if (pose === 'sit') rect(x - 3, legTop + 2, 6, 2, shade(bottom, 0.2));
    const bootHeight = a.shoes === 3 ? 11 : a.shoes === 0 ? 7 : 4;
    const shoeWidth = side ? 10 : 9;
    box(x - 4, ankle - bootHeight + 4, shoeWidth, bootHeight, a.shoes === 2 ? skin : shoe);
    rect(x - 4, ankle + 4, shoeWidth, 1, INK);
    if (a.shoes === 1) {
      rect(x - 4, ankle + 3, shoeWidth, 1, LINEN);
      rect(x - 1, ankle, 4, 1, LINEN);
    } else if (a.shoes === 2) {
      rect(x - 3, ankle, 7, 2, shoe);
      rect(x - 3, ankle - 2, 2, 5, shoe);
    } else {
      rect(x - 2, ankle - 1, 4, 1, shade(shoe, 0.35));
      rect(x - 2, ankle + 1, 4, 1, shade(shoe, 0.25));
    }
  }
  c.save();
  bodyTransform();
  rearArms();
  if (a.bottomStyle === 2) {
    material(
      [
        [22, 63],
        [42, 63],
        [46, 79],
        [18, 79],
      ],
      bottom,
      true,
    );
    rect(26, 66, 1, 12, shade(bottom, -0.25));
    rect(36, 66, 1, 12, shade(bottom, -0.25));
    rect(20, 77, 24, 1, shade(bottom, 0.25));
  }
  material(
    [
      [bx + 4, 40],
      [bx + bw - 4, 40],
      [bx + bw, 44],
      [bx + bw - 2, 56],
      [bx + bw - 1, 69],
      [bx + 1, 69],
      [bx + 2, 56],
      [bx, 44],
    ],
    top,
    true,
  );
  rect(bx + 4, 49, 2, 11, shade(top, 0.13));
  rect(bx + bw - 5, 52, 2, 10, shade(top, -0.15));
  if (a.topStyle === 3) {
    box(bx - 1, 62, bw + 2, 11, top, true);
    rect(bx + 1, 70, bw - 2, 1, GOLD);
  }
  if (a.topStyle === 2) {
    rect(bx + 1, 63, bw - 2, 3, shade(top, -0.2));
    rect(bx + 3, 64, bw - 6, 1, shade(top, 0.2));
  }
  // Neck and collar: clothes tuck below the head instead of cutting across its outline.
  box(side ? 31 : 28, 37, 8, 7, skin);
  if (!back && a.topStyle === 0) {
    poly(
      [
        [side ? 30 : 25, 41],
        [32, 44],
        [30, 49],
        [side ? 27 : 22, 43],
      ],
      LINEN,
    );
    poly(
      [
        [34, 44],
        [40, 41],
        [42, 44],
        [35, 49],
      ],
      shade(LINEN, -0.15),
    );
    rect(side ? 37 : 32, 49, 1, 16, shade(top, -0.35));
    for (let y = 51; y < 64; y += 5) rect(side ? 38 : 33, y, 1, 1, GOLD);
  }
  if (a.vest) {
    const color = a.vest === 3 ? shade(vest, 0.1) : vest;
    if (back) box(bx, 42, bw, 24, color, true);
    else {
      material(
        [
          [bx, 42],
          [bx + 6, 42],
          [32, 53],
          [30, 65],
          [bx, 66],
        ],
        color,
        true,
      );
      material(
        [
          [bx + bw - 6, 42],
          [bx + bw, 42],
          [bx + bw, 66],
          [34, 65],
          [33, 53],
        ],
        color,
        true,
      );
      if (a.vest === 2) {
        box(bx + 1, 56, 7, 6, shade(vest, 0.1));
        box(bx + bw - 8, 56, 7, 6, shade(vest, 0.1));
      }
      if (a.vest === 1) for (let y = 53; y < 65; y += 4) rect(32, y, 2, 1, GOLD);
      if (a.vest === 3) for (let y = 50; y < 65; y += 3) rect(bx + 2, y, 4, 1, shade(vest, 0.3));
    }
  }
  if (a.costume === 1 || a.costume === 4) {
    const apron = a.costume === 1 ? '#b6a079' : '#9b6b47';
    if (!back) {
      box(side ? 32 : 24, 48, side ? 9 : 17, 25, apron, true);
      rect(28, 58, 9, 7, shade(apron, -0.2));
      rect(29, 58, 7, 1, shade(apron, 0.3));
    }
    rect(bx, 61, bw, 2, shade(apron, -0.25));
    rect(side ? 32 : 25, 42, 2, 14, apron);
    if (!side) rect(38, 42, 2, 14, apron);
  }
  if (a.costume === 2 && !back) {
    poly(
      [
        [bx + 2, 42],
        [bx + 5, 41],
        [bx + bw - 1, 65],
        [bx + bw - 4, 67],
      ],
      '#785236',
    );
    box(bx + bw - 6, 60, 8, 11, '#735039');
    rect(bx + bw - 4, 62, 3, 2, GOLD);
  }
  // Buckle remains independently usable: selecting one also supplies its leather strap.
  if (a.belt || a.buckle) {
    const color = a.belt === 2 ? '#a65345' : '#66442e';
    rect(bx, 65, bw, a.belt === 2 ? 4 : 3, color);
    rect(bx, 65, bw, 1, shade(color, 0.3));
    if (a.belt === 2)
      poly(
        [
          [bx + bw - 5, 66],
          [bx + bw, 66],
          [bx + bw + 1, 77],
          [bx + bw - 4, 74],
        ],
        color,
      );
    if (a.buckle && !back) {
      const color = a.buckle === 2 ? '#bcc9c9' : a.buckle === 3 ? '#90ad60' : GOLD;
      const x = side ? 39 : 30;
      box(x, 64, 5, 5, color);
      rect(x + 1, 65, 3, 2, '#66442e');
      rect(x + 2, 65, 1, 3, color);
    }
  }
  if (back && (a.costume === 2 || a.costume === 3)) {
    const cape = a.costume === 2 ? '#4d6942' : '#65547e';
    material(
      [
        [22, 40],
        [42, 40],
        [44, 75],
        [36, 79],
        [20, 76],
      ],
      cape,
      true,
    );
    poly(
      [
        [26, 44],
        [29, 47],
        [27, 73],
        [24, 74],
      ],
      shade(cape, 0.12),
    );
    poly(
      [
        [35, 45],
        [38, 44],
        [41, 73],
        [38, 76],
      ],
      shade(cape, -0.2),
    );
    rect(22, 75, 18, 1, GOLD);
  }
  // The head has its own anchor and counter-rotation; every face/hair/hat layer follows it.
  c.save();
  c.translate(32 + motionState.headX, 39 + motionState.headY);
  c.rotate(-bend * 0.65 + motionState.nod);
  c.translate(-32, -39);
  // Longer hairstyles have a rear layer that remains visible beyond the jaw.
  const long = style === 'long' || style === 'braids' || style === 'ponytail';
  if (long) {
    if (side) box(17, 20, 10, style === 'ponytail' ? 29 : 27, hair, true);
    else if (back) box(18, 20, 28, 30, hair, true);
    else {
      box(16, 23, 7, 27, hair, true);
      box(41, 23, 7, 27, hair, true);
    }
    if (style === 'braids')
      for (let y = 32; y < 51; y += 4) {
        rect(18, y, 4, 1, shade(hair, 0.3));
        rect(43, y, 4, 1, shade(hair, 0.3));
      }
    if (style === 'ponytail') rect(side ? 18 : 42, 27, 6, 2, '#ac5546');
  }
  const hx = side ? 33 : 32;
  material(
    [
      [hx - 11, 14],
      [hx + 8, 14],
      [hx + 13, 20],
      [hx + 13, 32],
      [hx + 8, 39],
      [hx - 5, 40],
      [hx - 12, 34],
      [hx - 14, 23],
    ],
    skin,
  );
  box(side ? 20 : 16, 26, 5, 8, skin);
  if (!side) box(43, 26, 5, 8, skin);
  rect(hx - 8, 34, 15, 2, shade(skin, -0.1));
  if (!back) {
    for (const x of side ? [42] : [25, 37]) {
      rect(x - 1, 25, 5, 1, shade(hair, -0.2));
      if (motionState.blink) rect(x, 30, 4, 1, INK);
      else {
        rect(x, 27, 4, 5, INK);
        rect(x, 27, 1, 2, LINEN);
        rect(x + 1, 31, 2, 1, '#755746');
      }
      if (a.gender === 1) rect(x - 1, 27, 1, 2, INK);
    }
    if (side) {
      rect(45, 29, 2, 4, shade(skin, 0.15));
      rect(42, 35, 3, motionState.mouth ? 3 : 1, shade(skin, -0.4));
    } else {
      rect(32, 31, 2, 2, shade(skin, -0.18));
      rect(30, 36, 4, motionState.mouth ? 3 : 1, shade(skin, -0.4));
      rect(22, 33, 4, 1, shade(skin, -0.1));
    }
  }
  const coveredHair = acc === 'beanie' || acc === 'strawHat' || a.costume === 3;
  c.save();
  if (coveredHair) {
    c.beginPath();
    c.rect(0, 21, 64, 75);
    c.clip();
  }
  // Hair clumps follow a consistent light source, with individually placed highlight strands.
  if (style !== 'none') {
    if (style === 'buzz') {
      material(
        [
          [19, 17],
          [24, 12],
          [39, 12],
          [45, 18],
          [44, 23],
          [20, 22],
        ],
        hair,
        true,
      );
      if (back) box(19, 19, 26, 14, hair, true);
    } else {
      material(
        [
          [17, 22],
          [18, 15],
          [23, 11],
          [22, 8],
          [30, 10],
          [36, 7],
          [42, 12],
          [47, 15],
          [46, 25],
          [42, 29],
          [40, 21],
          [34, 20],
          [29, 25],
          [24, 24],
          [22, 30],
          [18, 28],
        ],
        hair,
        true,
      );
      if (back)
        material(
          [
            [18, 20],
            [46, 20],
            [44, 33],
            [39, 38],
            [26, 38],
            [20, 33],
          ],
          hair,
          true,
        );
      else if (side) box(18, 20, 10, 13, hair, true);
      poly(
        [
          [21, 17],
          [26, 13],
          [33, 12],
          [29, 15],
          [25, 16],
          [23, 20],
        ],
        shade(hair, 0.27),
      );
      poly(
        [
          [33, 11],
          [38, 12],
          [42, 17],
          [37, 15],
        ],
        shade(hair, 0.18),
      );
      rect(20, 22, 2, 4, shade(hair, 0.12));
      if (style === 'bob') {
        box(17, 22, 7, 16, hair, true);
        box(41, 22, 6, 16, hair, true);
      }
      if (style === 'bun') {
        box(side ? 16 : 26, 4, 13, 11, hair, true);
        rect(side ? 20 : 30, 13, 7, 2, GOLD);
      }
      if (style === 'curly')
        for (const [x, y] of [
          [18, 14],
          [23, 9],
          [31, 8],
          [39, 11],
          [43, 18],
          [18, 23],
        ] as const)
          box(x, y, 7, 7, hair, true);
      if (style === 'mohawk') {
        rect(18, 20, 7, 4, skin);
        rect(40, 20, 6, 4, skin);
        material(
          [
            [28, 22],
            [27, 10],
            [31, 3],
            [36, 5],
            [38, 20],
          ],
          hair,
          true,
        );
      }
    }
  }
  c.restore();
  // Hats and face accessories are deliberately separate from hairstyles.
  if (acc === 'glasses' && !back) {
    for (const x of side ? [37] : [22, 35]) {
      rect(x, 26, 9, 7, INK);
      rect(x + 1, 27, 7, 4, '#829b9b');
      rect(x + 2, 27, 2, 2, '#d4dfca');
    }
    rect(side ? 27 : 31, 28, side ? 10 : 4, 1, INK);
  }
  if (acc === 'beanie') {
    box(18, 8, 28, 13, '#9d4b42', true);
    rect(17, 18, 30, 4, '#773a36');
    box(28, 4, 7, 5, LINEN);
  }
  if (acc === 'strawHat') {
    box(21, 6, 22, 14, '#ba9454', true);
    rect(21, 17, 22, 3, '#805238');
    box(12, 20, 41, 4, '#d0ac67', true);
  }
  if (acc === 'headphones') {
    rect(17, 13, 2, 17, INK);
    rect(19, 11, 26, 2, INK);
    rect(45, 13, 2, 17, INK);
    box(side ? 22 : 16, 26, 6, 10, '#646d66');
    if (!side) box(43, 26, 6, 10, '#646d66');
  }
  if (acc === 'flower') {
    rect(42, 20, 2, 8, '#66844b');
    for (const [x, y] of [
      [39, 18],
      [43, 17],
      [45, 20],
      [41, 22],
    ] as const)
      box(x, y, 4, 4, '#ce8d86');
    rect(42, 20, 3, 3, GOLD);
  }
  if (acc === 'earrings') {
    rect(side ? 22 : 17, 33, 2, 4, GOLD);
    if (!side) rect(45, 33, 2, 4, GOLD);
  }
  if (acc === 'goggles') {
    rect(18, 19, 28, 3, '#70503c');
    box(23, 17, 8, 7, GOLD);
    box(35, 17, 8, 7, GOLD);
    rect(25, 19, 4, 3, '#718e89');
    rect(37, 19, 4, 3, '#718e89');
  }
  if (a.costume === 3) {
    material(
      [
        [19, 20],
        [26, 11],
        [30, 2],
        [36, 5],
        [40, 16],
        [46, 21],
      ],
      '#65547e',
      true,
    );
    box(15, 21, 35, 4, '#65547e');
    rect(23, 19, 18, 2, GOLD);
    rect(31, 10, 2, 3, LINEN);
  }
  c.restore();
  frontArm();
  if (motionState.prop === 'heart') {
    const y = 28 - motion!.frame * 3;
    poly(
      [
        [28, y],
        [24, y - 4],
        [24, y - 8],
        [27, y - 10],
        [31, y - 7],
        [35, y - 10],
        [39, y - 8],
        [39, y - 4],
        [31, y + 3],
      ],
      '#ca786e',
    );
  }
  c.restore();
  if (waterSpout) {
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (let n = 0; n < 5; n++)
      rect(waterSpout[0] + (dir === 'left' ? -n : n), waterSpout[1] + 3 + n * 4, 2, 3, '#86cdd8');
    c.restore();
  }
  // Polygon edges snap to opaque pixels; no soft halo or white sticker border.
  const pixels = c.getImageData(0, 0, cv.width, cv.height);
  for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i]! < 128 ? 0 : 255;
  c.putImageData(pixels, 0, 0);
  return cv;
}
