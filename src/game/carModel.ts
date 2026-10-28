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
  width: number;
  /** local exhaust positions for boost flames */
  exhausts: THREE.Vector3[];
  /** local rear tyre contact points (skid marks) */
  rearWheels: THREE.Vector3[];
  /** where the driver's hips sit (local, inside body) */
  seat: THREE.Vector3;
  /** ground point next to the driver's door, used by the intro walk */
  door: THREE.Vector3;
  driverScale: number;
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
  /** inward slope of the upper body sides */
  tumble?: number;
}

const SPECS: Partial<Record<BodyType, Spec>> = {
  sport: {
    length: 4.4, width: 2.0, wheelR: 0.38, wheelW: 0.32, wheelBase: 1.35, track: 0.92, tumble: 0.2,
    body: [[-2.2, 0.32], [2.15, 0.32], [2.25, 0.5], [2.1, 0.7], [0.9, 0.92], [-1.5, 0.98], [-2.15, 0.95], [-2.25, 0.6]],
    cabin: [[-1.35, 0.9], [0.75, 0.88], [0.05, 1.42], [-0.95, 1.44], [-1.6, 0.98]],
    cabinWidth: 0.8, spoiler: true,
  },
  muscle: {
    length: 4.7, width: 2.05, wheelR: 0.42, wheelW: 0.38, wheelBase: 1.45, track: 0.92, tumble: 0.12,
    body: [[-2.35, 0.38], [2.3, 0.38], [2.4, 0.62], [2.35, 0.95], [0.9, 1.04], [-2.3, 1.06], [-2.4, 0.7]],
    cabin: [[-1.45, 1.02], [0.55, 1.02], [-0.05, 1.58], [-1.1, 1.6], [-1.7, 1.06]],
    cabinWidth: 0.84, stripes: true, spoiler: true,
  },
  suv: {
    length: 4.6, width: 2.2, wheelR: 0.5, wheelW: 0.42, wheelBase: 1.45, track: 0.94, tumble: 0.08,
    body: [[-2.25, 0.55], [2.2, 0.55], [2.32, 0.85], [2.25, 1.3], [1.5, 1.45], [-2.25, 1.5], [-2.32, 0.9]],
    cabin: [[-2.1, 1.44], [1.25, 1.44], [0.8, 2.2], [-2.0, 2.22]],
    cabinWidth: 0.92, roof: true,
  },
  retro: {
    length: 3.7, width: 1.85, wheelR: 0.36, wheelW: 0.3, wheelBase: 1.15, track: 0.9, tumble: 0.14,
    body: [[-1.8, 0.35], [1.75, 0.35], [1.88, 0.6], [1.8, 0.95], [1.1, 1.05], [-1.8, 1.05], [-1.88, 0.62]],
    cabin: [[-1.72, 1.02], [0.8, 1.02], [0.32, 1.72], [-1.6, 1.74]],
    cabinWidth: 0.88, roof: true,
  },
  van: {
    length: 4.8, width: 2.2, wheelR: 0.44, wheelW: 0.38, wheelBase: 1.6, track: 0.92, tumble: 0.06,
    body: [[-2.4, 0.5], [2.35, 0.5], [2.45, 0.8], [2.4, 1.25], [1.7, 1.45], [-2.4, 1.45], [-2.45, 0.8]],
    cabin: [[-2.35, 1.42], [1.6, 1.42], [1.05, 2.45], [-2.35, 2.45]],
    cabinWidth: 0.94, roof: true,
  },
  cyber: {
    length: 4.6, width: 2.1, wheelR: 0.42, wheelW: 0.36, wheelBase: 1.45, track: 0.92, tumble: 0.16,
    body: [[-2.25, 0.42], [2.3, 0.42], [2.32, 0.78], [0.0, 1.55], [-2.25, 1.05], [-2.3, 0.6]],
    cabin: [[1.62, 1.04], [0.0, 1.6], [-1.25, 1.37], [-0.6, 1.22], [0.8, 1.0]],
    cabinWidth: 0.9,
  },
};

/** driver hip position per body (x = left side of the car is +x) */
const SEATS: Record<BodyType, [number, number, number, number]> = {
  // x, y, z, driver scale
  sport: [0.38, 0.42, -0.35, 0.9],
  muscle: [0.4, 0.5, -0.45, 0.92],
  suv: [0.42, 0.78, 0.05, 0.95],
  retro: [0.36, 0.55, -0.3, 0.9],
  van: [0.42, 0.78, 0.75, 0.95],
  cyber: [0.4, 0.5, -0.1, 0.9],
  f1: [0, 0.32, -0.05, 0.85],
  kart: [0, 0.48, -0.35, 0.85],
  buggy: [0, 0.85, -0.35, 0.9],
};

const tmpColor = new THREE.Color();

/** closed shape with rounded corners (quadratic fillets) */
function roundedShape(points: P, radius: number) {
  const shape = new THREE.Shape();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = points[(i - 1 + n) % n];
    const [cx, cy] = points[i];
    const [nx, ny] = points[(i + 1) % n];
    const l1 = Math.hypot(px - cx, py - cy);
    const l2 = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, l1 * 0.45, l2 * 0.45);
    const ax = cx + ((px - cx) / l1) * r;
    const ay = cy + ((py - cy) / l1) * r;
    const bx = cx + ((nx - cx) / l2) * r;
    const by = cy + ((ny - cy) / l2) * r;
    if (i === 0) shape.moveTo(ax, ay);
    else shape.lineTo(ax, ay);
    shape.quadraticCurveTo(cx, cy, bx, by);
  }
  shape.closePath();
  return shape;
}

/**
 * Extrudes a side profile into a body panel, then sculpts it: the sides lean inwards towards the
 * top (tumblehome) and the nose / tail narrow, so the car reads as a smooth shape, not a box.
 */
function sculpted(points: P, depth: number, opts: { bevel?: number; round?: number; tumble?: number; pinch?: number } = {}) {
  const bevel = opts.bevel ?? 0.08;
  const geo = new THREE.ExtrudeGeometry(roundedShape(points, opts.round ?? 0.18), {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 8,
  });
  geo.translate(0, 0, -(depth - bevel * 2) / 2);
  // shape x -> world +z (forward), extrude z -> world x
  geo.rotateY(-Math.PI / 2);
  const ys = points.map((p) => p[1]);
  const zs = points.map((p) => p[0]);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const half = Math.max(...zs.map(Math.abs)) || 1;
  const tumble = opts.tumble ?? 0.15;
  const pinch = opts.pinch ?? 0.12;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const ty = THREE.MathUtils.clamp((pos.getY(i) - y0) / (y1 - y0 || 1), 0, 1);
    const tz = Math.min(1, Math.abs(pos.getZ(i)) / half);
    pos.setX(i, pos.getX(i) * (1 - tumble * ty * ty) * (1 - pinch * tz ** 4));
  }
  geo.computeVertexNormals();
  return geo;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, r = 0) {
  const geo = r > 0 ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** box with rounded vertical edges (extruded rounded rectangle) */
function roundedBox(w: number, h: number, d: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  const s = roundedShape([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], rr);
  const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 4 });
  geo.translate(0, 0, -d / 2);
  return geo;
}

function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

interface WheelMats {
  tire: THREE.Material;
  rim: THREE.Material;
  hub: THREE.Material;
  disc: THREE.Material;
}

function makeWheel(r: number, w: number, m: WheelMats) {
  const g = new THREE.Group();
  // rounded tyre profile turned on a lathe, axle along x
  const prof = [
    new THREE.Vector2(r * 0.6, -w / 2),
    new THREE.Vector2(r * 0.9, -w / 2),
    new THREE.Vector2(r * 0.985, -w / 2 + w * 0.12),
    new THREE.Vector2(r, -w / 2 + w * 0.3),
    new THREE.Vector2(r, w / 2 - w * 0.3),
    new THREE.Vector2(r * 0.985, w / 2 - w * 0.12),
    new THREE.Vector2(r * 0.9, w / 2),
    new THREE.Vector2(r * 0.6, w / 2),
  ];
  const tire = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), m.tire);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 0.78, 24, 1, true), m.rim);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.48, r * 0.48, 0.04, 20), m.disc);
  disc.rotation.z = Math.PI / 2;
  g.add(disc);
  // five-spoke rim face on both sides so rolling is visible
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.035, r * 0.56, r * 0.13), m.rim);
      s.rotation.x = (i / 5) * Math.PI * 2;
      s.position.x = side * w * 0.36;
      s.translateY(r * 0.28);
      g.add(s);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.13, r * 0.13, 0.05, 12), m.hub);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = side * w * 0.37;
    g.add(cap);
  }
  return g;
}

let shadowTex: THREE.Texture | null = null;
function contactShadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
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
      metalness: 0.6,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
  );
  const accent = track(new THREE.MeshPhysicalMaterial({ color: def.accent, metalness: 0.45, roughness: 0.35, clearcoat: 0.6 }));
  const glass = track(
    new THREE.MeshPhysicalMaterial({
      color: '#0d1b2a',
      metalness: 0.3,
      roughness: 0.04,
      transparent: true,
      opacity: 0.42,
      clearcoat: 1,
      depthWrite: false,
      envMapIntensity: 1.6,
    }),
  );
  const tire = track(new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.92 }));
  const rim = track(new THREE.MeshStandardMaterial({ color: '#d4d4d8', metalness: 1, roughness: 0.22 }));
  const hub = track(new THREE.MeshStandardMaterial({ color: '#3f3f46', metalness: 0.8, roughness: 0.35 }));
  const disc = track(new THREE.MeshStandardMaterial({ color: '#6b7280', metalness: 0.9, roughness: 0.45 }));
  const caliper = track(new THREE.MeshStandardMaterial({ color: def.glow ?? '#dc2626', roughness: 0.35, metalness: 0.3 }));
  const head = track(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6db', emissiveIntensity: 2.6, roughness: 0.1 }));
  const tail = track(new THREE.MeshStandardMaterial({ color: '#ff1a1a', emissive: '#ff0000', emissiveIntensity: 2.2, roughness: 0.2 }));
  const dark = track(new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 0.6, metalness: 0.2 }));
  const chrome = track(new THREE.MeshStandardMaterial({ color: '#e4e4e7', metalness: 1, roughness: 0.12 }));
  const plate = track(new THREE.MeshStandardMaterial({ color: '#f5f5f4', roughness: 0.5 }));
  const archMat = track(new THREE.MeshStandardMaterial({ color: '#0c0c0e', roughness: 0.9, side: THREE.DoubleSide }));
  const glowColor = def.glow ?? null;
  const glowMat = glowColor
    ? track(new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 3 }))
    : null;
  const wm: WheelMats = { tire, rim, hub, disc };

  const frontPivots: THREE.Object3D[] = [];
  const wheels: THREE.Object3D[] = [];
  const exhausts: THREE.Vector3[] = [];
  const rearWheels: THREE.Vector3[] = [];

  const addWheels = (r: number, w: number, base: number, halfTrack: number, rearR = r) => {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Object3D();
      pivot.position.set(side * halfTrack, r, base);
      const wf = makeWheel(r, w, wm);
      pivot.add(wf);
      pivot.add(box(0.08, r * 0.38, r * 0.3, caliper, -side * w * 0.05, r * 0.32, -r * 0.12));
      body.add(pivot);
      frontPivots.push(pivot);
      wheels.push(wf);
      const wr = makeWheel(rearR, w * 1.1, wm);
      wr.position.set(side * halfTrack, rearR, -base);
      body.add(wr);
      body.add(box(0.08, rearR * 0.38, rearR * 0.3, caliper, side * halfTrack - side * w * 0.05, rearR * 1.32, -base + rearR * 0.12));
      wheels.push(wr);
      rearWheels.push(new THREE.Vector3(side * halfTrack, 0, -base));
    }
  };

  let length = 4.4;
  let width = 2;
  let wheelRadius = 0.4;

  const spec = SPECS[def.body];
  if (spec) {
    length = spec.length;
    width = spec.width;
    wheelRadius = spec.wheelR;
    const tumble = spec.tumble ?? 0.15;
    const bodyMesh = new THREE.Mesh(sculpted(spec.body, spec.width, { tumble, round: 0.22 }), paint);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    body.add(bodyMesh);
    const hw = spec.width / 2;
    if (spec.cabin) {
      const cw = spec.width * (spec.cabinWidth ?? 0.8);
      const cab = new THREE.Mesh(sculpted(spec.cabin, cw, { bevel: 0.05, round: 0.12, tumble: 0.22, pinch: 0.05 }), glass);
      cab.renderOrder = 2;
      body.add(cab);
      // painted roof + pillars around the glass greenhouse
      const top = spec.cabin.reduce((m, p) => Math.max(m, p[1]), 0);
      const topPts = spec.cabin.filter((p) => p[1] > top - 0.08);
      const zMin = Math.min(...topPts.map((p) => p[0]));
      const zMax = Math.max(...topPts.map((p) => p[0]));
      const roofW = cw * 0.8;
      body.add(box(roofW, 0.07, zMax - zMin + 0.14, paint, 0, top + 0.02, (zMin + zMax) / 2, 0.03));
      const bottom = spec.cabin.filter((p) => p[1] <= top - 0.08);
      const front = bottom.reduce((a, p) => (p[0] > a[0] ? p : a), bottom[0]);
      const back = bottom.reduce((a, p) => (p[0] < a[0] ? p : a), bottom[0]);
      const frontTop = topPts.reduce((a, p) => (p[0] > a[0] ? p : a), topPts[0]);
      const backTop = topPts.reduce((a, p) => (p[0] < a[0] ? p : a), topPts[0]);
      for (const side of [-1, 1]) {
        const xb = side * cw * 0.47;
        const xt = side * roofW * 0.5;
        body.add(rod(new THREE.Vector3(xb, front[1], front[0]), new THREE.Vector3(xt, frontTop[1], frontTop[0]), 0.045, paint));
        body.add(rod(new THREE.Vector3(xb, back[1], back[0]), new THREE.Vector3(xt, backTop[1], backTop[0]), 0.06, paint));
        // side mirror at the base of the A-pillar
        const mz = front[0] - 0.12;
        body.add(box(0.06, 0.04, 0.04, dark, side * (cw * 0.5 + 0.06), front[1] + 0.07, mz));
        body.add(box(0.07, 0.13, 0.2, paint, side * (cw * 0.5 + 0.14), front[1] + 0.12, mz, 0.03));
      }
    }
    const halfTrack = hw * spec.track;
    addWheels(spec.wheelR, spec.wheelW, spec.wheelBase, halfTrack);
    // dark wheel-arch liners give depth around the tyres
    for (const zz of [spec.wheelBase, -spec.wheelBase]) {
      for (const side of [-1, 1]) {
        const arch = new THREE.Mesh(new THREE.RingGeometry(spec.wheelR * 1.03, spec.wheelR * 1.2, 20, 1, 0, Math.PI), archMat);
        arch.rotation.y = side * Math.PI / 2;
        arch.position.set(side * (hw * 0.985), spec.wheelR, zz);
        body.add(arch);
      }
    }
    const frontY = spec.body[1][1] + 0.18;
    const nose = spec.length / 2;
    // headlights: glowing lenses + daytime-running strips
    for (const side of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, hw * 0.32, 4, 10), head);
      lens.rotation.z = Math.PI / 2;
      lens.position.set(side * hw * 0.55, frontY + 0.12, nose - 0.04);
      body.add(lens);
      body.add(box(hw * 0.4, 0.025, 0.03, head, side * hw * 0.58, frontY + 0.01, nose - 0.02));
    }
    // grille + bumper
    body.add(box(spec.width * 0.42, 0.18, 0.06, dark, 0, frontY - 0.02, nose + 0.01, 0.05));
    for (let i = 0; i < 3; i++) body.add(box(spec.width * 0.38, 0.015, 0.02, chrome, 0, frontY - 0.08 + i * 0.06, nose + 0.04));
    body.add(box(0.46, 0.11, 0.02, plate, 0, spec.body[0][1] + 0.12, nose + 0.06));
    const rearZ = -spec.length / 2 - 0.02;
    // tail lights: wide glowing bars
    for (const side of [-1, 1]) {
      const tl = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, hw * 0.42, 4, 8), tail);
      tl.rotation.z = Math.PI / 2;
      tl.position.set(side * hw * 0.55, frontY + 0.18, rearZ);
      body.add(tl);
    }
    if (def.body === 'cyber') body.add(box(spec.width * 0.9, 0.04, 0.03, tail, 0, frontY + 0.3, rearZ + 0.02));
    body.add(box(0.46, 0.11, 0.02, plate, 0, spec.body[0][1] + 0.16, rearZ - 0.02));
    body.add(box(spec.width * 0.7, 0.14, 0.06, dark, 0, spec.body[0][1] + 0.02, rearZ + 0.03, 0.04));
    for (const side of [-1, 1]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.28, 14, 1, true), chrome);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(side * hw * 0.38, spec.body[0][1] + 0.06, rearZ - 0.02);
      body.add(ex);
      exhausts.push(new THREE.Vector3(side * hw * 0.38, spec.body[0][1] + 0.06, rearZ - 0.2));
    }
    if (spec.spoiler) {
      const topY = spec.body[spec.body.length - 2][1];
      const z = -spec.length / 2 + 0.35;
      body.add(sculptedWing(spec.width * 0.95, 0.45, accent, topY + 0.36, z));
      body.add(box(0.06, 0.36, 0.18, accent, -hw * 0.6, topY + 0.17, z, 0.02));
      body.add(box(0.06, 0.36, 0.18, accent, hw * 0.6, topY + 0.17, z, 0.02));
    }
    if (spec.stripes) {
      for (const x of [-0.22, 0.22]) {
        const s = box(0.2, 0.02, spec.length * 0.9, accent, x, 0, 0);
        s.castShadow = false;
        s.position.y = spec.body[4][1] + 0.085;
        body.add(s);
      }
    }
    // side skirt + door handle line in accent colour
    body.add(box(spec.width * 0.96, 0.1, spec.length * 0.6, accent, 0, spec.body[0][1] + 0.04, 0, 0.04));
    for (const side of [-1, 1]) body.add(box(0.02, 0.025, 0.16, chrome, side * hw * 0.98, frontY + 0.12, -0.2));
  } else if (def.body === 'f1') {
    length = 4.8;
    width = 2.1;
    wheelRadius = 0.42;
    const nose = new THREE.Mesh(
      sculpted([[-2.0, 0.25], [2.3, 0.22], [2.35, 0.36], [0.6, 0.62], [-0.4, 0.82], [-1.6, 0.85], [-2.1, 0.6]], 0.9, { bevel: 0.12, tumble: 0.35, round: 0.2 }),
      paint,
    );
    nose.castShadow = true;
    body.add(nose);
    // side pods
    for (const side of [-1, 1]) body.add(box(0.5, 0.42, 1.6, paint, side * 0.62, 0.45, -0.5, 0.15));
    // cockpit opening + halo
    body.add(box(0.62, 0.12, 0.95, dark, 0, 0.8, 0.05, 0.05));
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 20, Math.PI), dark);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(0, 1.12, 0.05);
    body.add(halo);
    body.add(rod(new THREE.Vector3(0, 0.85, 0.55), new THREE.Vector3(0, 1.12, 0.39), 0.03, dark));
    // wings
    body.add(sculptedWing(2.1, 0.55, accent, 0.18, 2.25));
    body.add(box(0.05, 0.25, 0.55, accent, -1.05, 0.25, 2.25));
    body.add(box(0.05, 0.25, 0.55, accent, 1.05, 0.25, 2.25));
    body.add(sculptedWing(1.9, 0.5, accent, 1.2, -2.15));
    body.add(box(0.06, 0.6, 0.6, accent, -0.95, 0.95, -2.15));
    body.add(box(0.06, 0.6, 0.6, accent, 0.95, 0.95, -2.15));
    body.add(box(0.3, 0.12, 0.05, tail, 0, 0.55, -2.3));
    addWheels(0.4, 0.45, 1.6, 1.05, 0.45);
    exhausts.push(new THREE.Vector3(0, 0.55, -2.4));
  } else if (def.body === 'kart') {
    length = 3.0;
    width = 1.7;
    wheelRadius = 0.3;
    body.add(box(1.5, 0.08, 2.8, dark, 0, 0.26, 0));
    const shell = new THREE.Mesh(sculpted([[-1.4, 0.3], [1.45, 0.3], [1.5, 0.5], [0.9, 0.62], [-0.3, 0.6], [-1.4, 0.55]], 1.3, { bevel: 0.1, round: 0.15 }), paint);
    shell.castShadow = true;
    body.add(shell);
    body.add(box(0.7, 0.6, 0.12, accent, 0, 0.82, -0.62, 0.08));
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 8, 20), dark);
    wheel.position.set(0, 0.92, 0.25);
    wheel.rotation.x = -0.9;
    body.add(wheel);
    body.add(rod(new THREE.Vector3(0, 0.55, 0.55), new THREE.Vector3(0, 0.9, 0.27), 0.025, chrome));
    body.add(box(1.7, 0.16, 0.2, accent, 0, 0.35, 1.45, 0.06));
    body.add(box(1.7, 0.16, 0.2, accent, 0, 0.35, -1.45, 0.06));
    body.add(box(0.25, 0.08, 0.04, head, -0.45, 0.5, 1.5));
    body.add(box(0.25, 0.08, 0.04, head, 0.45, 0.5, 1.5));
    addWheels(0.28, 0.32, 1.0, 0.85, 0.32);
    exhausts.push(new THREE.Vector3(0.3, 0.5, -1.55));
  } else {
    // buggy
    length = 3.9;
    width = 2.1;
    wheelRadius = 0.55;
    const chassis = new THREE.Mesh(
      sculpted([[-1.7, 0.55], [1.6, 0.55], [1.9, 0.85], [1.1, 1.0], [-1.6, 1.0], [-1.8, 0.75]], 1.6, { bevel: 0.1, round: 0.18 }),
      paint,
    );
    chassis.castShadow = true;
    body.add(chassis);
    for (const s of [-0.65, 0.65]) {
      body.add(rod(new THREE.Vector3(s, 1.0, 0.6), new THREE.Vector3(s, 1.9, -0.1), 0.05, accent));
      body.add(rod(new THREE.Vector3(s, 1.9, -0.1), new THREE.Vector3(s, 1.9, -0.9), 0.05, accent));
      body.add(rod(new THREE.Vector3(s, 1.9, -0.9), new THREE.Vector3(s, 1.0, -1.4), 0.05, accent));
    }
    body.add(rod(new THREE.Vector3(-0.65, 1.9, -0.1), new THREE.Vector3(0.65, 1.9, -0.1), 0.05, accent));
    body.add(rod(new THREE.Vector3(-0.65, 1.9, -0.9), new THREE.Vector3(0.65, 1.9, -0.9), 0.05, accent));
    body.add(box(0.6, 0.15, 0.6, dark, 0, 0.98, -0.4, 0.05));
    body.add(box(1.4, 0.2, 0.15, dark, 0, 0.75, 1.95, 0.05));
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 14), head);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(side * 0.45, 1.05, 1.75);
      body.add(lamp);
    }
    body.add(box(0.25, 0.1, 0.05, tail, -0.55, 0.9, -1.82));
    body.add(box(0.25, 0.1, 0.05, tail, 0.55, 0.9, -1.82));
    addWheels(0.52, 0.5, 1.3, 1.05, 0.58);
    exhausts.push(new THREE.Vector3(0.4, 0.9, -1.9));
  }

  if (glowMat) {
    const strip = box(0.05, 0.05, length * 0.7, glowMat, 0, 0, 0);
    strip.castShadow = false;
    const strip2 = strip.clone();
    const y = def.body === 'cyber' ? 0.62 : 0.55;
    strip.position.set(-width * 0.5 - 0.02, y, 0);
    strip2.position.set(width * 0.5 + 0.02, y, 0);
    body.add(strip, strip2);
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, length * 0.95),
      track(new THREE.MeshBasicMaterial({ color: tmpColor.set(glowColor!), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = 0.06;
    root.add(under);
  }

  // soft contact shadow grounds the car even where the shadow map is coarse
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.35, length * 1.12),
    track(new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, color: '#000000', opacity: 0.6 })),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.04;
  contact.renderOrder = 1;
  contact.name = 'contact';
  root.add(contact);

  const [sx, sy, sz, ds] = SEATS[def.body];
  const seat = new THREE.Vector3(sx, sy, sz);
  // drivers always get in from the left (+x) side
  const door = new THREE.Vector3(width / 2 + 0.8, 0, sz + 0.2);

  return { root, body, frontPivots, wheels, wheelRadius, length, width, exhausts, rearWheels, seat, door, driverScale: ds, materials };
}

/** thin aerofoil-shaped wing (rounded leading edge) */
function sculptedWing(span: number, chord: number, mat: THREE.Material, y: number, z: number) {
  const geo = sculpted([[-chord / 2, -0.03], [chord / 2, -0.01], [chord / 2 - 0.05, 0.04], [-chord / 2, 0.03]], span, { bevel: 0.015, round: 0.03, tumble: 0, pinch: 0 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(0, y, z);
  m.castShadow = true;
  return m;
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
