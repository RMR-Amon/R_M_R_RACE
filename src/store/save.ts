import { useCallback, useEffect, useState } from 'react';
import { CARS } from '../data/cars';

export interface SaveData {
  coins: number;
  owned: string[];
  selectedCar: string;
  muted: boolean;
  wins: number;
  races: number;
}

// key kept from the original name so existing progress is not lost
const KEY = 'turbo-rush-3d-save-v1';

const DEFAULT: SaveData = {
  coins: 300,
  owned: CARS.filter((c) => c.price === 0).map((c) => c.id),
  selectedCar: CARS[0].id,
  muted: false,
  wins: 0,
  races: 0,
};

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const data = { ...DEFAULT, ...JSON.parse(raw) } as SaveData;
    // free cars are always owned
    for (const c of CARS) if (c.price === 0 && !data.owned.includes(c.id)) data.owned.push(c.id);
    if (!data.owned.includes(data.selectedCar)) data.selectedCar = DEFAULT.selectedCar;
    return data;
  } catch {
    return DEFAULT;
  }
}

export function useSave() {
  const [save, setSave] = useState<SaveData>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(save));
    } catch {
      /* storage unavailable (private mode) — progress lives in memory only */
    }
  }, [save]);

  const update = useCallback((fn: (s: SaveData) => SaveData) => setSave((s) => fn(s)), []);
  return [save, update] as const;
}
