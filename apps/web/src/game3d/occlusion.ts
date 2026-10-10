/**
 * Occlusion fade, the Three.js side (P16.9, ADR-052). The region mesh keeps one float per vertex
 * (`aFade`, the share of its pixels drawn), so a wall or tree cell fades by rewriting its own
 * vertices. The fade is a 4×4 ordered dither, not alpha blending: the mesh stays opaque, so depth
 * stays right, nothing needs sorting and it is still one draw call. Pixel art suits it.
 */
import type * as THREE from 'three';
import type { Cam } from './camera';
import {
  fadeStep,
  hiders,
  KEPT_WHEN_HIDDEN,
  screenBox,
  type OccluderObject,
  type Seen,
  type Subject,
} from './occlusionMath';

/** The per-vertex attribute of a region mesh holding each vertex's share of pixels drawn. */
export const FADE_ATTR = 'aFade';

const VERT_DECL = 'attribute float aFade;\nvarying float vFade;';
const FRAG_DECL = `varying float vFade;
// 4×4 ordered (Bayer) threshold in [0, 1): a fragment is drawn while its threshold is below vFade
float agoraBayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float agoraBayer4(vec2 a) { return agoraBayer2(0.5 * a) * 0.25 + agoraBayer2(a); }`;

/** Dither a lit material by the `aFade` vertex attribute (see the file comment). */
export function ditherFade(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace(
        '#include <alphatest_fragment>',
        '#include <alphatest_fragment>\nif (vFade < 1.0 && agoraBayer4(gl_FragCoord.xy) >= vFade) discard;',
      );
  };
  // a different program from the plain material, compiled once
  mat.customProgramCacheKey = () => 'agora-dither-fade';
}

interface Live {
  obj: OccluderObject;
  /** the share of pixels drawn now (1 solid, KEPT_WHEN_HIDDEN hidden) */
  cur: number;
}

/** The fades of one region's occluders, written into its `aFade` attribute. */
export class Occlusion {
  private readonly live: Live[];

  constructor(
    private readonly attr: THREE.BufferAttribute,
    objects: readonly OccluderObject[],
  ) {
    this.live = objects.map((obj) => ({ obj, cur: 1 }));
  }

  /** Test every occluder against the subjects this frame, then step its fade. */
  update(cam: Cam, subjects: readonly Subject[], dtMs: number, instant: boolean): void {
    if (!this.live.length) return;
    const seen = new Map<string, Seen>();
    for (const l of this.live) {
      const s = screenBox(cam, l.obj.box);
      if (s) seen.set(l.obj.key, s);
    }
    const hidden = subjects.length ? hiders(subjects, seen) : new Set<string>();
    const arr = this.attr.array as Float32Array;
    let dirty = false;
    for (const l of this.live) {
      const target = hidden.has(l.obj.key) ? KEPT_WHEN_HIDDEN : 1;
      const next = fadeStep(l.cur, target, dtMs, instant);
      if (next === l.cur) continue;
      l.cur = next;
      dirty = true;
      for (const f of l.obj.faces) arr.fill(next, f * 4, f * 4 + 4);
    }
    if (dirty) this.attr.needsUpdate = true;
  }

  /** The keys of the occluders not fully solid right now (test read-out). */
  fadedKeys(): string[] {
    return this.live.filter((l) => l.cur < 1).map((l) => l.obj.key);
  }
}
