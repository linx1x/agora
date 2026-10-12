import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CropMotion, REVIEW_CROPS, cropDisplacement } from './crops';
import { FLOOR_CLEARANCE, SUN_SHADOW, groundedGeometry, shadowGeometry } from './grounding';

describe('crop motion grounding', () => {
  it('keeps root collars and radish bulbs fixed through wind and watering', () => {
    for (const { id } of REVIEW_CROPS) {
      for (const t of [0, 0.15, 0.8, 2, 10, 100]) {
        for (const h of [0, FLOOR_CLEARANCE, 0.08, 0.13]) {
          expect(cropDisplacement(id, 0.3, h, t, 1, t)).toEqual([0, 0]);
        }
        const [x, y] = cropDisplacement(id, 0.3, 1, t, 1, t);
        expect(Math.abs(x)).toBeLessThan(0.2);
        expect(Math.abs(y)).toBeLessThan(0.2);
      }
    }
  });

  it('projects the animated silhouette onto the floor and never accumulates deformation', () => {
    const body = groundedGeometry(1, 1.25, { bottom: 1, footHeight: 0.025 }, 12);
    const cast = shadowGeometry(body, false),
      contact = shadowGeometry(body, true);
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    for (const geometry of [body, cast, contact]) group.add(new THREE.Mesh(geometry, material));
    const motion = new CropMotion(group, 'honey_pea', 2);
    motion.update(3, 0.2);
    const first = Array.from(body.getAttribute('position').array);
    motion.update(300, Infinity);
    motion.update(3, 0.2);
    expect(Array.from(body.getAttribute('position').array)).toEqual(first);
    const b = body.getAttribute('position');
    for (const geometry of [cast, contact]) {
      const p = geometry.getAttribute('position');
      for (let i = 0; i < b.count; i++) {
        const h = Math.max(0, b.getY(i) - FLOOR_CLEARANCE);
        expect(p.getX(i)).toBeCloseTo(b.getX(i) + h * SUN_SHADOW.x, 5);
        expect(p.getZ(i)).toBeCloseTo(b.getZ(i) + h * SUN_SHADOW.z, 5);
        expect(p.getY(i)).toBeLessThanOrEqual(0.0021);
      }
    }
    for (const geometry of [body, cast, contact]) geometry.dispose();
    material.dispose();
  });
});
