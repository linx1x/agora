import { SEASONS, SEASON_DAYS, type PlotState, type WorldSimState } from './gamedata';
import { hash32 } from './noise';

export const WEATHER_KINDS = ['clear', 'cloudy', 'rain', 'thunderstorm', 'snow'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];
export interface WeatherForecast {
  readonly day: number;
  readonly today: WeatherKind;
  readonly tomorrow: WeatherKind;
}

/** Versioned, independent random stream: forecasting never consumes gameplay randomness. */
export function weatherForDay(seed: number, day: number): WeatherKind {
  if (!Number.isSafeInteger(day) || day < 1)
    throw new RangeError('weather day must be a positive integer');
  if (day === 1) return 'clear';
  const season = SEASONS[Math.floor((day - 1) / SEASON_DAYS) % SEASONS.length];
  const roll = hash32(`weather:v1:${seed}:${day}`) / 0x1_0000_0000;
  if (season === 'winter') return roll < 0.45 ? 'snow' : roll < 0.7 ? 'cloudy' : 'clear';
  const storm = season === 'summer' ? 0.13 : 0.06;
  const wet = season === 'summer' ? 0.3 : season === 'spring' ? 0.42 : 0.36;
  return roll < storm
    ? 'thunderstorm'
    : roll < wet
      ? 'rain'
      : roll < wet + 0.22
        ? 'cloudy'
        : 'clear';
}

export const weatherForecast = (seed: number, day: number): WeatherForecast => ({
  day,
  today: weatherForDay(seed, day),
  tomorrow: weatherForDay(seed, day + 1),
});
export const rainWaters = (weather: WeatherKind): boolean =>
  weather === 'rain' || weather === 'thunderstorm';
export const animalsShelter = (weather: WeatherKind): boolean =>
  rainWaters(weather) || weather === 'snow';

/** Hook for P17.34 fishing: multiply bite waiting time, never catch rewards or success. */
export const fishingWaitMultiplier = (weather: WeatherKind): number =>
  rainWaters(weather) ? 0.8 : weather === 'snow' ? 1.1 : 1;

/** Outdoor rain waters today's soil for the next dawn. Never mutates stored state. */
export function waterFromWeather(state: WorldSimState, seed: number): WorldSimState {
  if (!rainWaters(weatherForDay(seed, state.day))) return state;
  let plots: Record<string, PlotState> | undefined;
  for (const [key, plot] of Object.entries(state.plots)) {
    if (!plot.tilled || plot.wateredOn === state.day + 1) continue;
    plots ??= { ...state.plots };
    plots[key] = { ...plot, wateredOn: state.day + 1 };
  }
  return plots ? { ...state, plots } : state;
}
