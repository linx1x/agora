/**
 * The build-mode drawing of the 2.5D view (P16.13, P16.14): grid, collision, cursor, stroke,
 * selection and handles. They are drawn in screen space on a canvas over the world, from 3D points
 * projected by the camera each frame, so they sit on the floor or on a surface under the tilt
 * without any depth test. aria-hidden: the build panel is the accessible control.
 */

export interface Pt2 {
  x: number;
  y: number;
}

export class BuildOverlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'absolute',
      pointerEvents: 'none',
      display: 'none',
    });
    parent.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Cover the world canvas (same place and size, CSS px), with the device pixel ratio. */
  place(left: number, top: number, w: number, h: number, pr: number, shown: boolean): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    Object.assign(this.canvas.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${this.w}px`,
      height: `${this.h}px`,
      display: shown ? 'block' : 'none',
    });
    this.canvas.width = Math.round(this.w * pr);
    this.canvas.height = Math.round(this.h * pr);
    this.ctx.setTransform(pr, 0, 0, pr, 0, 0);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  /** A closed polygon (screen points), filled and/or stroked. */
  poly(
    pts: readonly Pt2[],
    o: { fill?: string; alpha?: number; stroke?: string; line?: number; strokeAlpha?: number },
  ): void {
    if (pts.length < 2) return;
    const c = this.ctx;
    c.beginPath();
    c.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i]!.x, pts[i]!.y);
    c.closePath();
    if (o.fill) {
      c.globalAlpha = o.alpha ?? 1;
      c.fillStyle = o.fill;
      c.fill();
    }
    if (o.stroke) {
      c.globalAlpha = o.strokeAlpha ?? 1;
      c.strokeStyle = o.stroke;
      c.lineWidth = o.line ?? 1;
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  /** A straight segment (screen points). */
  line(a: Pt2, b: Pt2, color: string, width = 1, alpha = 1): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
    c.globalAlpha = 1;
  }

  /** A small square centred on a screen point (handles, snap spots). */
  square(p: Pt2, size: number, color: string, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    this.ctx.globalAlpha = 1;
  }

  destroy(): void {
    this.canvas.remove();
  }
}
