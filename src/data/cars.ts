import type { CarDef, CarParams, Paint } from '../game/types';
import { t, type TKey } from '../i18n';

/** Every car has a unique stat line, so each one drives differently */
export const CARS: CarDef[] = [
  { id: 'ember', name: 'Ember GT', body: 'sport', color: '#e11d2e', accent: '#111111', price: 0, engine: 'i4',
    stats: { speed: 7, accel: 6, handling: 6, braking: 6, weight: 5 } },
  { id: 'urban', name: 'Urban Hopper', body: 'retro', color: '#34d399', accent: '#f8fafc', price: 0, engine: 'i4',
    stats: { speed: 4, accel: 7, handling: 8, braking: 7, weight: 3 } },
  { id: 'titan', name: 'Titan X', body: 'suv', color: '#1e3a8a', accent: '#94a3b8', price: 0, engine: 'diesel',
    stats: { speed: 5, accel: 4, handling: 4, braking: 6, weight: 9 } },
  { id: 'kart', name: 'Turbo Kart', body: 'kart', color: '#22c55e', accent: '#facc15', price: 600, engine: 'single',
    stats: { speed: 3, accel: 10, handling: 10, braking: 8, weight: 1 } },
  { id: 'van', name: 'Party Van', body: 'van', color: '#f472b6', accent: '#fde68a', price: 500, engine: 'diesel',
    stats: { speed: 4, accel: 3, handling: 3, braking: 4, weight: 10 } },
  { id: 'viper', name: 'Viper Muscle', body: 'muscle', color: '#facc15', accent: '#0a0a0a', price: 800, engine: 'v8',
    stats: { speed: 8, accel: 7, handling: 3, braking: 5, weight: 7 } },
  { id: 'dune', name: 'Dune Rider', body: 'buggy', color: '#f97316', accent: '#1f2937', price: 900, engine: 'boxer',
    stats: { speed: 5, accel: 8, handling: 7, braking: 5, weight: 4 } },
  { id: 'glacier', name: 'Glacier', body: 'sport', color: '#bae6fd', accent: '#0ea5e9', price: 1200, engine: 'v6',
    stats: { speed: 7, accel: 7, handling: 7, braking: 9, weight: 5 } },
  { id: 'neon', name: 'Neon Phantom', body: 'cyber', color: '#6d28d9', accent: '#0f172a', glow: '#22d3ee', price: 1500, engine: 'electric',
    stats: { speed: 7, accel: 10, handling: 6, braking: 7, weight: 6 } },
  { id: 'sugar', name: 'Sugar Rush', body: 'retro', color: '#fb7185', accent: '#fff1f2', price: 1800, engine: 'i4',
    stats: { speed: 6, accel: 8, handling: 9, braking: 6, weight: 3 } },
  { id: 'inferno', name: 'Inferno V12', body: 'muscle', color: '#b91c1c', accent: '#f97316', price: 2500, engine: 'v12',
    stats: { speed: 10, accel: 7, handling: 4, braking: 6, weight: 8 } },
  { id: 'shadow', name: 'Shadow RS', body: 'cyber', color: '#111827', accent: '#ef4444', glow: '#ef4444', price: 3000, engine: 'v8',
    stats: { speed: 9, accel: 8, handling: 8, braking: 8, weight: 5 } },
  { id: 'apex', name: 'Apex F1', body: 'f1', color: '#f8fafc', accent: '#dc2626', price: 3500, engine: 'f1',
    stats: { speed: 10, accel: 9, handling: 10, braking: 10, weight: 2 } },
  { id: 'golden', name: 'Golden Legend', body: 'sport', color: '#eab308', accent: '#1c1917', glow: '#fde047', price: 5000, engine: 'v12',
    stats: { speed: 10, accel: 9, handling: 8, braking: 8, weight: 6 } },
];

export const getCar = (id: string): CarDef => CARS.find((c) => c.id === id) ?? CARS[0];

export const carDesc = (c: CarDef) => t(`car.${c.id}` as TKey);

/** Apply a custom paint job */
export const paintedCar = (def: CarDef, paint?: Paint): CarDef => (paint ? { ...def, color: paint.color, accent: paint.accent } : def);

/**
 * Converts the 1..10 stats into physics. Every stat is used by the simulation:
 * speed → top speed, accel → engine force (heavier cars pull less),
 * handling → steering rate, tyre grip and drift control, braking → brake force,
 * weight → collision mass (pushes others, resists being shoved and keeps more speed in hits).
 * Units: metres / second.
 */
export function carParams(def: CarDef): CarParams {
  const s = def.stats;
  const gears = def.engine === 'electric' || def.engine === 'single' ? 1 : def.engine === 'f1' ? 8 : def.engine === 'diesel' ? 5 : 6;
  return {
    maxSpeed: 29 + s.speed * 1.8, // 30.8 .. 47 (≈111 .. 169 km/h)
    accel: (6 + s.accel * 0.95) * (1.08 - s.weight * 0.016), // ≈ 8 .. 16.5
    turnRate: 0.92 + s.handling * 0.08, // 1.0 .. 1.72 rad/s
    brake: 14 + s.braking * 2.4, // 23.6 .. 38
    grip: 2.8 + s.handling * 0.5,
    mass: 0.5 + s.weight * 0.12,
    drift: 0.55 + s.handling * 0.07 + (def.body === 'buggy' ? 0.2 : 0),
    gears,
  };
}

/** Simulated 0–100 km/h time using the same acceleration curve as the race physics */
export function zeroTo100(def: CarDef): number {
  const p = carParams(def);
  let v = 0;
  let time = 0;
  const target = 100 / 3.6;
  while (v < target && time < 30) {
    const ratio = v / p.maxSpeed;
    v += p.accel * (1 - ratio * ratio * 0.85) * 0.01;
    time += 0.01;
  }
  return time;
}

export const massKg = (def: CarDef) => Math.round(520 + def.stats.weight * 170);
