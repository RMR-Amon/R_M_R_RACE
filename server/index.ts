/**
 * RMR_race LAN host server.
 *
 *   npm run server        (or: npm start — builds the game first)
 *
 * One process per computer that hosts (or wants to find) LAN games. It
 *  - serves the built game over HTTP, so phones / other PCs can simply open http://<ip>:47800;
 *  - runs the WebSocket endpoint for the room list (/agent) and for players (/play);
 *  - announces its rooms on the LAN and listens for other hosts' rooms (UDP 47801);
 *  - is the authority for the lobbies and matches of the rooms it hosts.
 *
 * Everything is driven by ONE timer (the 20 Hz tick); sockets are event-driven and never block it.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { isLanAddress, lanInterfaces, plainIp } from './netInfo';
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
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const port = opts.port ?? NET.HTTP_PORT;
  const distDir = path.resolve(opts.distDir ?? path.join(here, '..', 'dist'));
  const sid = crypto.randomBytes(4).toString('hex');
  const manager = new RoomManager(sid, port);
  const discovery = new Discovery(sid, port, () => manager.listings(), opts.udpPort ?? NET.DISCOVERY_PORT);
  const peers = new Set<Peer>();
  const watchers = new Set<Peer>();
  const bindings = new WeakMap<Peer, { room: Room; player: Player }>();
  const hostInfo = (): HostInfo => ({
    sid,
    addresses: lanInterfaces().map((i) => i.address),
    port,
    discovery: !discovery.error,
    version: GAME_VERSION,
  });

  // ------------------------------------------------------------------------------------------ HTTP
  const server = http.createServer((req, res) => {
    if (!isLanAddress(req.socket.remoteAddress)) {
      res.writeHead(403).end();
      return;
    }
    const url = req.url ?? '/';
    if (url.startsWith('/api/')) {
      // used by "connect by IP": lets a browser on another device ask this host for its rooms
      res.setHeader('access-control-allow-origin', '*');
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
    if (!isLanAddress(ip) || (pathname !== '/agent' && pathname !== '/play') || peers.size >= MAX_CONNECTIONS || (perIp.get(ip) ?? 0) >= MAX_PER_IP) {
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
    if (msg.game !== GAME_ID || msg.proto !== PROTOCOL_VERSION) return fail(peer, 'version');
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
  schedule();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host ?? '0.0.0.0', () => {
      server.off('error', reject);
      discovery.start();
      resolve({
        port,
        sid,
        manager,
        discovery,
        close: () =>
          new Promise<void>((done) => {
            running = false;
            if (timer) clearTimeout(timer);
            manager.closeAll('shutdown');
            discovery.stop();
            for (const p of peers) p.ws.terminate();
            wss.close();
            server.close(() => done());
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------------------------- CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.RMR_PORT) || NET.HTTP_PORT;
  startServer({ port, udpPort: Number(process.env.RMR_UDP) || NET.DISCOVERY_PORT })
    .then((srv) => {
      const addrs = lanInterfaces();
      log.info(`RMR_race LAN host v${GAME_VERSION} (protocol ${PROTOCOL_VERSION}) — server id ${srv.sid}`);
      log.info(`On this computer:   http://localhost:${port}`);
      for (const a of addrs) log.info(`Other devices (${a.name}): http://${a.address}:${port}`);
      if (!addrs.length) log.warn('No LAN interface found — connect to a Wi-Fi / hotspot / Ethernet network.');
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        log.info('shutting down: closing rooms…');
        srv.close().then(() => process.exit(0));
        setTimeout(() => process.exit(0), 1500).unref();
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') log.error(`Port ${port} is already in use — is the RMR_race server already running? (set RMR_PORT to use another port)`);
      else log.error(e);
      process.exit(1);
    });
}
