import * as THREE from 'three';
import type { Accessory, DriverLook } from './types';

/** Articulated racing driver built from rounded primitives */
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

const capsule = (r: number, len: number, mat: THREE.Material, y = 0) => {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
};

export function buildDriver(look: DriverLook): DriverModel {
  const mats: THREE.Material[] = [];
  const mk = <T extends THREE.Material>(m: T) => (mats.push(m), m);
  const suit = mk(new THREE.MeshStandardMaterial({ color: look.suit, roughness: 0.55, metalness: 0.05 }));
  const stripe = mk(new THREE.MeshStandardMaterial({ color: look.suitAccent, roughness: 0.5 }));
  const skin = mk(new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.75 }));
  const dark = mk(new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.6 }));
  const hairMat = mk(new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.85 }));
  const helmetMat = mk(new THREE.MeshPhysicalMaterial({ color: look.helmet, roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const visorMat = mk(new THREE.MeshStandardMaterial({ color: look.visor, roughness: 0.05, metalness: 0.95 }));
  const gold = mk(new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.2, metalness: 1, emissive: '#7c4a03', emissiveIntensity: 0.25 }));
  const eyeMat = mk(new THREE.MeshStandardMaterial({ color: '#0b0b0f', roughness: 0.2 }));
  const white = mk(new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.4 }));

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_H;
  root.add(hips);
  const pelvis = capsule(0.13, 0.14, suit);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1, 0.85);
  hips.add(pelvis);

  // ---------- legs
  const leg = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, -0.02, 0);
    hips.add(hip);
    hip.add(capsule(0.075, 0.3, suit, -0.21));
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    hip.add(knee);
    knee.add(capsule(0.064, 0.32, suit, -0.22));
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.14, 3, 8), dark);
    boot.rotation.x = Math.PI / 2;
    boot.position.set(0, -0.47, 0.05);
    boot.castShadow = true;
    knee.add(boot);
    return { hip, knee };
  };
  const L = leg(1);
  const R = leg(-1);

  // ---------- torso
  const spine = new THREE.Group();
  spine.position.y = 0.04;
  hips.add(spine);
  const torso = capsule(0.16, 0.3, suit, 0.3);
  torso.scale.set(1.2, 1, 0.8);
  spine.add(torso);
  for (const side of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.42, 0.06), stripe);
    s.position.set(side * 0.186, 0.3, 0);
    spine.add(s);
  }
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 18), stripe);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1.2, 0.85, 1);
  belt.position.y = 0.06;
  spine.add(belt);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), skin);
  neck.position.y = 0.58;
  spine.add(neck);

  // ---------- head
  const head = new THREE.Group();
  head.position.y = 0.66;
  spine.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), skin);
  skull.scale.set(0.92, 1.06, 0.98);
  skull.position.y = 0.06;
  skull.castShadow = true;
  head.add(skull);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), eyeMat);
    eye.position.set(side * 0.042, 0.08, 0.108);
    head.add(eye);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), skin);
    ear.scale.set(0.5, 1, 0.8);
    ear.position.set(side * 0.112, 0.06, 0);
    head.add(ear);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skin);
  nose.position.set(0, 0.05, 0.12);
  head.add(nose);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 4, 12, Math.PI), eyeMat);
  smile.rotation.z = Math.PI;
  smile.position.set(0, 0.015, 0.112);
  head.add(smile);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  hair.position.set(0, 0.075, -0.012);
  hair.rotation.x = -0.25;
  head.add(hair);

  const helmet = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.165, 22, 16), helmetMat);
  shell.scale.set(0.95, 1, 1.05);
  shell.position.y = 0.07;
  shell.castShadow = true;
  helmet.add(shell);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.168, 20, 10, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.24), visorMat);
  visor.scale.set(0.96, 1, 1.06);
  visor.position.y = 0.07;
  helmet.add(visor);
  const hStripe = new THREE.Mesh(new THREE.TorusGeometry(0.163, 0.012, 6, 28, Math.PI), stripe);
  hStripe.rotation.y = Math.PI / 2;
  hStripe.position.y = 0.07;
  helmet.add(hStripe);
  head.add(helmet);

  // ---------- arms
  const arm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.24, 0.48, 0);
    spine.add(shoulder);
    shoulder.add(capsule(0.058, 0.22, suit, -0.15));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    elbow.add(capsule(0.052, 0.2, suit, -0.13));
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 8), dark);
    glove.position.y = -0.29;
    glove.scale.set(0.9, 1.1, 0.8);
    elbow.add(glove);
    return { shoulder, elbow };
  };
  const AL = arm(1);
  const AR = arm(-1);

  // ---------- accessories
  const has = (a: Accessory) => look.accessories.includes(a);
  const offHelmet: THREE.Object3D[] = [hair];
  let topper: THREE.Object3D | null = null;
  if (has('glasses') || has('shades')) {
    const g = new THREE.Group();
    const frameMat = has('shades') ? dark : gold;
    for (const side of [-1, 1]) {
      if (has('shades')) {
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), dark);
        lens.scale.set(1.2, 0.8, 0.35);
        lens.position.set(side * 0.045, 0.085, 0.118);
        g.add(lens);
      } else {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.005, 6, 16), frameMat);
        ring.position.set(side * 0.045, 0.085, 0.118);
        g.add(ring);
      }
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.006, 0.006), frameMat);
    bridge.position.set(0, 0.09, 0.122);
    g.add(bridge);
    head.add(g);
    offHelmet.push(g);
  }
  if (has('cap')) {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.132, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), stripe);
    dome.position.y = 0.1;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), stripe);
    brim.position.set(0, 0.105, 0.09);
    g.add(dome, brim);
    head.add(g);
    offHelmet.push(g);
  }
  if (has('headphones')) {
    const g = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.014, 6, 20, Math.PI), dark);
    band.position.y = 0.07;
    g.add(band);
    for (const side of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14), stripe);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.13, 0.06, 0);
      g.add(cup);
    }
    head.add(g);
    offHelmet.push(g);
  }
  if (has('mohawk')) {
    const g = new THREE.Group();
    const mat = mk(new THREE.MeshStandardMaterial({ color: look.hair === '#1c1917' ? '#ec4899' : look.hair, roughness: 0.7 }));
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 6), mat);
      spike.position.set(0, 0, -0.08 + i * 0.035);
      spike.rotation.x = -0.3 + i * 0.12;
      g.add(spike);
    }
    g.position.y = 0.19;
    head.add(g);
    topper = g;
  }
  if (has('crown')) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.06, 18, 1, true), gold);
    g.add(ring);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 5), gold);
      spike.position.set(Math.cos(a) * 0.082, 0.055, Math.sin(a) * 0.082);
      g.add(spike);
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), i % 2 ? white : helmetMat);
      gem.position.set(Math.cos(a) * 0.086, 0, Math.sin(a) * 0.086);
      g.add(gem);
    }
    g.position.y = 0.2;
    head.add(g);
    topper = g;
  }
  if (has('scarf')) {
    const g = new THREE.Group();
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.03, 8, 18), stripe);
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 0.55;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.03), stripe);
    tail.position.set(0.06, 0.44, 0.12);
    tail.rotation.z = 0.15;
    g.add(wrap, tail);
    spine.add(g);
  }
  if (has('chain')) {
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 24), gold);
    chain.rotation.x = Math.PI / 2 - 0.5;
    chain.position.set(0, 0.48, 0.05);
    const medal = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 14), gold);
    medal.rotation.x = Math.PI / 2;
    medal.position.set(0, 0.4, 0.15);
    spine.add(chain, medal);
  }
  let cape: THREE.Mesh | null = null;
  if (has('cape')) {
    const geo = new THREE.PlaneGeometry(0.5, 0.75, 1, 4);
    geo.translate(0, -0.375, 0);
    cape = new THREE.Mesh(geo, mk(new THREE.MeshStandardMaterial({ color: look.suitAccent === look.suit ? '#dc2626' : look.suitAccent, roughness: 0.7, side: THREE.DoubleSide })));
    cape.position.set(0, 0.52, -0.15);
    cape.rotation.x = 0.12;
    cape.castShadow = true;
    spine.add(cape);
  }

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });

  const setHelmet = (on: boolean) => {
    helmet.visible = on;
    for (const o of offHelmet) o.visible = !on;
    // crown / mohawk sit on top of the helmet when it is on
    if (topper) topper.position.y = on ? 0.25 : has('crown') ? 0.2 : 0.19;
  };
  setHelmet(false);

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
      AL.shoulder.rotation.z = 0.08;
      AR.shoulder.rotation.z = -0.08;
    },
    walk(phase: number) {
      zero();
      const s = Math.sin(phase);
      L.hip.rotation.x = -s * 0.55;
      R.hip.rotation.x = s * 0.55;
      L.knee.rotation.x = Math.max(0, s) * 0.7;
      R.knee.rotation.x = Math.max(0, -s) * 0.7;
      AL.shoulder.rotation.x = s * 0.5;
      AR.shoulder.rotation.x = -s * 0.5;
      AL.elbow.rotation.x = -0.3;
      AR.elbow.rotation.x = -0.3;
      AL.shoulder.rotation.z = 0.08;
      AR.shoulder.rotation.z = -0.08;
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
      root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
