import type { ThemeId } from '../game/types';
import { t, type TKey } from '../i18n';

export interface MapDef {
  id: string;
  theme: ThemeId;
  /** Control points of the closed track centre line (x, z) */
  points: [number, number][];
  width: number;
  arena?: boolean;
  /** battle arena: an ellipse with semi-axes a (x) and b (z), drivable everywhere inside */
  oval?: { a: number; b: number };
  seed: number;
}

export interface ThemeInfo {
  id: ThemeId;
  emoji: string;
  gradient: string;
  accent: string;
}

export const THEMES: Record<ThemeId, ThemeInfo> = {
  city: { id: 'city', emoji: '🌆', gradient: 'from-indigo-600 via-fuchsia-600 to-orange-400', accent: '#f472b6' },
  desert: { id: 'desert', emoji: '🏜️', gradient: 'from-amber-300 via-orange-500 to-red-600', accent: '#f59e0b' },
  ocean: { id: 'ocean', emoji: '🐠', gradient: 'from-cyan-400 via-blue-600 to-indigo-900', accent: '#22d3ee' },
  pixel: { id: 'pixel', emoji: '👾', gradient: 'from-lime-400 via-emerald-500 to-sky-500', accent: '#84cc16' },
  candy: { id: 'candy', emoji: '🍭', gradient: 'from-pink-300 via-rose-400 to-purple-500', accent: '#f9a8d4' },
};

export const themeName = (id: ThemeId) => t(`theme.${id}` as TKey);
export const mapName = (m: MapDef) => t(`map.${m.id}.name` as TKey);
export const mapDesc = (m: MapDef) => t(`map.${m.id}.desc` as TKey);

export const RACE_MAPS: MapDef[] = [
  {
    id: 'city',
    theme: 'city',
    width: 34,
    seed: 11,
    points: [
      [0, -330], [230, -330], [380, -240], [420, -60], [340, 90], [360, 250], [220, 350],
      [30, 310], [-100, 215], [-240, 250], [-380, 150], [-400, -80], [-300, -270], [-150, -330],
    ],
  },
  {
    id: 'desert',
    theme: 'desert',
    width: 34,
    seed: 23,
    points: [
      [0, -360], [270, -310], [400, -150], [330, 20], [420, 190], [280, 360], [70, 320],
      [-70, 400], [-280, 340], [-350, 150], [-270, 15], [-380, -130], [-270, -310],
    ],
  },
  {
    id: 'ocean',
    theme: 'ocean',
    width: 34,
    seed: 37,
    points: [
      [0, -310], [210, -350], [390, -230], [390, -40], [290, 85], [370, 230], [230, 350],
      [0, 310], [-190, 370], [-370, 250], [-310, 50], [-390, -160], [-230, -310],
    ],
  },
  {
    id: 'pixel',
    theme: 'pixel',
    width: 34,
    seed: 41,
    points: [
      [0, -350], [300, -350], [400, -260], [400, -80], [350, 10], [400, 100], [400, 290],
      [310, 380], [80, 390], [-30, 335], [-140, 390], [-330, 380], [-420, 280], [-420, -260], [-330, -350],
    ],
  },
  {
    id: 'candy',
    theme: 'candy',
    width: 34,
    seed: 53,
    points: [
      [0, -310], [250, -370], [410, -250], [390, -40], [250, 40], [275, 195], [345, 335],
      [180, 430], [-20, 340], [-210, 390], [-390, 270], [-360, 50], [-250, -50], [-310, -210], [-200, -320],
    ],
  },
];

const OVAL = { a: 165, b: 105 };
/** half-width of the virtual ring along the arena wall (used for AI and spectators) */
const ARENA_RING = 20;

function ovalRing(): [number, number][] {
  const pts: [number, number][] = [];
  const n = 96;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * (OVAL.a - ARENA_RING), Math.sin(a) * (OVAL.b - ARENA_RING)]);
  }
  return pts;
}

export const ARENA_MAP: MapDef = {
  id: 'arena',
  theme: 'city',
  width: ARENA_RING * 2,
  arena: true,
  oval: OVAL,
  seed: 77,
  points: ovalRing(),
};

export const getMap = (id: string): MapDef =>
  id === 'arena' ? ARENA_MAP : RACE_MAPS.find((m) => m.id === id) ?? RACE_MAPS[0];
