import { useCallback, useEffect, useState } from 'react';
import { CARS } from '../data/cars';
import { DEFAULT_LOOK } from '../data/cosmetics';
import { detectLang, setLang, type Lang } from '../i18n';
import type { Accessory, Difficulty, DriverLook, Paint, Quality } from '../game/types';

export interface SaveData {
  coins: number;
  owned: string[];
  selectedCar: string;
  muted: boolean;
  /** rear-view camera + side mirrors at the top of the race screen */
  mirrors: boolean;
  wins: number;
  races: number;
  lang: Lang;
  quality: Quality;
  intro: boolean;
  difficulty: Difficulty;
  /** custom paint per car id */
  paints: Record<string, Paint>;
  driver: DriverLook;
  ownedAccessories: Accessory[];
  /** highest story level completed (0 = none) */
  storyDone: number;
  /** best finishing place per story level */
  storyBest: Record<number, number>;
}

// key kept from the original name so existing progress is not lost
const KEY = 'turbo-rush-3d-save-v1';

const isMobile = () => typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && window.innerWidth < 900;

const DEFAULT: SaveData = {
  coins: 300,
  owned: CARS.filter((c) => c.price === 0).map((c) => c.id),
  selectedCar: CARS[0].id,
  muted: false,
  mirrors: true,
  wins: 0,
  races: 0,
  lang: detectLang(),
  quality: isMobile() ? 'medium' : 'high',
  intro: true,
  difficulty: 'medium',
  paints: {},
  driver: DEFAULT_LOOK,
  ownedAccessories: [],
  storyDone: 0,
  storyBest: {},
};

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const data = { ...DEFAULT, ...JSON.parse(raw) } as SaveData;
    data.driver = { ...DEFAULT_LOOK, ...data.driver };
    // free cars are always owned
    for (const c of CARS) if (c.price === 0 && !data.owned.includes(c.id)) data.owned.push(c.id);
    if (!data.owned.includes(data.selectedCar)) data.selectedCar = DEFAULT.selectedCar;
    return data;
  } catch {
    return DEFAULT;
  }
}

export function useSave() {
  const [save, setSave] = useState<SaveData>(() => {
    const s = load();
    setLang(s.lang);
    return s;
  });

  useEffect(() => {
    setLang(save.lang);
    try {
      localStorage.setItem(KEY, JSON.stringify(save));
    } catch {
      /* storage unavailable (private mode) — progress lives in memory only */
    }
  }, [save]);

  const update = useCallback((fn: (s: SaveData) => SaveData) => setSave((s) => fn(s)), []);
  return [save, update] as const;
}
