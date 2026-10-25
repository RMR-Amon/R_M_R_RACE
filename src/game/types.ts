export type ThemeId = 'city' | 'desert' | 'ocean' | 'pixel' | 'candy';

export type BodyType = 'sport' | 'muscle' | 'f1' | 'suv' | 'buggy' | 'cyber' | 'retro' | 'kart' | 'van';

export interface CarStats {
  /** All stats are 1..10 */
  speed: number;
  accel: number;
  handling: number;
  braking: number;
  weight: number;
}

export interface CarDef {
  id: string;
  name: string;
  body: BodyType;
  color: string;
  accent: string;
  /** Optional glow colour (neon trims) */
  glow?: string;
  price: number;
  stats: CarStats;
  description: string;
}

/** Physical parameters derived from stats */
export interface CarParams {
  maxSpeed: number;
  accel: number;
  turnRate: number;
  brake: number;
  grip: number;
  mass: number;
}

export type ItemType = 'missile' | 'bomb' | 'oil' | 'boost' | 'shield' | 'ice';

export type GameMode = { kind: 'race'; laps: number } | { kind: 'battle'; duration: number };

export interface RaceConfig {
  mapId: string;
  theme: ThemeId;
  mode: GameMode;
  carId: string;
}

export interface StandingRow {
  id: number;
  name: string;
  isPlayer: boolean;
  color: string;
  place: number;
  lap: number;
  points: number;
  finished: boolean;
}

export interface HudState {
  phase: 'countdown' | 'racing' | 'finished';
  countdown: number;
  speedKmh: number;
  place: number;
  total: number;
  lap: number;
  laps: number;
  time: number;
  timeLeft: number;
  item: ItemType | null;
  itemCharges: number;
  rouletting: boolean;
  boost: number;
  shield: number;
  frozen: boolean;
  points: number;
  standings: StandingRow[];
  message: string;
  messageId: number;
}

export interface ResultRow {
  name: string;
  isPlayer: boolean;
  color: string;
  carName: string;
  place: number;
  time: number | null;
  points: number;
  hits: number;
  coins: number;
}

export interface RaceResult {
  mode: GameMode;
  mapName: string;
  rows: ResultRow[];
  playerCoins: number;
  playerPlace: number;
}
