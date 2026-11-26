/**
 * Matchmaker — one Durable Object for the whole service.
 *
 *  - Quick Play queue: the queue IS the list of open sockets that are searching (their state is in the
 *    socket attachments, so it survives hibernation and a closed tab leaves the queue by itself);
 *  - directory of rooms: which quick rooms still take players, which invite code belongs to which room;
 *  - directory of players: one player (browser id) is in at most one room — the newest wins;
 *  - the "players online" counter.
 *
 * It never touches a running race: rooms are separate objects. No polling timers: work happens when a
 * message arrives, plus one alarm while somebody is searching.
 */
import { DurableObject } from 'cloudflare:workers';
import { GAME_ID, ONLINE_PROTOCOL, WS_PING, WS_PONG } from '../../src/net/config';
import { CODE_ALPHABET, CODE_LENGTH, cleanCode, cleanSettings, isObj, type ErrorCode, type MmServerMsg, type RoomKind, type RoomSettings } from '../../src/net/protocol';
import { RACE_MAP_IDS, mapTheme } from '../../server/gameData';
import { Bucket, closeSocket, errorCode, isLimitError, isPid, randomHex, sendText, settings, type Env, type Settings } from './env';
import type { Seat } from './gameRoom';

const MAX_SOCKETS = 800;
const MAX_PER_IP = 16;
/** a menu that stopped answering pings is gone (browsers slow timers of hidden tabs to one a minute) */
const STALE_MS = 80_000;
/** assignments older than this are forgotten even if the room never reported back */
const ASSIGN_TTL_MS = 3 * 3600_000;

interface Attachment {
  pid: string | null;
  ip: string;
  /** searching since (epoch ms), 0 = not searching */
  since: number;
  /** a room is being prepared for this player */
  busy: boolean;
  at: number;
}

export class Matchmaker extends DurableObject<Env> {
  private readonly cfg: Settings;
  private readonly sql: SqlStorage;
  private buckets = new WeakMap<WebSocket, Bucket>();
  private created = new Map<string, number[]>();
  private wrong = new Map<string, number[]>();
  private matching = false;
  private again = false;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.cfg = settings(env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, kind TEXT NOT NULL, code TEXT, open INTEGER NOT NULL, created INTEGER NOT NULL) WITHOUT ROWID`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players (pid TEXT PRIMARY KEY, room TEXT NOT NULL, at INTEGER NOT NULL) WITHOUT ROWID`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID`);
    // answered by the platform: no wake-up, no charge
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(WS_PING, WS_PONG));
    // nothing can be in progress right after a start
    for (const ws of ctx.getWebSockets()) this.setAtt(ws, { busy: false });
  }

  // ------------------------------------------------------------------------------------------ sockets

  async fetch(req: Request): Promise<Response> {
    const ip = req.headers.get('x-rmr-ip') ?? '?';
    const pair = new WebSocketPair();
    const all = this.ctx.getWebSockets();
    const sameIp = all.filter((w) => (w.deserializeAttachment() as Attachment | null)?.ip === ip).length;
    if (all.length >= MAX_SOCKETS || sameIp >= MAX_PER_IP) {
      pair[1].accept();
      pair[1].send(JSON.stringify({ t: 'error', code: 'serverFull' }));
      pair[1].close(4002, 'serverFull');
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ pid: null, ip, since: 0, busy: false, at: Date.now() } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    let b = this.buckets.get(ws);
    if (!b) this.buckets.set(ws, (b = new Bucket(4, 4)));
    if (!b.take() || typeof data !== 'string' || data.length > 2048) {
      closeSocket(ws, 1008, 'rate limit');
      return this.webSocketClose(ws);
    }
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return this.err(ws, 'badMessage');
    }
    if (!isObj(msg) || typeof msg.t !== 'string') return this.err(ws, 'badMessage');
    try {
      await this.onMessage(ws, msg);
    } catch (e) {
      console.error('matchmaker', e instanceof Error ? e.message : String(e));
      this.err(ws, errorCode(e));
    }
  }

  webSocketClose(ws: WebSocket) {
    const a = this.att(ws);
    closeSocket(ws, 1000, '');
    if (a?.pid) this.pushStatus();
  }

  webSocketError(ws: WebSocket) {
    this.webSocketClose(ws);
  }

  private att(ws: WebSocket): Attachment | null {
    return ws.deserializeAttachment() as Attachment | null;
  }

  private setAtt(ws: WebSocket, p: Partial<Attachment>) {
    const a = this.att(ws);
    if (a) ws.serializeAttachment({ ...a, ...p });
  }

  private send(ws: WebSocket, m: MmServerMsg) {
    sendText(ws, JSON.stringify(m));
  }

  private err(ws: WebSocket, code: ErrorCode) {
    this.send(ws, { t: 'error', code });
  }

  /** sockets that are really open right now */
  private open(): WebSocket[] {
    return this.ctx.getWebSockets().filter((w) => w.readyState === WebSocket.OPEN);
  }

  private stale(ws: WebSocket, a: Attachment, now: number) {
    const heard = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
    return now - Math.max(heard, a.at, a.since) > STALE_MS;
  }

  // ------------------------------------------------------------------------------------------ messages

  private async onMessage(ws: WebSocket, msg: Record<string, unknown>) {
    const a = this.att(ws);
    if (!a) return closeSocket(ws, 1011, 'no state');
    const now = Date.now();
    if (msg.t === 'hello') {
      if (msg.game !== GAME_ID || msg.proto !== ONLINE_PROTOCOL) {
        this.err(ws, 'version');
        return closeSocket(ws, 4002, 'version');
      }
      if (!isPid(msg.pid)) return this.err(ws, 'badMessage');
      // the same player in a second tab: the newest one counts, the old one leaves the queue
      for (const other of this.open()) {
        if (other !== ws && this.att(other)?.pid === msg.pid) {
          this.err(other, 'replaced');
          this.setAtt(other, { pid: null, since: 0 });
          closeSocket(other, 4003, 'replaced');
        }
      }
      this.setAtt(ws, { pid: msg.pid, at: now });
      this.send(ws, this.status());
      return this.pushStatus();
    }
    if (!a.pid) return this.err(ws, 'badMessage');
    switch (msg.t) {
      case 'find':
        // pressing the button twice does not register twice
        if (a.since || a.busy) return this.send(ws, { t: 'searching' });
        this.setAtt(ws, { since: now, at: now });
        this.send(ws, { t: 'searching' });
        this.pushStatus();
        await this.schedule();
        return this.match();
      case 'cancel':
        this.setAtt(ws, { since: 0 });
        this.send(ws, { t: 'cancelled' });
        return this.pushStatus();
      case 'create': {
        if (a.busy) return;
        const s = cleanSettings(msg.settings, RACE_MAP_IDS);
        if (!s) return this.err(ws, 'badMessage');
        if (!this.allow(this.created, a.ip, 12, 600_000)) return this.err(ws, 'rateLimit');
        return this.withRoom(ws, a.pid, (seat) => this.createRoom('private', { ...s, private: true, maxPlayers: Math.min(s.maxPlayers, this.cfg.maxPlayers) }, [seat]));
      }
      case 'join': {
        if (a.busy) return;
        // guessing codes: 8 wrong ones a minute per address (there are 890 million codes)
        if (this.count(this.wrong, a.ip, 60_000) >= 8) return this.err(ws, 'rateLimit');
        const code = cleanCode(msg.code);
        const room = code ? [...this.sql.exec<{ id: string }>(`SELECT id FROM rooms WHERE code = ?`, code)][0]?.id : undefined;
        if (!room) {
          this.allow(this.wrong, a.ip, 1e9, 60_000);
          return this.err(ws, 'badCode');
        }
        return this.withRoom(ws, a.pid, async (seat) => {
          const r = await this.room(room).reserve([seat]);
          if (r.gone) this.sql.exec(`DELETE FROM rooms WHERE id = ?`, room);
          return r.error ? { error: r.error } : { room };
        });
      }
      default:
        return this.err(ws, 'badMessage');
    }
  }

  /** private rooms: prepare a seat and hand out the ticket */
  private async withRoom(ws: WebSocket, pid: string, get: (seat: Seat) => Promise<{ room?: string; error?: ErrorCode }>) {
    this.setAtt(ws, { since: 0, busy: true });
    try {
      const seat = { pid, ticket: randomHex(16) };
      const r = await get(seat);
      if (!r.room) return this.err(ws, r.error ?? 'serverError');
      await this.assign(pid, r.room);
      this.send(ws, { t: 'match', roomId: r.room, ticket: seat.ticket });
    } finally {
      this.setAtt(ws, { busy: false });
      this.pushStatus();
    }
  }

  // ------------------------------------------------------------------------------------------ Quick Play

  /** groups everybody who is searching; runs again when somebody arrived meanwhile */
  private async match() {
    if (this.matching) {
      this.again = true;
      return;
    }
    this.matching = true;
    try {
      do {
        this.again = false;
        await this.matchOnce();
      } while (this.again);
    } finally {
      this.matching = false;
    }
  }

  private queue(now: number): { ws: WebSocket; pid: string }[] {
    const list: { ws: WebSocket; pid: string; since: number }[] = [];
    for (const ws of this.open()) {
      const a = this.att(ws);
      if (a?.pid && a.since && !a.busy && !this.stale(ws, a, now)) list.push({ ws, pid: a.pid, since: a.since });
    }
    return list.sort((x, y) => x.since - y.since);
  }

  private async matchOnce() {
    // 1. rooms that are still waiting in their lobby
    let waiting = this.queue(Date.now());
    if (!waiting.length) return;
    const rooms = [...this.sql.exec<{ id: string }>(`SELECT id FROM rooms WHERE kind = 'quick' AND open = 1 ORDER BY created LIMIT 5`)];
    for (const { id } of rooms) {
      waiting = this.queue(Date.now());
      if (!waiting.length) return;
      await this.give(waiting, async (seats) => {
        const r = await this.room(id).reserve(seats);
        if (r.gone) this.sql.exec(`DELETE FROM rooms WHERE id = ?`, id);
        else if (r.error || r.free <= 0) this.sql.exec(`UPDATE rooms SET open = 0 WHERE id = ?`, id);
        return { room: id, taken: r.taken };
      });
    }
    // 2. new rooms
    for (;;) {
      waiting = this.queue(Date.now()).slice(0, this.cfg.maxPlayers);
      if (waiting.length < this.cfg.minPlayers) return;
      const map = RACE_MAP_IDS[crypto.getRandomValues(new Uint32Array(1))[0] % RACE_MAP_IDS.length];
      const s: RoomSettings = { name: 'Quick Play', maxPlayers: this.cfg.maxPlayers, mode: 'race', mapId: map, theme: mapTheme(map), laps: 2, minutes: 3, items: true, private: false };
      const ok = await this.give(waiting, async (seats) => {
        const r = await this.createRoom('quick', s, seats);
        if (!r.room) throw new Error(r.error === 'serviceLimit' ? 'Exceeded allowed rooms (daily limit)' : 'room was not created');
        return { room: r.room, taken: seats.map((x) => x.pid) };
      });
      if (!ok) return;
    }
  }

  /** seats players; the ones the room did not take stay in the queue */
  private async give(list: { ws: WebSocket; pid: string }[], get: (seats: Seat[]) => Promise<{ room: string; taken: string[] }>): Promise<boolean> {
    const seats = list.map((x) => ({ pid: x.pid, ticket: randomHex(16) }));
    for (const x of list) this.setAtt(x.ws, { busy: true });
    try {
      const { room, taken } = await get(seats);
      for (let i = 0; i < list.length; i++) {
        if (!taken.includes(list[i].pid)) continue;
        // cancelled or left while the room was being prepared: the unused seat expires in the room
        const a = this.att(list[i].ws);
        if (!a?.since || list[i].ws.readyState !== WebSocket.OPEN) continue;
        this.setAtt(list[i].ws, { since: 0 });
        await this.assign(list[i].pid, room);
        this.send(list[i].ws, { t: 'match', roomId: room, ticket: seats[i].ticket });
      }
      return true;
    } catch (e) {
      console.error('quick play', e instanceof Error ? e.message : String(e));
      // tell the players the truth instead of letting them search forever
      for (const x of list) {
        this.setAtt(x.ws, { since: 0 });
        this.err(x.ws, isLimitError(e) ? 'serviceLimit' : 'serverError');
      }
      return false;
    } finally {
      for (const x of list) this.setAtt(x.ws, { busy: false });
      this.pushStatus();
    }
  }

  // ------------------------------------------------------------------------------------------ rooms

  private room(id: string) {
    return this.env.ROOMS.get(this.env.ROOMS.idFromName(id));
  }

  private async createRoom(kind: RoomKind, s: RoomSettings, seats: Seat[]): Promise<{ room?: string; error?: ErrorCode }> {
    const openRooms = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM rooms`).one().n;
    if (openRooms >= this.cfg.maxOpenRooms) return { error: 'serverFull' };
    if (!this.takeDaily()) return { error: 'serviceLimit' };
    const id = randomHex(16);
    let code: string | null = null;
    if (kind === 'private') {
      do code = this.newCode();
      while ([...this.sql.exec(`SELECT id FROM rooms WHERE code = ?`, code)].length);
    }
    await this.room(id).create({ id, kind, code, settings: s, seats });
    this.sql.exec(`INSERT INTO rooms (id, kind, code, open, created) VALUES (?, ?, ?, ?, ?)`, id, kind, code, kind === 'quick' && seats.length < s.maxPlayers ? 1 : 0, Date.now());
    return { room: id };
  }

  private newCode() {
    let s = '';
    while (s.length < CODE_LENGTH) {
      // rejection sampling: every character is equally likely
      const n = crypto.getRandomValues(new Uint8Array(1))[0];
      if (n < 256 - (256 % CODE_ALPHABET.length)) s += CODE_ALPHABET[n % CODE_ALPHABET.length];
    }
    return s;
  }

  /** own daily budget of new rooms (UTC days, like the platform limits) */
  private takeDaily(): boolean {
    if (this.cfg.maxRoomsPerDay <= 0) return true;
    const day = new Date().toISOString().slice(0, 10);
    const row = [...this.sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'rooms'`)][0]?.v ?? '';
    const n = row.startsWith(day) ? Number(row.slice(11)) : 0;
    if (n >= this.cfg.maxRoomsPerDay) return false;
    this.sql.exec(`INSERT INTO meta (k, v) VALUES ('rooms', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, `${day} ${n + 1}`);
    return true;
  }

  /** one player, one room: a seat somewhere else is given up */
  private async assign(pid: string, room: string) {
    const old = [...this.sql.exec<{ room: string }>(`SELECT room FROM players WHERE pid = ?`, pid)][0]?.room;
    this.sql.exec(`INSERT INTO players (pid, room, at) VALUES (?, ?, ?) ON CONFLICT (pid) DO UPDATE SET room = excluded.room, at = excluded.at`, pid, room, Date.now());
    if (old && old !== room) {
      try {
        await this.room(old).evict(pid);
      } catch (e) {
        console.error('evict', e instanceof Error ? e.message : String(e));
      }
    }
  }

  /** a room reports what changed (who left, whether it takes players again, that it is gone) */
  async report(id: string, r: { open?: boolean; gone?: string[]; closed?: boolean }) {
    for (const pid of r.gone ?? []) this.sql.exec(`DELETE FROM players WHERE pid = ? AND room = ?`, pid, id);
    if (r.closed) {
      this.sql.exec(`DELETE FROM rooms WHERE id = ?`, id);
      this.sql.exec(`DELETE FROM players WHERE room = ?`, id);
    } else if (r.open !== undefined) this.sql.exec(`UPDATE rooms SET open = ? WHERE id = ? AND kind = 'quick' AND open != ?`, r.open ? 1 : 0, id, r.open ? 1 : 0);
    this.pushStatus();
    if (r.open) await this.match();
  }

  // ------------------------------------------------------------------------------------------ status

  private status(): MmServerMsg {
    const pids = new Set<string>();
    let searching = 0;
    for (const ws of this.open()) {
      const a = this.att(ws);
      if (!a?.pid) continue;
      pids.add(a.pid);
      if (a.since) searching++;
    }
    for (const p of this.sql.exec<{ pid: string }>(`SELECT pid FROM players`)) pids.add(p.pid);
    return { t: 'status', online: pids.size, searching, min: this.cfg.minPlayers, max: this.cfg.maxPlayers };
  }

  /** several changes within half a second become one update (the timer exists only then) */
  private pushStatus() {
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      const data = JSON.stringify(this.status());
      for (const ws of this.open()) if (this.att(ws)?.pid) sendText(ws, data);
    }, 500);
  }

  // ------------------------------------------------------------------------------------------ time

  /** the alarm only exists while somebody is searching */
  private async schedule() {
    let next = Infinity;
    for (const ws of this.open()) {
      const a = this.att(ws);
      if (a?.since) next = Math.min(next, a.since + this.cfg.searchMs);
    }
    if (next === Infinity) return;
    const cur = await this.ctx.storage.getAlarm();
    if (cur === null || cur > next) await this.ctx.storage.setAlarm(next);
  }

  async alarm() {
    const now = Date.now();
    for (const ws of this.open()) {
      const a = this.att(ws);
      if (!a) continue;
      if (this.stale(ws, a, now)) {
        this.setAtt(ws, { since: 0, pid: null });
        closeSocket(ws, 4008, 'silent');
      } else if (a.since && !a.busy && now - a.since >= this.cfg.searchMs) {
        this.setAtt(ws, { since: 0 });
        this.err(ws, 'searchTimeout');
      }
    }
    // rooms / players that never reported back (e.g. the quota ran out in the middle of a race)
    this.sql.exec(`DELETE FROM players WHERE at < ?`, now - ASSIGN_TTL_MS);
    this.sql.exec(`DELETE FROM rooms WHERE created < ?`, now - ASSIGN_TTL_MS * 2);
    this.pushStatus();
    await this.schedule();
  }

  // ------------------------------------------------------------------------------------------ per-address limits

  private count(map: Map<string, number[]>, ip: string, windowMs: number) {
    const now = Date.now();
    const list = (map.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (list.length) map.set(ip, list);
    else map.delete(ip);
    return list.length;
  }

  private allow(map: Map<string, number[]>, ip: string, max: number, windowMs: number): boolean {
    if (this.count(map, ip, windowMs) >= max) return false;
    map.set(ip, [...(map.get(ip) ?? []), Date.now()]);
    return true;
  }

  /** tests only (DEBUG = 1) */
  async debugRows() {
    if (!this.cfg.debug) return null;
    return { rooms: this.sql.exec(`SELECT * FROM rooms`).toArray(), players: this.sql.exec(`SELECT * FROM players`).toArray().length };
  }
}
