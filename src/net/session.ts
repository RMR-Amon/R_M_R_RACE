/**
 * The multiplayer session: one connection to one room on one host.
 * Holds the lobby / match state the UI renders (as an immutable snapshot for React) and turns
 * server messages into UI phases; during a match it feeds the RaceLink used by the engine.
 */
import { useSyncExternalStore } from 'react';
import { GAME_ID, GAME_VERSION, NET, ONLINE, ONLINE_PROTOCOL, PROTOCOL_VERSION } from './config';
import { Connection, type ConnState } from './connection';
import type { ClientMsg, ErrorCode, MatchInfo, NoticeKey, Profile, ResultInfo, RoomSettings, RoomState, ServerMsg } from './protocol';
import { RaceLink } from './raceLink';

export type NetFatal = ErrorCode | 'unreachable' | 'lost' | 'kicked' | 'hostClosed' | 'shutdown' | 'idle' | 'onlineLost' | 'onlineUnreachable' | 'onlineVersion';

export interface Notice {
  id: number;
  key: NoticeKey;
  name?: string;
}

export interface ResultsView {
  rows: ResultInfo[];
  mode: MatchInfo['mode'];
  laps: number;
  mapId: string;
}

export interface NetView {
  phase: 'idle' | 'connecting' | 'lobby' | 'race' | 'results' | 'ended';
  conn: ConnState | 'idle';
  room: RoomState | null;
  you: number;
  rtt: number;
  fatal: { code: NetFatal; detail?: string } | null;
  /** non-fatal problem shown in the lobby (e.g. "cannot start yet") */
  warn: { code: ErrorCode; detail?: string; id: number } | null;
  notices: Notice[];
  match: MatchInfo | null;
  results: ResultsView | null;
  /** increases with every match the session loads */
  raceKey: number;
  /** a room of the online service (false: LAN) */
  online: boolean;
}

const IDLE: NetView = {
  phase: 'idle',
  conn: 'idle',
  room: null,
  you: -1,
  rtt: -1,
  fatal: null,
  warn: null,
  notices: [],
  match: null,
  results: null,
  raceKey: 0,
  online: false,
};

/** errors that end the session (the rest are lobby warnings) */
const FATAL: ErrorCode[] = ['version', 'roomNotFound', 'roomFull', 'inProgress', 'wrongCode', 'kicked', 'sessionExpired', 'serverFull', 'serviceLimit', 'serverError', 'badOrigin', 'replaced', 'afk'];

const STORE_KEY = 'rmr-lan-session';

interface Saved {
  url: string;
  roomId: string;
  token: string;
  at: number;
  online?: boolean;
}

export function savedSession(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    // the host only keeps a dropped slot for RECONNECT_GRACE_MS
    if (!s || typeof s.token !== 'string' || Date.now() - s.at > (s.online ? ONLINE.RECONNECT_GRACE_MS : NET.RECONNECT_GRACE_MS)) {
      sessionStorage.removeItem(STORE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

class NetSession {
  private v: NetView = IDLE;
  private listeners = new Set<() => void>();
  private conn: Connection | null = null;
  private token: string | null = null;
  private roomId: string | null = null;
  private online = false;
  private n = 0;
  private noticeId = 0;
  private saveTimer = 0;
  /** link of the running match (the engine reads it) */
  link: RaceLink | null = null;

  get view() {
    return this.v;
  }

  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };

  /** host:port of the server the room lives on (null without a session) */
  get host(): string | null {
    return this.conn ? new URL(this.conn.url).host : null;
  }

  private set(patch: Partial<NetView>) {
    this.v = { ...this.v, ...patch };
    this.listeners.forEach((f) => f());
  }

  private nextN = () => ++this.n;

  // ---------------------------------------------------------------------------------------- start

  create(url: string, settings: RoomSettings, profile: Profile) {
    this.begin(url, null, (resume) =>
      resume ? this.resumeHello() : { t: 'hello', game: GAME_ID, proto: PROTOCOL_VERSION, ver: GAME_VERSION, join: 'create', settings, profile },
    );
  }

  join(url: string, roomId: string, profile: Profile, code?: string) {
    this.begin(url, roomId, (resume) =>
      resume ? this.resumeHello() : { t: 'hello', game: GAME_ID, proto: PROTOCOL_VERSION, ver: GAME_VERSION, join: 'join', roomId, profile, code },
    );
  }

  /** online: take the seat the matchmaking service reserved */
  joinTicket(url: string, roomId: string, ticket: string, profile: Profile) {
    this.begin(
      url,
      roomId,
      (resume) =>
        resume ? this.resumeHello() : { t: 'hello', game: GAME_ID, proto: ONLINE_PROTOCOL, ver: GAME_VERSION, join: 'ticket', roomId, ticket, profile },
      null,
      true,
    );
  }

  /** server clock (ms); 0 without a session */
  serverNow() {
    return this.conn?.serverNow() ?? 0;
  }

  /** rejoin after a page reload (token kept in sessionStorage) */
  resumeSaved(): boolean {
    const s = savedSession();
    if (!s) return false;
    this.begin(s.url, s.roomId, () => this.resumeHello(), s.token, !!s.online);
    return true;
  }

  private resumeHello(): ClientMsg | null {
    if (!this.token || !this.roomId) return null;
    const proto = this.online ? ONLINE_PROTOCOL : PROTOCOL_VERSION;
    // the race this page is showing: if it ended meanwhile, the room sends its results
    const match = this.online && this.link ? this.link.info.id : undefined;
    return { t: 'hello', game: GAME_ID, proto, ver: GAME_VERSION, join: 'resume', roomId: this.roomId, token: this.token, match };
  }

  private begin(url: string, roomId: string | null, hello: (resume: boolean) => ClientMsg | null, token: string | null = null, online = false) {
    this.teardown();
    this.online = online;
    this.token = token;
    this.roomId = roomId;
    this.n = 0;
    this.v = { ...IDLE, phase: 'connecting', conn: 'connecting', raceKey: this.v.raceKey, online };
    this.set({});
    // callbacks of an old connection that is still closing must not touch the new session
    let conn: Connection | null = null;
    const mine = () => conn !== null && this.conn === conn;
    conn = new Connection(
      url,
      {
        onJson: (m) => mine() && this.onJson(m),
        onBinary: (view) => mine() && this.link?.onSnapshot(view),
        onState: (s) => {
          if (!mine()) return;
          this.set({ conn: s });
          if (s === 'open') this.save();
        },
        onClosed: (reason) => mine() && this.end(online ? (reason === 'unreachable' ? 'onlineUnreachable' : 'onlineLost') : reason === 'normal' ? 'lost' : reason),
      },
      hello,
      online,
    );
    this.conn = conn;
    // keep the saved session fresh while connected (used to resume after a page reload)
    this.saveTimer = window.setInterval(() => {
      this.save();
      if (this.conn && this.conn.rtt !== this.v.rtt) this.set({ rtt: this.conn.rtt });
    }, 1000);
  }

  private save() {
    if (!this.token || !this.roomId || !this.conn || this.conn.state !== 'open') return;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ url: this.conn.url, roomId: this.roomId, token: this.token, at: Date.now(), online: this.online } satisfies Saved));
    } catch {
      /* storage blocked */
    }
  }

  private forget() {
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------------------- incoming

  private onJson(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.token = m.token;
        this.roomId = m.room.id;
        this.conn?.markEstablished();
        this.set({
          you: m.you,
          room: m.room,
          phase: this.v.phase === 'race' || this.v.phase === 'results' ? this.v.phase : 'lobby',
        });
        this.save();
        return;
      case 'error':
        // the room object is restarting: the connection tries again by itself
        if (m.code === 'serverError' && this.online && this.token) return;
        if (m.code === 'version' && this.online) {
          this.end('onlineVersion');
          return;
        }
        if (FATAL.includes(m.code) || !this.token) {
          this.end(m.code, m.detail);
          return;
        }
        this.set({ warn: { code: m.code, detail: m.detail, id: ++this.noticeId } });
        return;
      case 'room':
        this.set({ room: m.room });
        return;
      case 'notice':
        this.notice(m.key, m.name);
        return;
      case 'kicked':
        this.end('kicked');
        return;
      case 'closed':
        this.end(m.reason === 'host' ? 'hostClosed' : m.reason);
        return;
      case 'load': {
        // a reconnect in the middle of the same match keeps the running race
        if (this.link && this.link.info.id === m.match.id && !this.link.disposed) {
          // players who left while we were disconnected
          for (const r of this.link.info.roster) if (!m.match.roster.some((x) => x.id === r.id)) this.link.queue({ k: 'left', id: r.id });
          return;
        }
        if (!this.conn) return;
        this.link = new RaceLink(m.match, this.v.you, this.conn, this.nextN);
        this.set({ match: m.match, phase: 'race', results: null, raceKey: this.v.raceKey + 1 });
        return;
      }
      case 'go':
        this.link?.onGo(m.at);
        return;
      case 'standings':
        this.link?.onStandings(m.rows);
        return;
      case 'item':
        this.link?.queue({ k: 'item', from: m.from, e: m.e });
        return;
      case 'hit':
        this.link?.queue({ k: 'hit', victim: m.victim, owner: m.owner, shot: m.shot, kind: m.kind });
        return;
      case 'left':
        this.link?.queue({ k: 'left', id: m.id });
        return;
      case 'correct':
        this.link?.queue({ k: 'correct', x: m.x, y: m.y, z: m.z, heading: m.heading });
        return;
      case 'results':
        if (this.link) this.link.disposed = true;
        this.link = null;
        this.set({ results: { rows: m.rows, mode: m.mode, laps: m.laps, mapId: m.mapId }, phase: 'results', match: null });
        return;
      case 'abort':
        if (this.link) this.link.disposed = true;
        this.link = null;
        this.set({ phase: 'lobby', match: null });
        this.notice(m.key, m.name);
        return;
      default:
        return;
    }
  }

  private notice(key: NoticeKey, name?: string) {
    this.set({ notices: [...this.v.notices.slice(-3), { id: ++this.noticeId, key, name }] });
  }

  // ---------------------------------------------------------------------------------------- commands

  private cmd(build: (n: number) => ClientMsg) {
    this.conn?.send(build(this.nextN()));
  }

  setReady(v: boolean) {
    this.cmd((n) => ({ t: 'ready', n, v }));
  }
  setSettings(s: RoomSettings) {
    this.cmd((n) => ({ t: 'settings', n, s }));
  }
  setProfile(p: Profile) {
    this.cmd((n) => ({ t: 'profile', n, p }));
  }
  kick(id: number) {
    this.cmd((n) => ({ t: 'kick', n, id }));
  }
  start() {
    this.cmd((n) => ({ t: 'start', n }));
  }

  /** the host closes the room for everybody */
  closeRoom() {
    this.cmd((n) => ({ t: 'close', n }));
    this.reset();
  }

  /** leave the room (lobby or match) */
  leave() {
    this.conn?.send({ t: 'leave' });
    this.reset();
  }

  /** results seen: back into the lobby of the same room */
  backToLobby() {
    if (this.v.phase !== 'results') return;
    this.set({ phase: 'lobby', results: null });
    if (this.online) this.cmd((n) => ({ t: 'back', n }));
  }

  /** a fatal error was shown: back to idle */
  dismiss() {
    this.reset();
  }

  dismissWarn() {
    if (this.v.warn) this.set({ warn: null });
  }

  private end(code: NetFatal, detail?: string) {
    this.teardown();
    this.forget();
    this.set({ ...IDLE, phase: 'ended', fatal: { code, detail }, raceKey: this.v.raceKey });
  }

  private reset() {
    this.teardown();
    this.forget();
    this.set({ ...IDLE, raceKey: this.v.raceKey });
  }

  private teardown() {
    clearInterval(this.saveTimer);
    if (this.link) this.link.disposed = true;
    this.link = null;
    const c = this.conn;
    this.conn = null;
    // small delay so a final message (leave / close) still goes out before the socket closes
    if (c) window.setTimeout(() => c.endQuietly(), 60);
    this.token = null;
  }
}

export const net = new NetSession();

/** React hook: re-renders on every session change */
export const useNet = (): NetView => useSyncExternalStore(net.subscribe, () => net.view, () => net.view);
