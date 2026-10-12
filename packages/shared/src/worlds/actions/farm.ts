/**
 * The farm rules (ADR-053, P17.22): plant, harvest, fertilize and place sprinklers on the farm
 * layer. Growth, watering and withering are the night's job (clock.ts `simulateDays`); these rules
 * only start or collect what the night then carries on. Pure.
 */
import { seasonOfDay } from '../clock';
import type { GameData } from '../gamedata/load';
import type { Item } from '../gamedata/schema';
import type { CropState, PlotState } from '../gamedata/state';
import { cellKey } from '../gamedata/state';
import { countOf } from './inventory';
import { noChanges, type ActionChanges } from './kinds';
import { skillLevelOf } from './tools';
import { refuse, type ActionPlanner, type ActionView } from './plan';

/** Quality levels stored on items, as the research gives them (section 6): normal, silver, gold, best. */
export const QUALITY_LEVELS = [0, 1, 2, 4] as const;
export type Quality = (typeof QUALITY_LEVELS)[number];

const QUALITY_SEPARATOR = '~';

/** The stack key of an item of a quality: the plain item id for normal quality, `id~quality` otherwise. */
export function stackKey(item: string, quality: Quality): string {
  return quality === 0 ? item : `${item}${QUALITY_SEPARATOR}${quality}`;
}

/** The item id behind a stack key. */
export function baseItemOf(key: string): string {
  const at = key.indexOf(QUALITY_SEPARATOR);
  return at < 0 ? key : key.slice(0, at);
}

/** The quality level of a stack key: 0 for a normal item, and for any level that is not one of QUALITY_LEVELS. */
export function qualityOfStack(key: string): number {
  const at = key.indexOf(QUALITY_SEPARATOR);
  if (at < 0) return 0;
  const level = Number(key.slice(at + 1));
  return (QUALITY_LEVELS as readonly number[]).includes(level) ? level : 0;
}

/**
 * The harvest quality of a crop (research section 6). `f` is the fertilizer's quality level (0 to 3),
 * `level` the farming level and `roll` a number in [0, 1). Best needs the top fertilizer and a roll
 * under v / 2; gold a roll under v; silver under s, or always with the top fertilizer; else normal.
 */
export function harvestQuality(f: number, level: number, roll: number): Quality {
  const v = (0.2 * level) / 10 + (0.2 * f * (level + 2)) / 12 + 0.01;
  const s = Math.min(0.75, 2 * v);
  if (f === 3 && roll < v / 2) return 4;
  if (roll < v) return 2;
  if (roll < s || f === 3) return 1;
  return 0;
}

export type FertilizerEffect = Extract<NonNullable<Item['effect']>, { kind: 'fertilizer' }>;

/** The fertilizer effect of an item id, if it is fertilizer. */
export function fertilizerOf(data: GameData, id: string | null): FertilizerEffect | undefined {
  if (id === null) return undefined;
  const effect = data.itemsById.get(id)?.effect;
  return effect?.kind === 'fertilizer' ? effect : undefined;
}

/**
 * The phase lengths of a crop after the fertilizer's speed bonus (research section 5): the crop loses
 * ceil(total x pct) days, one day at a time from phases longer than one day, in order, for at most
 * three sweeps. Our phases all end in a ripe state; none is open-ended, so every phase can shorten.
 */
export function speedStages(stages: readonly number[], speedPct: number): number[] {
  const out = [...stages];
  let remove = Math.ceil((out.reduce((sum, days) => sum + days, 0) * speedPct) / 100);
  for (let sweep = 0; sweep < 3 && remove > 0; sweep++) {
    for (let i = 0; i < out.length && remove > 0; i++) {
      if (out[i]! > 1) {
        out[i] = out[i]! - 1;
        remove -= 1;
      }
    }
  }
  return out;
}

/** The farming level of a view. */
const farmingLevel = (view: ActionView, data: GameData): number =>
  skillLevelOf(view.skills.farming ?? 0, data.progression.levelXp);

/** The plot at a cell, if the rule was aimed at one. */
function plotAt(view: ActionView, at: { x: number; y: number }): PlotState | undefined {
  return view.sim.plots[cellKey(at.x, at.y)];
}

export const planPlant: ActionPlanner = (view, req, env) => {
  if (!req.at) return refuse('invalid');
  const item = req.item ? env.data.itemsById.get(req.item) : undefined;
  if (!req.item || item?.kind !== 'seed') return refuse('invalid');
  if (countOf(view.inventory, req.item) < 1) return refuse('missing');
  const crop = env.data.crops.find((row) => row.seed === req.item);
  if (!crop || !crop.seasons.includes(seasonOfDay(view.day))) return refuse('invalid');
  const plot = plotAt(view, req.at);
  if (!plot?.tilled || plot.crop !== null) return refuse('invalid');
  const fertilizer = fertilizerOf(env.data, plot.fertilizer);
  const state: CropState = {
    crop: crop.id,
    stage: 0,
    daysInStage: 0,
    ripe: false,
    regrowLeft: null,
    stages: speedStages(crop.stages, fertilizer?.speedPct ?? 0),
    fertilizer: plot.fertilizer,
  };
  const plots = { ...view.sim.plots, [cellKey(req.at.x, req.at.y)]: { ...plot, crop: state, fertilizer: null } };
  return {
    ok: true,
    plan: { changes: { ...noChanges(), items: { [req.item]: -1 } }, edits: [], sim: { ...view.sim, plots } },
  };
};

export const planHarvest: ActionPlanner = (view, req, env) => {
  if (!req.at) return refuse('invalid');
  const plot = plotAt(view, req.at);
  if (!plot?.crop) return refuse('gone');
  if (!plot.crop.ripe) return refuse('invalid');
  const crop = plot.crop;
  const row = env.data.crops.find((c) => c.id === crop.crop);
  if (!row) return refuse('invalid');
  const fertilizer = fertilizerOf(env.data, crop.fertilizer);
  const quality = harvestQuality(fertilizer?.quality ?? 0, farmingLevel(view, env.data), env.rng());
  const span = row.yield.max - row.yield.min;
  const qty = row.yield.min + Math.floor(env.rng() * (span + 1));
  const reward = env.data.progression.xp.harvest;
  const next: CropState | null =
    row.regrowDays === null ? null : { ...crop, ripe: false, regrowLeft: row.regrowDays, daysInStage: 0 };
  const plots = { ...view.sim.plots, [cellKey(req.at.x, req.at.y)]: { ...plot, crop: next } };
  const changes: ActionChanges = {
    ...noChanges(),
    items: qty > 0 ? { [stackKey(row.item, quality)]: qty } : {},
    xp: { [reward.skill]: reward.amount },
  };
  return { ok: true, plan: { changes, edits: [], sim: { ...view.sim, plots } } };
};

export const planFertilize: ActionPlanner = (view, req, env) => {
  if (!req.at) return refuse('invalid');
  const item = req.item ? env.data.itemsById.get(req.item) : undefined;
  if (!req.item || item?.kind !== 'fertilizer') return refuse('invalid');
  if (countOf(view.inventory, req.item) < 1) return refuse('missing');
  const plot = plotAt(view, req.at);
  if (!plot?.tilled || plot.crop !== null || plot.fertilizer !== null) return refuse('invalid');
  const plots = { ...view.sim.plots, [cellKey(req.at.x, req.at.y)]: { ...plot, fertilizer: req.item } };
  return {
    ok: true,
    plan: { changes: { ...noChanges(), items: { [req.item]: -1 } }, edits: [], sim: { ...view.sim, plots } },
  };
};

export const planPlace: ActionPlanner = (view, req, env) => {
  if (!req.at) return refuse('invalid');
  const item = req.item ? env.data.itemsById.get(req.item) : undefined;
  if (!req.item || item?.effect?.kind !== 'sprinkler') return refuse('invalid');
  if (countOf(view.inventory, req.item) < 1) return refuse('missing');
  const plot = plotAt(view, req.at);
  if (!plot?.tilled || plot.sprinkler !== null) return refuse('invalid');
  const plots = { ...view.sim.plots, [cellKey(req.at.x, req.at.y)]: { ...plot, sprinkler: req.item } };
  return {
    ok: true,
    plan: { changes: { ...noChanges(), items: { [req.item]: -1 } }, edits: [], sim: { ...view.sim, plots } },
  };
};
