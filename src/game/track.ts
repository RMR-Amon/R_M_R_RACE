import * as THREE from 'three';
import type { MapDef } from '../data/maps';
import { makeRng } from './rng';

export interface TrackSample {
  x: number;
  z: number;
  /** unit tangent (driving direction) */
  tx: number;
  tz: number;
  /** unit normal pointing to the driver's right */
  nx: number;
  nz: number;
  d: number;
  /** signed curvature (1 / radius) */
  curv: number;
}

export interface GapInfo {
  rampStart: number;
  rampEnd: number;
  gapStart: number;
  gapEnd: number;
  rampHeight: number;
}

export interface BoostPad {
  d: number;
  lat: number;
  len: number;
  width: number;
  /** arena pads are placed freely: world-space centre and direction */
  x?: number;
  z?: number;
  heading?: number;
}

export interface Barrier {
  d: number;
  lat: number;
  width: number;
  depth: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** > 0 while the barricade is smashed (seconds until it is rebuilt) */
  brokenT: number;
}

export interface Projection {
  index: number;
  d: number;
  lat: number;
}

export const STEP = 2;
const TRACK_SCALE = 0.82;
const SMOOTH_ITER = 500;

export class Track {
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly halfWidth: number;
  readonly arena: boolean;
  /** battle arena ellipse (drivable everywhere inside) */
  readonly oval: { a: number; b: number } | null;
  /** free item-box positions inside the arena */
  arenaBoxes: { x: number; z: number }[] = [];
  gap: GapInfo | null = null;
  boosts: BoostPad[] = [];
  itemRows: number[] = [];
  barriers: Barrier[] = [];
  private grid = new Map<string, number[]>();
  private readonly cell = 24;

  constructor(map: MapDef) {
    this.halfWidth = map.width / 2;
    this.arena = !!map.arena;
    this.oval = map.oval ?? null;
    const scale = this.oval ? 1 : TRACK_SCALE;
    const curve = new THREE.CatmullRomCurve3(
      map.points.map(([x, z]) => new THREE.Vector3(x * scale, 0, z * scale)),
      true,
      'centripetal',
    );
    // dense sampling, then a light smoothing pass to iron out any tight spots
    const dense = curve.getSpacedPoints(1600).slice(0, -1).map((p) => [p.x, p.z] as [number, number]);
    // (flat buffers: the online server builds tracks too, with a small CPU budget)
    if (!this.oval) {
      const n = dense.length;
      let from = new Float64Array(n * 2);
      let to = new Float64Array(n * 2);
      dense.forEach((p, i) => {
        from[i * 2] = p[0];
        from[i * 2 + 1] = p[1];
      });
      for (let it = 0; it < SMOOTH_ITER; it++) {
        for (let i = 0; i < n; i++) {
          const a = i === 0 ? n - 1 : i - 1;
          const b = i === n - 1 ? 0 : i + 1;
          to[i * 2] = (from[a * 2] + 2 * from[i * 2] + from[b * 2]) / 4;
          to[i * 2 + 1] = (from[a * 2 + 1] + 2 * from[i * 2 + 1] + from[b * 2 + 1]) / 4;
        }
        [from, to] = [to, from];
      }
      dense.forEach((p, i) => {
        p[0] = from[i * 2];
        p[1] = from[i * 2 + 1];
      });
    }
    // cumulative length
    const cum: number[] = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[cum.length - 1];
    const count = Math.round(total / STEP);
    this.length = count * STEP;
    const stretch = total / this.length;
    let j = 0;
    for (let i = 0; i < count; i++) {
      const target = i * STEP * stretch;
      while (cum[j + 1] < target) j++;
      const a = dense[j];
      const b = dense[(j + 1) % dense.length];
      const t = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
      this.samples.push({
        x: a[0] + (b[0] - a[0]) * t,
        z: a[1] + (b[1] - a[1]) * t,
        tx: 0, tz: 0, nx: 0, nz: 0,
        d: i * STEP,
        curv: 0,
      });
    }
    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const p = this.samples[(i - 1 + n) % n];
      const q = this.samples[(i + 1) % n];
      const s = this.samples[i];
      let tx = q.x - p.x;
      let tz = q.z - p.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      s.tx = tx;
      s.tz = tz;
      // right-hand normal for a +z forward / y-up world is (-tz, tx)
      s.nx = -tz;
      s.nz = tx;
    }
    for (let i = 0; i < n; i++) {
      const p = this.samples[(i - 2 + n) % n];
      const q = this.samples[(i + 2) % n];
      const a1 = Math.atan2(p.tx, p.tz);
      const a2 = Math.atan2(q.tx, q.tz);
      let da = a2 - a1;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      this.samples[i].curv = da / (4 * STEP);
    }
    // spatial grid for fast distance queries
    this.samples.forEach((s, i) => {
      const k = this.key(Math.floor(s.x / this.cell), Math.floor(s.z / this.cell));
      const arr = this.grid.get(k);
      if (arr) arr.push(i);
      else this.grid.set(k, [i]);
    });

    this.placeFeatures(map.seed);
  }

  private key(cx: number, cz: number) {
    return cx + ',' + cz;
  }

  wrapD(d: number) {
    const L = this.length;
    return ((d % L) + L) % L;
  }

  /** forward distance from a to b along the loop (0..L) */
  ahead(a: number, b: number) {
    return this.wrapD(b - a);
  }

  sampleAt(d: number): TrackSample {
    const i = Math.round(this.wrapD(d) / STEP) % this.samples.length;
    return this.samples[i];
  }

  /** world position at track distance d and lateral offset lat */
  pointAt(d: number, lat: number) {
    const dd = this.wrapD(d);
    const i0 = Math.floor(dd / STEP) % this.samples.length;
    const i1 = (i0 + 1) % this.samples.length;
    const t = (dd - i0 * STEP) / STEP;
    const a = this.samples[i0];
    const b = this.samples[i1];
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const nx = a.nx + (b.nx - a.nx) * t;
    const nz = a.nz + (b.nz - a.nz) * t;
    return { x: x + nx * lat, z: z + nz * lat, heading: Math.atan2(a.tx + (b.tx - a.tx) * t, a.tz + (b.tz - a.tz) * t) };
  }

  project(x: number, z: number, hint = -1): Projection {
    const n = this.samples.length;
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + n) % n;
        const s = this.samples[i];
        const dd = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
    }
    if (best < 0 || bestD > (this.halfWidth * 3) ** 2) {
      for (let i = 0; i < n; i++) {
        const s = this.samples[i];
        const dd = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
    }
    const s = this.samples[best];
    const dx = x - s.x;
    const dz = z - s.z;
    return {
      index: best,
      d: this.wrapD(s.d + dx * s.tx + dz * s.tz),
      lat: dx * s.nx + dz * s.nz,
    };
  }

  /** >1 outside the arena ellipse, <1 inside */
  ovalValue(x: number, z: number) {
    const o = this.oval!;
    return (x / o.a) ** 2 + (z / o.b) ** 2;
  }

  /**
   * Distance from any world point to the track centre line (approximate, capped).
   * In the oval arena the whole inside is road, so the result is 0 there and grows outside the wall.
   */
  distToCenter(x: number, z: number, maxR = 120): number {
    if (this.oval) {
      const k = Math.sqrt(this.ovalValue(x, z));
      if (k <= 1) return 0;
      const r = Math.hypot(x, z);
      return Math.min(maxR, this.halfWidth + r * (1 - 1 / k));
    }
    return this.ringDist(x, z, maxR);
  }

  private ringDist(x: number, z: number, maxR: number): number {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const r = Math.ceil(maxR / this.cell);
    let best = maxR * maxR;
    for (let i = -r; i <= r; i++) {
      for (let k = -r; k <= r; k++) {
        const arr = this.grid.get(this.key(cx + i, cz + k));
        if (!arr) continue;
        for (const idx of arr) {
          const s = this.samples[idx];
          const dd = (s.x - x) ** 2 + (s.z - z) ** 2;
          if (dd < best) best = dd;
        }
      }
    }
    return Math.sqrt(best);
  }

  inGap(d: number) {
    const g = this.gap;
    return !!g && d > g.gapStart && d < g.gapEnd;
  }

  /** road surface height at track distance d */
  heightAt(d: number) {
    const g = this.gap;
    if (!g) return 0;
    if (d >= g.rampStart && d <= g.rampEnd) {
      const t = (d - g.rampStart) / (g.rampEnd - g.rampStart);
      // gentle curved lip
      return g.rampHeight * (t * 0.55 + t * t * 0.45);
    }
    return 0;
  }

  /** ground height for physics (pit inside the gap) */
  groundAt(d: number) {
    if (this.inGap(d)) return -80;
    return this.heightAt(d);
  }

  /** World-space rectangle of the chasm, used to cut the ground and keep decor out */
  chasmRect() {
    const g = this.gap;
    if (!g) return null;
    const mid = (g.gapStart + g.gapEnd) / 2;
    const s = this.sampleAt(mid);
    return {
      cx: s.x,
      cz: s.z,
      tx: s.tx,
      tz: s.tz,
      nx: s.nx,
      nz: s.nz,
      halfLen: (g.gapEnd - g.gapStart) / 2,
      halfWide: 150,
    };
  }

  inChasm(x: number, z: number, margin = 0) {
    const c = this.chasmRect();
    if (!c) return false;
    const dx = x - c.cx;
    const dz = z - c.cz;
    const a = dx * c.tx + dz * c.tz;
    const b = dx * c.nx + dz * c.nz;
    return Math.abs(a) < c.halfLen + margin && Math.abs(b) < c.halfWide + margin;
  }

  private placeFeatures(seed: number) {
    const rng = makeRng(seed);
    if (this.oval) {
      this.placeArenaFeatures(rng);
      return;
    }
    const L = this.length;
    const hw = this.halfWidth;
    const occupied: [number, number][] = [];
    const free = (d0: number, d1: number) =>
      occupied.every(([a, b]) => d1 < a || d0 > b) && d0 > 60 && d1 < L - 40;
    const occupy = (d0: number, d1: number) => occupied.push([d0, d1]);

    if (!this.arena) {
      // ---- the jump: find the straightest window away from the start
      const windowLen = 140;
      let bestStart = L * 0.45;
      let bestScore = Infinity;
      for (let d = 260; d < L - 260; d += STEP * 2) {
        let score = 0;
        for (let k = 0; k <= windowLen; k += STEP * 2) score += Math.abs(this.sampleAt(d + k).curv);
        if (score < bestScore) {
          bestScore = score;
          bestStart = d;
        }
      }
      const rampStart = bestStart + 40;
      const rampLen = 18;
      const gapLen = 15;
      this.gap = {
        rampStart,
        rampEnd: rampStart + rampLen,
        gapStart: rampStart + rampLen,
        gapEnd: rampStart + rampLen + gapLen,
        rampHeight: 3.4,
      };
      occupy(rampStart - 45, rampStart + rampLen + gapLen + 35);
      // boost pad right before the ramp to help clear the cliff
      this.boosts.push({ d: rampStart - 34, lat: 0, len: 14, width: hw * 1.1 });
    }

    // ---- item box rows
    const rowEvery = this.arena ? 110 : 260;
    for (let d = this.arena ? 40 : 150; d < L - 60; d += rowEvery + rng.range(-30, 30)) {
      if (!free(d - 8, d + 8)) continue;
      this.itemRows.push(d);
      occupy(d - 25, d + 25);
    }

    // ---- boost pads
    const boostEvery = this.arena ? 160 : 210;
    for (let d = 120; d < L - 60; d += boostEvery + rng.range(-40, 40)) {
      const len = 14;
      if (!free(d - 4, d + len + 4)) continue;
      // prefer straight sections
      if (Math.abs(this.sampleAt(d).curv) > 0.018) continue;
      this.boosts.push({ d, lat: rng.range(-hw * 0.5, hw * 0.5), len, width: 9 });
      occupy(d - 10, d + len + 10);
    }

    // ---- barricades (leave a clear lane every time)
    const barEvery = this.arena ? 95 : 170;
    for (let d = 200; d < L - 80; d += barEvery + rng.range(-40, 40)) {
      if (!free(d - 6, d + 6)) continue;
      const count = this.arena ? rng.int(1, 2) : rng.int(1, 2);
      const lanes = [-0.55, 0, 0.55];
      const used = new Set<number>();
      for (let c = 0; c < count; c++) {
        let li = rng.int(0, 2);
        if (used.has(li)) li = (li + 1) % 3;
        used.add(li);
        const lat = lanes[li] * hw + rng.range(-2, 2);
        const s = this.sampleAt(d);
        this.barriers.push({
          d,
          lat,
          width: rng.pick([7, 8, 9]),
          depth: 2.2,
          x: s.x + s.nx * lat,
          z: s.z + s.nz * lat,
          tx: s.tx,
          tz: s.tz,
          brokenT: 0,
        });
      }
      occupy(d - 30, d + 30);
    }
    this.boosts.sort((a, b) => a.d - b.d);
  }

  /** Oval arena: boxes, pads and barricades scattered over the whole floor */
  private placeArenaFeatures(rng: ReturnType<typeof makeRng>) {
    const o = this.oval!;
    const taken: [number, number, number][] = [];
    const freeSpot = (x: number, z: number, r: number) =>
      this.ovalValue(x, z) < 0.78 && taken.every(([tx, tz, tr]) => (tx - x) ** 2 + (tz - z) ** 2 > (tr + r) ** 2);
    // item boxes in rings + centre cluster
    for (const [rx, count] of [[0.25, 6], [0.55, 10], [0.8, 14]] as const) {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rx;
        const x = Math.cos(a) * o.a * rx;
        const z = Math.sin(a) * o.b * rx;
        this.arenaBoxes.push({ x, z });
        taken.push([x, z, 4]);
      }
    }
    // boost pads pointing around the oval
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * o.a * 0.68;
      const z = Math.sin(a) * o.b * 0.68;
      if (!freeSpot(x, z, 7)) continue;
      const heading = Math.atan2(-Math.sin(a) * o.a, Math.cos(a) * o.b);
      const pr = this.project(x, z);
      this.boosts.push({ d: pr.d, lat: pr.lat, len: 12, width: 8, x, z, heading });
      taken.push([x, z, 8]);
    }
    // barricades scattered as cover
    let tries = 0;
    while (this.barriers.length < 14 && tries++ < 400) {
      const x = rng.range(-o.a, o.a);
      const z = rng.range(-o.b, o.b);
      if (!freeSpot(x, z, 7) || Math.hypot(x, z) < 22) continue;
      const ang = rng.range(0, Math.PI);
      const pr = this.project(x, z);
      this.barriers.push({ d: pr.d, lat: pr.lat, width: rng.pick([7, 8, 9]), depth: 2.2, x, z, tx: Math.sin(ang), tz: Math.cos(ang), brokenT: 0 });
      taken.push([x, z, 7]);
    }
  }
}
