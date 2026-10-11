import {
  SEASONS,
  SEASON_DAYS,
  cellKey,
  MAX_PENDING_PRODUCT,
  type AnimalState,
  type CropState,
  type GameData,
  type MachineState,
  type PlotState,
  type Season,
  type WorldSimState,
} from './gamedata';
import { hash32 } from './noise';

/** A game day runs from 06:00 to 02:00 the next morning: 20 clock hours. */
export const GAME_MINUTES_PER_DAY = 20 * 60;
export const DAY_START_MINUTE = 6 * 60;
export const DEFAULT_DAY_MS = 20 * 60 * 1000;
/** One year (4 seasons of 28 days). simulateDays never runs more days than this. */
export const MAX_SIM_DAYS = SEASONS.length * SEASON_DAYS;

export interface WorldTime {
  /** 1-based day since the world was created. */
  readonly day: number;
  readonly season: Season;
  /** 1-based year. */
  readonly year: number;
  /** Clock hour, 0 to 23. */
  readonly hour: number;
  readonly minute: number;
  /** 1 to seasonDays. */
  readonly dayOfSeason: number;
}

const seasonIndexOf = (dayIndex0: number, seasonDays: number) =>
  Math.floor(dayIndex0 / seasonDays) % SEASONS.length;

/**
 * The world clock. The day starts at 06:00; the game minute is `dayMs / 1200`,
 * so the 20-minute day is 1000 ms per game minute. Times before creation clamp to day 1.
 */
export function worldTime(
  createdAtMs: number,
  nowMs: number,
  dayMs: number = DEFAULT_DAY_MS,
  seasonDays: number = SEASON_DAYS,
): WorldTime {
  if (!Number.isFinite(dayMs) || dayMs < GAME_MINUTES_PER_DAY) {
    throw new RangeError(`dayMs must be at least ${GAME_MINUTES_PER_DAY} (one game minute per ms)`);
  }
  if (!Number.isInteger(seasonDays) || seasonDays < 1) throw new RangeError('seasonDays must be a positive integer');
  const elapsed = Math.max(0, nowMs - createdAtMs);
  const index = Math.floor(elapsed / dayMs);
  const into = elapsed - index * dayMs;
  const gameMinute = Math.floor((into * GAME_MINUTES_PER_DAY) / dayMs);
  const clock = DAY_START_MINUTE + gameMinute;
  return {
    day: index + 1,
    season: SEASONS[seasonIndexOf(index, seasonDays)]!,
    year: Math.floor(index / (seasonDays * SEASONS.length)) + 1,
    hour: Math.floor(clock / 60) % 24,
    minute: clock % 60,
    dayOfSeason: (index % seasonDays) + 1,
  };
}

/**
 * Sprinkler coverage: radius 0 waters the 4 orthogonal neighbours, radius 1 the
 * 8 neighbours, radius 2 the 24 cells of the 5 x 5 block (research section 7).
 * The sprinkler's own cell is never covered.
 */
export function sprinklerCovers(radius: number, dx: number, dy: number): boolean {
  if (dx === 0 && dy === 0) return false;
  if (radius === 0) return Math.abs(dx) + Math.abs(dy) === 1;
  return Math.max(Math.abs(dx), Math.abs(dy)) <= radius;
}

export const seasonOfDay = (day: number): Season => SEASONS[seasonIndexOf(day - 1, SEASON_DAYS)]!;

function witherOutOfSeason(plots: Record<string, PlotState>, season: Season, rows: Map<string, { seasons: readonly string[] }>) {
  for (const [key, plot] of Object.entries(plots)) {
    if (!plot.crop) continue;
    const row = rows.get(plot.crop.crop);
    if (row && !row.seasons.includes(season)) plots[key] = { ...plot, crop: null };
  }
}

function growCrop(crop: CropState): CropState {
  if (crop.regrowLeft !== null) {
    const left = crop.regrowLeft - 1;
    return left === 0 ? { ...crop, regrowLeft: null, ripe: true } : { ...crop, regrowLeft: left };
  }
  let { stage, daysInStage } = crop;
  let ripe = false;
  daysInStage += 1;
  if (daysInStage >= crop.stages[stage]!) {
    if (stage + 1 >= crop.stages.length) {
      ripe = true;
      daysInStage = crop.stages[stage]!;
    } else {
      stage += 1;
      daysInStage = 0;
    }
  }
  return { ...crop, stage, daysInStage, ripe };
}

function growCrops(plots: Record<string, PlotState>, day: number) {
  for (const [key, plot] of Object.entries(plots)) {
    const crop = plot.crop;
    // Growth needs water on this day. Unwatered crops stay as they are.
    if (!crop || crop.ripe || plot.wateredOn !== day) continue;
    plots[key] = { ...plot, crop: growCrop(crop) };
  }
}

/**
 * Water retention (research section 4): the water used on this day's growth is kept for the next
 * night with the fertilizer's retention chance. The roll depends only on the world seed, the cell
 * and the day, so running the days one at a time and running them as one catch-up give the same result.
 */
function retainWater(plots: Record<string, PlotState>, day: number, seed: number, items: GameData['itemsById']) {
  for (const [key, plot] of Object.entries(plots)) {
    if (plot.wateredOn !== day) continue;
    const effect = items.get(plot.crop?.fertilizer ?? plot.fertilizer ?? '')?.effect;
    if (effect?.kind !== 'fertilizer') continue;
    const roll = hash32(`${seed}:${key}:${day}`) / 0x1_0000_0000;
    if (roll < effect.retentionPct / 100) plots[key] = { ...plot, wateredOn: day + 1 };
  }
}

function waterFromSprinklers(plots: Record<string, PlotState>, day: number, items: GameData['itemsById']) {
  for (const [key, plot] of Object.entries(plots)) {
    if (!plot.sprinkler) continue;
    const effect = items.get(plot.sprinkler)?.effect;
    if (effect?.kind !== 'sprinkler') continue;
    const radius = effect.radius;
    const [x, y] = key.split(',').map(Number) as [number, number];
    // Radius 0 still reaches the 4 orthogonal neighbours, so scan at least 1 cell out.
    const reach = Math.max(1, radius);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (!sprinklerCovers(radius, dx, dy)) continue;
        const target = cellKey(x + dx, y + dy);
        const tile = plots[target];
        // Water counts for the next night, so it is set after growth has run.
        if (tile?.tilled) plots[target] = { ...tile, wateredOn: day + 1 };
      }
    }
  }
}

function stepAnimal(animal: AnimalState, day: number, rows: Map<string, { productDays: number }>): AnimalState {
  const row = rows.get(animal.animal);
  if (!row || animal.fedOn !== day || animal.pending >= MAX_PENDING_PRODUCT) return animal;
  const progress = animal.progress + 1;
  if (progress < row.productDays) return { ...animal, progress };
  return { ...animal, progress: 0, pending: animal.pending + 1 };
}

/**
 * Runs the night processing for days fromDay+1 .. toDay. The state must be at
 * fromDay. Order each day: season change (withering), crop growth (needs water
 * that day), water retention (fertilizer), sprinklers (water for tomorrow),
 * animals, machines. `seed` is the world's seed: it drives the retention rolls.
 * At most one year (MAX_SIM_DAYS) is simulated; earlier days in a longer gap are skipped.
 * Pure: the input state is not changed.
 */
export function simulateDays(state: WorldSimState, fromDay: number, toDay: number, data: GameData, seed = 0): WorldSimState {
  if (!Number.isInteger(fromDay) || !Number.isInteger(toDay)) throw new RangeError('days must be integers');
  if (state.day !== fromDay) throw new RangeError(`state is at day ${state.day}, not ${fromDay}`);
  if (toDay <= fromDay) return state;
  const cropRows = new Map(data.crops.map((c) => [c.id, c] as const));
  const animalRows = new Map(data.animals.map((a) => [a.id, a] as const));
  const plots: Record<string, PlotState> = { ...state.plots };
  let animals: AnimalState[] = [...state.animals];
  let machines: MachineState[] = [...state.machines];
  const first = Math.max(fromDay + 1, toDay - MAX_SIM_DAYS + 1);
  for (let day = first; day <= toDay; day++) {
    const dayOfSeason = ((day - 1) % SEASON_DAYS) + 1;
    if (dayOfSeason === 1 && day > 1) witherOutOfSeason(plots, seasonOfDay(day), cropRows);
    growCrops(plots, day);
    retainWater(plots, day, seed, data.itemsById);
    waterFromSprinklers(plots, day, data.itemsById);
    animals = animals.map((animal) => stepAnimal(animal, day, animalRows));
    machines = machines.map((machine) => (machine.daysLeft > 0 ? { ...machine, daysLeft: machine.daysLeft - 1 } : machine));
  }
  return { day: toDay, plots, animals, machines };
}
