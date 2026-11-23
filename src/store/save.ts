import { useCallback, useEffect, useState } from 'react';
import { CARS } from '../data/cars';
import { DEFAULT_LOOK } from '../data/cosmetics';
import { detectLang, setLang, type Lang } from '../i18n';
import type { Accessory, Difficulty, DriverLook, Paint, Quality } from '../game/types';
import { migratePlain, secureGet, secureSet } from './secure';

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
  /** name shown to other players in LAN multiplayer */
  netName: string;
}

/** logical save name — stored under a hashed key, obfuscated and signed (see secure.ts) */
const SAVE_NAME = 'save';
/** the old plain-text key; migrated once and then removed */
const LEGACY_KEY = 'turbo-rush-3d-save-v1';

const isMobile = () =>
  typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && Math.min(window.innerWidth, window.innerHeight) < 900;

const DEFAULT: SaveData = {
  coins: 300,
  owned: CARS.filter((c) => c.price === 0).map((c) => c.id),
  selectedCar: CARS[0].id,
  muted: false,
  // three extra scene renders per frame are too much for most phones
  mirrors: !isMobile(),
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
  netName: '',
};

function load(): SaveData {
  try {
    const stored = secureGet<Partial<SaveData>>(SAVE_NAME) ?? migratePlain<Partial<SaveData>>(LEGACY_KEY, SAVE_NAME);
    if (!stored || typeof stored !== 'object') return DEFAULT;
    const data = { ...DEFAULT, ...stored } as SaveData;
    if (!Array.isArray(data.owned)) data.owned = [...DEFAULT.owned];
    if (typeof data.coins !== 'number' || !Number.isFinite(data.coins) || data.coins < 0) data.coins = DEFAULT.coins;
    data.driver = { ...DEFAULT_LOOK, ...data.driver };
    // free cars are always owned
    for (const c of CARS) if (c.price === 0 && !data.owned.includes(c.id)) data.owned.push(c.id);
    if (!data.owned.includes(data.selectedCar)) data.selectedCar = DEFAULT.selectedCar;
    if (typeof data.netName !== 'string') data.netName = '';
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
    secureSet(SAVE_NAME, save);
  }, [save]);

  const update = useCallback((fn: (s: SaveData) => SaveData) => setSave((s) => fn(s)), []);
  return [save, update] as const;
}
