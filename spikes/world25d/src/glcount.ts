/** Counts WebGL draw calls per frame the same way for both engines (Phaser has no counter). */
let n = 0;
let lastFrame = 0;
for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
  for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
    const orig = (proto as unknown as Record<string, (...a: unknown[]) => void>)[k];
    if (!orig) continue;
    (proto as unknown as Record<string, (...a: unknown[]) => void>)[k] = function (this: unknown, ...a: unknown[]) {
      n++;
      return orig.apply(this, a);
    };
  }
}
/** Draw calls since the previous call (call once per frame). */
export function drawCalls(): number {
  lastFrame = n;
  n = 0;
  return lastFrame;
}
export const lastDrawCalls = () => lastFrame;
