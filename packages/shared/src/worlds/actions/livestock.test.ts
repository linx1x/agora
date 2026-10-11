import { describe, expect, it } from 'vitest';
import { loadGameData } from '../gamedata/load';
import { cellKey, emptySim, type AnimalState } from '../gamedata/state';
import { simulateDays } from '../clock';
import { envOf, viewOf } from './fixtures';
import { planCollect } from './crafting';
import { planFeed, planCollectProducts, planPlaceAnimal, nextAnimalId } from './livestock';
import { planRemove } from './build';
import type { ActionView } from './plan';

const data = loadGameData();
const env = envOf(data);
const COOP = { x: 5, y: 5 };
const COOP_KEY = cellKey(5, 5);
const BARN = { x: 6, y: 5 };
const coopCell = { [COOP_KEY]: { decor: 'coop', solid: true, walkable: false } };
const barnCells = { ...coopCell, [cellKey(6, 5)]: { decor: 'barn', solid: true, walkable: false } };

function hen(id: string, extra: Partial<AnimalState> = {}): AnimalState {
  return { id, animal: 'plume_hen', cell: COOP_KEY, fedOn: 0, progress: 0, pending: 0, ...extra };
}

function withSim(view: ActionView, sim: Partial<ActionView['sim']>): ActionView {
  return { ...view, sim: { ...view.sim, ...sim } };
}

describe('placing an animal on its housing (P17.25)', () => {
  it('a hen from the bag goes onto a coop: one leaves the bag, an unfed animal stands in the cell', () => {
    const out = planPlaceAnimal(viewOf({ items: { plume_hen: 1 }, cells: coopCell }), { kind: 'place', at: COOP, item: 'plume_hen' }, env);
    expect(out).toMatchObject({
      ok: true,
      plan: {
        changes: { items: { plume_hen: -1 } },
        sim: { animals: [{ id: 'a1', animal: 'plume_hen', cell: COOP_KEY, fedOn: 0, progress: 0, pending: 0 }] },
      },
    });
  });

  it('a new animal gets the next free id', () => {
    const view = withSim(viewOf({ items: { plume_hen: 1 }, cells: coopCell }), { animals: [hen('a4'), hen('a2')] });
    const out = planPlaceAnimal(view, { kind: 'place', at: COOP, item: 'plume_hen' }, env);
    expect(out.ok && out.plan.sim.animals.at(-1)?.id).toBe('a5');
    expect(nextAnimalId(emptySim(1))).toBe('a1');
  });

  it('a cow needs a barn, a hen a coop; a full housing and an empty bag are refused', () => {
    expect(planPlaceAnimal(viewOf({ items: { milk_cow: 1 }, cells: coopCell }), { kind: 'place', at: COOP, item: 'milk_cow' }, env)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(planPlaceAnimal(viewOf({ items: { plume_hen: 1 }, cells: barnCells }), { kind: 'place', at: BARN, item: 'plume_hen' }, env)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const full = withSim(viewOf({ items: { plume_hen: 1 }, cells: coopCell }), { animals: [hen('a1'), hen('a2'), hen('a3'), hen('a4')] });
    expect(planPlaceAnimal(full, { kind: 'place', at: COOP, item: 'plume_hen' }, env)).toEqual({ ok: false, reason: 'capacity' });
    expect(planPlaceAnimal(viewOf({ cells: coopCell }), { kind: 'place', at: COOP, item: 'plume_hen' }, env)).toEqual({ ok: false, reason: 'missing' });
    expect(planPlaceAnimal(viewOf({ items: { plume_hen: 1 } }), { kind: 'place', at: COOP, item: 'plume_hen' }, env)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('a housing with animals in it cannot be removed', () => {
    const view = withSim(viewOf({ cells: coopCell }), { animals: [hen('a1')] });
    expect(planRemove(view, { kind: 'remove', at: COOP }, env)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('feeding the animals of a housing (P17.25)', () => {
  it('fodder from the bag feeds every hen in the coop for tonight, once', () => {
    const view = withSim(viewOf({ day: 3, items: { fodder: 4 }, cells: coopCell }), { animals: [hen('a1'), hen('a2')] });
    const out = planFeed(view, { kind: 'feed', at: COOP, item: 'fodder' }, env);
    expect(out).toMatchObject({
      ok: true,
      plan: { changes: { items: { fodder: -2 } }, sim: { animals: [{ id: 'a1', fedOn: 4 }, { id: 'a2', fedOn: 4 }] } },
    });
    if (!out.ok) throw new Error('feed refused');
    const again = withSim(view, { animals: out.plan.sim.animals });
    expect(planFeed(again, { kind: 'feed', at: COOP, item: 'fodder' }, env)).toEqual({ ok: false, reason: 'gone' });
  });

  it('a cow eats two fodder a day, and too little fodder is refused in full', () => {
    const cow = hen('c1', { animal: 'milk_cow', cell: COOP_KEY });
    expect(planFeed(withSim(viewOf({ items: { fodder: 2 }, cells: coopCell }), { animals: [cow] }), { kind: 'feed', at: COOP, item: 'fodder' }, env).ok).toBe(true);
    expect(planFeed(withSim(viewOf({ items: { fodder: 1 }, cells: coopCell }), { animals: [cow] }), { kind: 'feed', at: COOP, item: 'fodder' }, env)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('refuses: not a housing, not feed, and nobody in the cell', () => {
    expect(planFeed(viewOf({ items: { fodder: 1 } }), { kind: 'feed', at: COOP, item: 'fodder' }, env)).toEqual({ ok: false, reason: 'invalid' });
    expect(planFeed(viewOf({ items: { dawn_radish_seed: 1 }, cells: coopCell }), { kind: 'feed', at: COOP, item: 'dawn_radish_seed' }, env)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(planFeed(viewOf({ items: { fodder: 1 }, cells: coopCell }), { kind: 'feed', at: COOP, item: 'fodder' }, env)).toEqual({ ok: false, reason: 'gone' });
  });

  it('a fed day becomes a product on the next day change, and collecting it puts the egg in the bag', () => {
    const fed = withSim(viewOf({ day: 3, items: { fodder: 1 }, cells: coopCell }), { animals: [hen('a1')] });
    const out = planFeed(fed, { kind: 'feed', at: COOP, item: 'fodder' }, env);
    if (!out.ok) throw new Error('feed refused');
    const next = simulateDays(out.plan.sim, 3, 4, data);
    expect(next.animals[0]).toMatchObject({ pending: 1 });
    const collected = planCollectProducts(withSim(viewOf({ day: 4, cells: coopCell }), { animals: next.animals }), { kind: 'collect', at: COOP }, env);
    expect(collected).toMatchObject({ ok: true, plan: { changes: { items: { plume_egg: 1 } }, sim: { animals: [{ pending: 0 }] } } });
  });

  it('collecting with nothing waiting is refused, and collect on plain ground is invalid', () => {
    expect(planCollect(withSim(viewOf({ cells: coopCell }), { animals: [hen('a1')] }), { kind: 'collect', at: COOP }, env)).toEqual({
      ok: false,
      reason: 'gone',
    });
    expect(planCollect(viewOf(), { kind: 'collect', at: COOP }, env)).toEqual({ ok: false, reason: 'invalid' });
  });
});
