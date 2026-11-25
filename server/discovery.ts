/**
 * LAN room discovery over UDP broadcast.
 *
 *  - Every host with at least one room broadcasts an announce packet once per second (heartbeat),
 *    both to 255.255.255.255 and to the directed broadcast address of every LAN interface
 *    (some systems with several adapters only route the directed form).
 *  - "Refresh" sends a query; hosts answer it immediately with a unicast announce.
 *  - Rooms that were not heard from for ROOM_TIMEOUT_MS disappear from the list.
 *
 * Broadcasts do not cross routers, so only rooms of the same network segment are ever seen.
 * A network that blocks client-to-client traffic (AP / client isolation, guest Wi-Fi) or a
 * firewall that drops UDP 47801 will hide rooms even on "the same Wi-Fi" — see LAN_MULTIPLAYER.md.
 */
import dgram from 'node:dgram';
import { GAME_ID, GAME_VERSION, NET, PROTOCOL_VERSION } from '../src/net/config';
import { cleanName, isInt, isObj, type DiscoveredRoom, type RoomListing } from '../src/net/protocol';
import { RACE_MAP_IDS } from './gameData';
import { lanInterfaces, isLanAddress, plainIp, subnetRank, type LanInterface } from './netInfo';
import { log } from './log';

const MAX_PACKET = 2048;
const MAX_ROOMS_PER_PACKET = 8;
const THEMES = ['city', 'desert', 'ocean', 'pixel', 'candy'];

interface Seen {
  listing: RoomListing;
  seen: number;
  /** protocol version of the announcing host (rooms of other versions are shown as incompatible) */
  proto: number;
}

type Packet =
  | { g: string; p: number; k: 'ann'; sid: string; port: number; v: string; rooms: Omit<RoomListing, 'sid' | 'address' | 'port' | 'version'>[] }
  | { g: string; p: number; k: 'q'; sid: string };

export class Discovery {
  private sock: dgram.Socket | null = null;
  private remote = new Map<string, Seen>();
  private ifaces: LanInterface[] = [];
  private ifaceT = 0;
  private lastAnnounce = 0;
  private lastQueryAnswer = 0;
  /** set when the UDP port could not be opened (rooms can then only be joined by IP) */
  error: string | null = null;
  /** the UDP socket is bound and can send broadcasts */
  active = false;
  /** own broadcasts that came back (proves that sending and receiving broadcasts works here) */
  selfHeard = 0;
  private stopped = false;
  private retryAt = 0;
  private lastQuery = 0;

  constructor(
    private readonly sid: string,
    private readonly port: number,
    private readonly localRooms: () => RoomListing[],
    private readonly udpPort: number = NET.DISCOVERY_PORT,
  ) {}

  /** resolves once the socket is bound or has failed (see `active` / `error`) */
  start(): Promise<void> {
    return new Promise((done) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.sock = sock;
      sock.on('error', (err) => {
        this.error = err.message;
        this.active = false;
        log.warn(`LAN discovery failed (UDP ${this.udpPort}): ${err.message} — retrying`);
        try {
          sock.close();
        } catch {
          /* already closed */
        }
        if (this.sock === sock) this.sock = null;
        this.retryAt = performance.now() + 10000;
        done();
      });
      sock.on('message', (buf, rinfo) => this.onPacket(buf, rinfo));
      sock.bind(this.udpPort, () => {
        try {
          sock.setBroadcast(true);
          this.active = true;
          this.error = null;
          log.debug(`LAN discovery on UDP ${this.udpPort}`);
          this.query(true);
        } catch (e) {
          this.error = String((e as Error).message ?? e);
        }
        done();
      });
    });
  }

  stop() {
    this.stopped = true;
    this.active = false;
    this.sock?.close();
    this.sock = null;
  }

  /** sends a broadcast and waits for our own copy of it */
  async verify(ms = 1200): Promise<boolean> {
    const before = this.selfHeard;
    const end = performance.now() + ms;
    while (this.active && performance.now() < end) {
      this.query(true);
      await new Promise((r) => setTimeout(r, 150));
      if (this.selfHeard > before) return true;
    }
    return false;
  }

  /** called by the server's main tick */
  tick(now: number) {
    // the port was taken / the adapter vanished: try again now and then
    if (!this.sock && !this.stopped && this.retryAt && now >= this.retryAt) {
      this.retryAt = now + 10000;
      void this.start();
    }
    if (now - this.ifaceT > 10000 || !this.ifaces.length) {
      this.ifaces = lanInterfaces();
      this.ifaceT = now;
    }
    if (now - this.lastAnnounce >= NET.ANNOUNCE_MS) {
      this.lastAnnounce = now;
      if (this.localRooms().length) this.broadcast(this.announcePacket());
    }
    for (const [k, r] of this.remote) if (now - r.seen > NET.ROOM_TIMEOUT_MS) this.remote.delete(k);
  }

  /** ask every host on the LAN to announce right now (players can trigger this: at most twice a second) */
  query(force = false) {
    const now = performance.now();
    if (!force && now - this.lastQuery < 500) return;
    this.lastQuery = now;
    if (!this.ifaces.length) this.ifaces = lanInterfaces();
    this.broadcast(Buffer.from(JSON.stringify({ g: GAME_ID, p: PROTOCOL_VERSION, k: 'q', sid: this.sid } satisfies Packet)));
  }

  /** rooms announced by other hosts that are still alive */
  rooms(now = performance.now()): DiscoveredRoom[] {
    const out: DiscoveredRoom[] = [];
    for (const r of this.remote.values()) {
      if (now - r.seen > NET.ROOM_TIMEOUT_MS) continue;
      out.push({ ...r.listing, compatible: r.proto === PROTOCOL_VERSION && r.listing.version === GAME_VERSION });
    }
    return out;
  }

  addresses() {
    return this.ifaces.map((i) => i.address);
  }

  private announcePacket(): Buffer {
    const rooms = this.localRooms()
      .slice(0, MAX_ROOMS_PER_PACKET)
      .map(({ sid: _s, address: _a, port: _p, version: _v, ...rest }) => rest);
    const pkt: Packet = { g: GAME_ID, p: PROTOCOL_VERSION, k: 'ann', sid: this.sid, port: this.port, v: GAME_VERSION, rooms };
    return Buffer.from(JSON.stringify(pkt));
  }

  private broadcast(buf: Buffer) {
    const sock = this.sock;
    if (!sock) return;
    const targets = new Set<string>(['255.255.255.255', ...this.ifaces.map((i) => i.broadcast)]);
    for (const addr of targets) {
      sock.send(buf, this.udpPort, addr, (err) => {
        if (err) log.debug(`broadcast to ${addr} failed: ${err.message}`);
      });
    }
  }

  private onPacket(buf: Buffer, rinfo: dgram.RemoteInfo) {
    if (buf.length > MAX_PACKET || !isLanAddress(rinfo.address)) return;
    let pkt: unknown;
    try {
      pkt = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    if (!isObj(pkt) || pkt.g !== GAME_ID || typeof pkt.sid !== 'string' || pkt.sid.length > 32) return;
    // our own broadcasts loop back: local rooms are listed directly
    if (pkt.sid === this.sid) {
      this.selfHeard++;
      return;
    }
    if (pkt.k === 'q') {
      // answer queries right away (at most 5 times per second)
      const now = performance.now();
      if (now - this.lastQueryAnswer < 200 || !this.localRooms().length || !this.sock) return;
      this.lastQueryAnswer = now;
      this.sock.send(this.announcePacket(), this.udpPort, rinfo.address);
      return;
    }
    if (pkt.k !== 'ann' || !isInt(pkt.port, 1, 65535) || !Array.isArray(pkt.rooms) || !isInt(pkt.p, 0, 1000)) return;
    const now = performance.now();
    const sid = pkt.sid;
    const version = typeof pkt.v === 'string' ? pkt.v.slice(0, 16) : '?';
    const announced = new Set<string>();
    for (const raw of pkt.rooms.slice(0, MAX_ROOMS_PER_PACKET)) {
      const l = cleanListing(raw);
      if (!l) continue;
      const key = sid + '/' + l.roomId;
      announced.add(key);
      // a host with several adapters is heard from several addresses: keep the one on our best network
      let address = plainIp(rinfo.address);
      const known = this.remote.get(key);
      if (known?.listing.address && now - known.seen < NET.ROOM_TIMEOUT_MS && subnetRank(known.listing.address) < subnetRank(address)) {
        address = known.listing.address;
      }
      this.remote.set(key, {
        listing: { ...l, sid, version, address, port: pkt.port },
        seen: now,
        proto: pkt.p,
      });
    }
    // rooms this host no longer announces are gone (closed) — drop them without waiting for the timeout
    for (const key of this.remote.keys()) if (key.startsWith(sid + '/') && !announced.has(key)) this.remote.delete(key);
  }
}

function cleanListing(v: unknown): Omit<RoomListing, 'sid' | 'address' | 'port' | 'version'> | null {
  if (!isObj(v) || typeof v.roomId !== 'string' || !/^[0-9a-f]{8}$/.test(v.roomId)) return null;
  if (!isInt(v.players, 0, NET.MAX_PLAYERS) || !isInt(v.max, NET.MIN_PLAYERS, NET.MAX_PLAYERS)) return null;
  const status = v.status === 'loading' || v.status === 'racing' ? v.status : 'lobby';
  return {
    roomId: v.roomId,
    name: cleanName(v.name, 24, 'Room'),
    hostName: cleanName(v.hostName, 16, '?'),
    players: v.players,
    max: v.max,
    status,
    mode: v.mode === 'battle' ? 'battle' : 'race',
    mapId: typeof v.mapId === 'string' && (RACE_MAP_IDS.includes(v.mapId) || v.mapId === 'arena') ? v.mapId : RACE_MAP_IDS[0],
    theme: THEMES.includes(v.theme as string) ? (v.theme as RoomListing['theme']) : 'city',
    laps: isInt(v.laps, 1, 5) ? v.laps : 3,
    minutes: isInt(v.minutes, 1, 10) ? v.minutes : 3,
    private: v.private === true,
  };
}
