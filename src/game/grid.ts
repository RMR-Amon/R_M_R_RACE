import type { Track } from './track';

/** Starting spot of a car on the grid (also used by the LAN server to validate the start) */
export interface GridSpot {
  x: number;
  z: number;
  heading: number;
  /** track distance used for the start progress */
  d: number;
  lat: number;
}

/**
 * Grid position of car number `k` out of `total`.
 * Race: rows of two behind the start line. Arena: spread around the oval facing the centre.
 */
export function gridSpot(track: Track, k: number, total: number, battle: boolean): GridSpot {
  const L = track.length;
  const oval = track.oval;
  if (oval) {
    const a = (k / total) * Math.PI * 2;
    const x = Math.cos(a) * oval.a * 0.62;
    const z = Math.sin(a) * oval.b * 0.62;
    const pr = track.project(x, z);
    return { x, z, heading: Math.atan2(-x, -z), d: pr.d, lat: pr.lat };
  }
  if (battle) {
    const d = (k / total) * L;
    const p = track.pointAt(d, 0);
    return { ...p, d, lat: 0 };
  }
  const row = Math.floor(k / 2);
  const d = L - 12 - row * 11;
  const lat = k % 2 ? 7 : -7;
  const p = track.pointAt(d, lat);
  return { ...p, d, lat };
}

/** progress value a car starts the race with (negative: the cars start behind the line) */
export function startProgress(track: Track, spot: GridSpot, battle: boolean) {
  return battle ? spot.d : -track.ahead(spot.d, 0);
}
