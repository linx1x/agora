/** Shared original axis-aligned bed views; one item with two placement orientations. */
export type BedAxis = 'vertical' | 'horizontal';
let pending: Promise<Record<BedAxis, HTMLCanvasElement>> | undefined;
export function loadBedArt(): Promise<Record<BedAxis, HTMLCanvasElement>> {
  return (pending ??= (async () => {
    const image = new Image();
    image.src = '/assets/art-review/beds.png';
    await image.decode();
    const out = {} as Record<BedAxis, HTMLCanvasElement>;
    for (const [axis, x, w] of [
      ['vertical', 0, 760],
      ['horizontal', 760, 1014],
    ] as const) {
      const raw = document.createElement('canvas');
      raw.width = w;
      raw.height = 887;
      const ctx = raw.getContext('2d')!;
      ctx.drawImage(image, x, 0, w, 887, 0, 0, w, 887);
      const data = ctx.getImageData(0, 0, w, 887).data;
      let left: number = w,
        top = 887,
        right = 0,
        bottom = 0;
      for (let y = 0; y < 887; y++)
        for (let px = 0; px < w; px++)
          if (data[(y * w + px) * 4 + 3]! >= 128) {
            left = Math.min(left, px);
            right = Math.max(right, px);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 96;
      const c = canvas.getContext('2d')!;
      c.imageSmoothingEnabled = false;
      const scale = 92 / Math.max(right - left + 1, bottom - top + 1);
      const dw = Math.round((right - left + 1) * scale),
        dh = Math.round((bottom - top + 1) * scale);
      c.drawImage(
        raw,
        left,
        top,
        right - left + 1,
        bottom - top + 1,
        Math.floor((96 - dw) / 2),
        95 - dh,
        dw,
        dh,
      );
      out[axis] = canvas;
    }
    return out;
  })());
}
