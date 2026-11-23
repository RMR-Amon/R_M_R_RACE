import type { RaceLink } from '../net/raceLink';

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

/** Engine layout — drives the synthesized engine sound */
export type EngineKind = 'i4' | 'v6' | 'v8' | 'v12' | 'single' | 'electric' | 'diesel' | 'f1' | 'boxer';

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
  engine: EngineKind;
}

/** Physical parameters derived from stats */
export interface CarParams {
  maxSpeed: number;
  accel: number;
  turnRate: number;
  brake: number;
  grip: number;
  mass: number;
  /** how well the car keeps a slide under control */
  drift: number;
  gears: number;
}

export type ItemType = 'missile' | 'bomb' | 'oil' | 'boost' | 'shield' | 'ice' | 'fly';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'impossible';

export type Quality = 'low' | 'medium' | 'high';

export type GameMode = { kind: 'race'; laps: number } | { kind: 'battle'; duration: number };

export type Accessory = 'glasses' | 'shades' | 'cap' | 'crown' | 'headphones' | 'scarf' | 'chain' | 'mohawk' | 'cape';

export interface DriverLook {
  skin: string;
  suit: string;
  suitAccent: string;
  helmet: string;
  visor: string;
  hair: string;
  accessories: Accessory[];
}

export interface Paint {
  color: string;
  accent: string;
}

export interface RaceConfig {
  mapId: string;
  theme: ThemeId;
  mode: GameMode;
  carId: string;
  difficulty: Difficulty;
  /** number of AI opponents */
  opponents: number;
  items: boolean;
  paint?: Paint;
  driver: DriverLook;
  /** story level (1..100) when started from the campaign */
  storyLevel?: number;
  /** fixed rival for 1-on-1 duels */
  rival?: { carId: string; name: string; look: DriverLook };
  intro: boolean;
  quality: Quality;
  /** LAN multiplayer: link to the match on the host (absent in single player) */
  net?: RaceLink;
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
  /** LAN: the player's connection dropped (the host keeps the slot for a while) */
  offline?: boolean;
}

export interface HudState {
  phase: 'intro' | 'countdown' | 'racing' | 'finished';
  countdown: number;
  speedKmh: number;
  gear: number;
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
  /** seconds of flight left (lucky-block "fly") */
  fly: number;
  /** drift intensity 0..1 (>= ~0.5 is a "good" drift that can dodge missiles) */
  drift: number;
  /** a missile is homing on the player: fuse seconds left + distance in metres */
  incoming: { time: number; dist: number } | null;
  /** the player's own missile in flight: fuse seconds left */
  ownMissile: number | null;
  mirrors: boolean;
  points: number;
  mistakes: number;
  difficulty: Difficulty;
  standings: StandingRow[];
  message: string;
  messageId: number;
  /** LAN multiplayer status (null in single player) */
  net: { waiting: boolean; rtt: number; conn: 'connecting' | 'open' | 'reconnecting' | 'closed' } | null;
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
  mistakes: number;
  storyLevel?: number;
}
