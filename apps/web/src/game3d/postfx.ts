/**
 * The pixel-diorama post-processing of the 2.5D view (P16.2 spike, P16.10, ADR-052): a tilt-shift
 * blur that is sharp in the middle of the screen and soft at the top and bottom, and an evening
 * bloom on the lamps. Desktop tier only (`tier.ts`). Both are still pictures, so reduced motion
 * keeps them; the bloom only runs when it has a strength (`bloomStrength`).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** The tilt-shift blur: a 9×9 tap kernel whose radius grows away from the band at mid-height. */
function tiltShiftShader() {
  return {
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      amount: { value: 2.2 },
      res: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader:
      'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; uniform vec2 res; varying vec2 vUv;
    void main(){
      float d = smoothstep(0.18, 0.5, abs(vUv.y - 0.47));
      vec4 acc = vec4(0.0); float tot = 0.0;
      for (int i = -4; i <= 4; i++) for (int j = -4; j <= 4; j++) {
        vec2 o = vec2(float(i), float(j)) * d * amount / res;
        float w = 1.0 - length(vec2(i, j)) / 6.0; if (w <= 0.0) continue;
        acc += texture2D(tDiffuse, vUv + o) * w; tot += w;
      }
      vec4 c = acc / tot;
      float v = smoothstep(0.95, 0.35, length(vUv - 0.5));
      gl_FragColor = vec4(c.rgb * mix(0.78, 1.0, v), 1.0);
    }`,
  };
}

export class PostFx {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly tilt: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    w: number,
    h: number,
    pixelRatio: number,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0, 0.4, 0.72);
    this.bloom.enabled = false;
    this.composer.addPass(this.bloom);
    this.tilt = new ShaderPass(tiltShiftShader());
    this.composer.addPass(this.tilt);
    this.composer.addPass(new OutputPass());
    this.setSize(w, h, pixelRatio);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.tilt.uniforms['res']!.value.set(w * pixelRatio, h * pixelRatio);
  }

  /** Draw the frame; `bloom` is the strength from `bloomStrength` (0 turns the bloom off). */
  render(bloom: number): void {
    this.bloom.enabled = bloom > 0;
    this.bloom.strength = bloom;
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
