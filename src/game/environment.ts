import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from './track';
import type { ThemeId } from './types';
import { THEME_STYLES } from './themes';
import { makeRng, type Rng } from './rng';
import { itemBoxTexture, signTexture, softDotTexture, stripeTexture, swirlTexture, windowsTexture } from './textures';

export interface Environment {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  update(t: number, dt: number, focus: THREE.Vector3): void;
}

// ---------------------------------------------------------------- geometry helpers

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Bakes transform + flat vertex colour into a geometry part */
function part(
  geo: THREE.BufferGeometry,
  color: string,
  x = 0, y = 0, z = 0,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = 1, sz = 1,
) {
  const g = geo;
  _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  _c.set(color);
  const n = g.attributes.position.count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = _c.r;
    cols[i * 3 + 1] = _c.g;
    cols[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const S = (r: number, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const C = (rt: number, rb: number, h: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const K = (r: number, h: number, seg = 10) => new THREE.ConeGeometry(r, h, seg);

interface Placement {
  x: number;
  y: number;
  z: number;
  ry: number;
  s: number;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: Placement[], shadow = false) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((p, i) => {
    _m.compose(_v.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(0, p.ry, 0)), _s.set(p.s, p.s, p.s));
    mesh.setMatrixAt(i, _m);
  });
  mesh.count = list.length;
  mesh.castShadow = shadow;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------------------------------------------------------------- spectators

type Proto = () => THREE.BufferGeometry;

function human(shirt: string, skin: string, pants: string, hat?: string): Proto {
  return () => {
    const p = [
      part(B(0.24, 0.8, 0.26), pants, -0.15, 0.4, 0),
      part(B(0.24, 0.8, 0.26), pants, 0.15, 0.4, 0),
      part(B(0.64, 0.78, 0.36), shirt, 0, 1.18, 0),
      part(B(0.18, 0.72, 0.18), shirt, -0.46, 1.72, 0, 0, 0, 0.35),
      part(B(0.18, 0.72, 0.18), shirt, 0.46, 1.72, 0, 0, 0, -0.35),
      part(S(0.13, 8, 6), skin, -0.6, 2.08, 0),
      part(S(0.13, 8, 6), skin, 0.6, 2.08, 0),
      part(S(0.26, 14, 10), skin, 0, 1.85, 0),
      part(B(0.08, 0.08, 0.04), '#111111', -0.09, 1.9, 0.24),
      part(B(0.08, 0.08, 0.04), '#111111', 0.09, 1.9, 0.24),
    ];
    if (hat) {
      p.push(part(C(0.42, 0.42, 0.05, 14), hat, 0, 2.05, 0));
      p.push(part(C(0.22, 0.26, 0.28, 12), hat, 0, 2.2, 0));
    } else {
      p.push(part(S(0.27, 12, 6), '#2b1d14', 0, 1.93, -0.04, 0, 0, 0, 1, 0.7, 1));
    }
    return merge(p);
  };
}

function dog(fur: string): Proto {
  return () =>
    merge([
      part(B(0.5, 0.45, 0.9), fur, 0, 0.6, 0),
      part(B(0.42, 0.4, 0.42), fur, 0, 0.98, 0.45),
      part(B(0.2, 0.14, 0.2), '#3b2416', 0, 0.92, 0.72),
      part(B(0.1, 0.22, 0.12), '#3b2416', -0.16, 1.24, 0.42),
      part(B(0.1, 0.22, 0.12), '#3b2416', 0.16, 1.24, 0.42),
      ...[-0.17, 0.17].flatMap((x) => [part(B(0.13, 0.4, 0.13), fur, x, 0.2, 0.3), part(B(0.13, 0.4, 0.13), fur, x, 0.2, -0.3)]),
      part(B(0.08, 0.08, 0.4), fur, 0, 0.9, -0.55, 0.7, 0, 0),
    ]);
}

function camel(): Proto {
  const c = '#c8964f';
  return () =>
    merge([
      part(S(0.7, 14, 10), c, 0, 1.75, 0, 0, 0, 0, 0.8, 0.6, 1.3),
      part(S(0.42, 12, 8), c, 0, 2.25, -0.1),
      part(B(0.28, 0.9, 0.28), c, 0, 2.3, 0.85, 0.5, 0, 0),
      part(B(0.32, 0.3, 0.6), c, 0, 2.75, 1.15),
      part(B(0.06, 0.06, 0.02), '#111', -0.12, 2.8, 1.45),
      part(B(0.06, 0.06, 0.02), '#111', 0.12, 2.8, 1.45),
      ...[-0.3, 0.3].flatMap((x) => [part(B(0.16, 1.4, 0.16), c, x, 0.7, 0.55), part(B(0.16, 1.4, 0.16), c, x, 0.7, -0.55)]),
    ]);
}

function meerkat(): Proto {
  const c = '#b8875a';
  return () =>
    merge([
      part(C(0.18, 0.25, 0.8, 10), c, 0, 0.45, 0),
      part(S(0.2, 10, 8), c, 0, 0.98, 0.02),
      part(B(0.1, 0.08, 0.15), '#3b2416', 0, 0.95, 0.2),
      part(B(0.06, 0.3, 0.06), c, -0.16, 0.7, 0.12, -0.4, 0, 0),
      part(B(0.06, 0.3, 0.06), c, 0.16, 0.7, 0.12, -0.4, 0, 0),
    ]);
}

function fish(body: string, fin: string): Proto {
  return () =>
    merge([
      part(S(0.55, 14, 10), body, 0, 0, 0, 0, 0, 0, 0.55, 0.75, 1),
      part(K(0.42, 0.6, 4), fin, 0, 0, -0.75, -Math.PI / 2, 0, 0, 0.3, 1, 1),
      part(K(0.2, 0.4, 4), fin, 0, 0.45, -0.05, 0, 0, 0, 0.25, 1, 1),
      part(S(0.12, 8, 6), '#ffffff', -0.24, 0.12, 0.32),
      part(S(0.12, 8, 6), '#ffffff', 0.24, 0.12, 0.32),
      part(S(0.06, 6, 4), '#111111', -0.31, 0.13, 0.38),
      part(S(0.06, 6, 4), '#111111', 0.31, 0.13, 0.38),
    ]);
}

function octopus(c: string): Proto {
  return () => {
    const p = [part(S(0.6, 14, 10), c, 0, 1.3, 0, 0, 0, 0, 1, 1.15, 1)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      p.push(part(C(0.07, 0.14, 1.0, 6), c, Math.sin(a) * 0.45, 0.5, Math.cos(a) * 0.45, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5));
    }
    p.push(part(S(0.14, 8, 6), '#ffffff', -0.22, 1.42, 0.5), part(S(0.14, 8, 6), '#ffffff', 0.22, 1.42, 0.5));
    p.push(part(S(0.07, 6, 4), '#111', -0.22, 1.42, 0.62), part(S(0.07, 6, 4), '#111', 0.22, 1.42, 0.62));
    return merge(p);
  };
}

function turtle(): Proto {
  return () =>
    merge([
      part(S(0.7, 14, 8), '#3f8f3a', 0, 0.35, 0, 0, 0, 0, 1, 0.5, 1.2),
      part(S(0.26, 10, 8), '#9bd17a', 0, 0.45, 0.85),
      part(B(0.6, 0.08, 0.25), '#9bd17a', -0.6, 0.3, 0.4, 0, 0.5, 0),
      part(B(0.6, 0.08, 0.25), '#9bd17a', 0.6, 0.3, 0.4, 0, -0.5, 0),
    ]);
}

function pixelHero(shirt: string, overall: string, cap: string): Proto {
  return () =>
    merge([
      part(B(0.3, 0.7, 0.34), overall, -0.17, 0.35, 0),
      part(B(0.3, 0.7, 0.34), overall, 0.17, 0.35, 0),
      part(B(0.7, 0.7, 0.42), shirt, 0, 1.05, 0),
      part(B(0.5, 0.4, 0.44), overall, 0, 0.9, 0),
      part(B(0.2, 0.7, 0.2), shirt, -0.48, 1.55, 0, 0, 0, 0.3),
      part(B(0.2, 0.7, 0.2), shirt, 0.48, 1.55, 0, 0, 0, -0.3),
      part(B(0.6, 0.6, 0.6), '#ffcc99', 0, 1.72, 0),
      part(B(0.64, 0.2, 0.64), cap, 0, 2.08, 0),
      part(B(0.5, 0.08, 0.3), cap, 0, 1.98, 0.4),
      part(B(0.4, 0.1, 0.06), '#3b2416', 0, 1.58, 0.31),
      part(B(0.1, 0.12, 0.04), '#111', -0.14, 1.78, 0.31),
      part(B(0.1, 0.12, 0.04), '#111', 0.14, 1.78, 0.31),
    ]);
}

function slime(c: string): Proto {
  return () =>
    merge([
      part(B(1.0, 0.9, 1.0), c, 0, 0.45, 0),
      part(B(0.18, 0.22, 0.04), '#111', -0.2, 0.6, 0.51),
      part(B(0.18, 0.22, 0.04), '#111', 0.2, 0.6, 0.51),
      part(B(0.3, 0.08, 0.04), '#111', 0, 0.35, 0.51),
    ]);
}

function mushroom(cap: string): Proto {
  return () =>
    merge([
      part(B(0.6, 0.7, 0.6), '#f5deb3', 0, 0.35, 0),
      part(B(1.2, 0.5, 1.2), cap, 0, 0.95, 0),
      part(B(0.3, 0.3, 0.04), '#ffffff', -0.35, 1.0, 0.61),
      part(B(0.3, 0.3, 0.04), '#ffffff', 0.35, 1.0, 0.61),
      part(B(0.1, 0.2, 0.04), '#111', -0.12, 0.5, 0.31),
      part(B(0.1, 0.2, 0.04), '#111', 0.12, 0.5, 0.31),
    ]);
}

function robot(): Proto {
  return () =>
    merge([
      part(B(0.25, 0.7, 0.25), '#71717a', -0.18, 0.35, 0),
      part(B(0.25, 0.7, 0.25), '#71717a', 0.18, 0.35, 0),
      part(B(0.8, 0.8, 0.5), '#a1a1aa', 0, 1.1, 0),
      part(B(0.55, 0.45, 0.45), '#d4d4d8', 0, 1.78, 0),
      part(B(0.12, 0.08, 0.04), '#22d3ee', -0.12, 1.82, 0.23),
      part(B(0.12, 0.08, 0.04), '#22d3ee', 0.12, 1.82, 0.23),
      part(C(0.03, 0.03, 0.35, 6), '#71717a', 0, 2.15, 0),
      part(S(0.07, 6, 4), '#ef4444', 0, 2.35, 0),
      part(B(0.18, 0.7, 0.18), '#a1a1aa', -0.52, 1.5, 0, 0, 0, 0.4),
      part(B(0.18, 0.7, 0.18), '#a1a1aa', 0.52, 1.5, 0, 0, 0, -0.4),
    ]);
}

function gummy(c: string): Proto {
  return () =>
    merge([
      part(S(0.42, 12, 10), c, 0, 0.75, 0, 0, 0, 0, 1, 1.2, 0.9),
      part(S(0.34, 12, 10), c, 0, 1.45, 0),
      part(S(0.13, 8, 6), c, -0.26, 1.72, 0),
      part(S(0.13, 8, 6), c, 0.26, 1.72, 0),
      part(S(0.15, 8, 6), c, -0.42, 1.0, 0.1),
      part(S(0.15, 8, 6), c, 0.42, 1.0, 0.1),
      part(S(0.17, 8, 6), c, -0.22, 0.22, 0.05),
      part(S(0.17, 8, 6), c, 0.22, 0.22, 0.05),
      part(S(0.05, 6, 4), '#111', -0.11, 1.52, 0.3),
      part(S(0.05, 6, 4), '#111', 0.11, 1.52, 0.3),
    ]);
}

function gingerbread(): Proto {
  const c = '#b06a2c';
  return () =>
    merge([
      part(B(0.7, 0.85, 0.24), c, 0, 0.95, 0),
      part(C(0.32, 0.32, 0.24, 14), c, 0, 1.7, 0, Math.PI / 2, 0, 0),
      part(B(0.28, 0.7, 0.24), c, -0.22, 0.32, 0, 0, 0, 0.15),
      part(B(0.28, 0.7, 0.24), c, 0.22, 0.32, 0, 0, 0, -0.15),
      part(B(0.65, 0.24, 0.24), c, -0.55, 1.45, 0, 0, 0, 0.7),
      part(B(0.65, 0.24, 0.24), c, 0.55, 1.45, 0, 0, 0, -0.7),
      part(S(0.07, 6, 4), '#ffffff', 0, 1.15, 0.13),
      part(S(0.07, 6, 4), '#ef4444', 0, 0.9, 0.13),
      part(S(0.07, 6, 4), '#ffffff', 0, 0.65, 0.13),
      part(S(0.06, 6, 4), '#ffffff', -0.12, 1.75, 0.13),
      part(S(0.06, 6, 4), '#ffffff', 0.12, 1.75, 0.13),
    ]);
}

function bunny(): Proto {
  return () =>
    merge([
      part(S(0.42, 12, 10), '#eeeaec', 0, 0.55, 0, 0, 0, 0, 1, 1.15, 1),
      part(S(0.3, 12, 10), '#eeeaec', 0, 1.2, 0.05),
      part(B(0.12, 0.6, 0.08), '#eeeaec', -0.12, 1.7, 0, 0, 0, 0.12),
      part(B(0.12, 0.6, 0.08), '#eeeaec', 0.12, 1.7, 0, 0, 0, -0.12),
      part(B(0.06, 0.45, 0.02), '#f9a8d4', -0.12, 1.7, 0.05, 0, 0, 0.12),
      part(B(0.06, 0.45, 0.02), '#f9a8d4', 0.12, 1.7, 0.05, 0, 0, -0.12),
      part(S(0.05, 6, 4), '#111', -0.11, 1.26, 0.3),
      part(S(0.05, 6, 4), '#111', 0.11, 1.26, 0.3),
      part(S(0.05, 6, 4), '#f472b6', 0, 1.16, 0.34),
    ]);
}

interface FanType {
  proto: Proto;
  weight: number;
  float?: boolean;
  scale?: number;
}

function fanTypes(theme: ThemeId): FanType[] {
  const st = THEME_STYLES[theme];
  const shirts = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#ec4899', '#14b8a6'];
  switch (theme) {
    case 'city':
      return [
        ...shirts.map((s, i) => ({ proto: human(s, st.skin[i % st.skin.length], i % 2 ? '#1f2937' : '#1e3a8a'), weight: 1 })),
        { proto: dog('#d6a26b'), weight: 0.8, scale: 1.2 },
        { proto: dog('#f5f5f4'), weight: 0.6, scale: 1.2 },
        { proto: robot(), weight: 0.5 },
      ];
    case 'desert':
      return [
        ...shirts.slice(0, 6).map((s, i) => ({ proto: human(s, st.skin[i % st.skin.length], '#a16207', i % 2 ? '#f5deb3' : '#78350f'), weight: 1 })),
        { proto: camel(), weight: 0.7 },
        { proto: meerkat(), weight: 1.2, scale: 1.4 },
      ];
    case 'ocean':
      return [
        { proto: fish('#f97316', '#ffffff'), weight: 1, float: true, scale: 1.6 },
        { proto: fish('#facc15', '#2563eb'), weight: 1, float: true, scale: 1.6 },
        { proto: fish('#38bdf8', '#fde047'), weight: 1, float: true, scale: 1.6 },
        { proto: fish('#f472b6', '#a855f7'), weight: 1, float: true, scale: 1.6 },
        { proto: fish('#4ade80', '#f97316'), weight: 1, float: true, scale: 1.6 },
        { proto: octopus('#c026d3'), weight: 0.8, scale: 1.1 },
        { proto: octopus('#fb7185'), weight: 0.6, scale: 1.1 },
        { proto: turtle(), weight: 0.6, scale: 1.2 },
      ];
    case 'pixel':
      return [
        { proto: pixelHero('#e52521', '#1d4ed8', '#e52521'), weight: 1 },
        { proto: pixelHero('#16a34a', '#1d4ed8', '#16a34a'), weight: 1 },
        { proto: pixelHero('#facc15', '#7c3aed', '#facc15'), weight: 0.8 },
        { proto: slime('#4ade80'), weight: 1 },
        { proto: slime('#60a5fa'), weight: 0.7 },
        { proto: mushroom('#dc2626'), weight: 1 },
        { proto: robot(), weight: 0.6 },
      ];
    case 'candy':
      return [
        { proto: gummy('#ef4444'), weight: 1 },
        { proto: gummy('#22c55e'), weight: 1 },
        { proto: gummy('#facc15'), weight: 1 },
        { proto: gummy('#f97316'), weight: 1 },
        { proto: gummy('#a855f7'), weight: 0.8 },
        { proto: gingerbread(), weight: 1.2 },
        { proto: bunny(), weight: 1 },
      ];
  }
}

const SIGNS: [string, string, string][] = [
  ['ДАВАЙ\nДАВАЙ!', '#facc15', '#111827'],
  ['ТЫ\nСМОЖЕШЬ!', '#ef4444', '#ffffff'],
  ['ВПЕРЁД!', '#22c55e', '#ffffff'],
  ['ЖМИ\nГАЗ!', '#3b82f6', '#ffffff'],
  ['ТЫ\nЛУЧШИЙ!', '#ec4899', '#ffffff'],
  ['★ №1 ★', '#e8e8ea', '#c2334f'],
];

interface FanInstance {
  mesh: THREE.InstancedMesh;
  index: number;
  x: number;
  y: number;
  z: number;
  ry: number;
  s: number;
  phase: number;
  speed: number;
  float: boolean;
}

function buildSpectators(track: Track, theme: ThemeId, rng: Rng, group: THREE.Group) {
  const types = fanTypes(theme);
  const totalW = types.reduce((a, t) => a + t.weight, 0);
  const pickType = () => {
    let r = rng.next() * totalW;
    for (let i = 0; i < types.length; i++) {
      r -= types[i].weight;
      if (r <= 0) return i;
    }
    return 0;
  };
  const hw = track.halfWidth;
  const slots: { type: number; p: Placement; float: boolean }[] = [];
  const signSlots: { sign: number; p: Placement }[] = [];
  const standList: { x: number; z: number; ry: number; len: number; rows: number }[] = [];

  const addCluster = (d: number, side: number, len: number, rows: number) => {
    const sTrack = track.sampleAt(d);
    const ry = Math.atan2(-sTrack.nx * side, -sTrack.nz * side);
    let placedAny = false;
    for (let r = 0; r < rows; r++) {
      const lat = side * (hw + 6.5 + r * 2.0);
      for (let k = -len / 2; k <= len / 2; k += 1.7) {
        const p = track.pointAt(d + k + rng.range(-0.3, 0.3), lat);
        if (track.distToCenter(p.x, p.z, 60) < hw + 5) continue;
        if (track.inChasm(p.x, p.z, 6)) continue;
        if (rng.chance(0.12)) continue;
        const ti = pickType();
        const t = types[ti];
        const float = !!t.float;
        const y = float ? 1.5 + r * 1.2 + rng.range(0, 1.2) : theme === 'ocean' ? 0 : 0.6 + r * 0.9;
        slots.push({ type: ti, float, p: { x: p.x, y, z: p.z, ry: ry + rng.range(-0.25, 0.25), s: (t.scale ?? 1) * rng.range(0.9, 1.1) } });
        placedAny = true;
        if (!float && rng.chance(0.16)) {
          signSlots.push({ sign: rng.int(0, SIGNS.length - 1), p: { x: p.x, y: y + 2.6 * (t.scale ?? 1), z: p.z, ry, s: 1 } });
        }
      }
    }
    if (placedAny && theme !== 'ocean') {
      const mid = track.pointAt(d, side * (hw + 6.5));
      standList.push({ x: mid.x, z: mid.z, ry, len, rows });
    }
  };

  // big grandstands at the start/finish
  addCluster(18, 1, 34, 4);
  addCluster(18, -1, 34, 4);
  // fans watching the jump
  if (track.gap) {
    addCluster(track.gap.rampStart - 16, 1, 18, 3);
    addCluster(track.gap.gapEnd + 18, -1, 18, 3);
  }
  for (let d = 90; d < track.length - 50; d += rng.range(70, 120)) {
    if (track.gap && Math.abs(d - track.gap.gapStart) < 40) continue;
    const side = rng.chance(0.5) ? 1 : -1;
    addCluster(d, side, rng.range(10, 22), rng.int(1, 3));
    if (rng.chance(0.3)) addCluster(d + 8, -side, rng.range(8, 14), rng.int(1, 2));
  }

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: theme === 'candy' ? 0.35 : 0.7 });
  const fans: FanInstance[] = [];
  types.forEach((t, ti) => {
    const list = slots.filter((s) => s.type === ti);
    if (!list.length) return;
    const mesh = instanced(t.proto(), mat, list.map((s) => s.p));
    group.add(mesh);
    list.forEach((s, i) =>
      fans.push({ mesh, index: i, ...s.p, phase: rng.range(0, Math.PI * 2), speed: rng.range(3, 5.5), float: s.float }),
    );
  });

  const signs: FanInstance[] = [];
  SIGNS.forEach(([text, bg, fg], si) => {
    const list = signSlots.filter((s) => s.sign === si);
    if (!list.length) return;
    const tex = signTexture(text, bg, fg);
    const geo = merge([part(new THREE.PlaneGeometry(2.2, 1.1), '#ffffff', 0, 0.4, 0), part(B(0.08, 1.2, 0.08), '#5b3a1a', 0, -0.6, -0.05)]);
    const m = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 });
    const mesh = instanced(geo, m, list.map((s) => s.p));
    group.add(mesh);
    list.forEach((s, i) => signs.push({ mesh, index: i, ...s.p, phase: rng.range(0, 6), speed: rng.range(4, 7), float: false }));
  });

  // grandstand steps
  if (standList.length) {
    const standMat = new THREE.MeshStandardMaterial({
      color: theme === 'pixel' ? '#9ca3af' : theme === 'candy' ? '#fbcfe8' : theme === 'desert' ? '#a16207' : '#475569',
      roughness: 0.8,
    });
    // every step of every stand merged into one mesh (one draw call)
    const steps: THREE.BufferGeometry[] = [];
    for (const s of standList) {
      for (let r = 0; r < s.rows; r++) {
        const h = 0.6 + r * 0.9;
        // rows go outward from the track
        const off = -r * 2.0;
        const g = new THREE.BoxGeometry(s.len + 2, h, 2.0);
        g.applyMatrix4(
          _m.compose(_v.set(s.x + Math.sin(s.ry) * off, h / 2, s.z + Math.cos(s.ry) * off), _q.setFromEuler(_e.set(0, s.ry, 0)), _s.set(1, 1, 1)),
        );
        steps.push(g);
      }
    }
    const stands = new THREE.Mesh(mergeGeometries(steps, false)!, standMat);
    steps.forEach((g) => g.dispose());
    stands.receiveShadow = true;
    group.add(stands);
  }

  return { fans, signs };
}

// ---------------------------------------------------------------- decor

function scatter(
  track: Track,
  rng: Rng,
  count: number,
  minDist: number,
  maxDist: number,
  scaleMin: number,
  scaleMax: number,
  extent = 650,
): Placement[] {
  const out: Placement[] = [];
  let tries = 0;
  while (out.length < count && tries < count * 40) {
    tries++;
    const x = rng.range(-extent, extent);
    const z = rng.range(-extent, extent);
    const d = track.distToCenter(x, z, Math.min(maxDist, 200));
    if (d < minDist || (maxDist < 200 && d > maxDist)) continue;
    if (track.inChasm(x, z, 12)) continue;
    out.push({ x, y: 0, z, ry: rng.range(0, Math.PI * 2), s: rng.range(scaleMin, scaleMax) });
  }
  return out;
}

const vc = (rough = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, ...extra });

function decorCity(track: Track, rng: Rng, g: THREE.Group) {
  const hw = track.halfWidth;
  // buildings merged into one mesh with per-building UV scaling
  const parts: THREE.BufferGeometry[] = [];
  const spots = scatter(track, rng, 230, hw + 34, 999, 1, 1, 760);
  const palette = ['#3b3355', '#2f3d5c', '#4a3550', '#293548', '#3d2e4a', '#1f2b40'];
  for (const p of spots) {
    const w = rng.range(14, 30);
    const d = rng.range(14, 30);
    const far = track.distToCenter(p.x, p.z, 200);
    const h = rng.range(18, 50) + (far / 200) * rng.range(20, 90);
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4);
      const isTop = face === 2 || face === 3;
      const sx = isTop ? 0 : (face < 2 ? d : w) / 8;
      const sy = isTop ? 0 : h / 16;
      uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
    }
    parts.push(part(geo, rng.pick(palette), p.x, h / 2, p.z, 0, rng.pick([0, Math.PI / 2]) + rng.range(-0.05, 0.05)));
  }
  const winTex = windowsTexture(5, '#ffd27a');
  const buildings = new THREE.Mesh(
    merge(parts),
    new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: 0.65, roughness: 0.7, metalness: 0.1 }),
  );
  g.add(buildings);

  // street lamps along both sides
  const lampSpots: Placement[] = [];
  const bulbs: Placement[] = [];
  for (let d = 0; d < track.length; d += 44) {
    for (const side of [-1, 1]) {
      const p = track.pointAt(d, side * (hw + 3.6));
      if (track.inChasm(p.x, p.z, 4)) continue;
      if (track.distToCenter(p.x, p.z, 50) < hw + 2.5) continue;
      const s = track.sampleAt(d);
      const ry = Math.atan2(-s.nx * side, -s.nz * side);
      lampSpots.push({ x: p.x, y: 0, z: p.z, ry, s: 1 });
      bulbs.push({ x: p.x + Math.sin(ry) * 2.2, y: 8.6, z: p.z + Math.cos(ry) * 2.2, ry, s: 1 });
    }
  }
  const lampGeo = merge([part(C(0.15, 0.22, 9, 8), '#3f3f46', 0, 4.5, 0), part(B(0.16, 0.16, 2.6), '#3f3f46', 0, 8.9, 1.2)]);
  g.add(instanced(lampGeo, vc(0.5, { metalness: 0.6 }), lampSpots));
  g.add(instanced(new THREE.BoxGeometry(0.7, 0.25, 1.0), new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffd27a', emissiveIntensity: 1.9 }), bulbs));

  // trees in small parks
  const treeGeo = merge([part(C(0.25, 0.35, 2.4, 8), '#5b3a1a', 0, 1.2, 0), part(S(1.6, 10, 8), '#2f7d32', 0, 3.4, 0), part(S(1.1, 10, 8), '#3a9440', 0.5, 4.3, 0.3)]);
  g.add(instanced(treeGeo, vc(), scatter(track, rng, 120, hw + 8, 34, 0.8, 1.4)));

  // neon billboards
  const neon = ['#d98bb3', '#6cc4d6', '#a9c97a', '#e2c46a'];
  for (let i = 0; i < 10; i++) {
    const d = (track.length / 10) * i + 30;
    const side = i % 2 ? 1 : -1;
    const p = track.pointAt(d, side * (hw + 16));
    if (track.inChasm(p.x, p.z, 10) || track.distToCenter(p.x, p.z, 50) < hw + 8) continue;
    const s = track.sampleAt(d);
    const c = neon[i % neon.length];
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(12, 5, 0.4),
      new THREE.MeshStandardMaterial({ color: '#111', emissive: c, emissiveIntensity: 0.75 }),
    );
    board.position.set(p.x, 9, p.z);
    board.rotation.y = Math.atan2(s.nx * side, s.nz * side);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), new THREE.MeshStandardMaterial({ color: '#27272a' }));
    pole.position.set(p.x, 3.5, p.z);
    g.add(board, pole);
  }
}

function decorDesert(track: Track, rng: Rng, g: THREE.Group) {
  const hw = track.halfWidth;
  const sand = new THREE.MeshStandardMaterial({ color: '#e2a85f', roughness: 1 });
  const dunes = scatter(track, rng, 70, hw + 60, 999, 1, 1, 900).map((p) => ({ ...p, s: rng.range(25, 70) }));
  const duneMesh = instanced(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), sand, dunes);
  // flatten dunes
  dunes.forEach((p, i) => {
    _m.compose(_v.set(p.x, -1, p.z), _q.setFromEuler(_e.set(0, p.ry, 0)), _s.set(p.s, p.s * 0.28, p.s * 0.7));
    duneMesh.setMatrixAt(i, _m);
  });
  g.add(duneMesh);

  const cactus = merge([
    part(C(0.55, 0.6, 5, 10), '#2f8a3b', 0, 2.5, 0),
    part(S(0.55, 10, 6), '#2f8a3b', 0, 5, 0),
    part(C(0.35, 0.35, 1.6, 8), '#2f8a3b', 1.1, 2.4, 0, 0, 0, Math.PI / 2),
    part(C(0.35, 0.35, 2, 8), '#2f8a3b', 1.8, 3.3, 0),
    part(C(0.3, 0.3, 1.2, 8), '#2f8a3b', -0.9, 3.0, 0, 0, 0, Math.PI / 2),
    part(C(0.3, 0.3, 1.5, 8), '#2f8a3b', -1.4, 3.7, 0),
    part(S(0.25, 8, 6), '#f472b6', 0, 5.5, 0),
  ]);
  g.add(instanced(cactus, vc(), scatter(track, rng, 160, hw + 7, 160, 0.7, 1.5), true));

  const rock = merge([part(new THREE.DodecahedronGeometry(1.5, 0), '#a0522d', 0, 0.8, 0), part(new THREE.DodecahedronGeometry(0.9, 0), '#8b4513', 1.3, 0.5, 0.4)]);
  g.add(instanced(rock, vc(1, { flatShading: true }), scatter(track, rng, 90, hw + 6, 200, 0.6, 2.5)));

  // pyramids on the horizon
  const pyrMat = new THREE.MeshStandardMaterial({ color: '#e6b46e', roughness: 1, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(780, 950);
    const size = rng.range(60, 120);
    const pyr = new THREE.Mesh(new THREE.ConeGeometry(size, size * 0.85, 4), pyrMat);
    pyr.position.set(Math.cos(a) * r, size * 0.42, Math.sin(a) * r);
    pyr.rotation.y = rng.range(0, Math.PI);
    g.add(pyr);
  }

  // oasis with palms
  const palm = merge([
    part(C(0.25, 0.4, 7, 8), '#8b5a2b', 0, 3.5, 0, 0.05, 0, 0.08),
    ...[0, 1, 2, 3, 4, 5].map((i) => part(B(0.8, 0.08, 3.6), '#3f9b3f', Math.sin((i / 6) * Math.PI * 2) * 1.6, 7, Math.cos((i / 6) * Math.PI * 2) * 1.6, -0.35, (i / 6) * Math.PI * 2, 0)),
  ]);
  const oases = scatter(track, rng, 5, hw + 30, 120, 1, 1);
  const water = new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.1, metalness: 0.3, emissive: '#0ea5e9', emissiveIntensity: 0.2 });
  const palms: Placement[] = [];
  for (const o of oases) {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(9, 24), water);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(o.x, 0.05, o.z);
    g.add(pool);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rng.range(0, 0.6);
      palms.push({ x: o.x + Math.cos(a) * 12, y: 0, z: o.z + Math.sin(a) * 12, ry: rng.range(0, 6), s: rng.range(0.9, 1.3) });
    }
  }
  g.add(instanced(palm, vc(), palms, true));

  // sun disc
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: '#fff5d6', fog: false }));
  sunDisc.position.set(600, 700, 450);
  sunDisc.lookAt(0, 0, 0);
  g.add(sunDisc);
}

function decorOcean(track: Track, rng: Rng, g: THREE.Group) {
  const hw = track.halfWidth;
  const coralCols = ['#fb7185', '#f97316', '#facc15', '#a855f7', '#22d3ee', '#f472b6'];
  for (const col of coralCols) {
    const coral = merge([
      part(C(0.3, 0.5, 2.5, 7), col, 0, 1.25, 0),
      part(C(0.2, 0.3, 1.8, 7), col, 0.6, 2.2, 0, 0, 0, -0.6),
      part(C(0.2, 0.3, 1.6, 7), col, -0.6, 2.0, 0.2, 0.2, 0, 0.6),
      part(S(0.4, 8, 6), col, 0, 2.6, 0),
      part(S(0.3, 8, 6), col, 1.1, 2.9, 0),
      part(S(0.3, 8, 6), col, -1.0, 2.7, 0.4),
    ]);
    g.add(instanced(coral, vc(0.5, { emissive: col, emissiveIntensity: 0.1 }), scatter(track, rng, 40, hw + 5, 140, 0.8, 2.2)));
  }
  const brain = merge([part(S(1.4, 12, 8), '#f9a8d4', 0, 0.4, 0, 0, 0, 0, 1, 0.6, 1)]);
  g.add(instanced(brain, vc(0.6), scatter(track, rng, 60, hw + 5, 160, 0.6, 2)));
  const rock = merge([part(new THREE.DodecahedronGeometry(2, 0), '#4b5d6b', 0, 1, 0), part(new THREE.DodecahedronGeometry(1.2, 0), '#3f4f5b', 1.8, 0.6, 0.5)]);
  g.add(instanced(rock, vc(1, { flatShading: true }), scatter(track, rng, 80, hw + 6, 250, 1, 4)));
  const star = merge(
    [0, 1, 2, 3, 4].map((i) => part(K(0.25, 0.9, 4), '#fb923c', Math.sin((i / 5) * Math.PI * 2) * 0.4, 0.1, Math.cos((i / 5) * Math.PI * 2) * 0.4, Math.PI / 2, 0, -(i / 5) * Math.PI * 2, 1, 1, 0.4)),
  );
  g.add(instanced(star, vc(0.6), scatter(track, rng, 70, hw + 4, 60, 0.8, 1.4)));
  // sunken treasure chests
  const chest = merge([part(B(2, 1.2, 1.3), '#7c4a1e', 0, 0.6, 0), part(B(2.05, 0.2, 1.35), '#facc15', 0, 1.0, 0), part(B(0.3, 0.4, 0.1), '#facc15', 0, 0.8, 0.7)]);
  g.add(instanced(chest, vc(0.5, { emissive: '#facc15', emissiveIntensity: 0.1 }), scatter(track, rng, 8, hw + 10, 60, 1, 1.4)));
}

function decorPixel(track: Track, rng: Rng, g: THREE.Group) {
  const hw = track.halfWidth;
  const tree = merge([part(B(1, 4, 1), '#7a4a1e', 0, 2, 0), part(B(4, 3, 4), '#2e9e3a', 0, 5, 0), part(B(2.6, 2, 2.6), '#3fbf4a', 0, 7.2, 0)]);
  g.add(instanced(tree, vc(1), scatter(track, rng, 170, hw + 7, 250, 0.8, 1.6), true));
  // blocky hills
  const hills: Placement[] = scatter(track, rng, 40, hw + 50, 999, 1, 1, 900);
  const hillParts: THREE.BufferGeometry[] = [];
  for (const h of hills) {
    const lv = rng.int(2, 5);
    for (let i = 0; i < lv; i++) {
      const size = (lv - i) * 10;
      hillParts.push(part(B(size, 6, size), i === lv - 1 ? '#5bc236' : '#4caf2a', h.x, 3 + i * 6, h.z));
    }
  }
  if (hillParts.length) g.add(new THREE.Mesh(merge(hillParts), vc(1)));
  // pipes
  const pipe = merge([part(C(1.4, 1.4, 4, 16), '#16a34a', 0, 2, 0), part(C(1.75, 1.75, 1.2, 16), '#22c55e', 0, 4.4, 0), part(C(1.2, 1.2, 0.1, 16), '#052e16', 0, 5.0, 0)]);
  g.add(instanced(pipe, vc(0.5), scatter(track, rng, 24, hw + 7, 80, 1, 1.6), true));
  // clouds
  const cloud = merge([part(B(10, 3, 6), '#eef2f6', 0, 0, 0), part(B(6, 3, 5), '#eef2f6', 3, 2, 0), part(B(5, 2, 4), '#eef2f6', -3, 1.5, 0)]);
  g.add(instanced(cloud, vc(1, { emissive: '#ffffff', emissiveIntensity: 0.08 }), scatter(track, rng, 40, 0, 999, 1.5, 3, 800).map((p) => ({ ...p, y: rng.range(70, 140) }))));
}

function decorCandy(track: Track, rng: Rng, g: THREE.Group) {
  const hw = track.halfWidth;
  // lollipops: stick instanced + swirl disc per colour pair
  const pairs: [string, string][] = [['#e86b95', '#efe6ea'], ['#6cc6d9', '#efe6ea'], ['#ecc95a', '#e8925a'], ['#a985d9', '#f1bad3']];
  for (const [a, b] of pairs) {
    const spots = scatter(track, rng, 18, hw + 7, 150, 1, 2.2);
    g.add(instanced(merge([part(C(0.2, 0.2, 7, 8), '#ebe7e9', 0, 3.5, 0)]), vc(0.5), spots));
    const disc = new THREE.CylinderGeometry(2.4, 2.4, 0.5, 28);
    disc.rotateX(Math.PI / 2);
    disc.translate(0, 8.5, 0);
    const discMat = new THREE.MeshStandardMaterial({ map: swirlTexture(a, b), roughness: 0.25 });
    g.add(instanced(disc, discMat, spots, true));
  }
  // candy canes
  const caneTex = stripeTexture('#ece6e8', '#d9535d');
  const caneGeo = (() => {
    const stick = new THREE.CylinderGeometry(0.4, 0.4, 7, 12);
    stick.translate(0, 3.5, 0);
    const hook = new THREE.TorusGeometry(1.2, 0.4, 10, 16, Math.PI);
    hook.translate(1.2, 7, 0);
    return mergeGeometries([stick, hook])!;
  })();
  caneTex.repeat.set(2, 4);
  g.add(instanced(caneGeo, new THREE.MeshStandardMaterial({ map: caneTex, roughness: 0.3 }), scatter(track, rng, 40, hw + 6, 120, 0.8, 1.6), true));
  // cupcakes
  const cup = merge([
    part(C(1.6, 1.2, 1.8, 14), '#f59e0b', 0, 0.9, 0),
    part(S(1.75, 14, 10), '#fbcfe8', 0, 2.0, 0, 0, 0, 0, 1, 0.7, 1),
    part(S(1.0, 12, 8), '#f9a8d4', 0, 2.8, 0, 0, 0, 0, 1, 0.8, 1),
    part(S(0.35, 8, 6), '#dc2626', 0, 3.6, 0),
  ]);
  g.add(instanced(cup, vc(0.4), scatter(track, rng, 50, hw + 6, 200, 1, 2.5), true));
  // donuts
  const donut = merge([part(new THREE.TorusGeometry(1.6, 0.8, 12, 20), '#d97706', 0, 0, 0), part(new THREE.TorusGeometry(1.6, 0.82, 12, 20, Math.PI * 2), '#f472b6', 0, 0.2, 0, 0, 0, 0, 1, 1, 0.8)]);
  const donuts = scatter(track, rng, 30, hw + 8, 200, 1, 2.2).map((p) => ({ ...p, y: 2.4 * p.s }));
  const dm = instanced(donut, vc(0.35), donuts);
  donuts.forEach((p, i) => {
    _m.compose(_v.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(0, p.ry, 0)), _s.set(p.s, p.s, p.s));
    dm.setMatrixAt(i, _m);
  });
  g.add(dm);
  // gumdrops
  const gumCols = ['#ef4444', '#22c55e', '#facc15', '#3b82f6', '#a855f7'];
  for (const c of gumCols) {
    const geo = merge([part(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), c, 0, 0, 0)]);
    g.add(instanced(geo, vc(0.2, { emissive: c, emissiveIntensity: 0.15 }), scatter(track, rng, 24, hw + 5, 180, 0.8, 2.5)));
  }
  // cotton-candy clouds
  const cloud = merge([part(S(6, 12, 8), '#fbcfe8', 0, 0, 0), part(S(4.5, 12, 8), '#f5d0fe', 5, 1, 0), part(S(4, 12, 8), '#fce7f3', -5, 0.5, 1)]);
  g.add(instanced(cloud, vc(1, { emissive: '#fbcfe8', emissiveIntensity: 0.1 }), scatter(track, rng, 30, 0, 999, 1.5, 3, 800).map((p) => ({ ...p, y: rng.range(70, 130) }))));
}

// ---------------------------------------------------------------- sky

function buildSky(theme: ThemeId) {
  const st = THEME_STYLES[theme];
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(st.skyTop) },
      horizon: { value: new THREE.Color(st.skyHorizon) },
      bottom: { value: new THREE.Color(st.skyBottom) },
      sunDir: { value: new THREE.Vector3(...st.sunDir).normalize() },
      sunColor: { value: new THREE.Color(st.sun) },
      clouds: { value: theme === 'ocean' ? 0 : theme === 'city' ? 0.35 : 1 },
      night: { value: theme === 'city' ? 0.6 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      uniform vec3 sunDir; uniform vec3 sunColor; uniform float clouds; uniform float night;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.4));
        // sun disc + wide glow (a moon-like glow at night)
        float sd = max(dot(dir, sunDir), 0.0);
        c += sunColor * (pow(sd, 900.0) * (night > 0.5 ? 1.2 : 2.2) + pow(sd, 12.0) * 0.25 + pow(sd, 3.0) * 0.1);
        // drifting cloud layer projected on a dome
        if (h > 0.0 && clouds > 0.0) {
          vec2 uv = dir.xz / (h + 0.18) * 1.6;
          float n = fbm(uv + vec2(0.0, 0.0));
          float cov = smoothstep(0.52, 0.78, n) * smoothstep(0.0, 0.25, h);
          vec3 cloudCol = mix(horizon * 1.1, vec3(1.0), 0.55 - night * 0.35) + sunColor * pow(sd, 6.0) * 0.4;
          c = mix(c, cloudCol, cov * clouds * 0.85);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), mat);
  sky.renderOrder = -10;
  return sky;
}

// ---------------------------------------------------------------- ambient particles (bubbles, sparkles)

function ambientParticles(theme: ThemeId) {
  if (theme !== 'ocean' && theme !== 'candy' && theme !== 'city') return null;
  const count = theme === 'ocean' ? 700 : 400;
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const rng = makeRng(99);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng.range(-120, 120);
    pos[i * 3 + 1] = rng.range(0, 60);
    pos[i * 3 + 2] = rng.range(-120, 120);
    seeds[i] = rng.next();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = theme === 'ocean' ? '#bae6fd' : theme === 'candy' ? '#ffffff' : '#fde68a';
  const mat = new THREE.PointsMaterial({
    map: softDotTexture(),
    color,
    size: theme === 'ocean' ? 0.9 : 0.6,
    transparent: true,
    opacity: theme === 'city' ? 0.5 : 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  const rise = theme === 'ocean' ? 4 : theme === 'candy' ? -1.5 : 0.6;
  return {
    pts,
    update(dt: number, focus: THREE.Vector3, t: number) {
      const a = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        let x = a.getX(i);
        let y = a.getY(i) + (rise * (0.5 + seeds[i])) * dt;
        let z = a.getZ(i);
        x += Math.sin(t * 0.8 + seeds[i] * 20) * dt * 0.6;
        // keep a box of particles around the camera focus
        if (x - focus.x > 120) x -= 240;
        if (x - focus.x < -120) x += 240;
        if (z - focus.z > 120) z -= 240;
        if (z - focus.z < -120) z += 240;
        if (y > 60) y = 0;
        if (y < 0) y = 60;
        a.setXYZ(i, x, y, z);
      }
      a.needsUpdate = true;
    },
  };
}

/** Schools of fish swimming in circles above the reef */
function fishSchools(rng: Rng, g: THREE.Group) {
  const geo = fish('#fde047', '#38bdf8')();
  const geo2 = fish('#93c5fd', '#e0f2fe')();
  const mat = vc(0.5);
  const schools: { mesh: THREE.InstancedMesh; cx: number; cz: number; r: number; y: number; speed: number; offs: number[] }[] = [];
  for (let i = 0; i < 9; i++) {
    const n = 14;
    const mesh = new THREE.InstancedMesh(i % 2 ? geo : geo2, mat, n);
    mesh.frustumCulled = false;
    const offs = Array.from({ length: n * 3 }, () => rng.range(-4, 4));
    schools.push({ mesh, cx: rng.range(-450, 450), cz: rng.range(-450, 450), r: rng.range(40, 120), y: rng.range(10, 30), speed: rng.range(0.08, 0.18) * (rng.chance(0.5) ? 1 : -1), offs });
    g.add(mesh);
  }
  return (t: number) => {
    for (const s of schools) {
      for (let k = 0; k < s.mesh.count; k++) {
        const a = t * s.speed + k * 0.05;
        const x = s.cx + Math.cos(a) * (s.r + s.offs[k * 3]);
        const z = s.cz + Math.sin(a) * (s.r + s.offs[k * 3 + 1]);
        const y = s.y + s.offs[k * 3 + 2] + Math.sin(t * 2 + k) * 0.5;
        const heading = Math.atan2(-Math.sin(a) * Math.sign(s.speed), Math.cos(a) * Math.sign(s.speed));
        _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(0, heading, Math.sin(t * 6 + k) * 0.1)), _s.set(1.4, 1.4, 1.4));
        s.mesh.setMatrixAt(k, _m);
      }
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  };
}

function kelpForest(track: Track, rng: Rng, g: THREE.Group) {
  const hw = track.halfWidth;
  const geo = new THREE.BoxGeometry(0.5, 1, 0.15, 1, 6, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: '#2f9e44', roughness: 0.8, side: THREE.DoubleSide });
  const spots = scatter(track, rng, 260, hw + 6, 200, 1, 1);
  const heights = spots.map(() => rng.range(6, 18));
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  g.add(mesh);
  return (t: number) => {
    spots.forEach((p, i) => {
      _m.compose(_v.set(p.x, 0, p.z), _q.setFromEuler(_e.set(Math.sin(t * 1.2 + i) * 0.12, p.ry, Math.cos(t * 0.9 + i * 1.7) * 0.12)), _s.set(1, heights[i], 1));
      mesh.setMatrixAt(i, _m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
}

function floatingBlocks(track: Track, rng: Rng, g: THREE.Group) {
  const hw = track.halfWidth;
  const tex = itemBoxTexture();
  const mat = new THREE.MeshStandardMaterial({ color: '#facc15', map: tex, emissive: '#b45309', emissiveIntensity: 0.4, roughness: 0.4 });
  const spots = scatter(track, rng, 30, hw + 6, 40, 1, 1).map((p) => ({ ...p, y: rng.range(7, 12) }));
  const mesh = instanced(new THREE.BoxGeometry(2.4, 2.4, 2.4), mat, spots);
  g.add(mesh);
  return (t: number) => {
    spots.forEach((p, i) => {
      _m.compose(_v.set(p.x, p.y + Math.sin(t * 2 + i) * 0.6, p.z), _q.setFromEuler(_e.set(0, t + i, 0)), _s.set(1, 1, 1));
      mesh.setMatrixAt(i, _m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
}

function lightRays(rng: Rng, g: THREE.Group) {
  const mat = new THREE.MeshBasicMaterial({ color: '#a5f3fc', transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  for (let i = 0; i < 24; i++) {
    const ray = new THREE.Mesh(new THREE.CylinderGeometry(3, 14, 140, 12, 1, true), mat);
    ray.position.set(rng.range(-500, 500), 60, rng.range(-500, 500));
    ray.rotation.z = rng.range(-0.25, 0.25);
    g.add(ray);
  }
}

function stars(rng: Rng, g: THREE.Group) {
  const n = 600;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const h = rng.range(0.25, 1);
    const r = 1500;
    pos[i * 3] = Math.cos(a) * Math.sqrt(1 - h * h) * r;
    pos[i * 3 + 1] = h * r;
    pos[i * 3 + 2] = Math.sin(a) * Math.sqrt(1 - h * h) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
  g.add(pts);
}

// ---------------------------------------------------------------- main

export function buildEnvironment(scene: THREE.Scene, track: Track, theme: ThemeId, seed: number): Environment {
  const st = THEME_STYLES[theme];
  const rng = makeRng(seed * 7 + 3);
  const group = new THREE.Group();

  scene.background = new THREE.Color(st.fog);
  scene.fog = new THREE.Fog(st.fog, st.fogNear, st.fogFar);
  group.add(buildSky(theme));

  const hemi = new THREE.HemisphereLight(st.hemiSky, st.hemiGround, st.hemiIntensity);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(st.sun, st.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70;
  sc.right = 70;
  sc.top = 70;
  sc.bottom = -70;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  group.add(sun);
  group.add(sun.target);

  const updaters: ((t: number, dt: number, focus: THREE.Vector3) => void)[] = [];

  switch (theme) {
    case 'city':
      decorCity(track, rng, group);
      stars(rng, group);
      break;
    case 'desert':
      decorDesert(track, rng, group);
      break;
    case 'ocean': {
      decorOcean(track, rng, group);
      lightRays(rng, group);
      const f = fishSchools(rng, group);
      const k = kelpForest(track, rng, group);
      updaters.push((t) => {
        f(t);
        k(t);
      });
      break;
    }
    case 'pixel': {
      decorPixel(track, rng, group);
      const fb = floatingBlocks(track, rng, group);
      updaters.push((t) => fb(t));
      break;
    }
    case 'candy':
      decorCandy(track, rng, group);
      break;
  }

  const amb = ambientParticles(theme);
  if (amb) {
    group.add(amb.pts);
    updaters.push((t, dt, f) => amb.update(dt, f, t));
  }

  const { fans, signs } = buildSpectators(track, theme, rng, group);
  const dirty = new Set<THREE.InstancedMesh>();
  const sunDir = new THREE.Vector3(...st.sunDir).normalize();

  scene.add(group);

  return {
    group,
    sun,
    update(t, dt, focus) {
      // shadow camera follows the action
      sun.position.copy(focus).addScaledVector(sunDir, 150);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();

      for (const u of updaters) u(t, dt, focus);

      // animate nearby fans only (cheap)
      const animate = (list: FanInstance[]) => {
        for (const f of list) {
          const dx = f.x - focus.x;
          const dz = f.z - focus.z;
          if (dx * dx + dz * dz > 160 * 160) continue;
          const bob = f.float
            ? Math.sin(t * 2 + f.phase) * 0.4
            : Math.max(0, Math.sin(t * f.speed + f.phase)) * 0.45;
          const wob = f.float ? Math.sin(t * 5 + f.phase) * 0.25 : Math.sin(t * f.speed * 0.5 + f.phase) * 0.08;
          _m.compose(_v.set(f.x, f.y + bob, f.z), _q.setFromEuler(_e.set(0, f.ry + wob, f.float ? 0 : wob)), _s.set(f.s, f.s, f.s));
          f.mesh.setMatrixAt(f.index, _m);
          dirty.add(f.mesh);
        }
      };
      animate(fans);
      animate(signs);
      dirty.forEach((m) => (m.instanceMatrix.needsUpdate = true));
      dirty.clear();
    },
  };
}
