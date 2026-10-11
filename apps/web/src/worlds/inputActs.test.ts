import { describe, expect, it } from 'vitest';
import { loadGameData, type C2SMsg } from '@agora/shared';
import { ActQueue, NO_FACTS, actionFor, factsOf, faceCell, type CellFacts } from './inputActs';

const data = loadGameData();

/** The facts of a cell, with the rest left as bare ground (no container, housing, station or shop). */
const facts = (over: Partial<CellFacts> = {}): CellFacts => ({ ...NO_FACTS, ...over });

/** A seed in the starter kit: the plant action takes it. */
const SEED = 'dawn_radish_seed';

describe('faceCell: the cell in front of the feet (P17.21b)', () => {
  // a feet point in the middle of cell (4, 7): 4 * 32 + 16, 7 * 32 + 16
  const x = 4 * 32 + 16;
  const y = 7 * 32 + 16;
  it('is the neighbour in the facing direction', () => {
    expect(faceCell(x, y, 'up')).toEqual({ x: 4, y: 6 });
    expect(faceCell(x, y, 'down')).toEqual({ x: 4, y: 8 });
    expect(faceCell(x, y, 'left')).toEqual({ x: 3, y: 7 });
    expect(faceCell(x, y, 'right')).toEqual({ x: 5, y: 7 });
  });
  it('reads the cell the feet are in, also at its edges and below zero', () => {
    expect(faceCell(0, 0, 'left')).toEqual({ x: -1, y: 0 });
    expect(faceCell(31.9, 31.9, 'right')).toEqual({ x: 1, y: 0 });
  });
});

describe('actionFor: what the held item asks for on a cell (P17.21b)', () => {
  it('an empty hand harvests', () => {
    expect(actionFor(null, data)).toBe('harvest');
  });
  it('each working tool does its action', () => {
    expect(actionFor('hoe_1', data)).toBe('till');
    expect(actionFor('can_2', data)).toBe('water');
    expect(actionFor('axe_3', data)).toBe('chop');
    expect(actionFor('pick_1', data)).toBe('mine');
  });
  it('a rod does nothing on a cell yet (fishing is later)', () => {
    expect(actionFor('rod_1', data)).toBeNull();
  });
  it('a seed plants, fertilizer fertilizes, a building places, food is eaten', () => {
    expect(actionFor(SEED, data)).toBe('plant');
    expect(actionFor('fertilizer_1', data)).toBe('fertilize');
    expect(actionFor('sprinkler_1', data)).toBe('place');
    expect(actionFor('dawn_salad', data)).toBe('eat');
  });
  it('a stack with a quality is the same item as its base', () => {
    expect(actionFor(`${SEED}~2`, data)).toBe('plant');
    expect(actionFor('hoe_1~1', data)).toBe('till');
  });
  it('a material does nothing on a cell', () => {
    expect(actionFor('softwood', data)).toBeNull();
  });
});

/** A queue whose keys are numbered, so a test can read them. */
function queue(limit?: number) {
  const sent: C2SMsg[] = [];
  let n = 0;
  const q = new ActQueue({ send: (m) => sent.push(m), newKey: () => `key-${++n}-abcdef`, limit });
  return { q, sent };
}

const act = (x: number) => ({ kind: 'till' as const, at: { x, y: 0 }, item: 'hoe_1' });

describe('ActQueue: one key per intent, kept until answered (P17.21b)', () => {
  it('sends each intent once, with its own key, and counts it until the server answers', () => {
    const { q, sent } = queue();
    const a = q.submit('w1', act(1));
    const b = q.submit('w1', act(2));
    expect(a).not.toBe(b);
    expect(sent.map((m) => (m.t === 'world:act' ? m.key : ''))).toEqual([a, b]);
    expect(q.size).toBe(2);
    expect(q.has(a)).toBe(true);
  });

  it('closes an intent when the server answers its op (approved or refused alike)', () => {
    const { q, sent } = queue();
    q.submit('w1', act(1));
    q.submit('w1', act(2));
    const [first, second] = sent as Extract<C2SMsg, { t: 'world:act' }>[];
    q.answer(first!.op);
    expect(q.size).toBe(1);
    q.answer(second!.op);
    expect(q.size).toBe(0);
  });

  it('after a reconnect, sends the same key again with a new op, and drops the other worlds', () => {
    const { q, sent } = queue();
    const k1 = q.submit('w1', act(1));
    q.submit('w2', act(2));
    sent.length = 0;
    q.resend('w1');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: 'world:act', key: k1, kind: 'till', item: 'hoe_1', at: { x: 1, y: 0 } });
    expect(q.size).toBe(1);
    expect(q.has(k1)).toBe(true);
  });

  it('an answer to an op that was superseded by a resend does not close the intent', () => {
    const { q, sent } = queue();
    q.submit('w1', act(1));
    const old = (sent[0] as Extract<C2SMsg, { t: 'world:act' }>).op;
    q.resend('w1');
    q.answer(old);
    expect(q.size).toBe(1);
  });

  it('keeps no more than its limit: the oldest unanswered intent goes first', () => {
    const { q } = queue(2);
    const a = q.submit('w1', act(1));
    const b = q.submit('w1', act(2));
    const c = q.submit('w1', act(3));
    expect(q.size).toBe(2);
    expect(q.has(a)).toBe(false);
    expect(q.has(b)).toBe(true);
    expect(q.has(c)).toBe(true);
  });

  it('leaves out the item when the action has none (a harvest by hand)', () => {
    const { q, sent } = queue();
    q.submit('w1', { kind: 'harvest', at: { x: 3, y: 3 } });
    expect(sent[0]).toEqual({ t: 'world:act', op: 1, kind: 'harvest', at: { x: 3, y: 3 }, key: 'key-1-abcdef' });
    expect('item' in (sent[0] as object)).toBe(false);
  });

  it('sends the target of a craft (its recipe), and leaves it out when there is none (P17.25)', () => {
    const { q, sent } = queue();
    q.submit('w1', { kind: 'craft', at: { x: 2, y: 2 }, target: 'fence' });
    q.submit('w1', { kind: 'buy', at: { x: 2, y: 2 }, item: 'dawn_radish_seed' });
    expect(sent[0]).toMatchObject({ t: 'world:act', kind: 'craft', target: 'fence' });
    expect(sent[1]).toMatchObject({ kind: 'buy', item: 'dawn_radish_seed' });
    expect('target' in (sent[1] as object)).toBe(false);
  });
});

describe('actionFor with the cell facts: shovel, pick, chests (P17.24)', () => {
  const PLACED = facts({ removable: true });
  const CHEST = facts({ container: true, removable: true });
  it('a shovel raises the ground, and with Shift lowers it', () => {
    expect(actionFor('shovel_1', data)).toBe('raise');
    expect(actionFor('shovel_1', data, NO_FACTS, true)).toBe('lower');
  });
  it('a pick takes a placed block back into the bag, and mines anything else', () => {
    expect(actionFor('pick_1', data, PLACED)).toBe('remove');
    expect(actionFor('pick_1', data, NO_FACTS)).toBe('mine');
  });
  it('an empty hand opens a chest and harvests anything else', () => {
    expect(actionFor(null, data, CHEST)).toBe('open');
    expect(actionFor(null, data, PLACED)).toBe('harvest');
  });
  it('a held item put on a chest is stashed, whatever it is', () => {
    expect(actionFor(SEED, data, CHEST)).toBe('stash');
    expect(actionFor('wood_wall', data, CHEST)).toBe('stash');
    expect(actionFor('hoe_1', data, CHEST)).toBe('stash');
  });
  it('a building is placed on a plain cell, and a shovel still raises on a placed block', () => {
    expect(actionFor('wood_wall', data)).toBe('place');
    expect(actionFor('shovel_1', data, PLACED)).toBe('raise');
  });
});

describe('factsOf: what a terrain cell holds (P17.24)', () => {
  it('a chest is a container, and a placed wall can be removed', () => {
    expect(factsOf({ decor: 'chest' }, data)).toMatchObject({ container: true, removable: true });
    expect(factsOf({ decor: 'wood_wall' }, data)).toMatchObject({ container: false, removable: true });
  });
  it('a tree, a boulder or bare ground is neither', () => {
    expect(factsOf({ decor: 'oak_tree' }, data)).toEqual(NO_FACTS);
    expect(factsOf({ decor: '' }, data)).toEqual(NO_FACTS);
  });
  it('the shipping bin is a fitting of the starter: placed by nobody, so not removable', () => {
    expect(factsOf({ decor: 'shipping_bin' }, data).removable).toBe(false);
  });
});

describe('actionFor for housings, machines, stations and shops (P17.25)', () => {
  const COOP = facts({ housing: true, removable: true });
  const FURNACE = facts({ machine: true, station: true, removable: true });
  const BENCH = facts({ station: true, removable: true });
  const BOARD = facts({ shop: true });
  it('an empty hand collects from a housing or a machine', () => {
    expect(actionFor(null, data, COOP)).toBe('collect');
    expect(actionFor(null, data, FURNACE)).toBe('collect');
  });
  it('an empty hand on a station or a shop board is no server action: the panel opens instead', () => {
    expect(actionFor(null, data, BENCH)).toBeNull();
    expect(actionFor(null, data, BOARD)).toBeNull();
  });
  it('an animal or a machine in hand is placed, feed goes into a housing and nowhere else', () => {
    expect(actionFor('plume_hen', data)).toBe('place');
    expect(actionFor('furnace', data)).toBe('place');
    expect(actionFor('fodder', data, COOP)).toBe('feed');
    expect(actionFor('fodder', data)).toBeNull();
    expect(actionFor('fodder', data, BENCH)).toBeNull();
  });
  it('a material held on a station does nothing: recipes are chosen in the panel', () => {
    expect(actionFor('softwood', data, BENCH)).toBeNull();
  });
  it('a pick takes a placed housing or machine back, like any placed block', () => {
    expect(actionFor('pick_1', data, COOP)).toBe('remove');
    expect(actionFor('pick_1', data, FURNACE)).toBe('remove');
  });
});

describe('factsOf for housings, machines, stations and shops (P17.25)', () => {
  it('a coop or a barn is a housing; a furnace is a machine and a station; a bench or a stove is a station only', () => {
    expect(factsOf({ decor: 'coop' }, data)).toMatchObject({ housing: true, machine: false, station: false });
    expect(factsOf({ decor: 'barn' }, data)).toMatchObject({ housing: true, station: false });
    expect(factsOf({ decor: 'furnace' }, data)).toMatchObject({ machine: true, station: true, housing: false });
    expect(factsOf({ decor: 'workbench' }, data)).toMatchObject({ station: true, machine: false, housing: false });
    expect(factsOf({ decor: 'stove' }, data)).toMatchObject({ station: true, machine: false });
  });
  it('the shop board is a shop, and nothing else is', () => {
    expect(factsOf({ decor: 'shop_board' }, data)).toMatchObject({ shop: true, station: false });
    expect(factsOf({ decor: 'chest' }, data).shop).toBe(false);
  });
});
