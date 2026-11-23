/**
 * The host server re-uses the game's own data and track math, so the server validates the race
 * with exactly the same track geometry, grid and car limits the browsers drive on.
 */
import { Track } from '../src/game/track';
import { ARENA_MAP, RACE_MAPS, getMap } from '../src/data/maps';
import { CARS, carParams, getCar } from '../src/data/cars';
import { DEFAULT_LOOK } from '../src/data/cosmetics';

export { DEFAULT_LOOK, getCar };

export const CAR_IDS: readonly string[] = CARS.map((c) => c.id);
export const RACE_MAP_IDS: readonly string[] = RACE_MAPS.map((m) => m.id);

const tracks = new Map<string, Track>();

/** tracks are immutable for the server (barricade state lives in the browsers), so they are cached */
export function trackFor(mapId: string): Track {
  let t = tracks.get(mapId);
  if (!t) {
    t = new Track(mapId === 'arena' ? ARENA_MAP : getMap(mapId));
    tracks.set(mapId, t);
  }
  return t;
}

/**
 * Highest speed (m/s) a car can legally reach: top speed × nitro (1.32) × flight (1.12) plus the
 * kick of a boost pad and some slack for collisions.
 */
export function speedLimit(carId: string): number {
  return carParams(getCar(carId)).maxSpeed * 1.32 * 1.12 + 6;
}

export const carColor = (carId: string, paint: { color: string } | null) => paint?.color ?? getCar(carId).color;
export const carName = (carId: string) => getCar(carId).name;
export const mapTheme = (mapId: string) => getMap(mapId).theme;
