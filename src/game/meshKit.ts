import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Small toolkit for building stylised models out of many primitives but drawing them with very
 * few draw calls: every part is baked (transform + flat vertex colour) and parts that share a
 * material are merged into one geometry.
 */

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** transform matrix from position, euler rotation (XYZ) and scale */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/**
 * Bakes a part: applies the matrix, drops the index, keeps only position / normal / uv and adds a
 * flat vertex colour, so any parts can later be merged together.
 */
export function bake(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (m) g.applyMatrix4(m);
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  _c.set(color);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = _c.r;
    cols[i * 3 + 1] = _c.g;
    cols[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.clearGroups();
  return g;
}

/** Collects baked parts per material key and turns them into one mesh per material */
export class PartBin {
  private bins = new Map<string, THREE.BufferGeometry[]>();

  add(key: string, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation = '#ffffff', m?: THREE.Matrix4) {
    let list = this.bins.get(key);
    if (!list) this.bins.set(key, (list = []));
    list.push(bake(geo, color, m));
    return this;
  }

  has(key: string) {
    return (this.bins.get(key)?.length ?? 0) > 0;
  }

  /** merged geometry for a key (null if nothing was added) */
  geometry(key: string): THREE.BufferGeometry | null {
    const list = this.bins.get(key);
    if (!list || !list.length) return null;
    const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) list.forEach((x) => x.dispose());
    this.bins.delete(key);
    if (!g) return null;
    g.computeBoundingSphere();
    return g;
  }

  /** builds a mesh for a key and parents it; returns null if the bin is empty */
  mesh(key: string, mat: THREE.Material, parent: THREE.Object3D, shadow = true): THREE.Mesh | null {
    const g = this.geometry(key);
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow;
    m.receiveShadow = false;
    parent.add(m);
    return m;
  }
}

// ---------------------------------------------------------------- lofted bodies

/**
 * One cross-section of a lofted body. The section is a superellipse between `yb` and `yt`:
 * `w` is the half-width at mid height, `wt` at the top and `wb` at the bottom, `n` its squareness
 * (2 = ellipse, higher = boxier).
 */
export interface Section {
  z: number;
  yb: number;
  yt: number;
  w: number;
  wt: number;
  wb: number;
  n: number;
  /** lateral offset of the section centre */
  x?: number;
}

const halfWidthAt = (s: Section, sn: number) => (sn >= 0 ? s.w + (s.wt - s.w) * sn : s.w + (s.wb - s.w) * -sn);

/** point on a section at angle a (0 = right side, π/2 = top) */
function sectionPoint(s: Section, a: number, out: THREE.Vector3) {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const ex = 2 / s.n;
  const px = Math.sign(c) * Math.abs(c) ** ex;
  const py = Math.sign(sn) * Math.abs(sn) ** ex;
  const yc = (s.yb + s.yt) / 2;
  const hh = (s.yt - s.yb) / 2;
  return out.set((s.x ?? 0) + px * halfWidthAt(s, sn), yc + py * hh, s.z);
}

export function lerpSection(a: Section, b: Section, t: number): Section {
  const l = (p: number, q: number) => p + (q - p) * t;
  return { z: l(a.z, b.z), yb: l(a.yb, b.yb), yt: l(a.yt, b.yt), w: l(a.w, b.w), wt: l(a.wt, b.wt), wb: l(a.wb, b.wb), n: l(a.n, b.n), x: l(a.x ?? 0, b.x ?? 0) };
}

/** smoothly interpolated (Catmull-Rom) list of sections, so the surface has no visible kinks */
export function refine(src: Section[], steps = 4): Section[] {
  const out: Section[] = [];
  const keys: (keyof Section)[] = ['z', 'yb', 'yt', 'w', 'wt', 'wb', 'n', 'x'];
  const n = src.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = src[Math.max(0, i - 1)];
    const p1 = src[i];
    const p2 = src[i + 1];
    const p3 = src[Math.min(n - 1, i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const s = {} as Section;
      for (const key of keys) {
        const a = (p0[key] as number | undefined) ?? 0;
        const b = (p1[key] as number | undefined) ?? 0;
        const c = (p2[key] as number | undefined) ?? 0;
        const d = (p3[key] as number | undefined) ?? 0;
        (s[key] as number) = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      }
      out.push(s);
    }
  }
  out.push({ ...src[n - 1] });
  return out;
}

/**
 * Lofts a closed tube through the sections (rounded end caps). UVs: u runs around the section
 * starting at the bottom (0.25 = right side, 0.5 = top, 0.75 = left side), v along the length.
 * `arc` builds an open strip between two angles instead of a closed tube (e.g. a roof panel).
 */
export function loft(sections: Section[], seg = 32, opts: { caps?: boolean; arc?: [number, number] } = {}) {
  const caps = opts.caps ?? !opts.arc;
  const list = sections.slice();
  if (caps) {
    // rounded ends: shrink towards the centre just beyond the first and last section
    const shrink = (s: Section, dz: number, k: number): Section => {
      const yc = (s.yb + s.yt) / 2;
      const hh = ((s.yt - s.yb) / 2) * k;
      return { ...s, z: s.z + dz, yb: yc - hh, yt: yc + hh, w: s.w * k, wt: s.wt * k, wb: s.wb * k };
    };
    const a = list[0];
    const b = list[list.length - 1];
    list.unshift(shrink(a, -0.06, 0.02), shrink(a, -0.035, 0.55));
    list.push(shrink(b, 0.035, 0.55), shrink(b, 0.06, 0.02));
  }
  const a0 = opts.arc ? opts.arc[0] : -Math.PI / 2;
  const a1 = opts.arc ? opts.arc[1] : Math.PI * 1.5;
  const z0 = list[0].z;
  const z1 = list[list.length - 1].z;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ring: THREE.Vector3[] = Array.from({ length: seg + 1 }, () => new THREE.Vector3());
  const span = (a1 - a0) / (Math.PI * 2);
  const uStart = (a0 + Math.PI / 2) / (Math.PI * 2);
  for (let i = 0; i < list.length; i++) {
    // u follows arc length around the section, so decals keep their proportions on boxy shapes
    let total = 0;
    const cum = [0];
    for (let k = 0; k <= seg; k++) {
      sectionPoint(list[i], a0 + ((a1 - a0) * k) / seg, ring[k]);
      if (k > 0) cum.push((total += ring[k].distanceTo(ring[k - 1])));
    }
    for (let k = 0; k <= seg; k++) {
      pos.push(ring[k].x, ring[k].y, ring[k].z);
      uv.push(uStart + (total > 1e-6 ? cum[k] / total : k / seg) * span, (list[i].z - z0) / (z1 - z0 || 1));
    }
  }
  const row = seg + 1;
  for (let i = 0; i < list.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const p = i * row + k;
      // outward-facing winding for a loft running along +z with angles counter-clockwise
      idx.push(p, p + 1, p + row, p + 1, p + row + 1, p + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Lofts a closed tube and splits its faces into several geometries: `classify(z, a)` receives the
 * centre of each face (length z and section angle a in -π/2 .. 3π/2) and returns a group index.
 * Used to cut windows out of a car's greenhouse.
 */
export function loftSplit(sections: Section[], seg: number, groups: number, classify: (z: number, a: number) => number) {
  const whole = loft(sections, seg, { caps: false });
  const pos = whole.attributes.position as THREE.BufferAttribute;
  const uv = whole.attributes.uv as THREE.BufferAttribute;
  const index = whole.index!.array;
  const lists: number[][] = Array.from({ length: groups }, () => []);
  const da = (Math.PI * 2) / seg;
  const row = seg + 1;
  for (let f = 0; f < index.length; f += 6) {
    const p = index[f];
    const k = p % row;
    const z = (pos.getZ(p) + pos.getZ(p + row)) / 2;
    const a = -Math.PI / 2 + (k + 0.5) * da;
    const gi = Math.min(groups - 1, Math.max(0, classify(z, a)));
    for (let j = 0; j < 6; j++) lists[gi].push(index[f + j]);
  }
  const out = lists.map((idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', pos.clone());
    g.setAttribute('uv', uv.clone());
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
  whole.dispose();
  return out;
}

/** half-width of a (refined) body at length z and height y; 0 if the point is above / below it */
export function bodyWidthAt(sections: Section[], z: number, y: number): number {
  if (z < sections[0].z || z > sections[sections.length - 1].z) return 0;
  let i = 0;
  while (i < sections.length - 2 && sections[i + 1].z < z) i++;
  const a = sections[i];
  const b = sections[i + 1];
  const s = lerpSection(a, b, (z - a.z) / (b.z - a.z || 1));
  const yc = (s.yb + s.yt) / 2;
  const hh = (s.yt - s.yb) / 2;
  const py = (y - yc) / hh;
  if (Math.abs(py) >= 1) return 0;
  const sn = Math.sign(py) * Math.abs(py) ** (s.n / 2);
  const c = Math.sqrt(Math.max(0, 1 - sn * sn));
  return c ** (2 / s.n) * halfWidthAt(s, sn);
}

/** the z where the body surface ends at lateral offset x and height y, searching from one end */
export function bodyEndAt(sections: Section[], x: number, y: number, front: boolean): number {
  const z0 = sections[0].z;
  const z1 = sections[sections.length - 1].z;
  const step = 0.01;
  // loft() adds a rounded cap that reaches ~4 cm beyond the end sections
  const CAP = 0.04;
  if (front) {
    for (let z = z1; z > z0; z -= step) if (bodyWidthAt(sections, z, y) >= Math.abs(x)) return z >= z1 - 1e-6 ? z1 + CAP : z;
    return z1;
  }
  for (let z = z0; z < z1; z += step) if (bodyWidthAt(sections, z, y) >= Math.abs(x)) return z <= z0 + 1e-6 ? z0 - CAP : z;
  return z0;
}

/** point on the surface of a (refined) loft at length z and section angle a (0 = right, π/2 = top) */
export function pointOn(sections: Section[], z: number, a: number, out = new THREE.Vector3()) {
  let i = 0;
  while (i < sections.length - 2 && sections[i + 1].z < z) i++;
  const s0 = sections[i];
  const s1 = sections[i + 1];
  const s = lerpSection(s0, s1, THREE.MathUtils.clamp((z - s0.z) / (s1.z - s0.z || 1), 0, 1));
  return sectionPoint(s, a, out);
}

/** cylinder between two points (for tubes, struts, pillars) */
export function rodGeo(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** box with rounded edges (all twelve) */
export function roundBox(w: number, h: number, d: number, r: number, seg = 3) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3(w / 2 - rr, h / 2 - rr, d / 2 - rr);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = new THREE.Vector3(
      THREE.MathUtils.clamp(v.x, -inner.x, inner.x),
      THREE.MathUtils.clamp(v.y, -inner.y, inner.y),
      THREE.MathUtils.clamp(v.z, -inner.z, inner.z),
    );
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 0) v.copy(c).addScaledVector(dir.normalize(), rr);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // weld the per-face duplicates so the rounded edges shade smoothly
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const welded = mergeVertices(g, 1e-4);
  g.dispose();
  welded.computeVertexNormals();
  return welded;
}

/** top surface height of a body at length z (centre line) */
export function bodyTopAt(sections: Section[], z: number): number {
  if (z <= sections[0].z) return sections[0].yt;
  if (z >= sections[sections.length - 1].z) return sections[sections.length - 1].yt;
  let i = 0;
  while (i < sections.length - 2 && sections[i + 1].z < z) i++;
  const a = sections[i];
  const b = sections[i + 1];
  return lerpSection(a, b, (z - a.z) / (b.z - a.z || 1)).yt;
}
