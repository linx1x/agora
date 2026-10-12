export function canvas(w = 64, h = w): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}
export async function image(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Extract by measured source bounds. Alpha trim removes padding, never scene content. */
export function extract(
  img: HTMLImageElement,
  r: readonly number[],
  size = 64,
  extent?: number,
): HTMLCanvasElement {
  const [x = 0, y = 0, w = 1, h = 1] = r;
  const raw = canvas(w, h);
  const rc = context(raw);
  rc.drawImage(img, x, y, w, h, 0, 0, w, h);
  const data = rc.getImageData(0, 0, w, h).data;
  let left = w,
    top = h,
    right = 0,
    bottom = 0;
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      if (data[(yy * w + xx) * 4 + 3]! < 200) continue;
      left = Math.min(left, xx);
      top = Math.min(top, yy);
      right = Math.max(right, xx);
      bottom = Math.max(bottom, yy);
    }
  const out = canvas(size);
  const c = context(out);
  if (left > right) return out;
  const sw = right - left + 1,
    sh = bottom - top + 1;
  const k = (size - 4) / (extent ?? Math.max(sw, sh));
  const dw = Math.round(sw * k),
    dh = Math.round(sh * k);
  c.drawImage(raw, left, top, sw, sh, Math.floor((size - dw) / 2), size - dh - 1, dw, dh);
  return out;
}
