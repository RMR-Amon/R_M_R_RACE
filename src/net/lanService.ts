/**
 * Talks to the LAN service (the RMR_race host server) for the room list.
 *
 * Browsers cannot send or receive UDP, so the UDP discovery runs inside the host server process;
 * the page watches its room list over a WebSocket ("agent" socket). On a PC that runs the server
 * this is localhost; a phone that opened the game from a host PC uses that host's server.
 */
import { useSyncExternalStore } from 'react';
import { GAME_ID, NET, PROTOCOL_VERSION } from './config';
import type { AgentMsg, DiscoveredRoom, HostInfo, RoomListing } from './protocol';

/** host:port of the LAN service this page talks to */
export function serviceHost(): string {
  const q = new URLSearchParams(location.search).get('lan');
  if (q && /^[\w.-]+(:\d+)?$/.test(q)) return q.includes(':') ? q : `${q}:${NET.HTTP_PORT}`;
  // opened from the host server itself (http://<ip>:47800): same origin
  if (location.port === String(NET.HTTP_PORT)) return location.host;
  // dev server / file: the service runs on the same machine
  const h = location.hostname || 'localhost';
  return `${h.includes(':') ? `[${h}]` : h}:${NET.HTTP_PORT}`;
}

const wsBase = (hostPort: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${hostPort}`;

/** WebSocket URL to join a room */
export function roomUrl(room: RoomListing): string {
  return room.address ? `${wsBase(`${room.address}:${room.port}`)}/play` : `${wsBase(serviceHost())}/play`;
}

/** WebSocket URL to create a room on the local LAN service */
export const createUrl = () => `${wsBase(serviceHost())}/play`;

export type ServiceState = 'connecting' | 'online' | 'offline';

export interface WatchView {
  state: ServiceState;
  rooms: DiscoveredRoom[];
  self: HostInfo | null;
  /** last time the list was refreshed (performance.now) */
  at: number;
}

class RoomWatcher {
  private v: WatchView = { state: 'connecting', rooms: [], self: null, at: 0 };
  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private users = 0;
  private retry = 0;

  get view() {
    return this.v;
  }

  subscribe = (f: () => void) => {
    this.listeners.add(f);
    // the socket only lives while some screen shows the list
    if (++this.users === 1) this.open();
    return () => {
      this.listeners.delete(f);
      if (--this.users === 0) this.stop();
    };
  };

  private set(p: Partial<WatchView>) {
    this.v = { ...this.v, ...p };
    this.listeners.forEach((f) => f());
  }

  private open() {
    clearTimeout(this.retry);
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${wsBase(serviceHost())}/agent`);
    } catch {
      this.set({ state: 'offline' });
      return;
    }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'watch' }));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let m: AgentMsg;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === 'rooms' && Array.isArray(m.rooms)) this.set({ state: 'online', rooms: m.rooms, self: m.self, at: performance.now() });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.set({ state: 'offline', rooms: [] });
      // the service may be started later: keep trying while the list is on screen
      if (this.users > 0) this.retry = window.setTimeout(() => this.open(), 3000);
    };
  }

  private stop() {
    clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.v = { ...this.v, state: 'connecting' };
  }

  /** asks every host on the LAN to announce right now */
  refresh() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'refresh' }));
    else {
      this.set({ state: 'connecting' });
      this.open();
    }
  }
}

export const rooms = new RoomWatcher();

export const useRooms = (): WatchView => useSyncExternalStore(rooms.subscribe, () => rooms.view, () => rooms.view);

/**
 * "Connect by IP": asks one host directly over HTTP for its rooms. Works when UDP broadcasts are
 * blocked (some routers / firewalls) but the devices can still reach each other over TCP.
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
    return data.rooms.map((r) => ({ ...r, address, port: Number(port), compatible: data.proto === PROTOCOL_VERSION }));
  } finally {
    clearTimeout(timer);
  }
}
