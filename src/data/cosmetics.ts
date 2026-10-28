import type { Accessory, DriverLook } from '../game/types';
import type { Rng } from '../game/rng';

export const PAINT_COLORS = [
  '#e11d2e', '#f97316', '#facc15', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#1e3a8a', '#6d28d9', '#a855f7', '#ec4899', '#fb7185', '#f8fafc', '#a1a1aa', '#3f3f46',
  '#111111', '#78350f', '#eab308', '#bae6fd',
];

export const SKIN_TONES = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a21'];
export const SUIT_COLORS = ['#e11d48', '#f97316', '#facc15', '#22c55e', '#0ea5e9', '#2563eb', '#7c3aed', '#ec4899', '#f8fafc', '#111827', '#64748b', '#0f766e'];
export const HELMET_COLORS = ['#f8fafc', '#111827', '#e11d48', '#facc15', '#22c55e', '#2563eb', '#a855f7', '#f97316', '#ec4899', '#06b6d4', '#eab308'];
export const VISOR_COLORS = ['#0b1220', '#1e3a8a', '#7c2d12', '#facc15', '#a855f7', '#22d3ee', '#e5e7eb'];
export const HAIR_COLORS = ['#1c1917', '#4a2f1a', '#8b5a2b', '#d6a756', '#f5f5f4', '#dc2626', '#2563eb', '#ec4899'];

export type Slot = 'head' | 'face' | 'neck' | 'back';

/** Purchasable driver accessories; only one item per slot can be worn */
export const ACCESSORIES: { id: Accessory; icon: string; price: number; slot: Slot }[] = [
  { id: 'glasses', icon: '👓', price: 150, slot: 'face' },
  { id: 'shades', icon: '🕶️', price: 250, slot: 'face' },
  { id: 'cap', icon: '🧢', price: 200, slot: 'head' },
  { id: 'headphones', icon: '🎧', price: 300, slot: 'head' },
  { id: 'mohawk', icon: '💈', price: 350, slot: 'head' },
  { id: 'crown', icon: '👑', price: 1500, slot: 'head' },
  { id: 'scarf', icon: '🧣', price: 200, slot: 'neck' },
  { id: 'chain', icon: '📿', price: 600, slot: 'neck' },
  { id: 'cape', icon: '🦸', price: 900, slot: 'back' },
];

export const accessorySlot = (a: Accessory): Slot => ACCESSORIES.find((x) => x.id === a)!.slot;

export const DEFAULT_LOOK: DriverLook = {
  skin: SKIN_TONES[1],
  suit: '#e11d48',
  suitAccent: '#f8fafc',
  helmet: '#f8fafc',
  visor: '#0b1220',
  hair: HAIR_COLORS[0],
  accessories: [],
};

/** Random outfit for AI drivers */
export function randomLook(rng: Rng): DriverLook {
  const acc: Accessory[] = [];
  if (rng.chance(0.35)) acc.push(rng.pick(['glasses', 'shades'] as const));
  if (rng.chance(0.3)) acc.push(rng.pick(['cap', 'headphones', 'mohawk'] as const));
  if (rng.chance(0.25)) acc.push(rng.pick(['scarf', 'chain'] as const));
  return {
    skin: rng.pick(SKIN_TONES),
    suit: rng.pick(SUIT_COLORS),
    suitAccent: rng.pick(SUIT_COLORS),
    helmet: rng.pick(HELMET_COLORS),
    visor: rng.pick(VISOR_COLORS),
    hair: rng.pick(HAIR_COLORS),
    accessories: acc,
  };
}
