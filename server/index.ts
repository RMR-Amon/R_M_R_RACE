/**
 * RMR_race LAN host server (started by server/launch.ts: npm start, or the optional desktop app).
 *
 * One process per computer that hosts (or wants to find) LAN games. It
 *  - serves the built game over HTTP: players only open http://<ip>:47800 in a browser;
 *  - runs the WebSocket endpoint for the room list (/agent) and for players (/play);
 *  - announces its rooms on the LAN and listens for other hosts' rooms (UDP 47801);
 *  - is the authority for the lobbies and matches of the rooms it hosts.
 *
 * Everything is driven by ONE timer (the 20 Hz tick); sockets are event-driven and never block it.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { GAME_ID, GAME_VERSION, NET, PROTOCOL_VERSION } from '../src/net/config';
import {
  cleanProfile,
  cleanSettings,
  isObj,
  isToken,
  type AgentMsg,
  type ClientMsg,
  type ErrorCode,
  type HostInfo,
} from '../src/net/protocol';
import { CAR_IDS, DEFAULT_LOOK, RACE_MAP_IDS } from './gameData';
import { Discovery } from './discovery';
import { log } from './log';
import { isLanAddress, isLanHostHeader, isLanOrigin, plainIp, rankedInterfaces } from './netInfo';
import { Peer } from './peer';
import type { Player, Room } from './room';
import { RoomManager } from './roomManager';
import { serveStatic } from './static';

const MAX_CONNECTIONS = 96;
const MAX_PER_IP = 12;
const MAX_ROOMS_PER_IP = 3;

export interface ServerOptions {
  port?: number;
  udpPort?: number;
  /** folder with the production build */
  distDir?: string;
  /** bind address (default: all interfaces) */
  host?: string;
}

export interface RunningServer {
  port: number;
  sid: string;
  manager: RoomManager;
  discovery: Discovery;
  /** players currently connected */
  players(): number;
  close(): Promise<void>;
}

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const port = opts.port ?? NET.HTTP_PORT;
  // the desktop app passes its own folder; the CLI uses ../dist next to this file
  const distDir = path.resolve(opts.distDir ?? path.join(process.cwd(), 'dist'));
  const sid = crypto.randomBytes(4).toString('hex');
  const manager = new RoomManager(sid, port);
  const discovery = new Discovery(sid, port, () => manager.listings(), opts.udpPort ?? NET.DISCOVERY_PORT);
  const peers = new Set<Peer>();
  const watchers = new Set<Peer>();
  const bindings = new WeakMap<Peer, { room: Room; player: Player }>();
  const hostInfo = (): HostInfo => ({
    sid,
    addresses: rankedInterfaces().map((i) => i.address),
    interfaces: rankedInterfaces().map((i) => ({ name: i.name, address: i.address, virtual: !!i.virtual })),
    port,
    players: manager.players(),
    roomCount: manager.rooms.size,
    discovery: discovery.active,
    version: GAME_VERSION,
  });

  // ------------------------------------------------------------------------------------------ HTTP
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (!isLanAddress(req.socket.remoteAddress) || !isLanHostHeader(req.headers.host) || !isLanOrigin(origin)) {
      res.writeHead(403).end();
      return;
    }
    const url = req.url ?? '/';
    if (url.startsWith('/api/')) {
      // pages served by OTHER hosts of this network ask for rooms / reachability; websites may not
      if (origin) res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      if (url.startsWith('/api/rooms')) res.end(JSON.stringify({ game: GAME_ID, proto: PROTOCOL_VERSION, rooms: manager.listings(), self: hostInfo() }));
      else if (url.startsWith('/api/info')) res.end(JSON.stringify({ game: GAME_ID, proto: PROTOCOL_VERSION, ...hostInfo() }));
      else res.writeHead(404).end('{}');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    serveStatic(distDir, req, res);
  });

  // ------------------------------------------------------------------------------------------ WebSocket
  const wss = new WebSocketServer({ noServer: true, maxPayload: NET.MAX_MESSAGE_BYTES, perMessageDeflate: false });
  const perIp = new Map<string, number>();

  server.on('upgrade', (req, socket, head) => {
    const ip = plainIp(req.socket.remoteAddress);
    const pathname = (req.url ?? '').split('?')[0];
    const lan = isLanAddress(ip) && isLanHostHeader(req.headers.host) && isLanOrigin(req.headers.origin);
    if (!lan || (pathname !== '/agent' && pathname !== '/play') || peers.size >= MAX_CONNECTIONS || (perIp.get(ip) ?? 0) >= MAX_PER_IP) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip, pathname === '/agent'));
  });

  function onConnection(ws: WebSocket, ip: string, agent: boolean) {
    const peer = new Peer(ws, ip);
    peers.add(peer);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    peer.role = agent ? 'agent' : 'pending';
    const helloTimer = agent
      ? null
      : setTimeout(() => {
          if (peer.role === 'pending') peer.close(4001, 'no hello');
        }, NET.HELLO_TIMEOUT_MS);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (peer.closed) return;
      const now = performance.now();
      peer.lastHeard = now;
      if (!peer.allow(isBinary, now)) return;
      if (isBinary) {
        const b = bindings.get(peer);
        if (!b || b.player.peer !== peer) return;
        const buf = data as Buffer;
        b.room.onBinary(b.player, new DataView(buf.buffer, buf.byteOffset, buf.byteLength), now);
        return;
      }
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!isObj(msg) || typeof msg.t !== 'string') return;
      if (msg.t === 'ping') {
        if (typeof msg.c === 'number' && Number.isFinite(msg.c)) peer.send({ t: 'pong', c: msg.c, s: now });
        return;
      }
      if (peer.role === 'agent') return onAgent(peer, msg.t);
      if (peer.role === 'pending') {
        if (helloTimer) clearTimeout(helloTimer);
        return onHello(peer, msg, now);
      }
      const b = bindings.get(peer);
      if (!b || b.player.peer !== peer) return;
      b.room.onMessage(b.player, msg as ClientMsg, now);
    });

    ws.on('close', () => {
      if (helloTimer) clearTimeout(helloTimer);
      peer.closed = true;
      peers.delete(peer);
      watchers.delete(peer);
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
      const b = bindings.get(peer);
      if (b && b.player.peer === peer) b.room.onDisconnect(b.player, performance.now());
    });
    ws.on('error', (e) => log.debug(`socket error ${ip}: ${e.message}`));
  }

  function fail(peer: Peer, code: ErrorCode) {
    peer.send({ t: 'error', code });
    peer.close(4002, code);
  }

  function onHello(peer: Peer, msg: Record<string, unknown>, now: number) {
    if (msg.t !== 'hello') return fail(peer, 'badMessage');
    // another game version may have other cars / tracks / physics: such a race cannot be fair
    if (msg.game !== GAME_ID || msg.proto !== PROTOCOL_VERSION || msg.ver !== GAME_VERSION) return fail(peer, 'version');
    if (msg.join === 'create') {
      const settings = cleanSettings(msg.settings, RACE_MAP_IDS);
      const profile = cleanProfile(msg.profile, CAR_IDS, DEFAULT_LOOK);
      if (!settings || !profile) return fail(peer, 'badMessage');
      const mine = [...manager.rooms.values()].filter((r) => [...r.players.values()].some((p) => p.peer?.ip === peer.ip && p.id === r.hostId));
      if (mine.length >= MAX_ROOMS_PER_IP) return fail(peer, 'serverFull');
      const made = manager.create(peer, settings, profile, now);
      if (!made) return fail(peer, 'serverFull');
      bindings.set(peer, made);
      log.info(`room ${made.room.id} "${settings.name}" created by ${profile.name} (${peer.ip})${made.room.code ? ' [private]' : ''}`);
      return;
    }
    if (typeof msg.roomId !== 'string') return fail(peer, 'badMessage');
    const room = manager.get(msg.roomId);
    if (!room) return fail(peer, msg.join === 'resume' ? 'sessionExpired' : 'roomNotFound');
    if (msg.join === 'join') {
      const profile = cleanProfile(msg.profile, CAR_IDS, DEFAULT_LOOK);
      if (!profile) return fail(peer, 'badMessage');
      const err = room.joinError(peer, typeof msg.code === 'string' ? msg.code : undefined, now);
      if (err) return fail(peer, err);
      bindings.set(peer, { room, player: room.addPlayer(peer, profile, now) });
      return;
    }
    if (msg.join === 'resume') {
      if (!isToken(msg.token, 32)) return fail(peer, 'badMessage');
      const player = room.resume(peer, msg.token, now);
      if (!player) return fail(peer, 'sessionExpired');
      bindings.set(peer, { room, player });
      return;
    }
    fail(peer, 'badMessage');
  }

  // ------------------------------------------------------------------------------------------ room list
  let lastListJson = '';
  let lastListPush = 0;
  const roomListMsg = (): AgentMsg => ({
    t: 'rooms',
    rooms: [...manager.listings().map((l) => ({ ...l, compatible: true })), ...discovery.rooms()],
    self: hostInfo(),
  });

  function onAgent(peer: Peer, t: string) {
    if (t === 'watch') {
      watchers.add(peer);
      peer.sendRaw(JSON.stringify(roomListMsg()));
    } else if (t === 'refresh') {
      discovery.query();
      // answers arrive within a few milliseconds; the next list push picks them up
      lastListPush = 0;
      lastListJson = '';
    }
  }

  function pushRoomLists(now: number) {
    if (!watchers.size) return;
    const json = JSON.stringify(roomListMsg());
    // unchanged lists are re-sent only every 3 s
    if (json === lastListJson && now - lastListPush < 3000) return;
    if (now - lastListPush < NET.ROOM_LIST_PUSH_MS && json === lastListJson) return;
    lastListJson = json;
    lastListPush = now;
    for (const w of watchers) w.sendRaw(json);
  }

  // ------------------------------------------------------------------------------------------ main tick
  let lastHeartbeat = 0;
  let lastList = 0;
  // drift-corrected 20 Hz loop: plain setInterval(50) runs at ~16 Hz on Windows (15.6 ms timer steps)
  const period = 1000 / NET.SNAPSHOT_HZ;
  let nextAt = performance.now() + period;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = true;
  const schedule = () => {
    if (!running) return;
    const now = performance.now();
    // fell far behind (machine asleep / debugger): do not try to catch up with a burst
    if (now - nextAt > period * 4) nextAt = now;
    timer = setTimeout(() => {
      nextAt += period;
      tick();
      schedule();
    }, Math.max(0, nextAt - now));
  };
  const tick = () => {
    const now = performance.now();
    manager.tick(now);
    discovery.tick(now);
    if (now - lastHeartbeat >= 2000) {
      lastHeartbeat = now;
      for (const p of peers) p.heartbeat(now);
    }
    if (now - lastList >= 250) {
      lastList = now;
      pushRoomLists(now);
    }
  };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host ?? '0.0.0.0', async () => {
      server.off('error', reject);
      server.on('error', (e) => log.error('http server:', e.message));
      nextAt = performance.now() + period;
      schedule();
      // report success only when the discovery socket is really up (or has really failed)
      await discovery.start();
      resolve({
        port,
        sid,
        manager,
        discovery,
        players: () => manager.players(),
        close: async () => {
          running = false;
          if (timer) clearTimeout(timer);
          manager.closeAll('shutdown');
          discovery.stop();
          // let the "server was shut down" message reach the players before the sockets go away
          for (const p of peers) p.close(1001, 'shutdown');
          const until = performance.now() + 500;
          while (peers.size && performance.now() < until) await new Promise((r) => setTimeout(r, 20));
          for (const p of peers) p.ws.terminate();
          wss.close();
          await new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          });
        },
      });
    });
  });
}
