/**
 * Match manager — the authority over a running race / battle.
 *
 * Every browser simulates its own car (instant controls) and streams its state; the host
 * validates each state against the real track and the car's limits and only then accepts it.
 * From accepted states alone the host computes progress, checkpoints, laps, places, finish
 * order, battle points and the final results. A browser cannot finish, score or teleport on
 * its own say-so: rejected states are answered with a correction back to the last valid one.
 */
import crypto from 'node:crypto';
import { NET } from '../src/net/config';
import {
  F2_TELEPORT,
  F_FALLING,
  copyCarState,
  decodeState,
  encodeSnapshot,
  newCarState,
  type CarState,
  type HitKind,
  type ItemEvent,
  type MatchInfo,
  type PlayerStatus,
  type ResultInfo,
  type RosterEntry,
  type RoomSettings,
  type ServerMsg,
  type StandingInfo,
} from '../src/net/protocol';
import { gridSpot, startProgress, type GridSpot } from '../src/game/grid';
import type { Track } from '../src/game/track';
import { carColor, mapTheme, speedLimit, trackFor } from './gameData';
import { log } from './log';

/** half the kerb width plus the slack a car may poke over the road edge */
const ROAD_SLACK = 1.8 + 2.5;
const SHOT_TTL_PROJECTILE = 15000;
const SHOT_TTL_HAZARD = 120000;
const PLACE_REWARD = [500, 350, 250, 160, 110, 70, 50, 40];

export interface MatchHost {
  broadcast(msg: ServerMsg, exceptId?: number): void;
  broadcastBinary(bytes: Uint8Array): void;
  sendTo(id: number, msg: ServerMsg): void;
  /** the match is over: results go to everybody and the room returns to the lobby */
  onEnd(results: ResultInfo[] | null, abort?: { key: 'loadFailed'; name: string }): void;
}

interface Shot {
  kind: HitKind;
  at: number;
  used: boolean;
}

class MCar {
  readonly s: CarState = newCarState();
  dirty = true;
  lastSent = 0;
  loaded = false;
  status: PlayerStatus = 'online';
  progress: number;
  lastD: number;
  index: number;
  lat: number;
  cp = 0;
  lap = 1;
  place: number;
  finished = false;
  finishTime: number | null = null;
  points = 0;
  hits = 0;
  // ---- client clock tracking (anti speed-hack time budget + interpolation timing)
  seq = -1;
  ct0 = -1;
  st0 = 0;
  lastCt = 0;
  /** smallest (server receive time − client time) seen: maps client times onto the host clock */
  offset = Infinity;
  // ---- validation
  violations = 0;
  lastCorrect = 0;
  // ---- items
  credits = 0;
  iceLeft = 0;
  lastShot = -1;
  lastItemAt = 0;
  shots = new Map<number, Shot>();
  boxCooldown = new Map<number, number>();

  constructor(
    readonly entry: RosterEntry,
    readonly spot: GridSpot,
    readonly vmax: number,
    start: number,
    proj: { index: number; d: number; lat: number },
  ) {
    this.progress = start;
    this.lastD = proj.d;
    this.index = proj.index;
    this.lat = proj.lat;
    this.place = entry.slot + 1;
    this.s.x = spot.x;
    this.s.z = spot.z;
    this.s.heading = spot.heading;
  }
}

export class Match {
  readonly id = crypto.randomBytes(4).toString('hex');
  readonly info: MatchInfo;
  phase: 'loading' | 'countdown' | 'racing' | 'over' = 'loading';
  goAt = 0;
  private readonly track: Track;
  private readonly battle: boolean;
  private readonly laps: number;
  private readonly durationMs: number;
  private readonly L: number;
  private cars = new Map<number, MCar>();
  private loadDeadline: number;
  private finishDeadline = 0;
  private standingsDirty = true;
  private lastStandings = 0;
  private readonly tmp = newCarState();
  private readonly sendList: { id: number; s: CarState }[] = [];

  constructor(
    private readonly host: MatchHost,
    settings: RoomSettings,
    roster: RosterEntry[],
    now: number,
  ) {
    this.battle = settings.mode === 'battle';
    const mapId = this.battle ? 'arena' : settings.mapId;
    this.track = trackFor(mapId);
    this.L = this.track.length;
    this.laps = this.battle ? 0 : settings.laps;
    this.durationMs = this.battle ? settings.minutes * 60000 : 0;
    this.info = {
      id: this.id,
      mode: settings.mode,
      mapId,
      theme: this.battle ? settings.theme : mapTheme(mapId),
      laps: this.laps,
      duration: this.durationMs / 1000,
      items: settings.items,
      roster,
    };
    for (const e of roster) {
      const spot = gridSpot(this.track, e.slot, roster.length, this.battle);
      const proj = this.track.project(spot.x, spot.z);
      this.cars.set(e.id, new MCar(e, spot, speedLimit(e.carId), startProgress(this.track, spot, this.battle), proj));
    }
    this.loadDeadline = now + NET.LOAD_TIMEOUT_MS;
  }

  has(id: number) {
    return this.cars.has(id);
  }

  get size() {
    return this.cars.size;
  }

  setStatus(id: number, status: PlayerStatus) {
    const c = this.cars.get(id);
    if (c && c.status !== status) {
      c.status = status;
      this.standingsDirty = true;
    }
  }

  /** info for a player that (re)joins this match while it is running */
  resumeInfo(id: number): MatchInfo {
    const c = this.cars.get(id);
    const base = { ...this.info, goAt: this.phase === 'loading' ? undefined : this.goAt };
    if (!c) return base;
    // the new page has a new clock: start the time budget over
    c.seq = -1;
    c.ct0 = -1;
    c.offset = Infinity;
    return { ...base, resume: { x: c.s.x, z: c.s.z, heading: c.s.heading, progress: c.progress } };
  }

  onLoaded(id: number) {
    const c = this.cars.get(id);
    if (c) c.loaded = true;
  }

  remove(id: number) {
    if (!this.cars.delete(id)) return;
    this.standingsDirty = true;
    this.host.broadcast({ t: 'left', id });
  }

  // ---------------------------------------------------------------------------------------- car state

  onState(id: number, view: DataView, now: number) {
    const c = this.cars.get(id);
    if (!c || this.phase === 'loading' || this.phase === 'over') return;
    const s = this.tmp;
    const seq = decodeState(view, s);
    if (seq < 0) return;
    // drop duplicates and out-of-order frames (16-bit wrap-around aware)
    if (c.seq >= 0) {
      const diff = (seq - c.seq) & 0xffff;
      if (diff === 0 || diff > 0x8000) return;
    }
    c.seq = seq;
    if (![s.x, s.z, s.y, s.heading, s.speed].every(Number.isFinite) || Math.abs(s.x) > 3000 || Math.abs(s.z) > 3000) {
      this.reject(c, now, 'bad numbers');
      return;
    }

    // client time budget: a client may not claim more elapsed time than really passed on the host
    if (c.ct0 < 0) {
      c.ct0 = s.t;
      c.st0 = now;
      c.lastCt = s.t - 1000 / NET.CLIENT_SEND_HZ;
    }
    const ct = Math.min(s.t, c.ct0 + (now - c.st0) + 500);
    const dt = Math.min(1.5, Math.max(0.001, (ct - c.lastCt) / 1000));
    c.offset = Math.min(c.offset, now - s.t);

    if (this.phase === 'countdown' && now < this.goAt) {
      // on the grid: the car may roll a little (bumps) but must not leave its spot
      if (Math.hypot(s.x - c.spot.x, s.z - c.spot.z) > 5) {
        this.correctTo(c, now, c.spot.x, 0, c.spot.z, c.spot.heading);
        return;
      }
      this.accept(c, s, ct, now, 0);
      return;
    }

    const tr = this.track;
    const pr = tr.project(s.x, s.z, c.index);
    let delta = pr.d - c.lastD;
    if (delta > this.L / 2) delta -= this.L;
    if (delta < -this.L / 2) delta += this.L;
    const moved = Math.hypot(s.x - c.s.x, s.z - c.s.z);
    const allowed = c.vmax * dt * 1.5 + 4;
    const teleport = (s.flags2 & F2_TELEPORT) !== 0;
    const gap = tr.gap;
    const inGapZone = (d: number) => !!gap && d > gap.gapStart - 30 && d < gap.gapEnd + 6;

    let reason = '';
    if (Math.abs(s.speed) > c.vmax + 2) reason = 'speed';
    else if (s.y > 16 || s.y < -120) reason = 'height';
    else if (moved > allowed) {
      // legal jumps: the respawn after a fall into the chasm, and the "stuck" respawn in place
      const gapRespawn = teleport && gap && inGapZone(c.lastD) && tr.ahead(gap.gapEnd, pr.d) < 30;
      const inPlace = teleport && Math.abs(delta) < 8 && moved < tr.halfWidth + 6;
      if (!gapRespawn && !inPlace) reason = `moved ${moved.toFixed(1)}m > ${allowed.toFixed(1)}m`;
    }
    if (!reason) {
      if (tr.oval) {
        if (tr.ovalValue(s.x, s.z) > 1.2) reason = 'outside arena';
      } else if (Math.abs(pr.lat) > tr.halfWidth + ROAD_SLACK && !((s.flags & F_FALLING) && inGapZone(pr.d))) {
        reason = 'off road';
      }
    }
    if (reason) {
      this.reject(c, now, reason);
      return;
    }

    const prevD = c.lastD;
    c.lastD = pr.d;
    c.index = pr.index;
    c.lat = pr.lat;
    this.accept(c, s, ct, now, this.battle ? 0 : delta);
    if (this.info.items) this.collectBoxes(c, prevD, delta, now);

    if (!this.battle) {
      const cp = Math.floor(Math.max(0, c.progress) / (this.L / NET.CHECKPOINTS));
      if (cp > c.cp) {
        c.cp = cp;
        this.standingsDirty = true;
      }
      const lap = Math.min(this.laps, Math.max(1, Math.floor(c.progress / this.L) + 1));
      if (lap !== c.lap) {
        c.lap = lap;
        this.standingsDirty = true;
      }
      // the lap only counts with every checkpoint of every lap passed in order
      if (!c.finished && this.phase === 'racing' && c.progress >= this.laps * this.L && c.cp >= this.laps * NET.CHECKPOINTS) {
        c.finished = true;
        c.finishTime = Math.max(0, (now - this.goAt) / 1000);
        this.standingsDirty = true;
        if (!this.finishDeadline) this.finishDeadline = now + NET.FINISH_GRACE_MS;
        log.info(`match ${this.id}: ${c.entry.name} finished in ${c.finishTime.toFixed(2)}s`);
      }
    }
  }

  private accept(c: MCar, s: CarState, ct: number, now: number, delta: number) {
    copyCarState(c.s, s);
    // timestamp on the host clock, used by the clients to interpolate
    c.s.t = Math.min(now, ct + c.offset);
    c.lastCt = ct;
    c.progress += delta;
    c.dirty = true;
  }

  private reject(c: MCar, now: number, reason: string) {
    c.violations++;
    if (c.violations % 20 === 1) log.warn(`match ${this.id}: rejected state of ${c.entry.name} (${reason}), ${c.violations} so far`);
    this.correctTo(c, now, c.s.x, c.s.y, c.s.z, c.s.heading);
  }

  private correctTo(c: MCar, now: number, x: number, y: number, z: number, heading: number) {
    // a burst of rejected frames needs only one correction
    if (now - c.lastCorrect < 400) return;
    c.lastCorrect = now;
    if (x !== c.s.x || z !== c.s.z) {
      c.s.x = x;
      c.s.z = z;
      c.s.y = y;
      c.s.heading = heading;
      c.dirty = true;
    }
    this.host.sendTo(c.entry.id, { t: 'correct', x, y, z, heading });
  }

  /** lucky blocks: a car that drives through a row of boxes earns the right to use one item */
  private collectBoxes(c: MCar, prevD: number, delta: number, now: number) {
    const tr = this.track;
    if (tr.oval) {
      tr.arenaBoxes.forEach((b, i) => {
        if ((b.x - c.s.x) ** 2 + (b.z - c.s.z) ** 2 > 3.8 * 3.8) return;
        if (now - (c.boxCooldown.get(i) ?? -1e9) < 2400) return;
        c.boxCooldown.set(i, now);
        c.credits = Math.min(2, c.credits + 1);
      });
      return;
    }
    if (delta <= 0 || c.s.y > 6) return;
    for (const row of tr.itemRows) {
      if (tr.ahead(prevD, row) <= delta + 0.5 && Math.abs(c.lat) < tr.halfWidth * 0.66 + 3.5) c.credits = Math.min(2, c.credits + 1);
    }
  }

  // ---------------------------------------------------------------------------------------- items & hits

  onItem(id: number, e: ItemEvent, now: number): boolean {
    const c = this.cars.get(id);
    if (!c || this.phase !== 'racing' || !this.info.items) return false;
    if (e.shot <= c.lastShot || now - c.lastItemAt < 120) return false;
    if (Math.hypot(e.x - c.s.x, e.z - c.s.z) > 25) return false;
    if (e.target !== -1 && (e.target === id || !this.cars.has(e.target))) return false;
    if (e.kind === 'ice' && c.iceLeft > 0) c.iceLeft--;
    else if (c.credits > 0) {
      c.credits--;
      c.iceLeft = e.kind === 'ice' ? 2 : 0;
    } else {
      log.debug(`match ${this.id}: ${c.entry.name} used an item without picking one up`);
      return false;
    }
    c.lastShot = e.shot;
    c.lastItemAt = now;
    if (e.kind === 'missile' || e.kind === 'ice' || e.kind === 'bomb' || e.kind === 'oil') {
      c.shots.set(e.shot, { kind: e.kind, at: now, used: false });
      if (c.shots.size > 40) {
        for (const [k, s] of c.shots) if (s.used || now - s.at > SHOT_TTL_HAZARD) c.shots.delete(k);
        while (c.shots.size > 40) c.shots.delete(c.shots.keys().next().value!);
      }
    }
    this.host.broadcast({ t: 'item', from: id, e }, id);
    return true;
  }

  /** a victim reports being hit; the host checks the shot really exists and was not used yet */
  onHit(victimId: number, ownerId: number, shot: number, kind: HitKind, now: number): boolean {
    if (this.phase !== 'racing' || victimId === ownerId) return false;
    const owner = this.cars.get(ownerId);
    if (!owner || !this.cars.has(victimId)) return false;
    const s = owner.shots.get(shot);
    const ttl = kind === 'bomb' || kind === 'oil' ? SHOT_TTL_HAZARD : SHOT_TTL_PROJECTILE;
    if (!s || s.used || s.kind !== kind || now - s.at > ttl) return false;
    s.used = true;
    owner.points++;
    owner.hits++;
    this.standingsDirty = true;
    this.host.broadcast({ t: 'hit', victim: victimId, owner: ownerId, shot, kind });
    return true;
  }

  // ---------------------------------------------------------------------------------------- tick

  tick(now: number) {
    if (this.phase === 'over') return;
    if (this.phase === 'loading') {
      const all = [...this.cars.values()];
      if (all.length && all.every((c) => c.loaded)) {
        this.phase = 'countdown';
        this.goAt = now + NET.COUNTDOWN_MS;
        this.host.broadcast({ t: 'go', at: this.goAt });
        log.info(`match ${this.id}: all ${all.length} loaded, green light in ${NET.COUNTDOWN_MS} ms`);
      } else if (now > this.loadDeadline || !all.length) {
        const slow = all.filter((c) => !c.loaded).map((c) => c.entry.name).join(', ');
        this.phase = 'over';
        this.host.onEnd(null, { key: 'loadFailed', name: slow });
      }
      return;
    }
    if (this.phase === 'countdown' && now >= this.goAt) this.phase = 'racing';

    this.rank();
    this.flushSnapshot(now);
    if (this.standingsDirty && now - this.lastStandings >= NET.STANDINGS_MIN_MS) {
      this.standingsDirty = false;
      this.lastStandings = now;
      this.host.broadcast({ t: 'standings', rows: this.standings() });
    }

    if (this.phase !== 'racing') return;
    const cars = [...this.cars.values()];
    let over = cars.length === 0;
    if (this.battle) over ||= now >= this.goAt + this.durationMs;
    else over ||= cars.every((c) => c.finished) || (this.finishDeadline > 0 && now >= this.finishDeadline);
    if (over) this.end();
  }

  private flushSnapshot(now: number) {
    const list = this.sendList;
    list.length = 0;
    for (const c of this.cars.values()) {
      if (c.dirty || now - c.lastSent >= NET.KEYFRAME_MS) {
        c.dirty = false;
        c.lastSent = now;
        list.push({ id: c.entry.id, s: c.s });
      }
    }
    if (list.length) this.host.broadcastBinary(encodeSnapshot(now, list, list.length));
  }

  private rank() {
    const sorted = [...this.cars.values()].sort((a, b) => {
      if (this.battle) return b.points - a.points || b.hits - a.hits || a.entry.slot - b.entry.slot;
      if (a.finished && b.finished) return (a.finishTime ?? 0) - (b.finishTime ?? 0);
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((c, i) => {
      if (c.place !== i + 1) {
        c.place = i + 1;
        this.standingsDirty = true;
      }
    });
  }

  standings(): StandingInfo[] {
    return [...this.cars.values()].map((c) => ({
      id: c.entry.id,
      place: c.place,
      lap: c.lap,
      progress: Math.round(c.progress * 10) / 10,
      cp: c.cp,
      finished: c.finished,
      finishTime: c.finishTime,
      points: c.points,
      hits: c.hits,
      status: c.status,
    }));
  }

  private end() {
    this.phase = 'over';
    this.rank();
    const lapMul = 0.5 + this.laps * 0.25;
    const rows: ResultInfo[] = [...this.cars.values()]
      .sort((a, b) => a.place - b.place)
      .map((c) => {
        const base = PLACE_REWARD[c.place - 1] ?? 40;
        const coins = this.battle
          ? Math.round(c.points * 40 + base * 0.6 * (this.durationMs / 120000))
          : Math.round((c.finished ? base * lapMul : base * 0.4) + c.hits * 15);
        return {
          id: c.entry.id,
          name: c.entry.name,
          carId: c.entry.carId,
          color: carColor(c.entry.carId, c.entry.paint),
          place: c.place,
          time: c.finished ? c.finishTime : null,
          points: c.points,
          hits: c.hits,
          coins,
        };
      });
    log.info(`match ${this.id} over: ${rows.map((r) => `${r.place}. ${r.name}`).join(', ')}`);
    this.host.onEnd(rows);
  }

  /** debug / tests */
  inspect(id: number) {
    const c = this.cars.get(id);
    return c ? { progress: c.progress, cp: c.cp, lap: c.lap, finished: c.finished, violations: c.violations, credits: c.credits, place: c.place } : null;
  }
}
