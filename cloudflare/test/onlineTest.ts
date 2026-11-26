/**
 * End-to-end tests of the online service (npm run test:online): the real Worker and Durable Objects in
 * the local workerd runtime, real WebSockets, scripted players driving on the real tracks.
 *
 * Simulated clients on one computer: this proves the server logic, not the quality of a real internet
 * connection and not the limits of a Cloudflare account.
 */
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { trackFor } from '../../server/gameData';
import { GAME_ID, GAME_VERSION, ONLINE_PROTOCOL } from '../../src/net/config';
import { gridSpot } from '../../src/game/grid';
import { decodeSnapshot, encodeBatch, newCarState, type MatchInfo, type MmServerMsg, type Profile, type RoomSettings, type ServerMsg, type StandingInfo } from '../../src/net/protocol';
import { startWorker, type LocalWorker } from './worker';

const PORT = 8797;
const ORIGIN = 'http://localhost:5173';
/** run only some parts: npm run test:online -- queue race */
const only = process.argv.slice(2);

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean, info = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ` — ${info}` : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean | Promise<boolean>, ms: number, step = 20) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(step);
  }
  return cond();
}

const LOOK = { skin: '#f1c27d', suit: '#e11d48', suitAccent: '#f8fafc', helmet: '#f8fafc', visor: '#0b1220', hair: '#1c1917', accessories: [] };
const profile = (name: string): Profile => ({ name, carId: 'apex', paint: null, look: LOOK });
const SETTINGS: RoomSettings = { name: 'Friends', maxPlayers: 8, mode: 'race', mapId: 'city', theme: 'city', laps: 1, minutes: 1, items: true, private: true };
const hex = (n: number) => crypto.randomBytes(n).toString('hex');

let base = `ws://127.0.0.1:${PORT}`;
const http = () => base.replace('ws', 'http');

/** raw socket with message log */
class Sock<M extends { t: string }> {
  msgs: M[] = [];
  closed = false;
  code = 0;
  onBin: ((v: DataView) => void) | null = null;
  ws!: WebSocket;
  pongs = 0;
  async open(url: string, origin: string | null = ORIGIN) {
    this.closed = false;
    const ws = new WebSocket(url, origin ? { headers: { origin } } : {});
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.on('message', (data, bin) => {
      if (bin) return this.onBin?.(new DataView(data as ArrayBuffer));
      const text = data.toString();
      if (text === 'pong') {
        this.pongs++;
        return;
      }
      this.msgs.push(JSON.parse(text) as M);
    });
    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.closed = true;
      this.code = code;
    });
    ws.on('error', () => (this.closed = true));
    // browsers send this too; the platform answers it without waking the object
    const beat = setInterval(() => (ws.readyState === WebSocket.OPEN ? ws.send('ping') : clearInterval(beat)), 2500);
    beat.unref();
    await new Promise<void>((r) => {
      ws.on('open', () => r());
      ws.on('error', () => r());
      ws.on('close', () => r());
    });
  }
  send(o: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  }
  last<T extends M['t']>(t: T): Extract<M, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i] as Extract<M, { t: T }>;
    return undefined;
  }
  async wait<T extends M['t']>(t: T, ms = 6000, from = 0): Promise<Extract<M, { t: T }> | undefined> {
    let f: M | undefined;
    await until(() => !!(f = this.msgs.slice(from).find((m) => m.t === t)), ms);
    return f as Extract<M, { t: T }> | undefined;
  }
}

/** the menu: matchmaking socket */
class Menu extends Sock<MmServerMsg> {
  constructor(readonly pid = hex(16)) {
    super();
  }
  async start(proto = ONLINE_PROTOCOL) {
    await this.open(`${base}/matchmaking`);
    this.send({ t: 'hello', game: GAME_ID, proto, pid: this.pid });
    await until(() => this.msgs.length > 0, 4000);
    return this;
  }
}

class Bot extends Sock<ServerMsg> {
  id = -1;
  token = '';
  roomId = '';
  n = 0;
  snaps = 0;
  entries = 0;
  own = 0;
  seen = new Set<number>();
  /** sample times per car, to see that every sample of a batch arrives */
  times = new Map<number, number[]>();
  standings = new Map<number, StandingInfo>();
  private seq = 0;
  readonly s = newCarState();
  menu: Menu;

  constructor(
    readonly name: string,
    pid = hex(16),
  ) {
    super();
    this.menu = new Menu(pid);
    this.onBin = (v) => {
      this.snaps++;
      decodeSnapshot(v, newCarState(), (id, s) => {
        this.entries++;
        if (id === this.id) this.own++;
        this.seen.add(id);
        const l = this.times.get(id) ?? [];
        l.push(s.t);
        this.times.set(id, l);
      });
    };
  }
  /** takes the seat from a match message */
  async enter(m: { roomId: string; ticket: string }) {
    this.roomId = m.roomId;
    await this.open(`${base}/room/${m.roomId}`);
    this.send({ t: 'hello', game: GAME_ID, proto: ONLINE_PROTOCOL, ver: GAME_VERSION, join: 'ticket', roomId: m.roomId, ticket: m.ticket, profile: profile(this.name) });
    await until(() => this.msgs.some((x) => x.t === 'welcome' || x.t === 'error'), 6000);
    const w = this.last('welcome');
    if (w) {
      this.id = w.you;
      this.token = w.token;
    }
    return !!w;
  }
  async quick() {
    await this.menu.start();
    this.menu.send({ t: 'find' });
  }
  async quickEnter(ms = 8000) {
    const m = await this.menu.wait('match', ms);
    if (!m) return false;
    const ok = await this.enter(m);
    this.menu.ws.close();
    return ok;
  }
  async create(s: Partial<RoomSettings> = {}) {
    await this.menu.start();
    this.menu.send({ t: 'create', settings: { ...SETTINGS, ...s } });
    const m = await this.menu.wait('match');
    if (!m) return false;
    const ok = await this.enter(m);
    this.menu.ws.close();
    return ok;
  }
  async join(code: string): Promise<string> {
    if (!this.menu.ws || this.menu.closed) await this.menu.start();
    const from = this.menu.msgs.length;
    this.menu.send({ t: 'join', code });
    await until(() => this.menu.msgs.slice(from).some((m) => m.t === 'match' || m.t === 'error'), 6000);
    const r = this.menu.msgs.slice(from).find((m) => m.t === 'match' || m.t === 'error');
    if (r?.t === 'match') return (await this.enter(r)) ? 'ok' : `room: ${this.last('error')?.code}`;
    return r?.t === 'error' ? r.code : 'timeout';
  }
  async resume(match?: string) {
    await this.open(`${base}/room/${this.roomId}`);
    this.n = 0;
    const from = this.msgs.length;
    this.send({ t: 'hello', game: GAME_ID, proto: ONLINE_PROTOCOL, ver: GAME_VERSION, join: 'resume', roomId: this.roomId, token: this.token, match });
    await until(() => this.msgs.slice(from).some((x) => x.t === 'welcome' || x.t === 'error'), 6000);
    return this.msgs.slice(from).find((x) => x.t === 'welcome' || x.t === 'error');
  }
  cmd(t: string, extra: Record<string, unknown> = {}) {
    this.send({ t, n: ++this.n, ...extra });
  }
  get room() {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i];
      if (m.t === 'room' || m.t === 'welcome') return m.room;
    }
    return undefined;
  }
  /** `samples` states of this car in one message */
  batch(samples: { t: number; x: number; z: number; heading: number; speed: number }[]) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const list = samples.map((p) => Object.assign(newCarState(), { ...p, vx: Math.sin(p.heading) * p.speed, vz: Math.cos(p.heading) * p.speed, flags: 1 }));
    this.ws.send(encodeBatch((this.seq = (this.seq + 1) & 0xffff), list, list.length));
  }
  leave() {
    this.send({ t: 'leave' });
    this.ws?.close();
    if (this.menu.ws) this.menu.ws.close();
  }
}

const updateStandings = (b: Bot) => {
  for (const m of b.msgs) if (m.t === 'standings') for (const r of m.rows) b.standings.set(r.id, r);
};

/** drives bots along their lanes: 20 samples / 10 messages a second, like the browser */
async function drive(bots: Bot[], match: MatchInfo, speeds: number[], stop: () => boolean, maxMs: number, skip?: (b: Bot, ms: number) => boolean) {
  const track = trackFor(match.mapId);
  const lanes = bots.map((b) => {
    const e = match.roster.find((r) => r.id === b.id)!;
    const sp = gridSpot(track, e.slot, match.roster.length, match.mode === 'battle');
    return { d: sp.d, lat: sp.lat };
  });
  const begin = Date.now();
  let last = performance.now();
  let nextAt = last + 100;
  while (!stop() && Date.now() - begin < maxMs) {
    await sleep(Math.max(0, nextAt - performance.now()));
    nextAt += 100;
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    bots.forEach((b, i) => {
      if (b.closed || skip?.(b, Date.now() - begin)) return;
      updateStandings(b);
      const v = b.standings.get(b.id)?.finished ? 0 : speeds[i];
      const list = [0.5, 1].map((k) => {
        const p = track.pointAt(lanes[i].d + v * dt * k, lanes[i].lat);
        return { t: now - dt * 1000 * (1 - k), x: p.x, z: p.z, heading: p.heading, speed: v };
      });
      lanes[i].d += v * dt;
      b.batch(list);
    });
  }
  return lanes;
}

const pingAll = (bots: Bot[]) => bots.forEach((b) => b.send({ t: 'ping', c: 1, rtt: 40 }));

/** everybody loads; waits for the green light */
async function loadAll(bots: Bot[], from: number[] = bots.map(() => 0)): Promise<MatchInfo> {
  const loads = await Promise.all(bots.map((b, i) => b.wait('load', 15000, from[i])));
  if (loads.some((l) => !l)) throw new Error(`no load: ${bots.map((b) => JSON.stringify(b.msgs.slice(-2)).slice(0, 200)).join(' | ')}`);
  bots.forEach((b) => b.cmd('loaded'));
  const gos = await Promise.all(bots.map((b, i) => b.wait('go', 8000, from[i])));
  if (gos.some((g) => !g)) throw new Error('no go');
  return loads[0]!.match;
}

const debug = async (what: string, id: string) => {
  try {
    return (await (await fetch(`${http()}/debug/${what}/${id}`)).json()) as { boot: string; status: string; players: number; seats: number; sockets: number; match: string | null; written: number; received: number };
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------------------------------ tests

async function testEntry() {
  console.log('\n[1] Entry point: health, origins, quota errors');
  const h = await fetch(`${http()}/health`, { headers: { origin: ORIGIN } });
  const hj = (await h.json()) as { ok: boolean; proto: number; origin: boolean };
  check('health answers the game website (CORS only for allowed origins)', hj.ok && hj.proto === ONLINE_PROTOCOL && h.headers.get('access-control-allow-origin') === ORIGIN);
  const e = await fetch(`${http()}/health`, { headers: { origin: 'https://evil.example' } });
  check('a foreign website gets no CORS header', e.headers.get('access-control-allow-origin') === null && !((await e.json()) as { origin: boolean }).origin);
  for (const [name, origin] of [['foreign origin', 'https://evil.example'], ['no origin', null], ['lookalike origin', 'https://r-m-r-race.netlify.app.evil.example']] as const) {
    const s = new Sock<ServerMsg>();
    await s.open(`${base}/matchmaking`, origin);
    await until(() => s.closed, 3000);
    check(`WebSocket with ${name} is refused`, s.last('error')?.code === 'badOrigin' && s.closed);
  }
  const s = new Sock<ServerMsg>();
  await s.open(`${base}/room/${hex(16)}`);
  await until(() => s.closed, 3000);
  check('unknown room id is refused', s.last('error')?.code === 'sessionExpired', s.last('error')?.code);
  const s2 = new Sock<ServerMsg>();
  await s2.open(`${base}/room/../../etc`);
  await until(() => s2.closed, 3000);
  check('malformed room id is refused', s2.last('error')?.code === 'roomNotFound' || s2.msgs.length === 0);
  const q = new Sock<ServerMsg>();
  await q.open(`${base}/matchmaking?simulateQuota=1`);
  await until(() => q.closed, 3000);
  check('used-up Durable Objects quota is reported as a service limit', q.last('error')?.code === 'serviceLimit');
  const qh = await fetch(`${http()}/health?simulateQuota=1`, { headers: { origin: ORIGIN } });
  check('health reports SERVICE_LIMIT_REACHED', qh.status === 503 && (await qh.text()).includes('SERVICE_LIMIT_REACHED'));
  const v = new Menu();
  await v.start(ONLINE_PROTOCOL + 1);
  check('another protocol version is refused', v.msgs.some((m) => m.t === 'error' && m.code === 'version'));
}

async function testQueue() {
  console.log('\n[2] Quick Play queue');
  const a = new Bot('Ann');
  await a.quick();
  check('one player waits (no fake opponents)', (await a.menu.wait('searching', 2000)) !== undefined && !(await a.menu.wait('match', 1500)));
  a.menu.send({ t: 'find' });
  a.menu.send({ t: 'find' });
  await sleep(900);
  check('pressing the button again does not register twice', a.menu.last('status')?.searching === 1, `searching ${a.menu.last('status')?.searching}`);
  check('the online counter is real', (a.menu.last('status')?.online ?? 0) >= 1, `online ${a.menu.last('status')?.online}`);
  a.menu.send({ t: 'cancel' });
  await a.menu.wait('cancelled', 2000);
  const b = new Bot('Bob');
  await b.quick();
  check('a cancelled player is not matched', !(await b.menu.wait('match', 1500)));
  // a closed tab leaves the queue
  b.menu.ws.close();
  const c = new Bot('Cid');
  await c.quick();
  check('a closed tab leaves the queue', !(await c.menu.wait('match', 1500)));
  // second tab of the same player replaces the first
  const c2 = new Bot('Cid2', c.menu.pid);
  await c2.quick();
  await sleep(600);
  check('a second tab of the same player replaces the first', c.menu.closed && c.menu.msgs.some((m) => m.t === 'error' && m.code === 'replaced') && !c2.menu.last('match'));
  // two real players
  a.menu.send({ t: 'find' });
  const ok = (await Promise.all([a.quickEnter(), c2.quickEnter()])).every(Boolean);
  check('two players are put into the same room', ok && a.roomId === c2.roomId, a.roomId.slice(0, 8));
  check('the room starts by itself after a visible countdown', await until(() => !!a.room?.startAt && !!c2.room?.startAt, 2000));
  check('quick rooms have no host with special rights', a.room?.hostId === -1 && a.room?.kind === 'quick');
  const d = new Bot('Dan');
  await d.quick();
  check('a later player joins the lobby that is still waiting', (await d.quickEnter()) && d.roomId === a.roomId);
  check('everybody sees all players', await until(() => [a, c2, d].every((x) => x.room?.players.length === 3), 3000));
  // one player, one room
  const a2 = new Bot('Ann again', a.menu.pid);
  const created = await a2.create();
  check('joining another room gives up the first seat', created && (await until(() => a.last('error')?.code === 'replaced', 3000)) && (await until(() => c2.room?.players.length === 2, 3000)));
  a2.leave();
  // a used ticket is worthless
  const stolen = new Bot('Thief');
  const m = d.menu.last('match')!;
  await stolen.enter(m);
  check('a ticket works only once', stolen.last('error')?.code === 'sessionExpired');
  // leaving below the minimum cancels the countdown
  d.leave();
  check('countdown is cancelled when too few players are left', await until(() => c2.room?.players.length === 1 && !c2.room?.startAt, 4000));
  // …and the lonely room is offered to the next player
  const f = new Bot('Fay');
  await f.quick();
  check('a lonely lobby gets the next searching player at once', (await f.quickEnter()) && f.roomId === c2.roomId);
  f.leave();
  c2.leave();
  await sleep(600);
  const g = new Bot('Gus');
  await g.quick();
  const t0 = Date.now();
  const to = await until(() => g.menu.msgs.some((x) => x.t === 'error' && x.code === 'searchTimeout'), 14000, 50);
  check('a search that takes too long ends with a message', to, `${((Date.now() - t0) / 1000).toFixed(1)} s (limit 8 s)`);
  g.menu.ws.close();
}

async function testRace() {
  console.log('\n[3] Quick Play race: 4 players, start, sync, cheating, finish, results, rematch');
  const bots = ['R1', 'R2', 'R3', 'R4'].map((n) => new Bot(n));
  for (const b of bots) await b.quick();
  const ok = (await Promise.all(bots.map((b) => b.quickEnter()))).every(Boolean);
  check('four players share one room', ok && new Set(bots.map((b) => b.roomId)).size === 1);
  pingAll(bots);
  bots.forEach((b) => b.cmd('ready', { v: true }));
  const t0 = Date.now();
  const match = await loadAll(bots);
  check('all ready shortens the countdown', Date.now() - t0 < 10000, `${Date.now() - t0} ms until the green light was announced`);
  const gos = bots.map((b) => b.last('go')!.at);
  check('everybody gets the same green light', new Set(gos).size === 1);
  check('the match tells the clients the network rates', match.net?.sendHz === 10 && match.net.sampleHz === 20);
  const [a, b, c, d] = bots;
  // early start: leaving the grid before the green light is pulled back
  const tr = trackFor(match.mapId);
  const far = tr.pointAt(200, 0);
  a.batch([{ t: performance.now(), x: far.x, z: far.z, heading: 0, speed: 30 }]);
  check('a jump start is corrected', !!(await a.wait('correct', 3000)));
  await sleep(4200);

  // cheats while racing: nobody can declare a victory
  const before = a.msgs.length;
  a.send({ t: 'results', rows: [{ id: a.id, place: 1 }], n: ++a.n });
  a.send({ t: 'finish', n: ++a.n });
  a.send({ t: 'standings', rows: [{ id: b.id, place: 4, finished: true }], n: ++a.n });
  const lapAhead = tr.pointAt(tr.length / 2, 0);
  a.batch([{ t: performance.now(), x: lapAhead.x, z: lapAhead.z, heading: 0, speed: 30 }]);
  check('teleporting is rejected with a correction', !!(await a.wait('correct', 3000, before)));
  a.batch([{ t: performance.now(), x: a.s.x, z: a.s.z, heading: 0, speed: 300 }]);
  a.cmd('item', { e: { kind: 'missile', shot: 1, x: 0, y: 0, z: 0, heading: 0, speed: 10, target: b.id } });
  a.cmd('hit', { owner: b.id, shot: 99, kind: 'missile' });
  await sleep(300);
  check('items that were never picked up and invented hits are ignored', !b.msgs.some((m) => m.t === 'item' || m.t === 'hit'));
  check('claims about results change nothing', !b.msgs.some((m) => m.t === 'results'));

  // honest race
  bots.forEach((x) => {
    x.snaps = x.own = x.entries = 0;
    x.times.clear();
  });
  const wire0 = bots.map((x) => x.snaps);
  const t1 = Date.now();
  const speeds = [52, 49, 46, 43];
  const done = () => bots.every((x) => x.msgs.some((m) => m.t === 'results'));
  // the starting grid lap: distances restart behind the line
  await drive(bots, match, speeds, done, 150000);
  const secs = (Date.now() - t1) / 1000;
  const res = bots.map((x) => x.last('results'));
  check('everybody receives the results', res.every(Boolean), `${secs.toFixed(0)} s`);
  if (res[0]) {
    check('results are identical for all players', new Set(res.map((r) => JSON.stringify(r!.rows))).size === 1);
    const order = res[0].rows.map((r) => r.name).join(',');
    check('finish order matches the driving', order === 'R1,R2,R3,R4', order);
    check('times come from the server and differ correctly', res[0].rows.every((r, i, l) => r.time !== null && (i === 0 || r.time > l[i - 1].time!)), res[0].rows.map((r) => r.time?.toFixed(1)).join(' / '));
  }
  check('every player saw every other car', bots.every((x) => bots.every((y) => x === y || x.seen.has(y.id))));
  const tm = b.times.get(a.id) ?? [];
  const perSec = tm.length / secs;
  const mono = tm.every((t, i) => i === 0 || t >= tm[i - 1]);
  check('both samples of a message are forwarded, in order', perSec > 15 && mono, `${perSec.toFixed(1)} samples/s of one car, ${(b.snaps / secs).toFixed(1)} frames/s`);
  void wire0;
  void c;

  const use = await debug('info', a.roomId);
  check('resource use of this room is small', !!use && use.written < 150 && use.received < 5000, `${use?.received} incoming messages = ${Math.ceil((use?.received ?? 0) / 20)} billed requests, ${use?.written} rows written, ${secs.toFixed(0)} s of driving, 4 players`);

  // rematch in the same room, one player does not come back from the results
  check('the room returns to the lobby', await until(() => a.room?.status === 'lobby', 3000));
  const from = bots.map((x) => x.msgs.length);
  for (const x of bots.slice(0, 3)) x.cmd('back');
  await sleep(200);
  for (const x of bots.slice(0, 3)) x.cmd('ready', { v: true });
  const m2 = await loadAll(bots.slice(0, 3), from);
  check('rematch starts without the player who stayed away', m2.roster.length === 3 && (await until(() => d.last('error')?.code === 'afk', 2000)));
  check('the next race is on another track', m2.mapId !== match.mapId, `${match.mapId} → ${m2.mapId}`);
  bots.forEach((x) => x.leave());
}

async function testPrivate() {
  console.log('\n[4] Private rooms');
  const h = new Bot('Host');
  check('private room is created', await h.create({ maxPlayers: 3, name: 'Mine' }));
  const code = h.room!.code!;
  check('the host gets a short random code', /^[A-Z2-9]{6}$/.test(code), code);
  const q = new Bot('Quick');
  await q.quick();
  check('private rooms are not offered to Quick Play', !(await q.menu.wait('match', 1500)));
  q.menu.ws.close();
  const f1 = new Bot('Friend1');
  check('wrong code', (await f1.join('ZZZZZZ')) === 'badCode');
  check('malformed code', (await f1.join('12')) === 'badCode' && (await f1.join("' OR 1=1")) === 'badCode');
  check('join by code (case and spaces do not matter)', (await f1.join(` ${code.toLowerCase().slice(0, 3)}-${code.slice(3)} `)) === 'ok' && f1.roomId === h.roomId);
  check('everybody sees the code to invite others', f1.room?.code === code);
  const f2 = new Bot('Friend2');
  check('third player joins', (await f2.join(code)) === 'ok');
  const f3 = new Bot('Friend3');
  check('full room', (await f3.join(code)) === 'roomFull');
  // lobby rules
  f1.cmd('settings', { s: { ...SETTINGS, laps: 5 } });
  check('only the host changes settings', await until(() => f1.last('error')?.code === 'notHost', 2000));
  f1.cmd('start');
  f1.cmd('kick', { id: h.id });
  await sleep(300);
  check('only the host starts and kicks', h.room!.status === 'lobby' && !h.closed);
  h.cmd('settings', { s: { ...SETTINGS, name: 'Mine', maxPlayers: 4, mapId: 'ocean', laps: 1 } });
  check('settings reach everybody immediately', await until(() => f1.room?.settings.mapId === 'ocean' && f2.room?.settings.maxPlayers === 4, 2000));
  f1.cmd('profile', { p: { ...profile('Friend1'), carId: 'nope', paint: { color: '#00ff00', accent: 'red' } } });
  f1.cmd('profile', { p: { ...profile('New<b>‮Name'), paint: { color: '#00ff00', accent: '#ff0000' } } });
  check('car, colour and name changes reach everybody (cleaned)', await until(() => h.room?.players.find((p) => p.id === f1.id)?.paint?.color === '#00ff00', 2000), h.room?.players.find((p) => p.id === f1.id)?.name);
  h.cmd('start');
  check('cannot start before everybody is ready', await until(() => h.last('error')?.code === 'notReady', 2000));
  f1.cmd('ready', { v: true });
  f2.cmd('ready', { v: true });
  check('ready status reaches everybody', await until(() => h.room!.players.every((p) => p.ready), 2000));
  // kick + ban
  h.cmd('kick', { id: f2.id });
  check('kicked player is told', await until(() => f2.msgs.some((m) => m.t === 'kicked'), 2000));
  check('kicked player cannot come straight back', (await new Bot('F2', f2.menu.pid).join(code)) === 'kicked');
  const from = [h, f1].map((x) => x.msgs.length);
  h.cmd('start');
  const match = await loadAll([h, f1], from);
  check('host starts the race', match.mapId === 'ocean' && match.roster.length === 2);
  check('nobody joins a running race', (await new Bot('Late').join(code)) === 'inProgress');
  // host leaves in the middle: the race goes on, somebody else becomes host
  await sleep(4100);
  await drive([h, f1], match, [40, 40], () => false, 1500);
  h.leave();
  check('the host leaving does not end the race', await until(() => f1.msgs.some((m) => m.t === 'left') && f1.room?.hostId === f1.id, 3000));
  f1.cmd('close');
  check('closing the room', await until(() => f1.msgs.some((m) => m.t === 'closed'), 2000));
  check('code of a closed room is dead', (await new Bot('Ghost').join(code)) === 'badCode');
}

async function testReconnect() {
  console.log('\n[5] Disconnect, reconnect, restart of the server object');
  const h = new Bot('Hana');
  await h.create({ laps: 2 });
  const f = new Bot('Finn');
  await f.join(h.room!.code!);
  const x = new Bot('Xena');
  await x.join(h.room!.code!);
  f.cmd('ready', { v: true });
  x.cmd('ready', { v: true });
  await sleep(200);
  h.cmd('start');
  const match = await loadAll([h, f, x]);
  await sleep(4200);
  const bots = [h, f, x];
  let t0 = Date.now();
  const track = trackFor(match.mapId);
  const lanes = bots.map((b) => {
    const sp = gridSpot(track, match.roster.find((r) => r.id === b.id)!.slot, 3, false);
    return { d: sp.d, lat: sp.lat };
  });
  let last = performance.now();
  /** drives everybody for a while; closed sockets keep "driving" locally like a browser does */
  const go = async (ms: number, who = bots) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      await sleep(100);
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      bots.forEach((b, i) => {
        if (!who.includes(b)) return;
        const list = [0.5, 1].map((k) => {
          const p = track.pointAt(lanes[i].d + 40 * dt * k, lanes[i].lat);
          return { t: now - dt * 1000 * (1 - k), x: p.x, z: p.z, heading: p.heading, speed: 40 };
        });
        lanes[i].d += 40 * dt;
        if (!b.closed) b.batch(list);
      });
      bots.forEach(updateStandings);
    }
  };
  const progress = (id: number) => {
    updateStandings(h);
    return h.standings.get(id)?.progress ?? 0;
  };
  await go(2500);
  // cut
  f.ws.terminate();
  check('others see the lost connection', await until(() => h.msgs.some((m) => m.t === 'notice' && m.key === 'dropped' && m.name === 'Finn'), 4000));
  const bad = new Bot('Imposter');
  bad.roomId = f.roomId;
  bad.token = hex(16);
  const r0 = await bad.resume();
  check('a wrong token cannot take over the seat', r0?.t === 'error' && r0.code === 'sessionExpired');
  const p0 = progress(f.id);
  last = performance.now();
  await go(800);
  const idBefore = f.id;
  const r1 = await f.resume(match.id);
  check('the player is back in the same race with the same id', r1?.t === 'welcome' && r1.you === idBefore && f.last('load')?.match.id === match.id);
  check('no duplicate player appears', f.room?.players.length === 3);
  const corr = f.msgs.filter((m) => m.t === 'correct').length;
  last = performance.now();
  await go(2000);
  check('and continues driving after a short outage', progress(f.id) > p0 + 40, `progress ${p0.toFixed(0)} → ${progress(f.id).toFixed(0)}, corrections ${f.msgs.filter((m) => m.t === 'correct').length - corr}`);

  // restart of the room object in the middle of the race
  const before = { h: progress(h.id), boot: (await debug('info', h.roomId))?.boot };
  await go(3300);
  await debug('crash', h.roomId);
  check('restart closes all sockets', await until(() => bots.every((b) => b.closed), 6000));
  t0 = Date.now();
  const res = await Promise.all(bots.map((b) => b.resume(match.id)));
  check('after a restart everybody resumes the same race', res.every((r) => r?.t === 'welcome') && bots.every((b) => b.last('load')?.match.id === match.id), `${Date.now() - t0} ms`);
  const info = await debug('info', h.roomId);
  check('it really was a new object', !!info && info.boot !== before.boot && info.match === 'racing', `${before.boot} → ${info?.boot}`);
  const row = h.last('standings')?.rows.find((r) => r.id === h.id);
  check('progress survived (checkpoint at most 3 s old)', !!row && row.progress > before.h - 40, `${before.h.toFixed(0)} m before, ${row?.progress.toFixed(0)} m restored`);
  check('the race clock survived', h.last('go')!.at === h.msgs.find((m) => m.t === 'go')!.at);
  // continue from the server's position, as the browser does after a correction
  for (let i = 0; i < 3; i++) lanes[i].d = (bots[i].last('load')!.match.resume!.progress + track.length) % track.length;
  last = performance.now();
  await go(1500);
  const p1 = progress(h.id);
  // standings are sent per checkpoint (an eighth of a lap)
  await go(9000);
  check('the race goes on after the restart', progress(h.id) > p1 + 200, `${p1.toFixed(0)} → ${progress(h.id).toFixed(0)}`);

  // one player stays away for good
  x.ws.terminate();
  const t2 = Date.now();
  const p = go(34000, [h, f]);
  const left = await until(() => h.msgs.some((m) => m.t === 'left' && m.id === x.id), 34000, 100);
  check('a player who does not return is removed after the grace time', left, `${((Date.now() - t2) / 1000).toFixed(0)} s`);
  await p;
  const late = await x.resume(match.id);
  check('too late: the session has expired', late?.t === 'error' && late.code === 'sessionExpired');
  // results reach a player who was away at the moment of the finish
  f.ws.terminate();
  const done = until(() => h.msgs.some((m) => m.t === 'results' || (m.t === 'standings' && m.rows.find((r) => r.id === h.id)?.finished === true)), 120000, 100);
  const pump = (async () => {
    while (!h.msgs.some((m) => m.t === 'results') && Date.now() - t2 < 170000) await go(500, [h]);
  })();
  await done;
  await pump;
  const gotH = h.last('results');
  check('race ended with results', !!gotH);
  h.leave();
}

async function testLateResults() {
  console.log('\n[6] Reconnecting right after the finish');
  const h = new Bot('Hal');
  await h.create({ laps: 1, mode: 'battle', minutes: 1 });
  const f = new Bot('Flo');
  await f.join(h.room!.code!);
  f.cmd('ready', { v: true });
  await sleep(200);
  h.cmd('start');
  const match = await loadAll([h, f]);
  check('battle mode starts online', match.mode === 'battle' && match.mapId === 'arena');
  const go = h.last('go')!.at;
  void go;
  await sleep(4200);
  await drive([h, f], match, [0, 0], () => false, 46000);
  f.ws.terminate();
  // nobody sends anything now: the alarm must end the battle
  const ended = await until(() => h.msgs.some((m) => m.t === 'results'), 25000, 100);
  check('the battle ends on time even when nobody sends anything', ended);
  const r = await f.resume(match.id);
  check('a player who was away gets the results afterwards', r?.t === 'welcome' && (await until(() => f.msgs.some((m) => m.t === 'results'), 2000)));
  check('both see the same results', JSON.stringify(h.last('results')?.rows) === JSON.stringify(f.last('results')?.rows));
  const r2 = await f.resume('deadbeef');
  check('a race the room does not know any more sends the player to the lobby', r2?.t === 'welcome' && (await until(() => f.last('abort')?.key === 'matchLost', 2000)));
  h.leave();
  f.leave();
}

async function testParallel() {
  console.log('\n[7] Several rooms and races at the same time, 8 players in one race');
  const rooms: Bot[][] = [];
  for (let r = 0; r < 3; r++) {
    const n = r === 0 ? 8 : 2;
    const h = new Bot(`H${r}`);
    await h.create({ name: `Room ${r}`, mapId: ['city', 'desert', 'candy'][r] });
    const others: Bot[] = [];
    for (let i = 1; i < n; i++) {
      const b = new Bot(`P${r}${i}`);
      const j = await b.join(h.room!.code!);
      if (j !== 'ok') check(`room ${r} join ${i}`, false, j);
      others.push(b);
    }
    rooms.push([h, ...others]);
  }
  check('8 players in one lobby', await until(() => rooms[0][0].room?.players.length === 8, 3000));
  check('9th player is refused', (await new Bot('Ninth').join(rooms[0][0].room!.code!)) === 'roomFull');
  check('rooms are separate objects', new Set(rooms.map((r) => r[0].roomId)).size === 3);
  const matches = await Promise.all(
    rooms.map(async (r) => {
      r.slice(1).forEach((b) => b.cmd('ready', { v: true }));
      await sleep(300);
      r[0].cmd('start');
      return loadAll(r);
    }),
  );
  await sleep(4200);
  rooms.flat().forEach((b) => {
    b.snaps = b.entries = 0;
    b.times.clear();
  });
  const t0 = Date.now();
  await Promise.all(rooms.map((r, i) => drive(r, matches[i], r.map((_, k) => 45 - k), () => false, 8000)));
  const s = (Date.now() - t0) / 1000;
  const big = rooms[0][3];
  const hz = [...big.times].filter(([id]) => id !== big.id).map(([, t]) => t.length / s);
  check('all races run at the same time', rooms.every((r) => r.every((b) => r.every((o) => o === b || b.seen.has(o.id)))));
  check('8-player race: every car arrives at full rate', hz.length === 7 && Math.min(...hz) > 14, `${Math.min(...hz).toFixed(1)}–${Math.max(...hz).toFixed(1)} samples/s per car, ${(big.snaps / s).toFixed(1)} frames/s`);
  check('nothing leaks between rooms', rooms[1][0].seen.size <= 2 && rooms.every((r) => r.every((b) => b.room!.players.length === r.length)));
  check('no honest driver was corrected', rooms.flat().every((b) => !b.msgs.some((m) => m.t === 'correct')));
  rooms.flat().forEach((b) => b.leave());
}

async function testAbuse() {
  console.log('\n[8] Invalid traffic');
  const h = new Bot('Hugo');
  await h.create();
  const f = new Bot('Fred');
  await f.join(h.room!.code!);
  for (const bad of ['', '{', '[]', 'null', '"x"', '{"t":5}', '{"t":"nope"}', '{"t":"ready"}', '{"t":"settings","n":1e99,"s":{}}', '{"t":"kick","n":-1,"id":0}']) f.send(bad);
  f.ws.send(Buffer.from([9, 9, 9]));
  f.ws.send(Buffer.alloc(4));
  f.ws.send(Buffer.from([3, 0, 0, 200]));
  await sleep(400);
  check('garbage changes nothing and disconnects nobody', !f.closed && h.room?.players.length === 2);
  const early = new Sock<ServerMsg>();
  await early.open(`${base}/room/${h.roomId}`);
  early.send({ t: 'ready', n: 1, v: true });
  await until(() => early.closed, 3000);
  check('commands before hello are refused', early.last('error')?.code === 'badMessage');
  const noTicket = new Bot('NoTicket');
  await noTicket.enter({ roomId: h.roomId, ticket: hex(16) });
  check('an invented ticket is refused (knowing the room id is not enough)', noTicket.last('error')?.code === 'sessionExpired');
  const silent = new Sock<ServerMsg>();
  await silent.open(`${base}/room/${h.roomId}`);
  check('a socket that never says hello is closed', await until(() => silent.closed, 14000, 100));
  f.send('x'.repeat(5000));
  check('an oversized message closes the connection', await until(() => f.closed, 3000));
  const m = new Menu();
  await m.start();
  for (let i = 0; i < 60; i++) m.send({ t: 'find' });
  check('flooding the matchmaker disconnects', await until(() => m.closed, 3000));
  const flood = new Bot('Flood');
  await flood.join(h.room!.code!);
  for (let i = 0; i < 400; i++) flood.send({ t: 'ready', n: ++flood.n, v: true });
  check('flooding a room disconnects and bans for a while', await until(() => flood.closed, 4000));
  check('…so reconnecting does not help', (await flood.resume())?.t === 'error');
  check('the host is not affected', !h.closed);
  h.send('ping');
  check('platform ping is answered', await until(() => h.pongs > 0, 2000));
  h.leave();
}

async function testHibernation() {
  console.log('\n[9] Idle lobby: hibernation, slow loader, room timeout');
  const h = new Bot('Hib');
  await h.create();
  const f = new Bot('Fib');
  await f.join(h.room!.code!);
  f.cmd('ready', { v: true });
  await sleep(300);
  const b0 = (await debug('info', h.roomId))?.boot;
  // only platform pings for a while: the object may be put to sleep
  const end = Date.now() + 22000;
  while (Date.now() < end) await sleep(500);
  const b1 = await debug('info', h.roomId);
  check('an idle lobby hibernates (the object is rebuilt on demand)', !!b1 && b1.boot !== b0, `${b0} → ${b1?.boot}`);
  check('sockets stay open and players are still known', !h.closed && !f.closed && b1?.players === 2 && b1.sockets === 2);
  h.cmd('settings', { s: { ...SETTINGS, mapId: 'candy', laps: 1 } });
  check('the lobby works after waking up', await until(() => f.room?.settings.mapId === 'candy', 3000) && f.room?.hostId === h.id);
  const g = new Bot('Slow');
  check('joining works after waking up', (await g.join(h.room!.code!)) === 'ok');
  f.cmd('ready', { v: true });
  g.cmd('ready', { v: true });
  await sleep(300);
  const from = [h, f, g].map((x) => x.msgs.length);
  h.cmd('start');
  await Promise.all([h, f, g].map((x, i) => x.wait('load', 5000, from[i])));
  h.cmd('loaded');
  f.cmd('loaded');
  const t0 = Date.now();
  const ok = await until(() => h.msgs.slice(from[0]).some((m) => m.t === 'go'), 32000, 100);
  check('a player who cannot load does not block the others', ok && (await until(() => g.last('error')?.code === 'afk', 2000)), `${((Date.now() - t0) / 1000).toFixed(0)} s`);
  h.leave();
  f.leave();
  check('an empty room disappears', await until(async () => (await debug('info', h.roomId))?.status === null, 4000, 200));
}

async function testGuessing() {
  console.log('\n[10] Guessing room codes');
  const g = new Bot('Guesser');
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) {
    limited = (await g.join('AAAAA' + 'BCDEFGHJKMNP'[i])) === 'rateLimit';
    await sleep(260);
  }
  check('guessing codes is rate limited', limited);
}

async function testLimits() {
  console.log('\n[11] Own limits: rooms per day, idle rooms');
  const h = new Bot('L1');
  check('first room of the day works', await h.create());
  const b = new Bot('L2');
  await b.menu.start();
  b.menu.send({ t: 'create', settings: SETTINGS });
  check('second room hits the configured daily limit: service limit', await until(() => b.menu.last('error')?.code === 'serviceLimit', 3000));
  const c = new Bot('L3');
  const d = new Bot('L4');
  await c.quick();
  await d.quick();
  check('Quick Play says so too instead of searching forever', await until(() => c.menu.last('error')?.code === 'serviceLimit' && d.menu.last('error')?.code === 'serviceLimit', 4000));
  check('an abandoned lobby is closed after ROOM_TIMEOUT', await until(() => h.msgs.some((m) => m.t === 'closed' && m.reason === 'idle'), 12000, 100));
}

async function main() {
  const tests: [string, () => Promise<void>][] = [
    ['entry', testEntry], ['queue', testQueue], ['race', testRace], ['private', testPrivate], ['reconnect', testReconnect],
    ['late', testLateResults], ['parallel', testParallel], ['abuse', testAbuse], ['hibernation', testHibernation], ['guessing', testGuessing],
  ];
  let w: LocalWorker | null = null;
  try {
    if (!only.length || only.some((x) => x !== 'limits')) {
      w = await startWorker(PORT, { MATCHMAKING_TIMEOUT: '8', LOBBY_COUNTDOWN: '12' });
      for (const [name, f] of tests) {
        if (only.length && !only.includes(name)) continue;
        try {
          await f();
        } catch (e) {
          check(`${name} completed`, false, String((e as Error).stack ?? e).slice(0, 400));
        }
      }
      const bad = w.output().split('\n').filter((l) => /Uncaught|TypeError|ReferenceError|✘/.test(l) && !/test crash/.test(l));
      check('no exceptions in the Worker', bad.length === 0, bad.slice(0, 3).join(' | '));
      w.stop();
    }
    if (!only.length || only.includes('limits')) {
      base = `ws://127.0.0.1:${PORT + 10}`;
      w = await startWorker(PORT + 10, { MAX_ROOMS_PER_DAY: '1', ROOM_TIMEOUT: '6' });
      await testLimits();
    }
  } catch (e) {
    check('tests completed', false, String((e as Error).stack ?? e).slice(0, 600));
  } finally {
    if (process.env.RMR_WORKER_LOG) console.log(w?.output());
    w?.stop();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} online checks passed`);
  for (const f of failed) console.log('  ✘', f.name);
  process.exit(failed.length ? 1 : 0);
}

void main();
