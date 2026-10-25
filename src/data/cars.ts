import type { CarDef, CarParams } from '../game/types';

export const CARS: CarDef[] = [
  {
    id: 'ember',
    name: 'Ember GT',
    body: 'sport',
    color: '#e11d2e',
    accent: '#111111',
    price: 0,
    stats: { speed: 7, accel: 6, handling: 6, braking: 6, weight: 5 },
    description: 'Сбалансированный спорткар. Отличный выбор для старта.',
  },
  {
    id: 'urban',
    name: 'Urban Hopper',
    body: 'retro',
    color: '#34d399',
    accent: '#f8fafc',
    price: 0,
    stats: { speed: 4, accel: 7, handling: 8, braking: 7, weight: 4 },
    description: 'Маленький и юркий хэтчбек. Легко входит в любые повороты.',
  },
  {
    id: 'titan',
    name: 'Titan X',
    body: 'suv',
    color: '#1e3a8a',
    accent: '#94a3b8',
    price: 0,
    stats: { speed: 5, accel: 5, handling: 4, braking: 6, weight: 9 },
    description: 'Тяжёлый внедорожник. Баррикады и удары ему почти не страшны.',
  },
  {
    id: 'kart',
    name: 'Turbo Kart',
    body: 'kart',
    color: '#22c55e',
    accent: '#facc15',
    price: 600,
    stats: { speed: 4, accel: 9, handling: 10, braking: 8, weight: 2 },
    description: 'Карт с мгновенным разгоном и идеальным управлением.',
  },
  {
    id: 'van',
    name: 'Party Van',
    body: 'van',
    color: '#f472b6',
    accent: '#fde68a',
    price: 500,
    stats: { speed: 4, accel: 4, handling: 4, braking: 5, weight: 10 },
    description: 'Фургон-вечеринка. Медленный, но расталкивает всех.',
  },
  {
    id: 'viper',
    name: 'Viper Muscle',
    body: 'muscle',
    color: '#facc15',
    accent: '#0a0a0a',
    price: 800,
    stats: { speed: 8, accel: 7, handling: 4, braking: 5, weight: 7 },
    description: 'Американский маслкар с мощным V8 и гоночными полосами.',
  },
  {
    id: 'dune',
    name: 'Dune Rider',
    body: 'buggy',
    color: '#f97316',
    accent: '#1f2937',
    price: 900,
    stats: { speed: 5, accel: 8, handling: 7, braking: 6, weight: 4 },
    description: 'Багги для пустыни. Резвый и цепкий.',
  },
  {
    id: 'glacier',
    name: 'Glacier',
    body: 'sport',
    color: '#bae6fd',
    accent: '#0ea5e9',
    price: 1200,
    stats: { speed: 7, accel: 7, handling: 7, braking: 7, weight: 5 },
    description: 'Ледяной спорткар с отточенной аэродинамикой.',
  },
  {
    id: 'neon',
    name: 'Neon Phantom',
    body: 'cyber',
    color: '#6d28d9',
    accent: '#0f172a',
    glow: '#22d3ee',
    price: 1500,
    stats: { speed: 8, accel: 6, handling: 6, braking: 7, weight: 6 },
    description: 'Кибер-кар с неоновой подсветкой из будущего.',
  },
  {
    id: 'sugar',
    name: 'Sugar Rush',
    body: 'retro',
    color: '#fb7185',
    accent: '#fff1f2',
    price: 1800,
    stats: { speed: 6, accel: 8, handling: 8, braking: 7, weight: 3 },
    description: 'Сладкий ретро-кар. Лёгкий и задорный.',
  },
  {
    id: 'inferno',
    name: 'Inferno V12',
    body: 'muscle',
    color: '#b91c1c',
    accent: '#f97316',
    price: 2500,
    stats: { speed: 9, accel: 8, handling: 5, braking: 6, weight: 7 },
    description: 'Огненный монстр с двенадцатью цилиндрами.',
  },
  {
    id: 'shadow',
    name: 'Shadow RS',
    body: 'cyber',
    color: '#111827',
    accent: '#ef4444',
    glow: '#ef4444',
    price: 3000,
    stats: { speed: 9, accel: 9, handling: 7, braking: 8, weight: 5 },
    description: 'Тёмный охотник. Быстрый и опасный.',
  },
  {
    id: 'apex',
    name: 'Apex F1',
    body: 'f1',
    color: '#f8fafc',
    accent: '#dc2626',
    price: 3500,
    stats: { speed: 10, accel: 9, handling: 9, braking: 9, weight: 2 },
    description: 'Болид Формулы. Максимальная скорость, но очень лёгкий.',
  },
  {
    id: 'golden',
    name: 'Golden Legend',
    body: 'sport',
    color: '#eab308',
    accent: '#1c1917',
    glow: '#fde047',
    price: 5000,
    stats: { speed: 10, accel: 8, handling: 8, braking: 8, weight: 6 },
    description: 'Легенда из чистого золота. Для настоящих чемпионов.',
  },
];

export const getCar = (id: string): CarDef => CARS.find((c) => c.id === id) ?? CARS[0];

/**
 * Speeds are deliberately moderate so races feel controllable and enjoyable.
 * Units: metres / second. 1 m/s is shown as 3.6 km/h * 1.1 visual scale.
 */
export function carParams(def: CarDef): CarParams {
  const s = def.stats;
  return {
    maxSpeed: 31 + s.speed * 1.5, // 32.5 .. 46
    accel: 6.5 + s.accel * 0.85, // 7.3 .. 15
    turnRate: 0.95 + s.handling * 0.07, // 1.02 .. 1.65 rad/s
    brake: 16 + s.braking * 2, // 18 .. 36
    grip: 3.2 + s.handling * 0.45,
    mass: 0.6 + s.weight * 0.1,
  };
}
