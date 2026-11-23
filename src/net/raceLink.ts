/**
 * Bridge between a running Game (3D engine) and the network session.
 *
 * The engine only ever talks to this object: it reads the host clock, remote car states and the
 * authoritative standings, pushes its own car state and item / hit events, and drains a queue of
 * incoming events once per frame. The network code never reaches into the engine.
 */
import { NET } from './config';
import type { Connection } from './connection';
import { decodeSnapshot, newCarState, type CarState, type HitKind, type ItemEvent, type MatchInfo, type StandingInfo } from './protocol';
import { LocalSender, RemoteBuffer } from './sync';

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
  private readonly sender = new LocalSender();
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
    private readonly conn: Connection,
    private readonly nextN: () => number,
  ) {
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
    decodeSnapshot(view, this.scratch, (id, s) => this.remotes.get(id)?.push(s));
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
    return !!b && b.sample(this.now() - NET.INTERP_DELAY_MS, out);
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
