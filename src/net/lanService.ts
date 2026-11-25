/**
 * Room list + host reachability.
 *
 * Browsers cannot send or receive UDP, so the UDP discovery runs inside the LAN host server
 * (in the desktop app: in Electron's main process). The page watches that server's room list over
 * a WebSocket ("agent" socket) and checks every listed host over HTTP (availability + ping).
 *
 * Where the LAN server is depends on how the game was opened:
 *  - 'served'  the normal way: the page came from a LAN host server (http://<host-ip>:<port>) — the
 *              server marks its page, so this works on every port it may have fallen back to;
 *  - 'dev'     local dev server (http, LAN ip): the server on the same machine, port 47800;
 *  - 'desktop' the optional desktop app: its own server on 127.0.0.1:<port> (from the IPC bridge);
 *  - 'unsupported' anything else (e.g. the HTTPS site on Netlify): the browser blocks insecure
 *              WebSockets to local addresses from an HTTPS page, so the player is asked to open the
 *              organizer's address instead (a plain navigation, which is allowed).
 */
import { useSyncExternalStore } from 'react';
import { GAME_ID, GAME_VERSION, NET, PROTOCOL_VERSION } from './config';
import { desktopApi, desktopLan, subscribeDesktop } from './desktop';
import type { AgentMsg, DiscoveredRoom, HostInfo, RoomListing } from './protocol';

export type LanMode = 'desktop' | 'served' | 'dev' | 'unsupported';

const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[::1\]$)/;
const LOOPBACK = /^(localhost$|127\.|\[::1\]$)/;

/** the page was delivered by a LAN host server (see server/static.ts) */
const servedByHost = () => typeof document !== 'undefined' && !!document.querySelector('meta[name="rmr-lan-host"]');

/** a player's device: the page came from another computer on the network */
export const isGuestPage = () => lanMode() === 'served' && !LOOPBACK.test(location.hostname);

/**
 * "192.168.1.100", "192.168.1.100:47800", "http://192.168.1.100:47800/" → the address to open.
 * Only private-network addresses and local names are accepted; null otherwise.
 */
export function lanUrl(input: string): string | null {
  const m = /^(?:http:\/\/)?([a-z0-9.-]+)(?::(\d{1,5}))?\/?$/i.exec(input.trim());
  if (!m) return null;
  const host = m[1].toLowerCase();
  const port = m[2] ? Number(m[2]) : NET.HTTP_PORT;
  if (port < 1 || port > 65535) return null;
  if (/^[\d.]+$/.test(host)) {
    const p = host.split('.').map(Number);
    if (p.length !== 4 || host.split('.').some((x) => !x || Number(x) > 255) || !PRIVATE_HOST.test(host)) return null;
  } else if (!/^[a-z][a-z0-9-]*(\.(local|lan|home|internal))?$/.test(host)) return null;
  return `http://${host}:${port}/`;
}

/** address the other players should open for this server (real LAN IPv4, never localhost) */
export function shareAddress(self: HostInfo | null): string | null {
  const best = self?.interfaces.find((i) => !i.virtual) ?? self?.interfaces[0];
  return self && best ? `${best.address}:${self.port}` : null;
}

export function lanMode(): LanMode {
  if (desktopApi()) return 'desktop';
  if (typeof location === 'undefined') return 'unsupported';
  if (location.protocol === 'http:' && servedByHost()) return 'served';
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
  private openTimer = 0;
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
    const lost = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.openTimer);
      this.ws = null;
      this.wsHost = null;
      this.set({ state: 'offline', rooms: [], self: null, checks: {} });
      // the server may be (re)started later: keep trying while the list is on screen
      if (this.users > 0) this.retry = window.setTimeout(() => this.sync(), 2500);
    };
    // silence = a dead connection: the server sends the list at least every 3 s
    const alive = () => {
      clearTimeout(this.openTimer);
      this.openTimer = window.setTimeout(() => {
        ws.onclose = null;
        ws.close();
        lost();
      }, NET.DEAD_AFTER_MS + 2000);
    };
    alive();
    ws.onmessage = (ev) => {
      alive();
      if (typeof ev.data !== 'string') return;
      let m: AgentMsg;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t !== 'rooms' || !Array.isArray(m.rooms)) return;
      const first = this.v.state !== 'online';
      // an open tab may be older than a restarted server
      const list = m.rooms.map((r) => ({ ...r, compatible: r.compatible && r.version === GAME_VERSION }));
      this.set({ state: 'online', rooms: list, self: m.self, at: performance.now() });
      if (first) void this.probeAll();
    };
    ws.onclose = lost;
  }

  private close() {
    clearTimeout(this.retry);
    clearTimeout(this.openTimer);
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
    this.v = { ...this.v, state: 'connecting', checks: {} };
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
    // only hosts that are still listed (no stale "unreachable" marks, no growing table)
    if (this.users > 0) this.set({ checks: Object.fromEntries(entries) });
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
