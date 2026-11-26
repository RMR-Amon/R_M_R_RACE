/**
 * Bridge between a running Game (3D engine) and the network session.
 *
 * The engine only ever talks to this object: it reads the host clock, remote car states and the
 * authoritative standings, pushes its own car state and item / hit events, and drains a queue of
 * incoming events once per frame. The network code never reaches into the engine.
 */
import { NET, ONLINE } from './config';
import { decodeSnapshot, newCarState, type CarState, type ClientMsg, type HitKind, type ItemEvent, type MatchInfo, type StandingInfo } from './protocol';
import { BatchSender, LocalSender, RemoteBuffer } from './sync';

/** what the race needs from the connection (see connection.ts) */
export interface RaceConn {
  readonly rtt: number;
  readonly state: 'connecting' | 'open' | 'reconnecting' | 'closed';
  serverNow(): number;
  send(msg: ClientMsg): void;
  sendBinary(buf: ArrayBuffer): void;
}

export type RaceEvent =
  | { k: 'item'; from: number; e: ItemEvent }
  | { k: 'hit'; victim: number; owner: number; shot: number; kind: HitKind }
  | { k: 'left'; id: number }
  | { k: 'correct'; x: number; y: number; z: number; heading: number };

export class RaceLink {
  /** the host's "green light" time (host clock, ms); null while players are still loading */
  goAt: number | null = null;
  readonly standings = new Map<number, StandingInfo>();
  /** bumped on every standings update */
  standingsVersion = 0;
  private readonly remotes = new Map<number, RemoteBuffer>();
  private readonly sender: LocalSender | BatchSender;
  /** how far in the past remote cars are drawn; online it follows the measured network */
  private delay: number = NET.INTERP_DELAY_MS;
  private lateAvg = -1;
  private lateDev = 0;
  private delayAt = performance.now();
  private readonly scratch = newCarState();
  private events: RaceEvent[] = [];
  private shot = 0;
  private loadedSent = false;
  disposed = false;
  // ---- monitoring: packets per second in both directions (1 s windows)
  private rxCount = 0;
  private txCount = 0;
  private winStart = performance.now();
  /** snapshots received per second (≈ host network tick while cars move) */
  rxHz = 0;
  /** own car states sent per second */
  txHz = 0;

  constructor(
    readonly info: MatchInfo,
    readonly localId: number,
    private readonly conn: RaceConn,
    private readonly nextN: () => number,
  ) {
    this.sender = info.net ? new BatchSender(info.net.sampleHz, info.net.sendHz, ONLINE.MAX_BATCH) : new LocalSender();
    for (const r of info.roster) if (r.id !== localId) this.remotes.set(r.id, new RemoteBuffer());
    if (info.goAt !== undefined) this.goAt = info.goAt;
  }

  /** host clock in ms */
  now() {
    return this.conn.serverNow();
  }

  get rtt() {
    return this.conn.rtt;
  }

  get connState() {
    return this.conn.state;
  }

  /** the 3D scene is built: tell the host we are ready for the countdown */
  loaded() {
    if (this.loadedSent) return;
    this.loadedSent = true;
    this.conn.send({ t: 'loaded', n: this.nextN() });
  }

  // ------------------------------------------------------------------ incoming (called by the session)

  onSnapshot(view: DataView) {
    this.rxCount++;
    if (!this.info.net) {
      decodeSnapshot(view, this.scratch, (id, s) => this.remotes.get(id)?.push(s));
      return;
    }
    const now = this.now();
    let newest = -Infinity;
    decodeSnapshot(view, this.scratch, (id, s) => {
      const b = this.remotes.get(id);
      if (!b) return;
      // repeated keyframes carry an old timestamp: they say nothing about the network
      if (s.t > b.newest && s.t > newest) newest = s.t;
      b.push(s);
    });
    if (newest > -Infinity) this.measure(now - newest);
  }

  /** lateness of a fresh sample (transit + jitter): running average and mean deviation */
  private measure(late: number) {
    if (late < -200 || late > 2000) return;
    if (this.lateAvg < 0) {
      this.lateAvg = Math.max(0, late);
      this.lateDev = 20;
      this.delay = this.target();
      return;
    }
    const d = late - this.lateAvg;
    this.lateAvg += d * 0.08;
    this.lateDev += (Math.abs(d) - this.lateDev) * 0.08;
  }

  /** the next message must normally arrive before the drawn moment catches up with the newest sample */
  private target() {
    const gap = 1000 / (this.info.net?.sendHz ?? NET.SNAPSHOT_HZ);
    return Math.min(ONLINE.INTERP_MAX_MS, Math.max(ONLINE.INTERP_MIN_MS, this.lateAvg + gap + this.lateDev * 3 + 10));
  }

  /** moves the delay slowly, so cars never visibly jump: 8 % faster / 5 % slower playback at most */
  private tickDelay() {
    const now = performance.now();
    const dt = Math.min(100, now - this.delayAt);
    this.delayAt = now;
    if (!this.info.net || this.lateAvg < 0) return;
    const d = this.target() - this.delay;
    this.delay += Math.max(-0.05 * dt, Math.min(0.08 * dt, d));
  }

  /** current interpolation delay in ms (monitoring / tests) */
  get interpDelay() {
    return Math.round(this.delay);
  }

  onStandings(rows: StandingInfo[]) {
    for (const r of rows) this.standings.set(r.id, r);
    this.standingsVersion++;
  }

  onGo(at: number) {
    this.goAt = at;
  }

  queue(ev: RaceEvent) {
    if (ev.k === 'left') {
      this.remotes.delete(ev.id);
      this.standings.delete(ev.id);
    }
    this.events.push(ev);
  }

  // ------------------------------------------------------------------ used by the engine

  /** interpolated state of a remote car at "now − INTERP_DELAY" */
  sampleRemote(id: number, out: CarState): boolean {
    const b = this.remotes.get(id);
    return !!b && b.sample(this.now() - this.delay, out);
  }

  /** hands all events received since the last call to the engine */
  drain(): RaceEvent[] {
    if (!this.events.length) return EMPTY;
    const e = this.events;
    this.events = [];
    return e;
  }

  /** the engine calls this every frame; packets leave at most at CLIENT_SEND_HZ */
  pushLocal(s: CarState): boolean {
    const buf = this.sender.next(s, performance.now());
    this.tickStats();
    this.tickDelay();
    if (!buf) return false;
    this.conn.sendBinary(buf);
    this.txCount++;
    return true;
  }

  private tickStats() {
    const now = performance.now();
    const span = now - this.winStart;
    if (span < 1000) return;
    this.rxHz = Math.round((this.rxCount * 1000) / span);
    this.txHz = Math.round((this.txCount * 1000) / span);
    this.rxCount = this.txCount = 0;
    this.winStart = now;
  }

  nextShot() {
    this.shot = (this.shot + 1) & 0xffffff;
    return this.shot;
  }

  sendItem(e: ItemEvent) {
    this.conn.send({ t: 'item', n: this.nextN(), e });
  }

  sendHit(owner: number, shot: number, kind: HitKind) {
    this.conn.send({ t: 'hit', n: this.nextN(), owner, shot, kind });
  }

  get packetsSent() {
    return this.sender.sent;
  }
}

const EMPTY: RaceEvent[] = [];
