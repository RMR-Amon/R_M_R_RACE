/**
 * Room list + host reachability.
 *
 * Browsers cannot send or receive UDP, so the UDP discovery runs inside the LAN host server
 * (in the desktop app: in Electron's main process). The page watches that server's room list over
 * a WebSocket ("agent" socket) and checks every listed host over HTTP (availability + ping).
 *
 * Where the LAN server is depends on how the game was opened:
 *  - desktop app:                     the app's own server on 127.0.0.1:<port> (from the IPC bridge);
 *  - page served by a host server:    that server (phones / PCs that opened http://<host-ip>:47800);
 *  - local dev server (http, LAN ip): the server on the same machine, port 47800;
 *  - anything else (e.g. the HTTPS site on Netlify): LAN is NOT available — the browser blocks
 *    insecure WebSockets to local addresses from an HTTPS page, and it cannot do UDP at all.
 */
import { useSyncExternalStore } from 'react';
import { GAME_ID, GAME_VERSION, NET, PROTOCOL_VERSION } from './config';
import { desktopApi, desktopLan, subscribeDesktop } from './desktop';
import type { AgentMsg, DiscoveredRoom, HostInfo, RoomListing } from './protocol';

export type LanMode = 'desktop' | 'served' | 'dev' | 'unsupported';

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[::1\])/;

export function lanMode(): LanMode {
  if (desktopApi()) return 'desktop';
  if (typeof location === 'undefined') return 'unsupported';
  if (location.protocol === 'http:' && location.port === String(NET.HTTP_PORT)) return 'served';
  if (location.protocol === 'http:' && PRIVATE_HOST.test(location.hostname)) return 'dev';
  return 'unsupported';
}

/** host:port of the LAN server this page talks to, or null when there is none */
export function serviceHost(): string | null {
  const mode = lanMode();
  if (mode === 'desktop') {
    const d = desktopLan();
    return d?.running ? `127.0.0.1:${d.port}` : null;
  }
  if (mode === 'served') return location.host;
  if (mode === 'dev') {
    const q = new URLSearchParams(location.search).get('lan');
    if (q && /^[\w.-]+(:\d+)?$/.test(q)) return q.includes(':') ? q : `${q}:${NET.HTTP_PORT}`;
    return `${location.hostname}:${NET.HTTP_PORT}`;
  }
  return null;
}

const hostOf = (room: RoomListing) => (room.address ? `${room.address}:${room.port}` : serviceHost());

/** WebSocket URL to join a room */
export function roomUrl(room: RoomListing): string {
  return `ws://${hostOf(room)}/play`;
}

/** WebSocket URL to create a room on this computer's LAN server */
export const createUrl = () => `ws://${serviceHost()}/play`;

export type ServiceState = 'connecting' | 'online' | 'offline' | 'stopped' | 'unsupported';

export interface HostCheck {
  ok: boolean;
  /** HTTP round trip to the host (ms), -1 when unreachable */
  ping: number;
  at: number;
}

export interface WatchView {
  state: ServiceState;
  rooms: DiscoveredRoom[];
  self: HostInfo | null;
  /** reachability per host ("ip:port", or "" for this computer) */
  checks: Record<string, HostCheck>;
  at: number;
}

const checkKey = (room: RoomListing) => (room.address ? `${room.address}:${room.port}` : '');

class RoomWatcher {
  private v: WatchView = { state: 'connecting', rooms: [], self: null, checks: {}, at: 0 };
  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private wsHost: string | null = null;
  private users = 0;
  private retry = 0;
  private probeTimer = 0;
  private unsubDesktop: (() => void) | null = null;

  get view() {
    return this.v;
  }

  subscribe = (f: () => void) => {
    this.listeners.add(f);
    // the socket only lives while some screen shows the list
    if (++this.users === 1) this.start();
    return () => {
      this.listeners.delete(f);
      if (--this.users === 0) this.stop();
    };
  };

  private set(p: Partial<WatchView>) {
    this.v = { ...this.v, ...p };
    this.listeners.forEach((f) => f());
  }

  private start() {
    // desktop: follow the server being started / stopped from the menu
    if (lanMode() === 'desktop') this.unsubDesktop = subscribeDesktop(() => this.sync());
    this.sync();
    this.probeTimer = window.setInterval(() => void this.probeAll(), 3000);
  }

  /** (re)connects to the right server for the current mode */
  private sync() {
    const host = serviceHost();
    if (host === this.wsHost && this.ws) return;
    this.close();
    if (!host) {
      const mode = lanMode();
      this.set({ state: mode === 'unsupported' ? 'unsupported' : mode === 'desktop' && desktopLan() ? 'stopped' : 'connecting', rooms: [], self: null });
      return;
    }
    this.open(host);
  }

  private open(host: string) {
    clearTimeout(this.retry);
    this.wsHost = host;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${host}/agent`);
    } catch {
      this.set({ state: 'offline' });
      return;
    }
    this.ws = ws;
    this.set({ state: 'connecting' });
    ws.onopen = () => ws.send(JSON.stringify({ t: 'watch' }));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let m: AgentMsg;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t !== 'rooms' || !Array.isArray(m.rooms)) return;
      const first = this.v.state !== 'online';
      this.set({ state: 'online', rooms: m.rooms, self: m.self, at: performance.now() });
      if (first) void this.probeAll();
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.wsHost = null;
      this.set({ state: 'offline', rooms: [] });
      // the server may be started later: keep trying while the list is on screen
      if (this.users > 0) this.retry = window.setTimeout(() => this.sync(), 2500);
    };
  }

  private close() {
    clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = null;
    this.wsHost = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }

  private stop() {
    this.close();
    clearInterval(this.probeTimer);
    this.unsubDesktop?.();
    this.unsubDesktop = null;
    this.v = { ...this.v, state: 'connecting' };
  }

  /** "client checks that the host is reachable": HTTP round trip to every listed host */
  private async probeAll() {
    const hosts = new Map<string, string>();
    for (const r of this.v.rooms) {
      const h = hostOf(r);
      if (h) hosts.set(checkKey(r), h);
    }
    if (!hosts.size) return;
    const entries = await Promise.all(
      [...hosts].map(async ([key, h]) => {
        const res = await pingHost(h);
        return [key, res] as const;
      }),
    );
    const checks = { ...this.v.checks };
    for (const [k, c] of entries) checks[k] = c;
    this.set({ checks });
  }

  check(room: RoomListing): HostCheck | undefined {
    return this.v.checks[checkKey(room)];
  }

  /** asks every host on the LAN to announce right now */
  refresh() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'refresh' }));
      void this.probeAll();
    } else this.sync();
  }
}

/** HTTP round trip to a host server (also proves it is reachable over TCP, i.e. not firewalled) */
export async function pingHost(hostPort: string, timeoutMs = 2000): Promise<HostCheck> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(`http://${hostPort}/api/info`, { signal: ctl.signal, cache: 'no-store' });
    const data = (await res.json()) as { game?: string };
    const ok = data.game === GAME_ID;
    return { ok, ping: ok ? Math.round(performance.now() - t0) : -1, at: performance.now() };
  } catch {
    return { ok: false, ping: -1, at: performance.now() };
  } finally {
    clearTimeout(timer);
  }
}

export const rooms = new RoomWatcher();

export const useRooms = (): WatchView => useSyncExternalStore(rooms.subscribe, () => rooms.view, () => rooms.view);

/**
 * Manual connection: asks one host directly over HTTP for its rooms. Works when UDP broadcasts are
 * blocked (router / firewall) but the computers can still reach each other over TCP.
 */
export async function probeHost(input: string): Promise<DiscoveredRoom[]> {
  const target = input.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[\w.-]+(:\d{1,5})?$/.test(target)) throw new Error('bad address');
  const hostPort = target.includes(':') ? target : `${target}:${NET.HTTP_PORT}`;
  const [address, port] = hostPort.split(':');
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch(`http://${hostPort}/api/rooms`, { signal: ctl.signal, cache: 'no-store' });
    const data = (await res.json()) as { game?: string; proto?: number; rooms?: RoomListing[] };
    if (data.game !== GAME_ID || !Array.isArray(data.rooms)) throw new Error('not an RMR_race host');
    return data.rooms.map((r) => ({ ...r, address, port: Number(port), compatible: data.proto === PROTOCOL_VERSION && r.version === GAME_VERSION }));
  } finally {
    clearTimeout(timer);
  }
}
