import { describe, expect, it } from 'vitest';
import { C2S } from './protocol';

/** The action message of a world (P17.21b, P17.26): the key is the idempotency key, and the server's own settlement keys have a colon. */
const act = (key: string) => ({ t: 'world:act', op: 1, kind: 'harvest', at: { x: 1, y: 2 }, key });

describe('world:act keys (P17.26)', () => {
  it('preserves the bed axis on a placement and rejects diagonal values',()=> {
    expect(C2S.parse({...act('bed-axis-1'),kind:'place',item:'bed',bedAxis:'horizontal'})).toHaveProperty('bedAxis','horizontal');
    expect(C2S.safeParse({...act('bed-axis-1'),kind:'place',item:'bed',bedAxis:'diagonal'}).success).toBe(false);
  });
  it('accepts a UUID key from the client (letters, digits, dashes)', () => {
    expect(C2S.safeParse(act('3f2b8c1e-9a7d-4e5f-8b6c-0d1e2f3a4b5c')).success).toBe(true);
  });

  it('refuses a key with a colon, so no client can name a settlement row (`ship:<world>:<day>`)', () => {
    expect(C2S.safeParse(act('ship:w1:2')).success).toBe(false);
  });
});
