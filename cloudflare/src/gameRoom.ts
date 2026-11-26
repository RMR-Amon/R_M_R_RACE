/**
 * GameRoom — one Durable Object per room: lobby, race, results.
 *
 * No timers: everything happens when a message arrives, plus one alarm for "nothing arrived until …"
 * (a player did not come back, the lobby countdown ended, the race is over). An idle lobby hibernates
 * and costs nothing; its sockets stay open.
 *
 * Nothing important lives only in memory: the room is stored in SQLite on every change, a running race
 * every few seconds, and which socket belongs to which player is in the socket attachments. After a
 * restart of the object the race continues from the last checkpoint.
 *
 * Authority: the browsers simulate their own cars, the room validates every state against the real
 * track and the car's limits (server/match.ts, shared with the LAN server) and alone decides start,
 * checkpoints, laps, places, finish, hits and results.
 */
import { DurableObject } from 'cloudflare:workers';
import { GAME_ID, NET, ONLINE, ONLINE_PROTOCOL, WS_PING, WS_PONG } from '../../src/net/config';
import {
  cleanItemEvent,
  cleanProfile,
  cleanSettings,
  isInt,
  isObj,
  isToken,
  type ErrorCode,
  type HitKind,
  type NoticeKey,
  type PlayerInfo,
  type PlayerStatus,
  type Profile,
  type ResultInfo,
  type RoomKind,
  type RoomSettings,
  type RoomState,
  type RoomStatus,
  type RosterEntry,
  type ServerMsg,
} from '../../src/net/protocol';
import { CAR_IDS, DEFAULT_LOOK, RACE_MAP_IDS } from '../../server/gameData';
import { Match, type MatchHost, type MatchOptions, type MatchSave } from '../../server/match';
import { Bucket, SEAT_MS, closeSocket, isLimitError, randomHex, sendText, settings, type Env, type Settings } from './env';

const HIT_KINDS: readonly HitKind[] = ['missile', 'ice', 'bomb', 'oil'];
const CHECKPOINT_MS = 3000;
/** a socket must say hello within this time */
const HELLO_MS = 8000;
const MAX_SOCKETS = 24;
const BAN_MS = 60_000;
/** silent players are looked for at least this often while a race runs */
const SWEEP_MS = 15_000;

/** a seat the matchmaker reserved for a player */
export interface Seat {
  pid: string;
  ticket: string;
}

interface PlayerRec {
  id: number;
  pid: string;
  token: string;
  profile: Profile;
  ready: boolean;
  status: PlayerStatus;
  joinedAt: number;
  dropAt: number;
  /** still looking at the results of the previous race */
  away: boolean;
}

/** everything that must survive a restart (times are on the room clock) */
interface RoomData {
  id: string;
  kind: RoomKind;
  code: string | null;
  settings: RoomSettings;
  /** -1: quick play rooms are run by the server */
  hostId: number;
  /** epoch ms of room clock 0 */
  epoch: number;
  status: RoomStatus;
  /** quick play: automatic start, 0 = not scheduled */
  startAt: number;
  activity: number;
  players: PlayerRec[];
  seats: (Seat & { until: number })[];
  bans: Record<string, number>;
  /** results of the last race, for players who reconnect right after it */
  last: { match: string; msg: ServerMsg } | null;
}

interface SockAtt {
  /** player id, -1 before hello */
  p: number;
  at: number;
}

/** per-socket data that may be lost (hibernation) without harm */
interface Sock {
  json: Bucket;
  bin: Bucket;
  floods: number;
  heard: number;
  rtt: number;
  lastN: number;
}

export interface ReserveResult {
  taken: string[];
  free: number;
  error?: ErrorCode;
  /** the room does not exist any more */
  gone?: boolean;
}

export class GameRoom extends DurableObject<Env> implements MatchHost {
  private readonly cfg: Settings;
  private d: RoomData | null = null;
  private match: Match | null = null;
  private socks = new WeakMap<WebSocket, Sock>();
  private byPlayer = new Map<number, WebSocket>();
  private dirty = false;
  private needSave = false;
  private lastTick = 0;
  private lastSweep = 0;
  private lastCheckpoint = 0;
  private alarmAt = 0;
  /** when the oldest socket that has not said hello runs out of time */
  private helloDue = Infinity;
  private storageFailed = false;
  /** monitoring (debug): billed rows and incoming messages of this room */
  private written = 0;
  private received = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.cfg = settings(env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(WS_PING, WS_PONG));
    void ctx.blockConcurrencyWhile(async () => {
      this.load();
      this.alarmAt = (await ctx.storage.getAlarm()) ?? 0;
    });
  }

  // ------------------------------------------------------------------------------------------ storage

  private get sql() {
    return this.ctx.storage.sql;
  }

  private load() {
    // an object that was never created as a room stays empty (nothing is written for guessed ids)
    const has = [...this.sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room'`)].length > 0;
    if (!has) return;
    const rows = new Map([...this.sql.exec<{ k: string; v: string }>(`SELECT k, v FROM room`)].map((r) => [r.k, r.v]));
    const data = rows.get('room');
    if (!data) return;
    this.d = JSON.parse(data) as RoomData;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as SockAtt | null;
      if (a && a.p >= 0 && ws.readyState === WebSocket.OPEN) this.byPlayer.set(a.p, ws);
    }
    const now = this.now();
    // players whose socket did not survive the restart get the usual time to come back
    for (const p of this.d.players) {
      if (p.status === 'online' && !this.byPlayer.has(p.id)) {
        p.status = 'reconnecting';
        p.dropAt = now;
        this.needSave = true;
      }
    }
    const m = rows.get('match');
    if (m && this.d.status !== 'lobby') {
      try {
        this.match = Match.restore(this, JSON.parse(m) as MatchSave, now, this.matchOptions());
        for (const p of this.d.players) this.match.setStatus(p.id, p.status);
      } catch (e) {
        console.error('restore', e instanceof Error ? e.message : String(e));
      }
    }
    if (!this.match && this.d.status !== 'lobby') this.d.status = 'lobby';
  }

  private put(k: string, v: string) {
    const c = this.sql.exec(`INSERT INTO room (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, k, v);
    this.written += c.rowsWritten;
  }

  /** a failed write (daily quota) must not stop a running race, but it is reported */
  private persist(write: () => void) {
    try {
      write();
    } catch (e) {
      console.error('storage', e instanceof Error ? e.message : String(e));
      if (!this.storageFailed && isLimitError(e)) {
        this.storageFailed = true;
        this.broadcast({ t: 'notice', key: 'serviceLimit' });
      }
    }
  }

  private save() {
    this.needSave = false;
    if (this.d) this.persist(() => this.put('room', JSON.stringify(this.d)));
  }

  /** room clock: ms since the room was created (fits 32 bits, survives restarts) */
  private now() {
    return Date.now() - (this.d?.epoch ?? 0);
  }

  // ------------------------------------------------------------------------------------------ RPC (matchmaker only)

  async create(o: { id: string; kind: RoomKind; code: string | null; settings: RoomSettings; seats: Seat[] }): Promise<void> {
    if (this.d) throw new Error('room exists');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS room (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID`);
    this.d = {
      id: o.id,
      kind: o.kind,
      code: o.code,
      settings: o.settings,
      hostId: -1,
      epoch: Date.now() - 1000,
      status: 'lobby',
      startAt: 0,
      activity: 1000,
      players: [],
      seats: o.seats.map((s) => ({ ...s, until: 1000 + SEAT_MS })),
      bans: {},
      last: null,
    };
    this.put('room', JSON.stringify(this.d));
    await this.schedule();
  }

  async reserve(seats: Seat[]): Promise<ReserveResult> {
    const d = this.d;
    if (!d) return { taken: [], free: 0, error: 'roomNotFound', gone: true };
    const now = this.now();
    this.expire(now);
    if (!this.d) return { taken: [], free: 0, error: 'roomNotFound', gone: true };
    if (d.status !== 'lobby') return { taken: [], free: 0, error: 'inProgress' };
    const taken: string[] = [];
    let error: ErrorCode | undefined;
    for (const s of seats) {
      if ((d.bans[s.pid] ?? 0) > now) {
        error = 'kicked';
        continue;
      }
      // the same player again (crashed tab, second tab): the new seat replaces the old one
      const old = d.players.find((p) => p.pid === s.pid);
      if (old) this.drop(old, 'replaced', false);
      if (!this.d) return { taken: [], free: 0, error: 'roomNotFound', gone: true };
      d.seats = d.seats.filter((x) => x.pid !== s.pid);
      if (d.players.length + d.seats.length >= d.settings.maxPlayers) {
        error = 'roomFull';
        break;
      }
      d.seats.push({ ...s, until: now + SEAT_MS });
      taken.push(s.pid);
    }
    d.activity = now;
    this.needSave = true;
    await this.after(now);
    return { taken, free: this.free(), error: taken.length ? undefined : error };
  }

  /** the player went to another room */
  async evict(pid: string): Promise<void> {
    const d = this.d;
    if (!d) return;
    d.seats = d.seats.filter((x) => x.pid !== pid);
    const p = d.players.find((x) => x.pid === pid);
    if (p) this.drop(p, 'replaced');
    this.needSave = true;
    await this.after(this.now());
  }

  private free() {
    const d = this.d;
    return d ? Math.max(0, d.settings.maxPlayers - d.players.length - d.seats.length) : 0;
  }

  private report(r: { open?: boolean; gone?: string[]; closed?: boolean }, id = this.d?.id) {
    if (!id) return;
    const mm = this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName('global'));
    this.ctx.waitUntil(
      mm.report(id, r).catch((e: unknown) => console.error('report', e instanceof Error ? e.message : String(e))),
    );
  }

  // ------------------------------------------------------------------------------------------ sockets

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const refuse = (code: ErrorCode) => {
      pair[1].accept();
      pair[1].send(JSON.stringify({ t: 'error', code } satisfies ServerMsg));
      pair[1].close(4002, code);
      return new Response(null, { status: 101, webSocket: pair[0] });
    };
    if (!this.d) return refuse('sessionExpired');
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return refuse('roomFull');
    this.ctx.acceptWebSocket(pair[1]);
    const now = this.now();
    pair[1].serializeAttachment({ p: -1, at: now } satisfies SockAtt);
    this.helloDue = Math.min(this.helloDue, now + HELLO_MS);
    await this.schedule();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private sock(ws: WebSocket): Sock {
    let s = this.socks.get(ws);
    if (!s) {
      s = { json: new Bucket(10, 3), bin: new Bucket(this.cfg.sendHz * 1.3 + 2, 2), floods: 0, heard: this.now(), rtt: -1, lastN: 0 };
      this.socks.set(ws, s);
    }
    return s;
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const now = this.now();
    const a = ws.deserializeAttachment() as SockAtt | null;
    if (!this.d || !a) return closeSocket(ws, 4002, 'closed');
    const s = this.sock(ws);
    s.heard = now;
    this.received++;
    const bin = typeof data !== 'string';
    const size = bin ? data.byteLength : data.length;
    if (size > NET.MAX_MESSAGE_BYTES) return this.kickSocket(ws, a, 1009, 'too big');
    if (!(bin ? s.bin : s.json).take()) {
      // every message counts against the daily quota: a flooding client is put out
      if (++s.floods > 100) this.kickSocket(ws, a, 1008, 'rate limit', true);
      return;
    }
    if (s.floods > 0) s.floods--;
    const p = a.p >= 0 && this.byPlayer.get(a.p) === ws ? this.d.players.find((x) => x.id === a.p) : undefined;
    if (bin) {
      if (p) this.match?.onBatch(p.id, new DataView(data), now);
    } else {
      let msg: unknown;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (!isObj(msg) || typeof msg.t !== 'string') return;
      if (msg.t === 'ping') {
        if (typeof msg.c === 'number' && Number.isFinite(msg.c)) sendText(ws, JSON.stringify({ t: 'pong', c: msg.c, s: now } satisfies ServerMsg));
        // the round trip is only shown to the others; nothing depends on it
        if (isInt(msg.rtt, 0, 60000) && Math.abs(msg.rtt - s.rtt) > 8) {
          s.rtt = msg.rtt;
          if (p && this.d.status === 'lobby') this.dirty = true;
        }
      } else if (a.p < 0) this.onHello(ws, msg, now);
      else if (p) this.onMessage(p, s, msg, now);
    }
    await this.after(now);
  }

  async webSocketClose(ws: WebSocket) {
    closeSocket(ws, 1000, '');
    this.onGone(ws);
    await this.after(this.now());
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  private onGone(ws: WebSocket) {
    const a = ws.deserializeAttachment() as SockAtt | null;
    if (!this.d || !a || a.p < 0 || this.byPlayer.get(a.p) !== ws) return;
    this.byPlayer.delete(a.p);
    const p = this.d.players.find((x) => x.id === a.p);
    if (!p) return;
    p.status = 'reconnecting';
    p.dropAt = this.now();
    this.match?.setStatus(p.id, 'reconnecting');
    this.broadcast({ t: 'notice', key: 'dropped', name: p.profile.name });
    this.dirty = this.needSave = true;
  }

  private kickSocket(ws: WebSocket, a: SockAtt, code: number, reason: string, ban = false) {
    const p = this.d?.players.find((x) => x.id === a.p);
    closeSocket(ws, code, reason);
    if (p && ban && this.d) {
      this.d.bans[p.pid] = this.now() + BAN_MS;
      this.drop(p, 'rateLimit');
    } else this.onGone(ws);
  }

  private fail(ws: WebSocket, code: ErrorCode) {
    sendText(ws, JSON.stringify({ t: 'error', code } satisfies ServerMsg));
    closeSocket(ws, 4002, code);
  }

  private bind(ws: WebSocket, p: PlayerRec, now: number) {
    const old = this.byPlayer.get(p.id);
    this.byPlayer.set(p.id, ws);
    ws.serializeAttachment({ p: p.id, at: now } satisfies SockAtt);
    if (old && old !== ws) closeSocket(old, 4000, 'replaced');
    this.sock(ws).lastN = 0;
  }

  // ------------------------------------------------------------------------------------------ hello

  private onHello(ws: WebSocket, msg: Record<string, unknown>, now: number) {
    const d = this.d!;
    if (msg.t !== 'hello') return this.fail(ws, 'badMessage');
    if (msg.game !== GAME_ID || msg.proto !== ONLINE_PROTOCOL) return this.fail(ws, 'version');
    if (msg.join === 'ticket') {
      if (!isToken(msg.ticket, 32)) return this.fail(ws, 'badMessage');
      const seat = d.seats.find((x) => x.ticket === msg.ticket && x.until > now);
      if (!seat) return this.fail(ws, 'sessionExpired');
      const profile = cleanProfile(msg.profile, CAR_IDS, DEFAULT_LOOK);
      if (!profile) return this.fail(ws, 'badMessage');
      if (d.status !== 'lobby') return this.fail(ws, 'inProgress');
      // a ticket works once
      d.seats = d.seats.filter((x) => x !== seat);
      let id = 0;
      while (d.players.some((x) => x.id === id)) id++;
      const p: PlayerRec = { id, pid: seat.pid, token: randomHex(16), profile, ready: false, status: 'online', joinedAt: now, dropAt: 0, away: false };
      d.players.push(p);
      if (d.kind === 'private' && d.hostId < 0) d.hostId = id;
      d.activity = now;
      this.bind(ws, p, now);
      // durable first: a player who was told "welcome" must still exist after a restart
      this.save();
      sendText(ws, JSON.stringify({ t: 'welcome', you: id, token: p.token, room: this.state(), time: now } satisfies ServerMsg));
      this.broadcast({ t: 'notice', key: 'joined', name: profile.name }, id);
      this.planStart(now, true);
      this.dirty = true;
      return;
    }
    if (msg.join === 'resume') {
      const p = isToken(msg.token, 32) ? d.players.find((x) => x.token === msg.token) : undefined;
      if (!p) return this.fail(ws, 'sessionExpired');
      this.bind(ws, p, now);
      p.status = 'online';
      this.send(p.id, { t: 'welcome', you: p.id, token: p.token, room: this.state(), time: now });
      const running = this.match?.has(p.id) ? this.match : null;
      if (running) {
        running.setStatus(p.id, 'online');
        this.send(p.id, { t: 'load', match: running.resumeInfo(p.id, now) });
        if (running.phase !== 'loading') {
          this.send(p.id, { t: 'go', at: running.goAt });
          this.send(p.id, { t: 'standings', rows: running.standings() });
        }
      } else if (typeof msg.match === 'string' && msg.match) {
        // the race this player was in ended while they were away
        if (d.last?.match === msg.match) this.send(p.id, d.last.msg);
        else this.send(p.id, { t: 'abort', key: 'matchLost' });
      }
      this.broadcast({ t: 'notice', key: 'back', name: p.profile.name }, p.id);
      this.planStart(now, false);
      this.dirty = this.needSave = true;
      return;
    }
    this.fail(ws, 'badMessage');
  }

  // ------------------------------------------------------------------------------------------ commands

  private onMessage(p: PlayerRec, s: Sock, msg: Record<string, unknown>, now: number) {
    const d = this.d!;
    if (msg.t !== 'leave') {
      // commands carry an increasing number: duplicates are ignored
      if (!isInt(msg.n, 1, 2 ** 31) || msg.n <= s.lastN) return;
      s.lastN = msg.n;
    }
    const isHost = p.id === d.hostId;
    switch (msg.t) {
      case 'settings': {
        if (!isHost) return this.error(p, 'notHost');
        if (d.status !== 'lobby') return;
        const x = cleanSettings(msg.s, RACE_MAP_IDS);
        if (!x) return this.error(p, 'badMessage');
        x.private = true;
        x.maxPlayers = Math.min(this.cfg.maxPlayers, Math.max(x.maxPlayers, d.players.length + d.seats.length, NET.MIN_PLAYERS));
        const changed = JSON.stringify({ ...d.settings, name: '' }) !== JSON.stringify({ ...x, name: '' });
        d.settings = x;
        // new conditions: everybody confirms again
        if (changed) for (const q of d.players) q.ready = false;
        break;
      }
      case 'profile': {
        if (d.status !== 'lobby') return;
        const prof = cleanProfile(msg.p, CAR_IDS, DEFAULT_LOOK);
        if (!prof) return this.error(p, 'badMessage');
        p.profile = prof;
        break;
      }
      case 'ready':
        if (d.status !== 'lobby') return;
        p.ready = msg.v === true;
        p.away = false;
        this.planStart(now, false);
        break;
      case 'back':
        if (!p.away) return;
        p.away = false;
        this.planStart(now, false);
        break;
      case 'kick': {
        if (!isHost) return this.error(p, 'notHost');
        const target = isInt(msg.id, 0, 255) ? d.players.find((x) => x.id === msg.id) : undefined;
        if (!target || target.id === p.id) return;
        d.bans[target.pid] = now + BAN_MS;
        this.send(target.id, { t: 'kicked' });
        this.remove(target, 'kickedOther');
        break;
      }
      case 'start':
        if (!isHost) return this.error(p, 'notHost');
        return this.hostStart(p, now);
      case 'close':
        if (!isHost) return this.error(p, 'notHost');
        return this.close('host');
      case 'leave':
        this.remove(p, 'left');
        break;
      case 'loaded':
        this.match?.onLoaded(p.id);
        return;
      case 'item': {
        const e = cleanItemEvent(msg.e);
        if (e) this.match?.onItem(p.id, e, now);
        return;
      }
      case 'hit':
        if (isInt(msg.owner, 0, 255) && isInt(msg.shot, 0, 0xffffff) && HIT_KINDS.includes(msg.kind as HitKind)) this.match?.onHit(p.id, msg.owner, msg.shot, msg.kind as HitKind, now);
        return;
      default:
        return;
    }
    d.activity = now;
    this.dirty = this.needSave = true;
  }

  private error(p: PlayerRec, code: ErrorCode, detail?: string) {
    this.send(p.id, { t: 'error', code, detail });
  }

  // ------------------------------------------------------------------------------------------ players

  /** tells the player why, then removes them */
  private drop(p: PlayerRec, code: ErrorCode, report = true) {
    this.send(p.id, { t: 'error', code });
    this.remove(p, 'left', report);
  }

  private remove(p: PlayerRec, notice: NoticeKey, report = true) {
    const d = this.d;
    if (!d || !d.players.includes(p)) return;
    d.players = d.players.filter((x) => x !== p);
    this.match?.remove(p.id);
    const ws = this.byPlayer.get(p.id);
    this.byPlayer.delete(p.id);
    if (ws) closeSocket(ws, 1000, 'left');
    this.broadcast({ t: 'notice', key: notice, name: p.profile.name });
    if (report) this.report({ gone: [p.pid], open: this.isOpen() });
    if (p.id === d.hostId) {
      // the room does not depend on anybody's computer: somebody else simply becomes the host
      const next = [...d.players].sort((a, b) => (a.status === 'online' ? 0 : 1) - (b.status === 'online' ? 0 : 1) || a.joinedAt - b.joinedAt)[0];
      d.hostId = next ? next.id : -1;
      if (next) {
        next.ready = false;
        this.broadcast({ t: 'notice', key: 'newHost', name: next.profile.name });
      }
    }
    this.planStart(this.now(), false);
    this.dirty = this.needSave = true;
  }

  private isOpen() {
    const d = this.d;
    return !!d && d.kind === 'quick' && d.status === 'lobby' && this.free() > 0;
  }

  /** removes what ran out: seats, players who did not come back, silent sockets */
  private expire(now: number) {
    const d = this.d;
    if (!d) return;
    if (d.seats.some((s) => s.until <= now)) {
      const gone = d.seats.filter((s) => s.until <= now).map((s) => s.pid);
      d.seats = d.seats.filter((s) => s.until > now);
      this.needSave = true;
      this.report({ gone, open: this.isOpen() });
    }
    for (const p of [...d.players]) if (p.status === 'reconnecting' && now - p.dropAt >= ONLINE.RECONNECT_GRACE_MS) this.remove(p, 'left');
    if (now - this.lastSweep < 1000) return;
    this.lastSweep = now;
    this.helloDue = Infinity;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const a = ws.deserializeAttachment() as SockAtt | null;
      if (!a) continue;
      if (a.p < 0) {
        if (now - a.at >= HELLO_MS) closeSocket(ws, 4001, 'no hello');
        else this.helloDue = Math.min(this.helloDue, a.at + HELLO_MS);
        continue;
      }
      // the platform answers pings by itself; its timestamp tells whether the player is still there
      const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      const heard = Math.max(a.at, this.socks.get(ws)?.heard ?? 0, auto ? auto.getTime() - d.epoch : 0);
      if (now - heard > ONLINE.DEAD_AFTER_MS + 3000) {
        closeSocket(ws, 4008, 'silent');
        this.onGone(ws);
      }
    }
  }

  // ------------------------------------------------------------------------------------------ start

  /** quick play: when does the race start by itself? */
  private planStart(now: number, newPlayer: boolean) {
    const d = this.d;
    if (!d || d.kind !== 'quick' || d.status !== 'lobby') return;
    const here = d.players.filter((p) => p.status === 'online' && !p.away);
    const before = d.startAt;
    if (here.length < this.cfg.minPlayers) d.startAt = 0;
    else {
      if (!d.startAt) d.startAt = now + this.cfg.lobbyMs;
      // somebody new gets a moment to see the lobby
      if (newPlayer) d.startAt = Math.max(d.startAt, now + Math.min(8000, this.cfg.lobbyMs));
      if (here.length >= d.settings.maxPlayers) d.startAt = Math.min(d.startAt, now + 8000);
      if (here.every((p) => p.ready)) d.startAt = Math.min(d.startAt, now + 3000);
    }
    if (before !== d.startAt) this.dirty = this.needSave = true;
  }

  private quickStart(now: number) {
    const d = this.d!;
    d.startAt = 0;
    const here = d.players.filter((p) => p.status === 'online' && !p.away);
    if (here.length < this.cfg.minPlayers) return this.planStart(now, false);
    // players who are not there right now cannot hold up the others
    for (const p of [...d.players]) if (!here.includes(p)) this.drop(p, 'afk');
    d.seats = [];
    this.begin(here, now);
  }

  /** private room: the host starts when everybody is ready */
  private hostStart(host: PlayerRec, now: number) {
    const d = this.d!;
    if (d.status !== 'lobby') return;
    if (d.players.length < NET.MIN_PLAYERS) return this.error(host, 'tooFewPlayers');
    const names = (l: PlayerRec[]) => l.map((x) => x.profile.name).join(', ');
    const missing = d.players.filter((x) => x.status !== 'online' || (x.id !== d.hostId && !x.ready));
    if (missing.length) return this.error(host, 'notReady', names(missing));
    this.begin([...d.players], now);
  }

  private matchOptions(): MatchOptions {
    return { slackMs: 1200, countdownMs: this.cfg.countdownMs, queued: true, net: { sampleHz: this.cfg.sampleHz, sendHz: this.cfg.sendHz } };
  }

  private begin(list: PlayerRec[], now: number) {
    const d = this.d!;
    const sorted = [...list].sort((a, b) => a.joinedAt - b.joinedAt);
    const roster: RosterEntry[] = sorted.map((x, slot) => ({ ...x.profile, id: x.id, slot }));
    this.match = new Match(this, d.settings, roster, now, this.matchOptions());
    d.status = 'loading';
    d.startAt = 0;
    d.activity = now;
    this.broadcast({ t: 'load', match: this.match.info });
    this.report({ open: false });
    this.checkpoint(now);
    this.dirty = this.needSave = true;
  }

  private checkpoint(now: number) {
    this.lastCheckpoint = now;
    const m = this.match;
    if (m) this.persist(() => this.put('match', JSON.stringify(m.save())));
  }

  // ------------------------------------------------------------------------------------------ MatchHost

  broadcast(msg: ServerMsg, exceptId = -1) {
    const data = JSON.stringify(msg);
    for (const [id, ws] of this.byPlayer) if (id !== exceptId) sendText(ws, data);
  }

  broadcastBinary(bytes: Uint8Array, exceptId = -1) {
    for (const [id, ws] of this.byPlayer) if (id !== exceptId) sendText(ws, bytes);
  }

  sendTo(id: number, msg: ServerMsg) {
    this.send(id, msg);
  }

  private send(id: number, msg: ServerMsg) {
    const ws = this.byPlayer.get(id);
    if (ws) sendText(ws, JSON.stringify(msg));
  }

  dropSlow(ids: number[]): boolean {
    for (const id of ids) {
      const p = this.d?.players.find((x) => x.id === id);
      if (p) this.drop(p, 'afk');
      else this.match?.remove(id);
    }
    return true;
  }

  onEnd(results: ResultInfo[] | null, abort?: { key: 'loadFailed'; name: string }) {
    const d = this.d!;
    const m = this.match;
    const now = this.now();
    this.match = null;
    d.status = 'lobby';
    d.activity = now;
    for (const p of d.players) {
      p.ready = false;
      p.away = !!results;
    }
    if (results && m) {
      const msg: ServerMsg = { t: 'results', rows: results, mode: m.info.mode, laps: m.info.laps, mapId: m.info.mapId };
      d.last = { match: m.id, msg };
      this.broadcast(msg);
    }
    if (abort) this.broadcast({ t: 'abort', key: abort.key, name: abort.name });
    this.persist(() => this.sql.exec(`DELETE FROM room WHERE k = 'match'`));
    // another random track next time
    if (d.kind === 'quick') {
      const others = RACE_MAP_IDS.filter((x) => x !== d.settings.mapId);
      d.settings = { ...d.settings, mapId: others[Math.floor(Math.random() * others.length)] };
      this.report({ open: this.isOpen() });
      this.planStart(now, false);
    }
    this.dirty = this.needSave = true;
  }

  // ------------------------------------------------------------------------------------------ after every event

  /** smallest gap between two outgoing snapshots: small races are forwarded at once, big ones are bundled */
  private tickGap() {
    const n = this.match?.size ?? 0;
    return n <= 3 ? 0 : n <= 5 ? 20 : 40;
  }

  private async after(now: number) {
    if (!this.d) return;
    this.expire(now);
    const d = this.d;
    if (!d) return;
    if (d.status === 'lobby' && d.startAt && now >= d.startAt) this.quickStart(now);
    if (this.match && (this.match.phase !== 'racing' || now - this.lastTick >= this.tickGap())) {
      this.lastTick = now;
      this.match.tick(now);
      const ph = this.match?.phase;
      if (this.match && ph !== 'over') {
        const st: RoomStatus = ph === 'loading' ? 'loading' : 'racing';
        if (st !== d.status) {
          d.status = st;
          this.dirty = this.needSave = true;
        }
        if (now - this.lastCheckpoint >= CHECKPOINT_MS) this.checkpoint(now);
      }
    }
    if (!d.players.length && !d.seats.length) return this.destroy();
    if (d.status === 'lobby' && now - d.activity >= this.cfg.roomIdleMs) return this.close('idle');
    if (this.needSave) this.save();
    if (this.dirty) {
      this.dirty = false;
      this.broadcast({ t: 'room', room: this.state() });
    }
    await this.schedule();
  }

  private state(): RoomState {
    const d = this.d!;
    const players: PlayerInfo[] = [...d.players]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => {
        const ws = this.byPlayer.get(p.id);
        return { ...p.profile, id: p.id, host: p.id === d.hostId, ready: p.id === d.hostId || p.ready, ping: (ws && this.socks.get(ws)?.rtt) ?? -1, status: p.status };
      });
    return { id: d.id, settings: d.settings, status: d.status, hostId: d.hostId, players, code: d.code ?? undefined, kind: d.kind, startAt: d.startAt || undefined, min: this.cfg.minPlayers };
  }

  // ------------------------------------------------------------------------------------------ time

  /** one alarm for the nearest thing that happens by itself; an earlier one is left alone */
  private async schedule() {
    const d = this.d;
    if (!d) return;
    const now = this.now();
    let next = this.helloDue;
    for (const s of d.seats) next = Math.min(next, s.until);
    for (const p of d.players) if (p.status === 'reconnecting') next = Math.min(next, p.dropAt + ONLINE.RECONNECT_GRACE_MS);
    if (d.startAt) next = Math.min(next, d.startAt);
    if (this.match) next = Math.min(next, this.match.nextDeadline() || Infinity, now + SWEEP_MS);
    else if (d.status === 'lobby') next = Math.min(next, d.activity + this.cfg.roomIdleMs);
    if (next === Infinity) return;
    const at = d.epoch + Math.max(next, now + 5);
    // each setAlarm is a billed row: only when the pending one is too late (or already fired)
    if (this.alarmAt && this.alarmAt <= at && this.alarmAt > Date.now() - 2000) return;
    this.alarmAt = at;
    this.written++;
    try {
      await this.ctx.storage.setAlarm(at);
    } catch (e) {
      console.error('alarm', e instanceof Error ? e.message : String(e));
    }
  }

  async alarm() {
    this.alarmAt = 0;
    this.lastTick = this.lastSweep = 0;
    await this.after(this.now());
  }

  // ------------------------------------------------------------------------------------------ end

  private async close(reason: 'host' | 'idle') {
    this.broadcast({ t: 'closed', reason });
    await this.destroy();
  }

  private async destroy() {
    const d = this.d;
    if (!d) return;
    this.d = null;
    this.match = null;
    for (const ws of this.ctx.getWebSockets()) closeSocket(ws, 1000, 'room closed');
    this.byPlayer.clear();
    this.report({ closed: true }, d.id);
    this.alarmAt = 0;
    try {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
    } catch (e) {
      console.error('destroy', e instanceof Error ? e.message : String(e));
    }
  }

  // ------------------------------------------------------------------------------------------ tests only (DEBUG = 1)

  async debug(what: 'info' | 'crash') {
    if (!this.cfg.debug) return null;
    if (what === 'crash') this.ctx.abort('test crash');
    const d = this.d;
    return { boot: this.boot, status: d?.status ?? null, players: d?.players.length ?? 0, seats: d?.seats.length ?? 0, sockets: this.ctx.getWebSockets().length, match: this.match?.phase ?? null, written: this.written, received: this.received };
  }

  /** differs after every restart / hibernation of the object */
  private readonly boot = randomHex(4);
}
