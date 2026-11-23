/**
 * RMR_race LAN protocol — shared by the browser client and the Node host server.
 *
 * Two kinds of traffic:
 *  - control messages (lobby, match events): small JSON objects, rare;
 *  - car state (20 Hz per car): compact little-endian binary frames (29–37 bytes per car).
 *
 * Nothing in here touches the DOM or Node APIs, so both sides import the same code.
 */
import { NET } from './config';
import type { Accessory, DriverLook, ItemType, Paint, ThemeId } from '../game/types';

// ============================================================================ shared types

export type MatchMode = 'race' | 'battle';
export type RoomStatus = 'lobby' | 'loading' | 'racing';
export type PlayerStatus = 'online' | 'reconnecting';

export interface Profile {
  name: string;
  carId: string;
  paint: Paint | null;
  look: DriverLook;
}

export interface RoomSettings {
  name: string;
  maxPlayers: number;
  mode: MatchMode;
  /** race track id (race mode); the arena is always used for battle */
  mapId: string;
  /** arena theme (battle mode) */
  theme: ThemeId;
  laps: number;
  minutes: number;
  items: boolean;
  /** private rooms are listed with a lock and need the 4-digit code */
  private: boolean;
}

export interface PlayerInfo extends Profile {
  id: number;
  host: boolean;
  ready: boolean;
  /** round-trip time in ms (-1 = not measured yet) */
  ping: number;
  status: PlayerStatus;
}

export interface RoomState {
  id: string;
  settings: RoomSettings;
  status: RoomStatus;
  hostId: number;
  players: PlayerInfo[];
  /** only sent to the host of a private room */
  code?: string;
}

/** a room as it appears in the LAN room list */
export interface RoomListing {
  /** id of the host server process */
  sid: string;
  roomId: string;
  name: string;
  hostName: string;
  players: number;
  max: number;
  status: RoomStatus;
  mode: MatchMode;
  mapId: string;
  theme: ThemeId;
  laps: number;
  minutes: number;
  private: boolean;
  version: string;
  /** address of the host server; null = the server this page is talking to */
  address: string | null;
  port: number;
}

/** a room in the list shown to the player */
export interface DiscoveredRoom extends RoomListing {
  /** same protocol and game version as this client (others are shown but cannot be joined) */
  compatible: boolean;
}

/** the host server a browser is talking to */
export interface HostInfo {
  sid: string;
  /** LAN addresses of the machine, best (real Wi-Fi / Ethernet) first */
  addresses: string[];
  /** the same with interface names, so the player can pick the right one */
  interfaces: { name: string; address: string }[];
  port: number;
  /** false when the UDP discovery port could not be opened */
  discovery: boolean;
  version: string;
}

/** browser ↔ local LAN service ("agent" socket used for the room list) */
export type AgentClientMsg = { t: 'watch' } | { t: 'refresh' } | { t: 'ping'; c: number };
export type AgentMsg = { t: 'rooms'; rooms: DiscoveredRoom[]; self: HostInfo } | { t: 'pong'; c: number; s: number };

export interface RosterEntry extends Profile {
  id: number;
  /** grid slot (0 = pole) */
  slot: number;
}

export interface MatchInfo {
  /** new for every match (a resumed client compares it with the race it is running) */
  id: string;
  mode: MatchMode;
  mapId: string;
  theme: ThemeId;
  laps: number;
  /** battle length in seconds */
  duration: number;
  items: boolean;
  roster: RosterEntry[];
  /** set when (re)joining a match that is already running */
  goAt?: number;
  resume?: { x: number; z: number; heading: number; progress: number };
}

export interface StandingInfo {
  id: number;
  place: number;
  lap: number;
  progress: number;
  /** checkpoints passed in total */
  cp: number;
  finished: boolean;
  finishTime: number | null;
  points: number;
  hits: number;
  status: PlayerStatus;
}

export interface ResultInfo {
  id: number;
  name: string;
  carId: string;
  color: string;
  place: number;
  time: number | null;
  points: number;
  hits: number;
  coins: number;
}

export const PROJECTILE_KINDS = ['missile', 'ice'] as const;
export const HAZARD_KINDS = ['bomb', 'oil'] as const;
export const ITEM_KINDS: readonly ItemType[] = ['missile', 'bomb', 'oil', 'boost', 'shield', 'ice', 'fly'];
export type HitKind = 'missile' | 'ice' | 'bomb' | 'oil';

/** a lucky-block item used by a player (relayed to everybody else) */
export interface ItemEvent {
  kind: ItemType;
  /** unique per player (used to validate hits and drop duplicates) */
  shot: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  /** id of the targeted player for missiles, -1 = none */
  target: number;
}

// ============================================================================ control messages

export type ClientMsg =
  | { t: 'hello'; game: string; proto: number; join: 'create'; settings: RoomSettings; profile: Profile }
  | { t: 'hello'; game: string; proto: number; join: 'join'; roomId: string; code?: string; profile: Profile }
  | { t: 'hello'; game: string; proto: number; join: 'resume'; roomId: string; token: string }
  | { t: 'ping'; c: number; rtt?: number }
  | { t: 'settings'; n: number; s: RoomSettings }
  | { t: 'profile'; n: number; p: Profile }
  | { t: 'ready'; n: number; v: boolean }
  | { t: 'kick'; n: number; id: number }
  | { t: 'start'; n: number }
  | { t: 'close'; n: number }
  | { t: 'leave' }
  | { t: 'loaded'; n: number }
  | { t: 'item'; n: number; e: ItemEvent }
  | { t: 'hit'; n: number; owner: number; shot: number; kind: HitKind };

export type ServerMsg =
  | { t: 'welcome'; you: number; token: string; room: RoomState; time: number }
  | { t: 'error'; code: ErrorCode; detail?: string }
  | { t: 'pong'; c: number; s: number }
  | { t: 'room'; room: RoomState }
  | { t: 'notice'; key: NoticeKey; name?: string }
  | { t: 'kicked' }
  | { t: 'closed'; reason: 'host' | 'shutdown' }
  | { t: 'load'; match: MatchInfo }
  | { t: 'abort'; key: NoticeKey; name?: string }
  | { t: 'go'; at: number }
  | { t: 'standings'; rows: StandingInfo[] }
  | { t: 'item'; from: number; e: ItemEvent }
  | { t: 'hit'; victim: number; owner: number; shot: number; kind: HitKind }
  | { t: 'correct'; x: number; y: number; z: number; heading: number }
  | { t: 'left'; id: number }
  | { t: 'results'; rows: ResultInfo[]; mode: MatchMode; laps: number; mapId: string };

export type ErrorCode =
  | 'version'
  | 'badMessage'
  | 'roomNotFound'
  | 'roomFull'
  | 'inProgress'
  | 'wrongCode'
  | 'kicked'
  | 'notHost'
  | 'notReady'
  | 'tooFewPlayers'
  | 'badPing'
  | 'rateLimit'
  | 'sessionExpired'
  | 'serverFull';

export type NoticeKey = 'joined' | 'left' | 'dropped' | 'back' | 'newHost' | 'loadFailed' | 'kickedOther';

// ============================================================================ binary car state

export const BIN_STATE = 1;
export const BIN_SNAPSHOT = 2;

/** flags (byte 1) */
export const F_THROTTLE = 1;
export const F_BRAKE = 2;
export const F_DRIFT = 4;
export const F_BOOST = 8;
export const F_SHIELD = 16;
export const F_FROZEN = 32;
export const F_AIR = 64;
export const F_FALLING = 128;
/** flags (byte 2) */
export const F2_FLY = 1;
export const F2_SPIN = 2;
export const F2_INVULN = 4;
/** the car was teleported (respawn / correction): do not interpolate from the previous sample */
export const F2_TELEPORT = 8;

/** Kinematic state of one car. Objects of this shape are reused, never allocated per packet. */
export interface CarState {
  /** client clock (ms) when the state was produced (client → host) / host clock of the sample (host → clients) */
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  speed: number;
  steer: number;
  flags: number;
  flags2: number;
  drift: number;
  spin: number;
}

export const newCarState = (): CarState => ({
  t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, speed: 0, steer: 0, flags: 0, flags2: 0, drift: 0, spin: 0,
});

export function copyCarState(to: CarState, from: CarState) {
  to.t = from.t;
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.heading = from.heading;
  to.speed = from.speed;
  to.steer = from.steer;
  to.flags = from.flags;
  to.flags2 = from.flags2;
  to.drift = from.drift;
  to.spin = from.spin;
}

const TAU = Math.PI * 2;
const wrap = (a: number) => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
};
const i16 = (v: number, scale: number) => Math.max(-32768, Math.min(32767, Math.round(v * scale)));

/** bytes of the per-car body (shared by the state and snapshot frames) */
const BODY = 28;
/** client → host: type u8, seq u16, client time u32, body */
export const STATE_BYTES = 1 + 2 + 4 + BODY;
const ENTRY = 1 + 4 + BODY;
export const snapshotBytes = (n: number) => 1 + 4 + 1 + n * ENTRY;

function writeBody(v: DataView, o: number, s: CarState) {
  v.setFloat32(o, s.x, true);
  v.setFloat32(o + 4, s.z, true);
  v.setInt16(o + 8, i16(s.y, 100), true);
  v.setInt16(o + 10, i16(s.vx, 100), true);
  v.setInt16(o + 12, i16(s.vy, 100), true);
  v.setInt16(o + 14, i16(s.vz, 100), true);
  v.setUint16(o + 16, Math.round(((wrap(s.heading) + TAU) % TAU) / TAU * 65535), true);
  v.setInt16(o + 18, i16(s.speed, 100), true);
  v.setInt8(o + 20, Math.max(-127, Math.min(127, Math.round(s.steer * 127))));
  v.setUint8(o + 21, s.flags & 0xff);
  v.setUint8(o + 22, s.flags2 & 0xff);
  v.setUint8(o + 23, Math.max(0, Math.min(255, Math.round(s.drift * 255))));
  v.setInt16(o + 24, i16(wrap(s.spin), 10000), true);
  v.setUint16(o + 26, 0, true);
}

function readBody(v: DataView, o: number, s: CarState) {
  s.x = v.getFloat32(o, true);
  s.z = v.getFloat32(o + 4, true);
  s.y = v.getInt16(o + 8, true) / 100;
  s.vx = v.getInt16(o + 10, true) / 100;
  s.vy = v.getInt16(o + 12, true) / 100;
  s.vz = v.getInt16(o + 14, true) / 100;
  s.heading = wrap((v.getUint16(o + 16, true) / 65535) * TAU);
  s.speed = v.getInt16(o + 18, true) / 100;
  s.steer = v.getInt8(o + 20) / 127;
  s.flags = v.getUint8(o + 21);
  s.flags2 = v.getUint8(o + 22);
  s.drift = v.getUint8(o + 23) / 255;
  s.spin = v.getInt16(o + 24, true) / 10000;
}

/** encodes the local car into a reusable buffer */
export function encodeState(buf: ArrayBuffer, seq: number, s: CarState): ArrayBuffer {
  const v = new DataView(buf);
  v.setUint8(0, BIN_STATE);
  v.setUint16(1, seq & 0xffff, true);
  v.setUint32(3, Math.max(0, Math.round(s.t)) >>> 0, true);
  writeBody(v, 7, s);
  return buf;
}

/** decodes a client state frame; returns the sequence number or -1 when the frame is malformed */
export function decodeState(v: DataView, out: CarState): number {
  if (v.byteLength !== STATE_BYTES || v.getUint8(0) !== BIN_STATE) return -1;
  out.t = v.getUint32(3, true);
  readBody(v, 7, out);
  return v.getUint16(1, true);
}

/** host → clients: every car that changed since the previous snapshot */
export function encodeSnapshot(time: number, cars: { id: number; s: CarState }[], count: number): Uint8Array {
  const bytes = new Uint8Array(snapshotBytes(count));
  const v = new DataView(bytes.buffer);
  v.setUint8(0, BIN_SNAPSHOT);
  v.setUint32(1, Math.max(0, Math.round(time)) >>> 0, true);
  v.setUint8(5, count);
  let o = 6;
  for (let i = 0; i < count; i++) {
    const c = cars[i];
    v.setUint8(o, c.id);
    v.setUint32(o + 1, Math.max(0, Math.round(c.s.t)) >>> 0, true);
    writeBody(v, o + 5, c.s);
    o += ENTRY;
  }
  return bytes;
}

/**
 * Decodes a snapshot, calling `each` for every car. `scratch` is reused for every entry,
 * so the callback must copy what it needs. Returns false when the frame is malformed.
 */
export function decodeSnapshot(v: DataView, scratch: CarState, each: (id: number, s: CarState) => void): boolean {
  if (v.byteLength < 6 || v.getUint8(0) !== BIN_SNAPSHOT) return false;
  const n = v.getUint8(5);
  if (v.byteLength !== snapshotBytes(n)) return false;
  let o = 6;
  for (let i = 0; i < n; i++) {
    const id = v.getUint8(o);
    scratch.t = v.getUint32(o + 1, true);
    readBody(v, o + 5, scratch);
    each(id, scratch);
    o += ENTRY;
  }
  return true;
}

// ============================================================================ validation helpers

const HEX = /^#[0-9a-fA-F]{6}$/;
const ACCESSORIES: readonly Accessory[] = ['glasses', 'shades', 'cap', 'crown', 'headphones', 'scarf', 'chain', 'mohawk', 'cape'];
const THEMES: readonly ThemeId[] = ['city', 'desert', 'ocean', 'pixel', 'candy'];

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isInt = (v: unknown, min: number, max: number): v is number => isNum(v) && Number.isInteger(v) && v >= min && v <= max;
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback);

/** player and room names: printable, trimmed, no control / bidi characters, limited length */
export function cleanName(v: unknown, max: number, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  return s ? Array.from(s).slice(0, max).join('') : fallback;
}

export function cleanLook(v: unknown, fallback: DriverLook): DriverLook {
  if (!isObj(v)) return fallback;
  const acc = Array.isArray(v.accessories)
    ? (v.accessories.filter((a) => ACCESSORIES.includes(a as Accessory)) as Accessory[]).slice(0, 4)
    : [];
  return {
    skin: color(v.skin, fallback.skin),
    suit: color(v.suit, fallback.suit),
    suitAccent: color(v.suitAccent, fallback.suitAccent),
    helmet: color(v.helmet, fallback.helmet),
    visor: color(v.visor, fallback.visor),
    hair: color(v.hair, fallback.hair),
    accessories: Array.from(new Set(acc)),
  };
}

/** checks a profile; unknown cars fall back to the first car */
export function cleanProfile(v: unknown, carIds: readonly string[], fallbackLook: DriverLook): Profile | null {
  if (!isObj(v)) return null;
  const paint = isObj(v.paint) && HEX.test(String(v.paint.color)) && HEX.test(String(v.paint.accent))
    ? { color: String(v.paint.color), accent: String(v.paint.accent) }
    : null;
  return {
    name: cleanName(v.name, 16, 'Player'),
    carId: typeof v.carId === 'string' && carIds.includes(v.carId) ? v.carId : carIds[0],
    paint,
    look: cleanLook(v.look, fallbackLook),
  };
}

export function cleanSettings(v: unknown, raceMapIds: readonly string[]): RoomSettings | null {
  if (!isObj(v)) return null;
  const mode: MatchMode = v.mode === 'battle' ? 'battle' : 'race';
  return {
    name: cleanName(v.name, 24, 'RMR room'),
    maxPlayers: isInt(v.maxPlayers, NET.MIN_PLAYERS, NET.MAX_PLAYERS) ? v.maxPlayers : 4,
    mode,
    mapId: typeof v.mapId === 'string' && raceMapIds.includes(v.mapId) ? v.mapId : raceMapIds[0],
    theme: THEMES.includes(v.theme as ThemeId) ? (v.theme as ThemeId) : 'city',
    laps: isInt(v.laps, 1, 5) ? v.laps : 3,
    minutes: isInt(v.minutes, 1, 10) ? v.minutes : 3,
    // battle needs the lucky blocks: points only come from item hits
    items: mode === 'battle' ? true : v.items !== false,
    private: v.private === true,
  };
}

export function cleanItemEvent(v: unknown): ItemEvent | null {
  if (!isObj(v)) return null;
  if (!ITEM_KINDS.includes(v.kind as ItemType)) return null;
  if (!isInt(v.shot, 0, 0xffffff) || !isInt(v.target, -1, 255)) return null;
  for (const k of ['x', 'y', 'z', 'heading', 'speed'] as const) if (!isNum(v[k]) || Math.abs(v[k] as number) > 5000) return null;
  return {
    kind: v.kind as ItemType,
    shot: v.shot,
    x: v.x as number,
    y: v.y as number,
    z: v.z as number,
    heading: v.heading as number,
    speed: v.speed as number,
    target: v.target,
  };
}

/** a 4-digit room code */
export const isRoomCode = (v: unknown): v is string => typeof v === 'string' && /^\d{4}$/.test(v);

/** opaque ids / tokens produced by the server */
export const isToken = (v: unknown, len: number): v is string => typeof v === 'string' && v.length === len && /^[0-9a-f]+$/.test(v);
