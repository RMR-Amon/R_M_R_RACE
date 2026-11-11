import * as THREE from 'three';
import type { Accessory, DriverLook } from './types';
import { PartBin, T, roundBox } from './meshKit';

/**
 * Articulated racing driver. Every limb segment is a single merged, vertex-coloured mesh, so a
 * whole driver costs ~14 draw calls instead of ~40.
 */
export interface DriverModel {
  root: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  cape: THREE.Mesh | null;
  setHelmet(on: boolean): void;
  stand(): void;
  /** phase in radians; one full cycle = two steps */
  walk(phase: number): void;
  /** raise one arm and wave; side 1 = left hand, -1 = right hand */
  wave(t: number, side: number): void;
  sit(): void;
  dispose(): void;
}

/** height of the hip joint above the feet */
export const HIP_H = 0.95;

const DARK = '#17181d';
const SOLE = '#3a3b42';
const WHITE = '#eeeeee';
const GOLD = '#e8b83a';

const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

export function buildDriver(look: DriverLook): DriverModel {
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mk = <M extends THREE.Material>(m: M) => (mats.push(m), m);
  const cloth = mk(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.04 }));
  const gloss = mk(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06 }));
  const metal = mk(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.9 }));

  const suit = look.suit;
  const acc = look.suitAccent;
  const suitDark = shade(suit, 0.72);
  const has = (a: Accessory) => look.accessories.includes(a);

  /** builds one merged mesh from a bin under a parent */
  const emit = (bin: PartBin, parent: THREE.Object3D, key = 'c', mat: THREE.Material = cloth) => {
    const m = bin.mesh(key, mat, parent, true);
    if (m) geos.push(m.geometry);
    return m;
  };

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_H;
  root.add(hips);

  // ---------- pelvis
  const pel = new PartBin();
  pel.add('c', roundBox(0.3, 0.18, 0.2, 0.08), suit, T(0, -0.01, 0));
  pel.add('c', roundBox(0.31, 0.05, 0.21, 0.025), DARK, T(0, 0.07, 0)); // belt
  pel.add('c', roundBox(0.07, 0.045, 0.02, 0.01), GOLD, T(0, 0.07, 0.105)); // buckle
  const pelvisMesh = emit(pel, hips);

  // ---------- legs
  const legMeshes: THREE.Object3D[] = [];
  const leg = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.09, -0.03, 0);
    hips.add(hip);
    const thigh = new PartBin();
    thigh.add('c', new THREE.CapsuleGeometry(0.078, 0.28, 4, 12), suit, T(0, -0.21, 0));
    thigh.add('c', new THREE.CylinderGeometry(0.081, 0.081, 0.035, 14), acc, T(0, -0.1, 0)); // stripe band
    const tm = emit(thigh, hip);
    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);
    const shin = new PartBin();
    shin.add('c', new THREE.CapsuleGeometry(0.068, 0.28, 4, 12), suit, T(0, -0.2, 0));
    shin.add('c', new THREE.SphereGeometry(0.075, 12, 8), suitDark, T(0, 0, 0.02, 0, 0, 0, 1, 0.8, 1)); // knee pad
    // boot: rounded, with a light sole and toe cap
    shin.add('c', roundBox(0.13, 0.12, 0.25, 0.05), DARK, T(0, -0.43, 0.045));
    shin.add('c', roundBox(0.135, 0.035, 0.27, 0.015), SOLE, T(0, -0.49, 0.05));
    shin.add('c', new THREE.CylinderGeometry(0.072, 0.072, 0.03, 14), acc, T(0, -0.36, 0)); // cuff
    const sm = emit(shin, knee);
    if (tm) legMeshes.push(tm);
    if (sm) legMeshes.push(sm);
    return { hip, knee };
  };
  const L = leg(1);
  const R = leg(-1);
  if (pelvisMesh) legMeshes.push(pelvisMesh);

  // ---------- torso (lathe: waist → chest → shoulders)
  const spine = new THREE.Group();
  spine.position.y = 0.05;
  hips.add(spine);
  const tor = new PartBin();
  const prof = [
    [0.0, 0.0], [0.135, 0.0], [0.15, 0.08], [0.17, 0.2], [0.185, 0.32], [0.18, 0.42], [0.15, 0.49], [0.09, 0.53], [0.0, 0.54],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  tor.add('c', new THREE.LatheGeometry(prof, 20), suit, T(0, 0, 0, 0, 0, 0, 1.2, 1, 0.82));
  // chest panel + side stripes + collar + zip + chest badge
  tor.add('c', roundBox(0.26, 0.2, 0.05, 0.025), acc, T(0, 0.34, 0.12));
  for (const side of [-1, 1]) tor.add('c', roundBox(0.03, 0.4, 0.12, 0.012), acc, T(side * 0.205, 0.24, 0));
  tor.add('c', new THREE.TorusGeometry(0.075, 0.026, 8, 18), acc, T(0, 0.53, 0, Math.PI / 2, 0, 0));
  tor.add('c', new THREE.BoxGeometry(0.012, 0.3, 0.012), DARK, T(0, 0.27, 0.152));
  tor.add('c', new THREE.CylinderGeometry(0.035, 0.035, 0.01, 14), WHITE, T(0.08, 0.38, 0.15, Math.PI / 2, 0, 0));
  // back number panel
  tor.add('c', roundBox(0.22, 0.2, 0.03, 0.02), acc, T(0, 0.3, -0.135));
  emit(tor, spine);
  const neck = new PartBin();
  neck.add('c', new THREE.CylinderGeometry(0.05, 0.058, 0.1, 12), look.skin, T(0, 0.58, 0));
  emit(neck, spine);

  // ---------- head
  const head = new THREE.Group();
  head.position.y = 0.64;
  spine.add(head);
  const face = new PartBin();
  face.add('c', new THREE.SphereGeometry(0.135, 22, 16), look.skin, T(0, 0.08, 0, 0, 0, 0, 0.94, 1.04, 1));
  for (const side of [-1, 1]) {
    face.add('c', new THREE.SphereGeometry(0.026, 10, 8), WHITE, T(side * 0.047, 0.095, 0.112, 0, 0, 0, 1, 1.15, 0.55));
    face.add('c', new THREE.SphereGeometry(0.015, 8, 6), '#2a1d14', T(side * 0.047, 0.093, 0.125));
    face.add('c', roundBox(0.045, 0.012, 0.012, 0.005), shade(look.hair, 0.9), T(side * 0.048, 0.135, 0.122, 0, 0, side * -0.12));
    face.add('c', new THREE.SphereGeometry(0.03, 10, 8), look.skin, T(side * 0.128, 0.075, 0, 0, 0, 0, 0.45, 1, 0.8)); // ear
    face.add('c', new THREE.SphereGeometry(0.022, 8, 6), '#e8907a', T(side * 0.075, 0.045, 0.108, 0, 0, 0, 1, 0.6, 0.4)); // cheek
  }
  face.add('c', new THREE.SphereGeometry(0.02, 10, 8), shade(look.skin, 0.92), T(0, 0.065, 0.135));
  face.add('c', new THREE.TorusGeometry(0.032, 0.007, 6, 14, Math.PI), '#7a2e2e', T(0, 0.032, 0.122, 0, 0, Math.PI));
  emit(face, head);

  // hair (and everything worn on the head without a helmet)
  const offBin = new PartBin();
  offBin.add('c', new THREE.SphereGeometry(0.143, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), look.hair, T(0, 0.085, -0.012, -0.22, 0, 0));
  offBin.add('c', roundBox(0.2, 0.05, 0.06, 0.025), look.hair, T(0, 0.17, 0.09, 0.5, 0, 0)); // fringe
  if (has('glasses') || has('shades')) {
    const frame = has('shades') ? DARK : GOLD;
    for (const side of [-1, 1]) {
      if (has('shades')) offBin.add('c', roundBox(0.065, 0.04, 0.012, 0.012), DARK, T(side * 0.047, 0.095, 0.135));
      else offBin.add('c', new THREE.TorusGeometry(0.028, 0.005, 6, 16), frame, T(side * 0.047, 0.095, 0.132));
    }
    offBin.add('c', new THREE.BoxGeometry(0.035, 0.006, 0.006), frame, T(0, 0.1, 0.137));
  }
  if (has('cap')) {
    offBin.add('c', new THREE.SphereGeometry(0.148, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), acc, T(0, 0.1, 0));
    offBin.add('c', new THREE.CylinderGeometry(0.11, 0.11, 0.014, 16, 1, false, -Math.PI / 2, Math.PI), acc, T(0, 0.105, 0.1));
  }
  if (has('headphones')) {
    offBin.add('c', new THREE.TorusGeometry(0.15, 0.015, 6, 20, Math.PI), DARK, T(0, 0.08, 0));
    for (const side of [-1, 1]) offBin.add('c', new THREE.CylinderGeometry(0.05, 0.05, 0.04, 14), acc, T(side * 0.145, 0.07, 0, 0, 0, Math.PI / 2));
  }
  const hairMesh = emit(offBin, head);

  // helmet: glossy shell with stripe, chin bar, visor and a small spoiler
  const hel = new PartBin();
  hel.add('c', new THREE.SphereGeometry(0.188, 26, 18), look.helmet, T(0, 0.085, -0.005, 0, 0, 0, 0.95, 1, 1.05));
  hel.add('c', new THREE.TorusGeometry(0.186, 0.016, 6, 30, Math.PI), acc, T(0, 0.085, -0.005, 0, Math.PI / 2, 0, 1, 1, 1));
  hel.add('c', roundBox(0.28, 0.08, 0.12, 0.04), look.helmet, T(0, -0.03, 0.09, 0.15, 0, 0)); // chin bar
  hel.add('c', roundBox(0.14, 0.03, 0.08, 0.015), acc, T(0, 0.21, -0.17, -0.3, 0, 0)); // spoiler
  // SphereGeometry's phi = π/2 is +z (the face), so the visor arc is centred there
  hel.add('v', new THREE.SphereGeometry(0.191, 24, 10, Math.PI * 0.17, Math.PI * 0.66, Math.PI * 0.36, Math.PI * 0.22), look.visor, T(0, 0.085, -0.005, 0, 0, 0, 0.96, 1, 1.06));
  const helmet = new THREE.Group();
  head.add(helmet);
  const hm = emit(hel, helmet, 'c', gloss);
  const vm = emit(hel, helmet, 'v', metal);
  void hm;
  void vm;

  // ---------- arms
  const arm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.235, 0.46, 0);
    spine.add(shoulder);
    const up = new PartBin();
    up.add('c', new THREE.SphereGeometry(0.075, 12, 10), acc, T(0, 0, 0)); // shoulder cap
    up.add('c', new THREE.CapsuleGeometry(0.06, 0.2, 4, 12), suit, T(0, -0.15, 0));
    emit(up, shoulder);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    const fore = new PartBin();
    fore.add('c', new THREE.CapsuleGeometry(0.054, 0.18, 4, 12), suit, T(0, -0.12, 0));
    fore.add('c', new THREE.CylinderGeometry(0.062, 0.058, 0.06, 12), acc, T(0, -0.22, 0)); // glove cuff
    fore.add('c', roundBox(0.1, 0.11, 0.075, 0.035), DARK, T(0, -0.3, 0.005)); // glove
    fore.add('c', new THREE.CapsuleGeometry(0.02, 0.04, 3, 6), DARK, T(-side * 0.05, -0.28, 0.03, 0, 0, side * 0.5)); // thumb
    emit(fore, elbow);
    return { shoulder, elbow };
  };
  const AL = arm(1);
  const AR = arm(-1);

  // ---------- accessories on the body / on top of the helmet
  let topper: THREE.Object3D | null = null;
  if (has('mohawk')) {
    const b = new PartBin();
    const col = look.hair === '#1c1917' ? '#ec4899' : look.hair;
    for (let i = 0; i < 6; i++) b.add('c', new THREE.ConeGeometry(0.028, 0.13, 6), col, T(0, 0, -0.09 + i * 0.037, -0.3 + i * 0.12, 0, 0));
    const g = new THREE.Group();
    g.position.y = 0.2;
    head.add(g);
    emit(b, g);
    topper = g;
  }
  if (has('crown')) {
    const b = new PartBin();
    b.add('c', new THREE.CylinderGeometry(0.09, 0.085, 0.065, 18, 1, true), GOLD);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add('c', new THREE.ConeGeometry(0.019, 0.065, 5), GOLD, T(Math.cos(a) * 0.087, 0.06, Math.sin(a) * 0.087));
      b.add('c', new THREE.SphereGeometry(0.013, 6, 4), i % 2 ? WHITE : look.helmet, T(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09));
    }
    const g = new THREE.Group();
    g.position.y = 0.21;
    head.add(g);
    emit(b, g, 'c', metal);
    topper = g;
  }
  if (has('scarf') || has('chain')) {
    const b = new PartBin();
    if (has('scarf')) {
      b.add('c', new THREE.TorusGeometry(0.078, 0.032, 8, 18), acc, T(0, 0.55, 0, Math.PI / 2, 0, 0));
      b.add('c', roundBox(0.065, 0.23, 0.03, 0.015), acc, T(0.06, 0.43, 0.13, 0, 0, 0.15));
    }
    if (has('chain')) {
      b.add('c', new THREE.TorusGeometry(0.115, 0.008, 6, 24), GOLD, T(0, 0.47, 0.05, Math.PI / 2 - 0.5, 0, 0));
      b.add('c', new THREE.CylinderGeometry(0.032, 0.032, 0.009, 14), GOLD, T(0, 0.39, 0.16, Math.PI / 2, 0, 0));
    }
    emit(b, spine);
  }
  let cape: THREE.Mesh | null = null;
  if (has('cape')) {
    const geo = new THREE.PlaneGeometry(0.5, 0.75, 1, 4);
    geo.translate(0, -0.375, 0);
    geos.push(geo);
    cape = new THREE.Mesh(geo, mk(new THREE.MeshStandardMaterial({ color: acc === suit ? '#dc2626' : acc, roughness: 0.7, side: THREE.DoubleSide })));
    cape.position.set(0, 0.52, -0.15);
    cape.rotation.x = 0.12;
    cape.castShadow = true;
    spine.add(cape);
  }

  const setHelmet = (on: boolean) => {
    helmet.visible = on;
    if (hairMesh) hairMesh.visible = !on;
    // crown / mohawk sit on top of the helmet when it is on
    if (topper) topper.position.y = on ? 0.27 : has('crown') ? 0.21 : 0.2;
  };
  setHelmet(false);

  const showLegs = (v: boolean) => legMeshes.forEach((m) => (m.visible = v));

  const zero = () => {
    for (const g of [hips, spine, head, AL.shoulder, AR.shoulder, AL.elbow, AR.elbow, L.hip, R.hip, L.knee, R.knee]) g.rotation.set(0, 0, 0);
    hips.position.y = HIP_H;
  };

  return {
    root, hips, spine, head,
    armL: AL.shoulder, armR: AR.shoulder, elbowL: AL.elbow, elbowR: AR.elbow,
    legL: L.hip, legR: R.hip, kneeL: L.knee, kneeR: R.knee,
    cape,
    setHelmet,
    stand() {
      zero();
      showLegs(true);
      AL.shoulder.rotation.z = 0.1;
      AR.shoulder.rotation.z = -0.1;
      AL.elbow.rotation.x = -0.12;
      AR.elbow.rotation.x = -0.12;
    },
    walk(phase: number) {
      zero();
      showLegs(true);
      const s = Math.sin(phase);
      L.hip.rotation.x = -s * 0.55;
      R.hip.rotation.x = s * 0.55;
      L.knee.rotation.x = Math.max(0, s) * 0.7;
      R.knee.rotation.x = Math.max(0, -s) * 0.7;
      AL.shoulder.rotation.x = s * 0.5;
      AR.shoulder.rotation.x = -s * 0.5;
      AL.elbow.rotation.x = -0.35;
      AR.elbow.rotation.x = -0.35;
      AL.shoulder.rotation.z = 0.1;
      AR.shoulder.rotation.z = -0.1;
      hips.position.y = HIP_H + Math.abs(Math.cos(phase)) * 0.03;
      spine.rotation.y = s * 0.08;
      if (cape) cape.rotation.x = 0.35 + Math.abs(s) * 0.15;
    },
    wave(t: number, side: number) {
      const sh = side > 0 ? AL : AR;
      sh.shoulder.rotation.set(0, 0, side * 2.55);
      sh.elbow.rotation.set(0, 0, side * (0.35 + Math.sin(t * 11) * 0.45));
      head.rotation.y = side * 0.25;
    },
    sit() {
      zero();
      // legs are hidden inside the car: skip drawing them
      showLegs(false);
      for (const l of [L, R]) {
        l.hip.rotation.x = -1.45;
        l.knee.rotation.x = 1.35;
      }
      L.hip.rotation.z = 0.12;
      R.hip.rotation.z = -0.12;
      // hands on the steering wheel
      AL.shoulder.rotation.set(-1.0, 0, 0.25);
      AR.shoulder.rotation.set(-1.0, 0, -0.25);
      AL.elbow.rotation.set(-0.7, 0, 0);
      AR.elbow.rotation.set(-0.7, 0, 0);
      spine.rotation.x = -0.12;
      if (cape) cape.rotation.x = 0.05;
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
