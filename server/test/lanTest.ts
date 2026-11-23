/**
 * End-to-end LAN tests: real host servers, real WebSocket / UDP traffic, scripted players.
 *
 *   npm run test:lan
 *
 * Covers discovery (two hosts, heartbeat timeout), lobby rules (8 players, full room, private code,
 * ready / start checks, kick, leave, host migration), a full 8-player race with authoritative
 * finish order, cheat rejection, items / hits validation, disconnection + reconnection, room close,
 * server shutdown, malformed traffic, the browser session code itself, and traffic / CPU numbers.
 */
import WebSocket from 'ws';
import { setLogLevel } from '../log';
import { startServer, type RunningServer } from '../index';
import { trackFor } from '../gameData';
import { GAME_ID, NET, PROTOCOL_VERSION } from '../../src/net/config';
import { gridSpot } from '../../src/game/grid';
import {
  STATE_BYTES,
  decodeSnapshot,
  encodeState,
  newCarState,
  type MatchInfo,
  type Profile,
  type RoomSettings,
  type ServerMsg,
  type StandingInfo,
} from '../../src/net/protocol';

setLogLevel((process.env.RMR_LOG as 'info') ?? 'warn');

// ------------------------------------------------------------------------------------------ helpers
const results: { name: string; ok: boolean; info: string }[] = [];
function check(name: string, ok: boolean, info = '') {
  results.push({ name, ok, info });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ` — ${info}` : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms: number, step = 20) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(step);
  }
  return cond();
}

const LOOK = { skin: '#f1c27d', suit: '#e11d48', suitAccent: '#f8fafc', helmet: '#f8fafc', visor: '#0b1220', hair: '#1c1917', accessories: [] };
const profile = (name: string, carId = 'apex'): Profile => ({ name, carId, paint: null, look: LOOK });
const SETTINGS: RoomSettings = { name: 'Test room', maxPlayers: 8, mode: 'race', mapId: 'city', theme: 'city', laps: 1, minutes: 1, items: true, private: false };

class Bot {
  msgs: ServerMsg[] = [];
  id = -1;
  token = '';
  roomId = '';
  snaps = 0;
  snapBytes = 0;
  jsonBytes = 0;
  seenCars = new Set<number>();
  standings = new Map<number, StandingInfo>();
  n = 0;
  closed = false;
  closeCode = 0;
  private seq = 0;
  private buf = new ArrayBuffer(STATE_BYTES);
  readonly s = newCarState();
  ws!: WebSocket;

  constructor(
    readonly port: number,
    readonly name: string,
  ) {}

  open(path = '/play'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.closed = false;
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}${path}`);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.on('open', () => resolve());
      ws.on('error', reject);
      ws.on('close', (code) => {
        if (this.ws === ws) {
          this.closed = true;
          this.closeCode = code;
        }
      });
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          const ab = data as ArrayBuffer;
          this.snaps++;
          this.snapBytes += ab.byteLength;
          decodeSnapshot(new DataView(ab), newCarState(), (id) => this.seenCars.add(id));
          return;
        }
        const text = data.toString();
        this.jsonBytes += text.length;
        const m = JSON.parse(text) as ServerMsg;
        this.msgs.push(m);
        if (m.t === 'welcome') {
          this.id = m.you;
          this.token = m.token;
          this.roomId = m.room.id;
        }
        if (m.t === 'standings') for (const r of m.rows) this.standings.set(r.id, r);
      });
    });
  }

  send(obj: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  cmd(t: string, extra: Record<string, unknown> = {}) {
    this.send({ t, n: ++this.n, ...extra });
  }

  async create(settings: Partial<RoomSettings> = {}, carId = 'apex') {
    await this.open();
    this.send({ t: 'hello', game: GAME_ID, proto: PROTOCOL_VERSION, join: 'create', settings: { ...SETTINGS, ...settings }, profile: profile(this.name, carId) });
    await this.waitFor((m) => m.t === 'welcome' || m.t === 'error');
    return this;
  }

  async join(roomId: string, code?: string, carId = 'apex') {
    await this.open();
    this.send({ t: 'hello', game: GAME_ID, proto: PROTOCOL_VERSION, join: 'join', roomId, code, profile: profile(this.name, carId) });
    return this.waitFor((m) => m.t === 'welcome' || m.t === 'error');
  }

  async resume() {
    await this.open();
    this.n = 0;
    this.send({ t: 'hello', game: GAME_ID, proto: PROTOCOL_VERSION, join: 'resume', roomId: this.roomId, token: this.token });
    return this.waitFor((m) => m.t === 'welcome' || m.t === 'error');
  }

  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }

  async waitFor(pred: (m: ServerMsg) => boolean, ms = 4000, fromIndex = 0): Promise<ServerMsg | undefined> {
    let found: ServerMsg | undefined;
    await until(() => !!(found = this.msgs.slice(fromIndex).find(pred)), ms);
    return found;
  }

  sendState(t = performance.now()) {
    this.s.t = t;
    this.seq = (this.seq + 1) & 0xffff;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeState(this.buf, this.seq, this.s));
  }

  kill() {
    this.ws.terminate();
  }

  close() {
    this.ws.close();
  }
}

/** drives bots along the track at constant speeds (like real cars on their lanes) */
async function drive(
  bots: Bot[],
  match: MatchInfo,
  speeds: number[],
  stop: () => boolean,
  maxMs: number,
  onTick?: (elapsed: number) => void,
) {
  const track = trackFor(match.mapId);
  const lanes = bots.map((b) => {
    const e = match.roster.find((r) => r.id === b.id)!;
    const spot = gridSpot(track, e.slot, match.roster.length, match.mode === 'battle');
    return { d: spot.d, lat: spot.lat };
  });
  const start = Date.now();
  let last = performance.now();
  // drift-corrected 20 Hz like a browser (plain sleep(50) gives ~16 Hz on Windows)
  let nextAt = performance.now() + 50;
  while (!stop() && Date.now() - start < maxMs) {
    await sleep(Math.max(0, nextAt - performance.now()));
    nextAt += 50;
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    bots.forEach((b, i) => {
      if (b.closed) return;
      const st = b.standings.get(b.id);
      if (st?.finished) {
        b.sendState(now);
        return;
      }
      lanes[i].d += speeds[i] * dt;
      const p = track.pointAt(lanes[i].d, lanes[i].lat);
      Object.assign(b.s, { x: p.x, z: p.z, y: 0, heading: p.heading, speed: speeds[i], vx: Math.sin(p.heading) * speeds[i], vz: Math.cos(p.heading) * speeds[i], flags: 1 });
      b.sendState(now);
    });
    onTick?.(Date.now() - start);
  }
  return lanes;
}

async function startMatch(host: Bot, others: Bot[]): Promise<MatchInfo> {
  for (const b of others) b.cmd('ready', { v: true });
  await sleep(2300); // pings get measured by the host (ws ping every 2 s)
  const from = host.msgs.length;
  host.cmd('start');
  const load = (await host.waitFor((m) => m.t === 'load' || m.t === 'error', 5000, from)) as ServerMsg;
  if (load.t !== 'load') throw new Error(`start failed: ${JSON.stringify(load)}`);
  for (const b of [host, ...others]) b.cmd('loaded');
  await Promise.all([host, ...others].map((b) => b.waitFor((m) => m.t === 'go', 5000)));
  return load.match;
}

// ------------------------------------------------------------------------------------------ tests
async function testDiscovery() {
  console.log('\n[1] LAN discovery between two hosts');
  const UDP = 47911;
  const a = await startServer({ port: 47910, udpPort: UDP });
  const b = await startServer({ port: 47920, udpPort: UDP });
  try {
    const ha = await new Bot(a.port, 'Alice').create({ name: 'Room A' });
    const hb = await new Bot(b.port, 'Bob').create({ name: 'Room B', private: true });
    const seen = await until(() => a.discovery.rooms().some((r) => r.name === 'Room B') && b.discovery.rooms().some((r) => r.name === 'Room A'), 4000);
    check('host A sees room of host B and vice versa (UDP broadcast)', seen, seen ? '' : `A sees ${a.discovery.rooms().length}, B sees ${b.discovery.rooms().length}`);
    const rb = a.discovery.rooms().find((r) => r.name === 'Room B');
    check('listing carries host name, players, version, private flag, address', !!rb && rb.hostName === 'Bob' && rb.players === 1 && rb.private && rb.compatible && !!rb.address, JSON.stringify(rb ?? {}).slice(0, 160));

    // agent socket: the browser's view of the room list
    const agent = new Bot(a.port, 'agent');
    await agent.open('/agent');
    agent.send({ t: 'watch' });
    const list = await agent.waitFor((m) => (m as { t: string }).t === 'rooms');
    const rooms = (list as unknown as { rooms: { name: string }[] }).rooms;
    check('agent socket lists local + discovered rooms', rooms.some((r) => r.name === 'Room A') && rooms.some((r) => r.name === 'Room B'), rooms.map((r) => r.name).join(', '));

    // two rooms on one host are both announced
    const hb2 = await new Bot(b.port, 'Bea').create({ name: 'Room B2' });
    check('several rooms of one host are discovered', await until(() => a.discovery.rooms().some((r) => r.name === 'Room B2'), 3000));

    // the room closes: it disappears from the other host's list
    hb2.cmd('close');
    check('closed room disappears from the list', await until(() => !a.discovery.rooms().some((r) => r.name === 'Room B2'), 3000));

    // host B goes silent: its rooms time out (heartbeat timeout)
    const t0 = Date.now();
    await b.close();
    const gone = await until(() => !a.discovery.rooms().some((r) => r.sid === b.sid), NET.ROOM_TIMEOUT_MS + 2500);
    check('rooms of a vanished host time out', gone, `${Date.now() - t0} ms (timeout ${NET.ROOM_TIMEOUT_MS} ms)`);
    check('players of a shut-down host are told', !!hb.last('closed') && hb.last('closed')!.reason === 'shutdown');

    // a different protocol version is rejected
    const v = new Bot(a.port, 'Old');
    await v.open();
    v.send({ t: 'hello', game: GAME_ID, proto: PROTOCOL_VERSION + 1, join: 'join', roomId: ha.roomId, profile: profile('Old') });
    const e = await v.waitFor((m) => m.t === 'error');
    check('client with another protocol version is refused', e?.t === 'error' && e.code === 'version');
    agent.close();
  } finally {
    await a.close();
  }
}

async function testLobby(srv: RunningServer) {
  console.log('\n[2] Lobby: 8 players, full room, private code, ready / start, kick, leave, host migration');
  const host = await new Bot(srv.port, 'Host').create({ name: 'Lobby test', maxPlayers: 8 });
  check('room created, creator is host', host.id === 0 && host.last('welcome')!.room.hostId === 0);
  const others: Bot[] = [];
  for (let i = 1; i < 8; i++) {
    const b = new Bot(srv.port, `P${i}`);
    const w = await b.join(host.roomId);
    if (w?.t === 'welcome') others.push(b);
  }
  check('7 more players join (8/8)', others.length === 7);
  await sleep(150);
  check('everybody receives the lobby state with 8 players', [host, ...others].every((b) => b.last('room')?.room.players.length === 8));
  check('players are told who joined', host.msgs.filter((m) => m.t === 'notice' && m.key === 'joined').length === 7);

  const ninth = new Bot(srv.port, 'Ninth');
  const e9 = await ninth.join(host.roomId);
  check('9th player is refused: room full', e9?.t === 'error' && e9.code === 'roomFull');

  let from = host.msgs.length;
  host.cmd('start');
  const notReady = await host.waitFor((m) => m.t === 'error', 3000, from);
  check('start refused while players are not ready', notReady?.t === 'error' && notReady.code === 'notReady', notReady?.t === 'error' ? notReady.detail : '');

  from = others[0].msgs.length;
  others[0].cmd('start');
  const nh = await others[0].waitFor((m) => m.t === 'error', 3000, from);
  check('only the host may start', nh?.t === 'error' && nh.code === 'notHost');

  // replayed command (same n) is ignored
  others[1].send({ t: 'ready', n: 1, v: true });
  others[1].send({ t: 'ready', n: 1, v: false });
  await sleep(200);
  check('replayed command with the same sequence number is ignored', host.last('room')!.room.players.find((p) => p.id === others[1].id)!.ready === true);

  // kick
  from = others[6].msgs.length;
  host.cmd('kick', { id: others[6].id });
  check('kicked player is told and disconnected', !!(await others[6].waitFor((m) => m.t === 'kicked', 3000, from)) && (await until(() => others[6].closed, 2000)));
  const back = await new Bot(srv.port, 'P7again').join(host.roomId);
  check('kicked player cannot come straight back (same address)', back?.t === 'error' && back.code === 'kicked');

  // leave
  others[5].send({ t: 'leave' });
  await until(() => host.last('room')?.room.players.length === 6, 2000);
  check('leaving player is removed from the lobby', host.last('room')!.room.players.length === 6);

  // host migration
  host.send({ t: 'leave' });
  const nm = await others[0].waitFor((m) => m.t === 'notice' && m.key === 'newHost', 3000);
  await sleep(150);
  check('host leaves → the longest-present player becomes host', !!nm && others[0].last('room')!.room.hostId === others[0].id);

  // private room + code
  const ph = await new Bot(srv.port, 'Priv').create({ name: 'Secret', private: true });
  const code = ph.last('welcome')!.room.code;
  check('private room: host gets a 4-digit code', !!code && /^\d{4}$/.test(code));
  const wrong = await new Bot(srv.port, 'Guess').join(ph.roomId, code === '0000' ? '1111' : '0000');
  check('wrong code is refused', wrong?.t === 'error' && wrong.code === 'wrongCode');
  const right = await new Bot(srv.port, 'Friend').join(ph.roomId, code);
  check('right code is accepted', right?.t === 'welcome');
  check('code is only sent to the host', right?.t === 'welcome' && right.room.code === undefined);

  // settings: host only, validated
  ph.cmd('settings', { s: { ...SETTINGS, name: '<b>x</b>‮ evil', maxPlayers: 99, laps: 50, mapId: 'nope' } });
  await sleep(200);
  const st = ph.last('room')!.room.settings;
  check('settings are sanitised by the host (bad values replaced)', st.maxPlayers === 4 && st.laps === 3 && st.mapId === 'city' && !st.name.includes('‮'), JSON.stringify(st));
  for (const b of [ph, ...others.slice(0, 5)]) b.close();
}

async function testRace(srv: RunningServer) {
  console.log('\n[3] 8-player race: countdown, snapshots, checkpoints, laps, finish order, results');
  const host = await new Bot(srv.port, 'R0').create({ name: 'Race', maxPlayers: 8, laps: 1, mapId: 'city' });
  const bots = [host];
  for (let i = 1; i < 8; i++) {
    const b = new Bot(srv.port, `R${i}`);
    await b.join(host.roomId);
    bots.push(b);
  }
  const match = await startMatch(host, bots.slice(1));
  check('match loads with 8 players on a shared grid', match.roster.length === 8 && new Set(match.roster.map((r) => r.slot)).size === 8);
  const go = host.last('go')!.at;
  check('everybody gets the same green-light time', bots.every((b) => b.last('go')?.at === go));

  // wait for the green light, then race; speeds decide the finishing order
  await until(() => performance.now() >= go, 6000);
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  bots.forEach((b) => {
    b.snaps = 0;
    b.snapBytes = 0;
    b.jsonBytes = 0;
  });
  const speeds = bots.map((_, i) => 70 - i * 1.5);
  let cheatChecked = false;
  await drive(
    bots,
    match,
    speeds,
    () => bots.every((b) => !!b.last('results')),
    90000,
    (ms) => {
      if (!cheatChecked && ms > 3000) {
        cheatChecked = true;
        cheat(bots[7]);
      }
    },
  );
  const secs = (performance.now() - t0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  const res = host.last('results');
  check('race ends with results for everybody', bots.every((b) => !!b.last('results')));
  const order = res?.rows.map((r) => r.name).join(',');
  check('finish order follows the real driving (host-authoritative)', order === 'R0,R1,R2,R3,R4,R5,R6,R7', order);
  check('finish times are increasing and positive', !!res && res.rows.every((r, i) => r.time !== null && r.time > 0 && (i === 0 || r.time >= res.rows[i - 1].time!)));
  const st = host.standings.get(host.id);
  check('checkpoints were counted along the lap', !!st && st.cp >= NET.CHECKPOINTS, `cp=${st?.cp}`);
  check('every client received the other 7 cars in snapshots', bots.every((b) => [...Array(8).keys()].filter((id) => id !== b.id).every((id) => b.seenCars.has(id))));
  const kbps = bots.map((b) => (b.snapBytes + b.jsonBytes) / secs / 1024);
  const hz = bots[0].snaps / secs;
  check('snapshot rate ≈ 20 Hz', hz > 15 && hz < 22, `${hz.toFixed(1)} Hz`);
  check('download per client stays small', Math.max(...kbps) < 12, `${Math.max(...kbps).toFixed(2)} KB/s per client (8 cars)`);
  const cpuMs = (cpu.user + cpu.system) / 1000;
  console.log(`     ℹ test process CPU (host server + 8 scripted clients): ${((cpuMs / (secs * 1000)) * 100).toFixed(1)}% of one core over ${secs.toFixed(1)} s`);
  await sleep(200);
  check('room goes back to the lobby after the match', host.last('room')?.room.status === 'lobby');
  check('ready flags reset for the next match', host.last('room')!.room.players.filter((p) => !p.host).every((p) => !p.ready));
  for (const b of bots) b.close();

  async function cheat(b: Bot) {
    // teleport 300 m ahead: rejected and corrected; progress must not jump
    const before = b.standings.get(b.id)?.progress ?? 0;
    const from = b.msgs.length;
    const saved = { ...b.s };
    const p = trackFor(match.mapId).pointAt(trackFor(match.mapId).project(b.s.x, b.s.z).d + 300, 0);
    b.s.x = p.x;
    b.s.z = p.z;
    b.sendState();
    const corr = await b.waitFor((m) => m.t === 'correct', 2000, from);
    Object.assign(b.s, saved);
    await sleep(400);
    const after = b.standings.get(b.id)?.progress ?? 0;
    check('teleport is rejected with a correction', !!corr);
    check('rejected teleport gives no progress', after - before < 60, `progress +${(after - before).toFixed(1)} m`);
    // impossible speed
    const f2 = b.msgs.length;
    b.s.speed = 500;
    b.sendState();
    b.s.speed = saved.speed;
    await sleep(500);
    check('impossible speed is rejected', !!(await b.waitFor((m) => m.t === 'correct', 1500, f2)));
  }
}

async function testItems(srv: RunningServer) {
  console.log('\n[4] Items and hits: pickups validated, relayed, hits scored once');
  const host = await new Bot(srv.port, 'I0').create({ name: 'Items', maxPlayers: 2, laps: 3, mapId: 'city', items: true });
  const guest = new Bot(srv.port, 'I1');
  await guest.join(host.roomId);
  const match = await startMatch(host, [guest]);
  const go = host.last('go')!.at;
  await until(() => performance.now() >= go, 6000);
  const track = trackFor(match.mapId);
  const ev = (shot: number) => ({ kind: 'missile', shot, x: host.s.x, y: 1, z: host.s.z, heading: host.s.heading, speed: 60, target: guest.id });

  // before any lucky block: an item use is refused (not relayed)
  await drive([host, guest], match, [30, 30], () => false, 600);
  let from = guest.msgs.length;
  host.cmd('item', { e: ev(1) });
  await sleep(300);
  check('item without a lucky block pickup is NOT relayed', !guest.msgs.slice(from).some((m) => m.t === 'item'));

  // drive through the first row of lucky blocks
  const row = track.itemRows[0];
  await drive([host, guest], match, [60, 60], () => track.ahead(row + 20, track.project(host.s.x, host.s.z).d) < track.length / 2, 30000);
  from = guest.msgs.length;
  host.cmd('item', { e: ev(2) });
  const relayed = await guest.waitFor((m) => m.t === 'item', 2000, from);
  check('item after a pickup is relayed to the other player', relayed?.t === 'item' && relayed.from === host.id && relayed.e.target === guest.id);
  from = guest.msgs.length;
  host.cmd('item', { e: ev(3) });
  await sleep(300);
  check('a second item from one pickup is refused', !guest.msgs.slice(from).some((m) => m.t === 'item'));

  // the victim reports the hit; the host scores it once
  from = host.msgs.length;
  guest.cmd('hit', { owner: host.id, shot: 2, kind: 'missile' });
  const hit = await host.waitFor((m) => m.t === 'hit', 2000, from);
  check('hit reported by the victim is confirmed to everybody', hit?.t === 'hit' && hit.owner === host.id && hit.victim === guest.id);
  guest.cmd('hit', { owner: host.id, shot: 2, kind: 'missile' });
  guest.cmd('hit', { owner: host.id, shot: 99, kind: 'missile' });
  await sleep(400);
  check('duplicate / invented hits are not scored', host.standings.get(host.id)?.hits === 1, `hits=${host.standings.get(host.id)?.hits}`);
  host.cmd('hit', { owner: host.id, shot: 2, kind: 'missile' });
  await sleep(200);
  check('a player cannot score a hit on themselves', host.standings.get(host.id)?.hits === 1);
  host.close();
  guest.close();
}

async function testReconnect(srv: RunningServer) {
  console.log('\n[5] Disconnection during a race, reconnection, grace timeout, room close');
  const host = await new Bot(srv.port, 'C0').create({ name: 'Drops', maxPlayers: 4, laps: 5 });
  const b1 = new Bot(srv.port, 'C1');
  const b2 = new Bot(srv.port, 'C2');
  await b1.join(host.roomId);
  await b2.join(host.roomId);
  const match = await startMatch(host, [b1, b2]);
  await until(() => performance.now() >= host.last('go')!.at, 6000);
  let driving = true;
  const loop = drive([host, b1, b2], match, [40, 40, 40], () => !driving, 60000);
  await sleep(1500);

  // Wi-Fi off: the socket just dies
  b1.kill();
  const dropped = await host.waitFor((m) => m.t === 'notice' && m.key === 'dropped', 3000);
  check('others are told when a player drops', !!dropped);
  await until(() => host.standings.get(b1.id)?.status === 'reconnecting', 2000);
  check('standings mark the player as reconnecting', host.standings.get(b1.id)?.status === 'reconnecting');

  await sleep(1500);
  const before = b1.msgs.length;
  const w = await b1.resume();
  const load = await b1.waitFor((m) => m.t === 'load', 3000, before);
  check('reconnect with the session token is accepted', w?.t === 'welcome' && w.you === b1.id);
  check('rejoined player gets the running match with its last position', load?.t === 'load' && !!load.match.resume && load.match.goAt !== undefined);
  await until(() => host.standings.get(b1.id)?.status === 'online', 3000);
  check('player is back online for everybody', host.standings.get(b1.id)?.status === 'online');

  // a second player never comes back: removed after the grace period
  b2.kill();
  const t0 = Date.now();
  const left = await host.waitFor((m) => m.t === 'left' && m.id === b2.id, NET.RECONNECT_GRACE_MS + 4000);
  check('a player who does not return is removed after the grace period', !!left, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const late = new Bot(srv.port, 'C2');
  late.roomId = host.roomId;
  late.token = b2.token;
  const exp = await late.resume();
  check('reconnecting after the grace period is refused', exp?.t === 'error' && exp.code === 'sessionExpired');
  const latejoin = await new Bot(srv.port, 'Late').join(host.roomId);
  check('new players cannot join a running race', latejoin?.t === 'error' && latejoin.code === 'inProgress');

  // the host closes the room
  driving = false;
  await loop;
  const f = b1.msgs.length;
  host.cmd('close');
  const closed = await b1.waitFor((m) => m.t === 'closed', 3000, f);
  check('host closes the room → players are told', closed?.t === 'closed' && closed.reason === 'host');
  check('room is removed from the host', !srv.manager.get(host.roomId));
}

async function testRobustness(srv: RunningServer) {
  console.log('\n[6] Malformed / hostile traffic');
  const b = new Bot(srv.port, 'X');
  await b.open();
  b.ws.send('{not json');
  b.ws.send(JSON.stringify({ t: 'hello', game: 'OtherGame', proto: 1 }));
  const e = await b.waitFor((m) => m.t === 'error');
  check('foreign game id is refused', e?.t === 'error' && e.code === 'version');

  const c = new Bot(srv.port, 'Y');
  await c.open();
  c.ws.send('x'.repeat(NET.MAX_MESSAGE_BYTES + 10));
  check('oversized message closes the connection', await until(() => c.closed, 2000), `code ${c.closeCode}`);

  const d = new Bot(srv.port, 'Z');
  await d.open();
  await sleep(NET.HELLO_TIMEOUT_MS + 500);
  check('socket without a hello is dropped', d.closed);

  const h = await new Bot(srv.port, 'H').create({ name: 'Flood' });
  for (let i = 0; i < 400; i++) h.send({ t: 'ready', n: i + 1, v: true });
  h.ws.send(new Uint8Array([1, 2, 3]));
  await sleep(500);
  check('flooding is rate limited and the host survives', srv.manager.get(h.roomId) !== undefined);
  h.close();
}

async function testBrowserSession(srv: RunningServer) {
  console.log('\n[7] Browser session code (src/net) against the real host');
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    window: globalThis,
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  });
  const { net } = await import('../../src/net/session');
  const host = await new Bot(srv.port, 'Web host').create({ name: 'Browser test', laps: 1 });
  net.join(`ws://127.0.0.1:${srv.port}/play`, host.roomId, profile('Browser'));
  check('session reaches the lobby', await until(() => net.view.phase === 'lobby' && !!net.view.room, 4000));
  check('clock sync: round trip measured', await until(() => net.view.rtt >= 0, 4000), `rtt ${net.view.rtt} ms`);
  net.setReady(true);
  await sleep(2300);
  host.cmd('start');
  check('session switches to the race on "load"', await until(() => net.view.phase === 'race' && !!net.link, 4000));
  const link = net.link!;
  link.loaded();
  host.cmd('loaded');
  check('go time arrives', await until(() => link.goAt !== null, 4000));
  check('host clock offset is sane', Math.abs(link.now() - performance.now()) < 50, `${(link.now() - performance.now()).toFixed(1)} ms`);
  // the scripted host drives; the browser link must interpolate it smoothly
  const match = host.last('load')!.match;
  const out = newCarState();
  let samples = 0;
  let maxJump = 0;
  let prevX = NaN;
  let prevZ = NaN;
  const track = trackFor(match.mapId);
  await until(() => performance.now() >= link.goAt!, 6000);
  const loop = drive([host], match, [40], () => false, 2500, () => {
    if (link.sampleRemote(host.id, out)) {
      samples++;
      if (!Number.isNaN(prevX)) maxJump = Math.max(maxJump, Math.hypot(out.x - prevX, out.z - prevZ));
      prevX = out.x;
      prevZ = out.z;
    }
  });
  // the local car (the "browser") sends its state through the link
  const spot = gridSpot(track, match.roster.find((r) => r.id === net.view.you)!.slot, 2, false);
  const s = newCarState();
  Object.assign(s, { x: spot.x, z: spot.z, heading: spot.heading });
  const t0 = performance.now();
  while (performance.now() - t0 < 2000) {
    s.t = performance.now();
    link.pushLocal(s);
    await sleep(16);
  }
  await loop;
  check('remote car is interpolated every frame', samples > 30, `${samples} samples`);
  check('interpolated movement has no big jumps', maxJump < 4, `max ${maxJump.toFixed(2)} m per 50 ms at 40 m/s`);
  check('a standing car sends only keyframes (no flooding)', link.packetsSent <= 4, `${link.packetsSent} packets in 2 s`);
  net.leave();
  await sleep(200);
  check('leaving resets the session', net.view.phase === 'idle');
  host.close();
}

// ------------------------------------------------------------------------------------------ main
const main = async () => {
  console.log(`RMR_race LAN tests — protocol ${PROTOCOL_VERSION}`);
  await testDiscovery();
  const srv = await startServer({ port: 47930, udpPort: 47931 });
  try {
    await testLobby(srv);
    await testRace(srv);
    await testItems(srv);
    await testReconnect(srv);
    await testRobustness(srv);
    await testBrowserSession(srv);
  } finally {
    const shut = await new Bot(srv.port, 'S').create({ name: 'Shutdown' });
    await srv.close();
    await sleep(100);
    check('server shutdown closes rooms for their players', shut.last('closed')?.reason === 'shutdown');
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:\n' + failed.map((f) => ` - ${f.name} ${f.info}`).join('\n'));
    process.exit(1);
  }
  process.exit(0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
