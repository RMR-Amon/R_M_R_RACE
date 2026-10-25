import * as THREE from 'three';
import type { BodyType, CarDef } from './types';

export interface CarModel {
  root: THREE.Group;
  /** tilts / spins independently of the root heading */
  body: THREE.Group;
  /** steering pivots for front wheels */
  frontPivots: THREE.Object3D[];
  /** all wheel meshes that roll */
  wheels: THREE.Object3D[];
  wheelRadius: number;
  length: number;
  /** local exhaust positions for boost flames */
  exhausts: THREE.Vector3[];
  materials: THREE.Material[];
}

type P = [number, number][];

interface Spec {
  length: number;
  width: number;
  wheelR: number;
  wheelW: number;
  wheelBase: number;
  track: number;
  body: P;
  cabin?: P;
  cabinWidth?: number;
  spoiler?: boolean;
  stripes?: boolean;
  roof?: boolean;
}

const SPECS: Partial<Record<BodyType, Spec>> = {
  sport: {
    length: 4.4, width: 2.0, wheelR: 0.38, wheelW: 0.32, wheelBase: 1.35, track: 0.92,
    body: [[-2.2, 0.32], [2.15, 0.32], [2.25, 0.52], [2.05, 0.74], [0.9, 0.92], [-1.5, 0.98], [-2.15, 0.95], [-2.25, 0.6]],
    cabin: [[-1.35, 0.9], [0.75, 0.88], [0.05, 1.42], [-0.95, 1.44], [-1.6, 0.98]],
    cabinWidth: 0.78, spoiler: true,
  },
  muscle: {
    length: 4.7, width: 2.05, wheelR: 0.42, wheelW: 0.38, wheelBase: 1.45, track: 0.92,
    body: [[-2.35, 0.38], [2.3, 0.38], [2.4, 0.62], [2.35, 0.95], [0.9, 1.04], [-2.3, 1.06], [-2.4, 0.7]],
    cabin: [[-1.45, 1.02], [0.55, 1.02], [-0.05, 1.58], [-1.1, 1.6], [-1.7, 1.06]],
    cabinWidth: 0.82, stripes: true, spoiler: true,
  },
  suv: {
    length: 4.6, width: 2.2, wheelR: 0.5, wheelW: 0.42, wheelBase: 1.45, track: 0.94,
    body: [[-2.25, 0.55], [2.2, 0.55], [2.32, 0.85], [2.25, 1.3], [1.5, 1.45], [-2.25, 1.5], [-2.32, 0.9]],
    cabin: [[-2.1, 1.44], [1.25, 1.44], [0.8, 2.2], [-2.0, 2.22]],
    cabinWidth: 0.9, roof: true,
  },
  retro: {
    length: 3.7, width: 1.85, wheelR: 0.36, wheelW: 0.3, wheelBase: 1.15, track: 0.9,
    body: [[-1.8, 0.35], [1.75, 0.35], [1.88, 0.6], [1.8, 0.95], [1.1, 1.05], [-1.8, 1.05], [-1.88, 0.62]],
    cabin: [[-1.72, 1.02], [0.8, 1.02], [0.32, 1.72], [-1.6, 1.74]],
    cabinWidth: 0.86, roof: true,
  },
  van: {
    length: 4.8, width: 2.2, wheelR: 0.44, wheelW: 0.38, wheelBase: 1.6, track: 0.92,
    body: [[-2.4, 0.5], [2.35, 0.5], [2.45, 0.8], [2.4, 1.25], [1.7, 1.45], [-2.4, 1.45], [-2.45, 0.8]],
    cabin: [[-2.35, 1.42], [1.6, 1.42], [1.05, 2.45], [-2.35, 2.45]],
    cabinWidth: 0.92, roof: true,
  },
  cyber: {
    length: 4.6, width: 2.1, wheelR: 0.42, wheelW: 0.36, wheelBase: 1.45, track: 0.92,
    body: [[-2.25, 0.42], [2.3, 0.42], [2.32, 0.78], [0.0, 1.55], [-2.25, 1.05], [-2.3, 0.6]],
    cabin: [[1.62, 1.04], [0.0, 1.6], [-1.25, 1.37], [-0.6, 1.22], [0.8, 1.0]],
    cabinWidth: 0.9,
  },
};

const tmpColor = new THREE.Color();

function extrude(points: P, depth: number, bevel = 0.07) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 6,
  });
  geo.translate(0, 0, -(depth - bevel * 2) / 2);
  // shape x -> world +z (forward), extrude z -> world x
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function makeWheel(r: number, w: number, tire: THREE.Material, rim: THREE.Material, hub: THREE.Material) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 22), tire);
  t.rotation.z = Math.PI / 2;
  t.castShadow = true;
  g.add(t);
  const rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 14), rim);
  rimMesh.rotation.z = Math.PI / 2;
  g.add(rimMesh);
  // spokes so rolling is visible
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, r * 1.1, r * 0.16), hub);
    s.rotation.x = (i / 3) * Math.PI;
    g.add(s);
  }
  return g;
}

export function buildCar(def: CarDef): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const materials: THREE.Material[] = [];
  const track = <T extends THREE.Material>(m: T) => {
    materials.push(m);
    return m;
  };

  const paint = track(
    new THREE.MeshPhysicalMaterial({
      color: def.color,
      metalness: 0.55,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }),
  );
  const accent = track(new THREE.MeshStandardMaterial({ color: def.accent, metalness: 0.4, roughness: 0.45 }));
  const glass = track(new THREE.MeshStandardMaterial({ color: '#0b1220', metalness: 0.95, roughness: 0.06 }));
  const tire = track(new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 }));
  const rim = track(new THREE.MeshStandardMaterial({ color: '#d4d4d8', metalness: 1, roughness: 0.25 }));
  const hub = track(new THREE.MeshStandardMaterial({ color: '#3f3f46', metalness: 0.8, roughness: 0.4 }));
  const head = track(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff7d6', emissiveIntensity: 2.2 }));
  const tail = track(new THREE.MeshStandardMaterial({ color: '#ff1a1a', emissive: '#ff0000', emissiveIntensity: 1.8 }));
  const dark = track(new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 0.7 }));
  const glowColor = def.glow ?? null;
  const glowMat = glowColor
    ? track(new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 2.5 }))
    : null;

  const frontPivots: THREE.Object3D[] = [];
  const wheels: THREE.Object3D[] = [];
  const exhausts: THREE.Vector3[] = [];

  const addWheels = (r: number, w: number, base: number, halfTrack: number, rearR = r) => {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Object3D();
      pivot.position.set(side * halfTrack, r, base);
      const wf = makeWheel(r, w, tire, rim, hub);
      pivot.add(wf);
      body.add(pivot);
      frontPivots.push(pivot);
      wheels.push(wf);
      const wr = makeWheel(rearR, w * 1.1, tire, rim, hub);
      wr.position.set(side * halfTrack, rearR, -base);
      body.add(wr);
      wheels.push(wr);
    }
  };

  let length = 4.4;
  let wheelRadius = 0.4;

  const spec = SPECS[def.body];
  if (spec) {
    length = spec.length;
    wheelRadius = spec.wheelR;
    const bodyMesh = new THREE.Mesh(extrude(spec.body, spec.width), paint);
    bodyMesh.castShadow = true;
    body.add(bodyMesh);
    if (spec.cabin) {
      const cab = new THREE.Mesh(extrude(spec.cabin, spec.width * (spec.cabinWidth ?? 0.8), 0.05), glass);
      cab.castShadow = true;
      body.add(cab);
      if (spec.roof) {
        // painted roof slab on top of the glass
        const top = spec.cabin.reduce((m, p) => Math.max(m, p[1]), 0);
        const xs = spec.cabin.filter((p) => p[1] > top - 0.05).map((p) => p[0]);
        const zMin = Math.min(...xs);
        const zMax = Math.max(...xs);
        body.add(box(spec.width * (spec.cabinWidth ?? 0.8) + 0.06, 0.1, zMax - zMin + 0.1, paint, 0, top + 0.04, (zMin + zMax) / 2));
      }
    }
    const hw = spec.width / 2;
    const halfTrack = hw * spec.track;
    addWheels(spec.wheelR, spec.wheelW, spec.wheelBase, halfTrack);
    // wheel arches (dark) for depth
    const frontY = spec.body[1][1] + 0.18;
    for (const z of [spec.length / 2 - 0.02]) {
      body.add(box(hw * 0.5, 0.12, 0.05, head, -hw * 0.58, frontY + 0.12, z));
      body.add(box(hw * 0.5, 0.12, 0.05, head, hw * 0.58, frontY + 0.12, z));
      body.add(box(spec.width * 0.4, 0.14, 0.05, dark, 0, frontY - 0.02, z + 0.01));
    }
    const rearZ = -spec.length / 2 - 0.02;
    body.add(box(hw * 0.55, 0.12, 0.05, tail, -hw * 0.55, frontY + 0.18, rearZ));
    body.add(box(hw * 0.55, 0.12, 0.05, tail, hw * 0.55, frontY + 0.18, rearZ));
    for (const side of [-1, 1]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 10), rim);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(side * hw * 0.35, spec.body[0][1] + 0.08, rearZ);
      body.add(ex);
      exhausts.push(new THREE.Vector3(side * hw * 0.35, spec.body[0][1] + 0.08, rearZ - 0.2));
    }
    if (spec.spoiler) {
      const topY = spec.body[spec.body.length - 2][1];
      const z = -spec.length / 2 + 0.35;
      body.add(box(spec.width * 0.95, 0.07, 0.45, accent, 0, topY + 0.35, z));
      body.add(box(0.08, 0.35, 0.2, accent, -hw * 0.6, topY + 0.17, z));
      body.add(box(0.08, 0.35, 0.2, accent, hw * 0.6, topY + 0.17, z));
    }
    if (spec.stripes) {
      for (const x of [-0.22, 0.22]) {
        const s = box(0.2, 0.02, spec.length * 0.98, accent, x, 0, 0);
        s.castShadow = false;
        s.position.y = spec.body[4][1] + 0.08;
        body.add(s);
      }
    }
    // side skirt in accent colour
    body.add(box(spec.width + 0.02, 0.12, spec.length * 0.62, accent, 0, spec.body[0][1] + 0.05, 0));
  } else if (def.body === 'f1') {
    length = 4.8;
    wheelRadius = 0.42;
    const nose = new THREE.Mesh(
      extrude([[-2.0, 0.25], [2.3, 0.22], [2.35, 0.36], [0.6, 0.62], [-0.4, 0.82], [-1.6, 0.85], [-2.1, 0.6]], 0.9, 0.12),
      paint,
    );
    nose.castShadow = true;
    body.add(nose);
    // side pods
    body.add(box(1.7, 0.42, 1.6, paint, 0, 0.45, -0.5));
    // cockpit + driver
    body.add(box(0.6, 0.15, 0.9, dark, 0, 0.83, 0.1));
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), accent);
    helmet.position.set(0, 1.02, 0.05);
    helmet.castShadow = true;
    body.add(helmet);
    body.add(box(0.36, 0.1, 0.12, glass, 0, 1.04, 0.28));
    // wings
    body.add(box(2.1, 0.06, 0.55, accent, 0, 0.18, 2.25));
    body.add(box(0.06, 0.25, 0.55, accent, -1.05, 0.25, 2.25));
    body.add(box(0.06, 0.25, 0.55, accent, 1.05, 0.25, 2.25));
    body.add(box(1.9, 0.08, 0.5, accent, 0, 1.2, -2.15));
    body.add(box(0.08, 0.6, 0.6, accent, -0.95, 0.95, -2.15));
    body.add(box(0.08, 0.6, 0.6, accent, 0.95, 0.95, -2.15));
    body.add(box(0.3, 0.12, 0.05, tail, 0, 0.55, -2.3));
    addWheels(0.4, 0.45, 1.6, 1.05, 0.45);
    exhausts.push(new THREE.Vector3(0, 0.55, -2.4));
  } else if (def.body === 'kart') {
    length = 3.0;
    wheelRadius = 0.3;
    body.add(box(1.5, 0.12, 2.8, accent, 0, 0.28, 0));
    const shell = new THREE.Mesh(extrude([[-1.4, 0.3], [1.45, 0.3], [1.5, 0.5], [0.9, 0.62], [-0.3, 0.6], [-1.4, 0.55]], 1.3, 0.1), paint);
    shell.castShadow = true;
    body.add(shell);
    body.add(box(0.8, 0.6, 0.15, dark, 0, 0.85, -0.55));
    const driverBody = box(0.6, 0.5, 0.45, accent, 0, 0.85, -0.3);
    body.add(driverBody);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), paint);
    helmet.position.set(0, 1.3, -0.3);
    helmet.castShadow = true;
    body.add(helmet);
    body.add(box(0.42, 0.12, 0.12, glass, 0, 1.32, -0.08));
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 8, 16), dark);
    wheel.position.set(0, 0.95, 0.2);
    wheel.rotation.x = -0.6;
    body.add(wheel);
    body.add(box(1.7, 0.18, 0.2, accent, 0, 0.35, 1.45));
    body.add(box(1.7, 0.18, 0.2, accent, 0, 0.35, -1.45));
    body.add(box(0.25, 0.08, 0.04, head, -0.45, 0.5, 1.5));
    body.add(box(0.25, 0.08, 0.04, head, 0.45, 0.5, 1.5));
    addWheels(0.28, 0.32, 1.0, 0.85, 0.32);
    exhausts.push(new THREE.Vector3(0.3, 0.5, -1.55));
  } else {
    // buggy
    length = 3.9;
    wheelRadius = 0.55;
    const chassis = new THREE.Mesh(
      extrude([[-1.7, 0.55], [1.6, 0.55], [1.9, 0.85], [1.1, 1.0], [-1.6, 1.0], [-1.8, 0.75]], 1.6, 0.1),
      paint,
    );
    chassis.castShadow = true;
    body.add(chassis);
    const tube = accent;
    const bar = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      const a = new THREE.Vector3(x1, y1, z1);
      const b = new THREE.Vector3(x2, y2, z2);
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 8), tube);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      m.castShadow = true;
      body.add(m);
    };
    for (const s of [-0.65, 0.65]) {
      bar(s, 1.0, 0.6, s, 1.9, -0.1);
      bar(s, 1.9, -0.1, s, 1.9, -0.9);
      bar(s, 1.9, -0.9, s, 1.0, -1.4);
    }
    bar(-0.65, 1.9, -0.1, 0.65, 1.9, -0.1);
    bar(-0.65, 1.9, -0.9, 0.65, 1.9, -0.9);
    body.add(box(0.6, 0.15, 0.6, dark, 0, 1.05, -0.4));
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), accent);
    helmet.position.set(0, 1.5, -0.35);
    body.add(helmet);
    body.add(box(0.36, 0.1, 0.1, glass, 0, 1.52, -0.12));
    body.add(box(1.4, 0.2, 0.15, dark, 0, 0.75, 1.95));
    body.add(box(0.2, 0.2, 0.06, head, -0.45, 1.05, 1.75));
    body.add(box(0.2, 0.2, 0.06, head, 0.45, 1.05, 1.75));
    body.add(box(0.25, 0.1, 0.05, tail, -0.55, 0.9, -1.82));
    body.add(box(0.25, 0.1, 0.05, tail, 0.55, 0.9, -1.82));
    addWheels(0.52, 0.5, 1.3, 1.05, 0.58);
    exhausts.push(new THREE.Vector3(0.4, 0.9, -1.9));
  }

  if (glowMat) {
    const strip = box(0.06, 0.06, length * 0.7, glowMat, 0, 0, 0);
    strip.castShadow = false;
    const strip2 = strip.clone();
    const y = def.body === 'cyber' ? 0.62 : 0.55;
    strip.position.set(-1.07, y, 0);
    strip2.position.set(1.07, y, 0);
    body.add(strip, strip2);
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, length * 0.95),
      track(new THREE.MeshBasicMaterial({ color: tmpColor.set(glowColor!), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = 0.06;
    root.add(under);
  }

  return { root, body, frontPivots, wheels, wheelRadius, length, exhausts, materials };
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}
