/** bindings, settings and small helpers shared by the Worker and its Durable Objects */
import { NET } from '../../src/net/config';
import type { ErrorCode } from '../../src/net/protocol';
import type { GameRoom } from './gameRoom';
import type { Matchmaker } from './matchmaker';

export interface Env {
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  ROOMS: DurableObjectNamespace<GameRoom>;
  ALLOWED_ORIGINS?: string;
  MIN_PLAYERS?: string;
  MAX_PLAYERS?: string;
  MATCHMAKING_TIMEOUT?: string;
  ROOM_TIMEOUT?: string;
  COUNTDOWN_DURATION?: string;
  LOBBY_COUNTDOWN?: string;
  SEND_HZ?: string;
  SAMPLE_HZ?: string;
  MAX_OPEN_ROOMS?: string;
  MAX_ROOMS_PER_DAY?: string;
  DEBUG?: string;
}

const num = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** settings with safe bounds: a typo in wrangler.toml must not break the game or burn the quota */
export function settings(env: Env) {
  const minPlayers = Math.round(num(env.MIN_PLAYERS, 2, NET.MIN_PLAYERS, NET.MAX_PLAYERS));
  return {
    minPlayers,
    maxPlayers: Math.round(num(env.MAX_PLAYERS, NET.MAX_PLAYERS, minPlayers, NET.MAX_PLAYERS)),
    searchMs: num(env.MATCHMAKING_TIMEOUT, 120, 5, 1800) * 1000,
    roomIdleMs: num(env.ROOM_TIMEOUT, 600, 5, 7200) * 1000,
    countdownMs: num(env.COUNTDOWN_DURATION, 4, 3, 15) * 1000,
    lobbyMs: num(env.LOBBY_COUNTDOWN, 20, 1, 120) * 1000,
    sendHz: num(env.SEND_HZ, 10, 4, 20),
    sampleHz: num(env.SAMPLE_HZ, 20, 4, 30),
    maxOpenRooms: num(env.MAX_OPEN_ROOMS, 60, 1, 10000),
    maxRoomsPerDay: num(env.MAX_ROOMS_PER_DAY, 600, 0, 1e6),
    debug: env.DEBUG === '1',
  };
}

export type Settings = ReturnType<typeof settings>;

/** a reserved seat must be taken within this time */
export const SEAT_MS = 30_000;

export const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/** what the platform says when a daily limit of the Free plan is used up */
export const isLimitError = (e: unknown) => /free tier|exceeded allowed|exceeded .*(limit|quota)|daily (limit|quota)|SQLITE_FULL/i.test(e instanceof Error ? e.message : String(e));

export const errorCode = (e: unknown): ErrorCode => (isLimitError(e) ? 'serviceLimit' : 'serverError');

/** token bucket: `rate` messages per second, bursts up to `burst` seconds worth */
export class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly rate: number,
    private readonly burst = 2,
  ) {
    this.tokens = rate * burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.rate * this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** a player's secret id (32 hex digits made by the browser) */
export const isPid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);

/** closing a socket that is already going away must never throw */
export function closeSocket(ws: WebSocket, code: number, reason: string) {
  try {
    ws.close(code, reason);
  } catch {
    /* already closed */
  }
}

export function sendText(ws: WebSocket, data: string | Uint8Array) {
  try {
    ws.send(data);
  } catch {
    /* closing: webSocketClose follows */
  }
}

/** accepts the socket only to say why it is refused: a browser cannot read a failed handshake */
export function refuseSocket(code: ErrorCode): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].send(JSON.stringify({ t: 'error', code }));
  pair[1].close(4002, code);
  return new Response(null, { status: 101, webSocket: pair[0] });
}
