import type { ThemeId } from '../game/types';

export interface MapDef {
  id: string;
  name: string;
  theme: ThemeId;
  description: string;
  /** Control points of the closed track centre line (x, z) */
  points: [number, number][];
  width: number;
  arena?: boolean;
  seed: number;
}

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  emoji: string;
  gradient: string;
  accent: string;
}

export const THEMES: Record<ThemeId, ThemeInfo> = {
  city: { id: 'city', name: 'Город', emoji: '🌆', gradient: 'from-indigo-600 via-fuchsia-600 to-orange-400', accent: '#f472b6' },
  desert: { id: 'desert', name: 'Пустыня', emoji: '🏜️', gradient: 'from-amber-300 via-orange-500 to-red-600', accent: '#f59e0b' },
  ocean: { id: 'ocean', name: 'Под водой', emoji: '🐠', gradient: 'from-cyan-400 via-blue-600 to-indigo-900', accent: '#22d3ee' },
  pixel: { id: 'pixel', name: 'Пиксельный мир', emoji: '👾', gradient: 'from-lime-400 via-emerald-500 to-sky-500', accent: '#84cc16' },
  candy: { id: 'candy', name: 'Мир сладостей', emoji: '🍭', gradient: 'from-pink-300 via-rose-400 to-purple-500', accent: '#f9a8d4' },
};

export const RACE_MAPS: MapDef[] = [
  {
    id: 'city',
    name: 'Неоновый Мегаполис',
    theme: 'city',
    description: 'Ночные улицы, небоскрёбы и разрушенный мост над рекой.',
    width: 34,
    seed: 11,
    points: [
      [0, -330], [230, -330], [380, -240], [420, -60], [340, 90], [360, 250], [220, 350],
      [30, 310], [-100, 215], [-240, 250], [-380, 150], [-400, -80], [-300, -270], [-150, -330],
    ],
  },
  {
    id: 'desert',
    name: 'Каньон Миражей',
    theme: 'desert',
    description: 'Раскалённые дюны, кактусы, пирамиды и огромный каньон.',
    width: 34,
    seed: 23,
    points: [
      [0, -360], [270, -310], [400, -150], [330, 20], [420, 190], [280, 360], [70, 320],
      [-70, 400], [-280, 340], [-350, 150], [-270, 15], [-380, -130], [-270, -310],
    ],
  },
  {
    id: 'ocean',
    name: 'Коралловый Риф',
    theme: 'ocean',
    description: 'Подводная трасса среди кораллов, рыб и глубоководной впадины.',
    width: 34,
    seed: 37,
    points: [
      [0, -310], [210, -350], [390, -230], [390, -40], [290, 85], [370, 230], [230, 350],
      [0, 310], [-190, 370], [-370, 250], [-310, 50], [-390, -160], [-230, -310],
    ],
  },
  {
    id: 'pixel',
    name: '8-Бит Королевство',
    theme: 'pixel',
    description: 'Ретро-мир из кубиков, труб и парящих блоков.',
    width: 34,
    seed: 41,
    points: [
      [0, -350], [300, -350], [400, -260], [400, -80], [350, 10], [400, 100], [400, 290],
      [310, 380], [80, 390], [-30, 335], [-140, 390], [-330, 380], [-420, 280], [-420, -260], [-330, -350],
    ],
  },
  {
    id: 'candy',
    name: 'Сахарная Спираль',
    theme: 'candy',
    description: 'Леденцы, кексы, пончики и шоколадная река.',
    width: 34,
    seed: 53,
    points: [
      [0, -310], [250, -370], [410, -250], [390, -40], [250, 40], [275, 195], [345, 335],
      [180, 430], [-20, 340], [-210, 390], [-390, 270], [-360, 50], [-250, -50], [-310, -210], [-200, -320],
    ],
  },
];

/** Rounded-rectangle arena for battle mode */
function stadiumPoints(halfLen: number, halfWid: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [
    [halfLen - r, -(halfWid - r), -Math.PI / 2],
    [halfLen - r, halfWid - r, 0],
    [-(halfLen - r), halfWid - r, Math.PI / 2],
    [-(halfLen - r), -(halfWid - r), Math.PI],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return pts;
}

export const ARENA_MAP: MapDef = {
  id: 'arena',
  name: 'Арена Битвы',
  theme: 'city',
  description: 'Прямоугольно-круглая арена. Попадай во врагов и набирай очки!',
  width: 52,
  arena: true,
  seed: 77,
  points: stadiumPoints(230, 140, 110),
};

export const getMap = (id: string): MapDef =>
  id === 'arena' ? ARENA_MAP : RACE_MAPS.find((m) => m.id === id) ?? RACE_MAPS[0];
