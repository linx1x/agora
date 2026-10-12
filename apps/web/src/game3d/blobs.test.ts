import { describe, expect, it } from 'vitest';
import { BLOB_RADIUS, BLOB_Y, blobShadows } from './blobs';
import type { OccluderObject } from './occlusionMath';

const tree = (x: number, z: number): OccluderObject => ({
  key: `${x},${z}`,
  faces: [0],
  box: { x0: x, x1: x + 1, y0: 0, y1: 1.4, z0: z + 0.9, z1: z + 0.9 },
  card: true,
});

describe('blobShadows', () => {
  it('draws one fan per card: a centre and a ring, all at the foot of the card', () => {
    const b = blobShadows([tree(2, 3)]);
    // 1 centre + 10 rim vertices, 10 triangles
    expect(b.pos).toHaveLength(11 * 3);
    expect(b.color).toHaveLength(11 * 4);
    expect(b.index).toHaveLength(10 * 3);
    expect(b.pos[1]).toBeCloseTo(BLOB_Y, 9);
    // centre on the card's middle, at its foot
    expect(b.pos[0]).toBeCloseTo(2.5, 9);
    expect(b.pos[2]).toBeCloseTo(3.9, 9);
  });

  it('is opaque at the centre and clear on the rim, at the blob radius', () => {
    const b = blobShadows([tree(0, 0)]);
    expect(b.color[3]).toBe(1);
    for (let v = 1; v <= 10; v++) {
      expect(b.color[v * 4 + 3]).toBe(0);
      const dx = b.pos[v * 3]! - b.pos[0]!;
      const dz = b.pos[v * 3 + 2]! - b.pos[2]!;
      expect(Math.hypot(dx, dz)).toBeCloseTo(BLOB_RADIUS, 9);
    }
  });

  it('casts for cards only: walls and vines have no blob', () => {
    const wall: OccluderObject = { ...tree(0, 0), card: false };
    expect(blobShadows([wall]).pos).toEqual([]);
    const b = blobShadows([wall, tree(4, 4), tree(6, 4)]);
    expect(b.pos).toHaveLength(2 * 11 * 3);
    // the second fan's indices start after the first fan's vertices
    expect(Math.min(...b.index.slice(30))).toBe(11);
  });

  it('nothing in, nothing out', () => {
    expect(blobShadows([])).toEqual({ pos: [], color: [], index: [] });
  });
});
