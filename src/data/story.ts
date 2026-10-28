import type { Difficulty, DriverLook } from '../game/types';
import { t, type TKey } from '../i18n';

export interface StoryLevel {
  n: number;
  chapter: number;
  mapId: string;
  laps: number;
  difficulty: Difficulty;
  opponents: number;
  items: boolean;
  /** every 10th level is a 1-on-1 duel against the chapter boss */
  duel: boolean;
  /** finishing place needed to pass the level */
  needPlace: number;
  reward: number;
}

export interface Boss {
  carId: string;
  look: DriverLook;
}

const CHAPTER_MAPS = ['city', 'desert', 'ocean', 'pixel', 'candy', 'city', 'desert', 'ocean', 'pixel'];
const ALL_MAPS = ['city', 'desert', 'ocean', 'pixel', 'candy'];

export const BOSSES: Boss[] = [
  { carId: 'viper', look: { skin: '#f1c27d', suit: '#facc15', suitAccent: '#111827', helmet: '#facc15', visor: '#111827', hair: '#dc2626', accessories: ['shades'] } },
  { carId: 'dune', look: { skin: '#c68642', suit: '#f97316', suitAccent: '#fde68a', helmet: '#f5deb3', visor: '#7c2d12', hair: '#1c1917', accessories: ['scarf'] } },
  { carId: 'glacier', look: { skin: '#ffdbac', suit: '#0ea5e9', suitAccent: '#f8fafc', helmet: '#f8fafc', visor: '#1e3a8a', hair: '#f5f5f4', accessories: ['cap'] } },
  { carId: 'kart', look: { skin: '#e0ac69', suit: '#e11d48', suitAccent: '#2563eb', helmet: '#e11d48', visor: '#22d3ee', hair: '#4a2f1a', accessories: ['crown'] } },
  { carId: 'sugar', look: { skin: '#ffdbac', suit: '#ec4899', suitAccent: '#fde68a', helmet: '#ec4899', visor: '#a855f7', hair: '#d6a756', accessories: ['chain', 'glasses'] } },
  { carId: 'shadow', look: { skin: '#8d5524', suit: '#111827', suitAccent: '#ef4444', helmet: '#111827', visor: '#ef4444', hair: '#1c1917', accessories: ['cape'] } },
  { carId: 'inferno', look: { skin: '#c68642', suit: '#b91c1c', suitAccent: '#f97316', helmet: '#f97316', visor: '#111827', hair: '#1c1917', accessories: ['mohawk'] } },
  { carId: 'neon', look: { skin: '#5c3a21', suit: '#7c3aed', suitAccent: '#22d3ee', helmet: '#06b6d4', visor: '#a855f7', hair: '#2563eb', accessories: ['headphones'] } },
  { carId: 'apex', look: { skin: '#f1c27d', suit: '#22c55e', suitAccent: '#111827', helmet: '#22c55e', visor: '#e5e7eb', hair: '#ec4899', accessories: ['shades', 'chain'] } },
  { carId: 'golden', look: { skin: '#e0ac69', suit: '#eab308', suitAccent: '#f8fafc', helmet: '#eab308', visor: '#111827', hair: '#1c1917', accessories: ['crown', 'cape'] } },
];

function chapterDifficulty(ch: number, duel: boolean): Difficulty {
  if (ch <= 2) return duel ? 'medium' : 'easy';
  if (ch <= 4) return duel ? 'hard' : 'medium';
  if (ch <= 7) return 'hard';
  if (ch <= 9) return duel ? 'impossible' : 'hard';
  return 'impossible';
}

/** 100 levels in 10 chapters of 10; the last level of every chapter is a duel */
export const STORY: StoryLevel[] = Array.from({ length: 100 }, (_, i) => {
  const n = i + 1;
  const chapter = Math.ceil(n / 10);
  const k = (n - 1) % 10; // 0..9 inside the chapter
  const duel = k === 9;
  const mapId = chapter === 10 ? ALL_MAPS[k % ALL_MAPS.length] : k % 4 === 3 ? ALL_MAPS[(chapter + k) % ALL_MAPS.length] : CHAPTER_MAPS[chapter - 1];
  const laps = duel ? (chapter >= 6 ? 3 : 2) : 1 + Math.floor(k / 4) + (chapter >= 7 && k >= 6 ? 1 : 0);
  return {
    n,
    chapter,
    mapId,
    laps: Math.min(4, laps),
    difficulty: chapterDifficulty(chapter, duel),
    opponents: duel ? 1 : chapter === 1 ? 3 : chapter === 2 ? 4 : 5,
    items: duel ? true : n % 7 !== 0,
    duel,
    needPlace: duel ? 1 : chapter <= 3 ? 3 : chapter <= 9 ? 2 : 1,
    reward: Math.round((120 + n * 14) * (duel ? 2.5 : 1)),
  };
});

export const chapterTitle = (ch: number) => t(`ch${ch}.title` as TKey);
export const chapterText = (ch: number) => t(`ch${ch}.text` as TKey);
export const bossName = (ch: number) => t(`ch${ch}.boss` as TKey);
