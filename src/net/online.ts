/**
 * Online multiplayer (Cloudflare): the only place that knows the backend address.
 *
 * VITE_MULTIPLAYER_URL is set where the site is built (Netlify, .env.development); without it online
 * play is simply not available and nothing is contacted.
 *
 * This module talks to the matchmaking service: Quick Play queue, private rooms, "players online".
 * When a seat is found it hands the room address over to the session (session.ts).
 */
import { useSyncExternalStore } from 'react';
import { GAME_ID, ONLINE, ONLINE_PROTOCOL, WS_PING, WS_PONG } from './config';
import { lanMode } from './lanService';
import type { ErrorCode, MmClientMsg, MmServerMsg, RoomSettings } from './protocol';

const RAW = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_MULTIPLAYER_URL ?? '').trim();

/** "https://name.account.workers.dev" (any of http, https, ws, wss) → the two base addresses, or null */
function parse(raw: string): { ws: string; http: string } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const secure = u.protocol === 'https:' || u.protocol === 'wss:';
    if (!secure && u.protocol !== 'http:' && u.protocol !== 'ws:') return null;
    // an HTTPS page may only use wss:// (the browser blocks everything else)
    if (!secure && typeof location !== 'undefined' && location.protocol === 'https:') return null;
    const path = u.pathname.replace(/\/+$/, '');
    return { ws: `${secure ? 'wss' : 'ws'}://${u.host}${path}`, http: `${secure ? 'https' : 'http'}://${u.host}${path}` };
  } catch {
    return null;
  }
}

const BASE = parse(RAW);

/** this page plays online; pages that came from a LAN server and the desktop app keep their LAN menu */
export const onlineAvailable = () => BASE !== null && (lanMode() === 'unsupported' || lanMode() === 'dev');

export const onlineRoomUrl = (roomId: string) => `${BASE?.ws ?? ''}/room/${roomId}`;

// ---------------------------------------------------------------------------- who am I

const PID_KEY = 'rmr-online-id';
let memoryPid: string | null = null;

/** random secret of this browser: the service uses it to keep one player in one room */
function playerId(): string {
  try {
    const s = localStorage.getItem(PID_KEY);
    if (s && /^[0-9a-f]{32}$/.test(s)) return s;
  } catch {
    /* storage blocked */
  }
  memoryPid ??= Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(PID_KEY, memoryPid);
  } catch {
    /* storage blocked: a new id for every visit */
  }
  return memoryPid;
}

// ---------------------------------------------------------------------------- invite links

export const inviteLink = (code: string) => `${location.origin}${location.pathname}?room=${code}`;

/** code of an invite link the page was opened with (read once, then removed from the address bar) */
let linkCode: string | null = null;
export function takeInviteCode(): string | null {
  const c = linkCode;
  linkCode = null;
  return c;
}

/** called once at start; true = the page was opened with an invite link */
export function readInviteLink(): boolean {
  if (typeof location === 'undefined' || !onlineAvailable()) return false;
  const q = new URLSearchParams(location.search);
  const code = q.get('room');
  if (!code) return linkCode !== null;
  linkCode = code.slice(0, 12);
  q.delete('room');
  const rest = q.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  return true;
}

// ---------------------------------------------------------------------------- matchmaking

export type OnlineState = 'connecting' | 'online' | 'offline' | 'limit';

export interface OnlineView {
  state: OnlineState;
  /** players in the menu, the queue and rooms; null = not known yet */
  players: number | null;
  searching: number;
  min: number;
  max: number;
  phase: 'idle' | 'searching' | 'creating' | 'joining';
  /** performance.now() when the search started */
  since: number;
  error: { code: ErrorCode | 'onlineUnreachable' | 'onlineVersion'; id: number } | null;
  /** a seat was found: the menu takes it with takeMatch() */
  match: { roomId: string; ticket: string } | null;
}

const IDLE: OnlineView = { state: 'connecting', players: null, searching: 0, min: 2, max: 8, phase: 'idle', since: 0, error: null, match: null };
const BACKOFF = [1000, 2000, 4000, 8000, 15000];
/** these answers end the connection for good: retrying would not help */
const FINAL: ErrorCode[] = ['version', 'badOrigin', 'replaced'];

class OnlineService {
  private v: OnlineView = IDLE;
  private listeners = new Set<() => void>();
  private users = 0;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retry = 0;
  private openTimer = 0;
  private pingTimer = 0;
  private heard = 0;
  private stopped = false;
  /** the service itself said that its quota is used up (until it answers normally again) */
  private limited = false;
  private errorId = 0;

  get view() {
    return this.v;
  }

  subscribe = (f: () => void) => {
    this.listeners.add(f);
    // connected only while the multiplayer menu is on screen
    if (++this.users === 1) this.start();
    return () => {
      this.listeners.delete(f);
      if (--this.users === 0) this.stop();
    };
  };

  private set(p: Partial<OnlineView>) {
    this.v = { ...this.v, ...p };
    this.listeners.forEach((f) => f());
  }

  private start() {
    this.stopped = false;
    this.attempt = 0;
    this.v = { ...IDLE };
    this.open();
    this.pingTimer = window.setInterval(this.ping, ONLINE.MENU_PING_MS);
  }

  private stop() {
    this.stopped = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retry);
    clearTimeout(this.openTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onopen = ws.onerror = null;
      ws.close(1000);
    }
    this.v = { ...IDLE };
  }

  private open() {
    if (!BASE || this.stopped) return;
    clearTimeout(this.retry);
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${BASE.ws}/matchmaking`);
    } catch {
      this.set({ state: 'offline' });
      return;
    }
    this.ws = ws;
    const lost = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.openTimer);
      this.ws = null;
      ws.onclose = ws.onmessage = ws.onopen = ws.onerror = null;
      this.onLost();
    };
    clearTimeout(this.openTimer);
    this.openTimer = window.setTimeout(() => {
      ws.close();
      lost();
    }, ONLINE.CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      this.heard = performance.now();
      this.send({ t: 'hello', game: GAME_ID, proto: ONLINE_PROTOCOL, pid: playerId() });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.heard = performance.now();
      if (typeof ev.data !== 'string' || ev.data === WS_PONG) return;
      let m: MmServerMsg;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.onMsg(m);
    };
    ws.onclose = lost;
  }

  private onLost() {
    if (this.stopped) return;
    // a search continues after reconnecting; creating / joining is reported as failed
    if (this.v.phase === 'creating' || this.v.phase === 'joining') {
      this.set({ phase: 'idle', error: { code: 'onlineUnreachable', id: ++this.errorId } });
    }
    if (this.v.state !== 'limit') this.set({ state: this.attempt ? 'offline' : 'connecting', players: null });
    void this.diagnose();
    this.retry = window.setTimeout(() => this.open(), BACKOFF[Math.min(this.attempt++, BACKOFF.length - 1)]);
  }

  /** a browser cannot see why a WebSocket failed; an ordinary request can */
  private async diagnose() {
    if (!BASE) return;
    const ask = (mode: RequestMode) => fetch(`${BASE.http}/health`, { mode, cache: 'no-store', signal: AbortSignal.timeout(6000) });
    let state: OnlineState = this.limited ? 'limit' : 'offline';
    try {
      const r = await ask('cors');
      if (r.status === 429 || (!r.ok && /SERVICE_LIMIT/.test(await r.text()))) state = 'limit';
    } catch {
      try {
        // the platform's own error page (daily request limit) carries no CORS headers: the address
        // answers, but the game service behind it does not
        await ask('no-cors');
        state = 'limit';
      } catch {
        /* really unreachable */
      }
    }
    if (!this.stopped && !this.ws) this.set({ state, players: null });
    else if (!this.stopped && state === 'limit' && this.v.state !== 'online') this.set({ state });
  }

  private ping = () => {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (performance.now() - this.heard > ONLINE.MENU_PING_MS * 2.5 + 2000 && !document.hidden) {
      ws.close();
      ws.onclose?.(new CloseEvent('close'));
      return;
    }
    ws.send(WS_PING);
  };

  private onMsg(m: MmServerMsg) {
    switch (m.t) {
      case 'status': {
        const first = this.v.state !== 'online';
        clearTimeout(this.openTimer);
        this.attempt = 0;
        this.limited = false;
        this.set({ state: 'online', players: m.online, searching: m.searching, min: m.min, max: m.max });
        // the connection broke during a search: back into the queue
        if (first && this.v.phase === 'searching') this.send({ t: 'find' });
        return;
      }
      case 'match':
        this.set({ phase: 'idle', match: { roomId: m.roomId, ticket: m.ticket } });
        return;
      case 'error': {
        const error = { code: m.code === 'version' ? ('onlineVersion' as const) : m.code, id: ++this.errorId };
        if (FINAL.includes(m.code)) {
          this.stop();
          this.set({ state: 'offline', error });
          return;
        }
        if (m.code === 'serviceLimit') this.limited = true;
        // refused while connecting (not an answer to a command): the status line says it, no dialog
        const quiet = this.v.phase === 'idle' && (m.code === 'serviceLimit' || m.code === 'serverError' || m.code === 'serverFull');
        this.set({ phase: 'idle', ...(quiet ? {} : { error }), ...(m.code === 'serviceLimit' ? { state: 'limit' as const } : {}) });
        return;
      }
      default:
        return;
    }
  }

  private send(m: MmClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  // ------------------------------------------------------------------------ commands

  private begin(phase: OnlineView['phase'], m: MmClientMsg) {
    if (this.v.phase !== 'idle') return;
    if (!this.send(m)) {
      this.set({ error: { code: 'onlineUnreachable', id: ++this.errorId } });
      return;
    }
    this.set({ phase, since: performance.now(), error: null, match: null });
  }

  quickPlay() {
    this.begin('searching', { t: 'find' });
  }
  createPrivate(settings: RoomSettings) {
    this.begin('creating', { t: 'create', settings });
  }
  joinPrivate(code: string) {
    this.begin('joining', { t: 'join', code });
  }
  cancel() {
    this.send({ t: 'cancel' });
    this.set({ phase: 'idle' });
  }

  takeMatch() {
    const m = this.v.match;
    if (m) this.set({ match: null });
    return m;
  }

  dismissError() {
    if (this.v.error) this.set({ error: null });
  }

  /** try again now instead of waiting for the next automatic attempt */
  reconnect() {
    if (this.ws) return;
    clearInterval(this.pingTimer);
    this.start();
    this.set({});
  }
}

export const online = new OnlineService();

export const useOnline = (): OnlineView => useSyncExternalStore(online.subscribe, () => online.view, () => online.view);
