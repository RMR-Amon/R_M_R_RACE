/**
 * Room / lobby manager: players, host role, settings, readiness, kicking, reconnection and the
 * hand-over into a match. All lobby rules are enforced here — the browser UI only mirrors them.
 */
import crypto from 'node:crypto';
import { NET } from '../src/net/config';
import {
  cleanItemEvent,
  cleanProfile,
  cleanSettings,
  isInt,
  type ClientMsg,
  type ErrorCode,
  type HitKind,
  type NoticeKey,
  type PlayerInfo,
  type PlayerStatus,
  type Profile,
  type ResultInfo,
  type RoomListing,
  type RoomSettings,
  type RoomState,
  type RoomStatus,
  type RosterEntry,
  type ServerMsg,
} from '../src/net/protocol';
import { CAR_IDS, DEFAULT_LOOK, RACE_MAP_IDS } from './gameData';
import { Match, type MatchHost } from './match';
import type { Peer } from './peer';
import { log } from './log';

export interface Player {
  readonly id: number;
  profile: Profile;
  ready: boolean;
  status: PlayerStatus;
  readonly token: string;
  peer: Peer | null;
  readonly joinedAt: number;
  dropAt: number;
  /** last processed command number (replayed / duplicated commands are ignored) */
  lastN: number;
}

export interface RoomOwner {
  removeRoom(room: Room): void;
}

const HIT_KINDS: readonly HitKind[] = ['missile', 'ice', 'bomb', 'oil'];
const newCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

export class Room implements MatchHost {
  readonly id = crypto.randomBytes(4).toString('hex');
  settings: RoomSettings;
  code: string | null;
  status: RoomStatus = 'lobby';
  hostId = -1;
  match: Match | null = null;
  readonly players = new Map<number, Player>();
  private bans = new Map<string, number>();
  private wrongCodes = new Map<string, { n: number; until: number }>();
  private dirty = true;
  private lastPingSync = 0;
  private closed = false;

  constructor(
    private readonly owner: RoomOwner,
    settings: RoomSettings,
  ) {
    this.settings = settings;
    this.code = settings.private ? newCode() : null;
  }

  get hostName() {
    return this.players.get(this.hostId)?.profile.name ?? '?';
  }

  // ---------------------------------------------------------------------------------------- joining

  /** why `peer` may not join right now, or null */
  joinError(peer: Peer, code: string | undefined, now: number): ErrorCode | null {
    if ((this.bans.get(peer.ip) ?? 0) > now) return 'kicked';
    if (this.status !== 'lobby') return 'inProgress';
    if (this.players.size >= this.settings.maxPlayers) return 'roomFull';
    if (this.code) {
      const w = this.wrongCodes.get(peer.ip);
      if (w && w.until > now) return 'rateLimit';
      if (code !== this.code) {
        const n = (w?.n ?? 0) + 1;
        // brute-forcing the 4-digit code: 5 tries, then a 30 s lock-out
        this.wrongCodes.set(peer.ip, { n: n >= 5 ? 0 : n, until: n >= 5 ? now + 30000 : 0 });
        return 'wrongCode';
      }
    }
    return null;
  }

  addPlayer(peer: Peer, profile: Profile, now: number): Player {
    let id = 0;
    while (this.players.has(id)) id++;
    const p: Player = {
      id,
      profile,
      ready: false,
      status: 'online',
      token: crypto.randomBytes(16).toString('hex'),
      peer,
      joinedAt: now,
      dropAt: 0,
      lastN: 0,
    };
    this.players.set(id, p);
    if (this.hostId < 0) this.hostId = id;
    peer.role = 'player';
    peer.send({ t: 'welcome', you: id, token: p.token, room: this.state(id), time: now });
    this.broadcast({ t: 'notice', key: 'joined', name: profile.name }, id);
    this.dirty = true;
    log.info(`room ${this.id}: ${profile.name} joined (${this.players.size}/${this.settings.maxPlayers}) from ${peer.ip}`);
    return p;
  }

  /** a player whose connection dropped comes back with their secret token */
  resume(peer: Peer, token: string, now: number): Player | null {
    const p = [...this.players.values()].find((x) => x.token === token);
    if (!p) return null;
    if (p.peer && p.peer !== peer) p.peer.close(4000, 'replaced');
    p.peer = peer;
    p.status = 'online';
    p.lastN = 0;
    peer.role = 'player';
    peer.send({ t: 'welcome', you: p.id, token: p.token, room: this.state(p.id), time: now });
    if (this.match?.has(p.id)) {
      this.match.setStatus(p.id, 'online');
      peer.send({ t: 'load', match: this.match.resumeInfo(p.id) });
      if (this.match.phase !== 'loading') {
        peer.send({ t: 'go', at: this.match.goAt });
        peer.send({ t: 'standings', rows: this.match.standings() });
      }
    }
    this.broadcast({ t: 'notice', key: 'back', name: p.profile.name }, p.id);
    this.dirty = true;
    log.info(`room ${this.id}: ${p.profile.name} reconnected`);
    return p;
  }

  /** the socket of a player closed: keep the slot for RECONNECT_GRACE_MS */
  onDisconnect(p: Player, now: number) {
    if (!this.players.has(p.id) || !p.peer) return;
    p.peer = null;
    p.status = 'reconnecting';
    p.dropAt = now;
    this.match?.setStatus(p.id, 'reconnecting');
    this.broadcast({ t: 'notice', key: 'dropped', name: p.profile.name });
    this.dirty = true;
    log.info(`room ${this.id}: ${p.profile.name} lost connection, waiting ${NET.RECONNECT_GRACE_MS / 1000}s`);
  }

  private removePlayer(p: Player, notice: NoticeKey) {
    if (!this.players.delete(p.id)) return;
    this.match?.remove(p.id);
    p.peer?.close(1000, 'left');
    p.peer = null;
    this.broadcast({ t: 'notice', key: notice, name: p.profile.name });
    log.info(`room ${this.id}: ${p.profile.name} ${notice}`);
    if (!this.players.size) {
      this.destroy();
      return;
    }
    if (p.id === this.hostId) {
      // host migration: the room lives on this server, so the lobby simply gets a new host —
      // the player who has been in the room longest and is still connected
      const next = [...this.players.values()].sort(
        (a, b) => (a.status === 'online' ? 0 : 1) - (b.status === 'online' ? 0 : 1) || a.joinedAt - b.joinedAt,
      )[0];
      this.hostId = next.id;
      next.ready = false;
      this.broadcast({ t: 'notice', key: 'newHost', name: next.profile.name });
      log.info(`room ${this.id}: ${next.profile.name} is the new host`);
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------------------- messages

  onMessage(p: Player, msg: ClientMsg, now: number) {
    // commands carry an increasing number: duplicates / replays are ignored
    if ('n' in msg) {
      if (!isInt(msg.n, 1, 2 ** 31) || msg.n <= p.lastN) return;
      p.lastN = msg.n;
    }
    const isHost = p.id === this.hostId;
    switch (msg.t) {
      case 'settings': {
        if (!isHost) return this.err(p, 'notHost');
        if (this.status !== 'lobby') return;
        const s = cleanSettings(msg.s, RACE_MAP_IDS);
        if (!s) return this.err(p, 'badMessage');
        s.maxPlayers = Math.max(s.maxPlayers, this.players.size, NET.MIN_PLAYERS);
        if (s.private && !this.code) this.code = newCode();
        if (!s.private) this.code = null;
        const changedRace = JSON.stringify({ ...this.settings, name: '' }) !== JSON.stringify({ ...s, name: '' });
        this.settings = s;
        // new conditions: everybody confirms again
        if (changedRace) for (const x of this.players.values()) x.ready = false;
        this.dirty = true;
        return;
      }
      case 'profile': {
        if (this.status !== 'lobby') return;
        const prof = cleanProfile(msg.p, CAR_IDS, DEFAULT_LOOK);
        if (!prof) return this.err(p, 'badMessage');
        p.profile = prof;
        this.dirty = true;
        return;
      }
      case 'ready':
        if (this.status !== 'lobby') return;
        p.ready = msg.v === true;
        this.dirty = true;
        return;
      case 'kick': {
        if (!isHost) return this.err(p, 'notHost');
        const target = isInt(msg.id, 0, 255) ? this.players.get(msg.id) : undefined;
        if (!target || target.id === p.id) return;
        target.peer?.send({ t: 'kicked' });
        if (target.peer) this.bans.set(target.peer.ip, now + 60000);
        this.removePlayer(target, 'kickedOther');
        return;
      }
      case 'start':
        if (!isHost) return this.err(p, 'notHost');
        return this.start(p, now);
      case 'close':
        if (!isHost) return this.err(p, 'notHost');
        log.info(`room ${this.id} closed by the host`);
        return this.close('host');
      case 'leave':
        return this.removePlayer(p, 'left');
      case 'loaded':
        this.match?.onLoaded(p.id);
        return;
      case 'item': {
        const e = cleanItemEvent(msg.e);
        if (e && this.match) this.match.onItem(p.id, e, now);
        return;
      }
      case 'hit':
        if (!this.match || !isInt(msg.owner, 0, 255) || !isInt(msg.shot, 0, 0xffffff) || !HIT_KINDS.includes(msg.kind)) return;
        this.match.onHit(p.id, msg.owner, msg.shot, msg.kind, now);
        return;
      default:
        return;
    }
  }

  onBinary(p: Player, view: DataView, now: number) {
    this.match?.onState(p.id, view, now);
  }

  private err(p: Player, code: ErrorCode, detail?: string) {
    p.peer?.send({ t: 'error', code, detail });
  }

  /** checks that the lobby is ready, then hands the players over to a new match */
  private start(host: Player, now: number) {
    if (this.status !== 'lobby') return;
    const list = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    if (list.length < NET.MIN_PLAYERS) return this.err(host, 'tooFewPlayers');
    const offline = list.filter((x) => x.status !== 'online');
    if (offline.length) return this.err(host, 'notReady', offline.map((x) => x.profile.name).join(', '));
    const waiting = list.filter((x) => x.id !== this.hostId && !x.ready);
    if (waiting.length) return this.err(host, 'notReady', waiting.map((x) => x.profile.name).join(', '));
    const laggy = list.filter((x) => (x.peer?.rtt ?? -1) < 0 || (x.peer?.rtt ?? 0) > NET.MAX_START_PING);
    if (laggy.length) return this.err(host, 'badPing', laggy.map((x) => x.profile.name).join(', '));

    const roster: RosterEntry[] = list.map((x, slot) => ({ ...x.profile, id: x.id, slot }));
    this.match = new Match(this, this.settings, roster, now);
    this.status = 'loading';
    this.broadcast({ t: 'load', match: this.match.info });
    this.dirty = true;
    log.info(`room ${this.id}: match ${this.match.id} starting with ${roster.length} players (${this.match.info.mode} on ${this.match.info.mapId})`);
  }

  // ---------------------------------------------------------------------------------------- MatchHost

  broadcast(msg: ServerMsg, exceptId = -1) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.id !== exceptId) p.peer?.sendRaw(data);
  }

  broadcastBinary(bytes: Uint8Array) {
    for (const p of this.players.values()) p.peer?.sendRaw(bytes);
  }

  sendTo(id: number, msg: ServerMsg) {
    this.players.get(id)?.peer?.send(msg);
  }

  onEnd(results: ResultInfo[] | null, abort?: { key: 'loadFailed'; name: string }) {
    const m = this.match;
    this.match = null;
    this.status = 'lobby';
    for (const p of this.players.values()) p.ready = false;
    if (results && m) this.broadcast({ t: 'results', rows: results, mode: m.info.mode, laps: m.info.laps, mapId: m.info.mapId });
    if (abort) this.broadcast({ t: 'abort', key: abort.key, name: abort.name });
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------------------- tick / state

  tick(now: number) {
    for (const p of [...this.players.values()]) {
      if (p.status === 'reconnecting' && now - p.dropAt > NET.RECONNECT_GRACE_MS) this.removePlayer(p, 'left');
    }
    if (this.closed) return;
    if (this.match) {
      this.match.tick(now);
      if (this.match?.phase === 'loading' || this.match?.phase === 'countdown' || this.match?.phase === 'racing') {
        const st: RoomStatus = this.match.phase === 'loading' ? 'loading' : 'racing';
        if (st !== this.status) {
          this.status = st;
          this.dirty = true;
        }
      }
    }
    // lobby: refresh the ping column every 2 s
    if (this.status === 'lobby' && now - this.lastPingSync > 2000) {
      this.lastPingSync = now;
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      for (const p of this.players.values()) p.peer?.send({ t: 'room', room: this.state(p.id) });
    }
  }

  state(forId: number): RoomState {
    const players: PlayerInfo[] = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        ...p.profile,
        id: p.id,
        host: p.id === this.hostId,
        ready: p.id === this.hostId || p.ready,
        ping: p.peer?.rtt ?? -1,
        status: p.status,
      }));
    return {
      id: this.id,
      settings: this.settings,
      status: this.status,
      hostId: this.hostId,
      players,
      code: forId === this.hostId && this.code ? this.code : undefined,
    };
  }

  listing(sid: string, port: number, version: string): RoomListing {
    const s = this.settings;
    return {
      sid,
      roomId: this.id,
      name: s.name,
      hostName: this.hostName,
      players: this.players.size,
      max: s.maxPlayers,
      status: this.status,
      mode: s.mode,
      mapId: s.mode === 'battle' ? 'arena' : s.mapId,
      theme: s.theme,
      laps: s.laps,
      minutes: s.minutes,
      private: !!this.code,
      version,
      address: null,
      port,
    };
  }

  findByPeer(peer: Peer): Player | undefined {
    for (const p of this.players.values()) if (p.peer === peer) return p;
    return undefined;
  }

  /** closes the room for everybody */
  close(reason: 'host' | 'shutdown') {
    if (this.closed) return;
    this.broadcast({ t: 'closed', reason });
    for (const p of this.players.values()) p.peer?.close(1000, 'room closed');
    this.players.clear();
    this.destroy();
  }

  private destroy() {
    if (this.closed) return;
    this.closed = true;
    this.match = null;
    this.owner.removeRoom(this);
    log.info(`room ${this.id} removed`);
  }
}
