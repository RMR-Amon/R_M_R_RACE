import * as THREE from 'three';
import type { Track } from './track';
import type { ThemeId } from './types';
import { THEME_STYLES } from './themes';
import {
  bannerTexture,
  boostTexture,
  checkerTexture,
  cliffTexture,
  curbTexture,
  groundTexture,
  rampTexture,
  roadTexture,
  stripeTexture,
  wallTexture,
} from './textures';

export interface TrackVisuals {
  group: THREE.Group;
  boostTex: THREE.Texture;
  barrierMeshes: THREE.Object3D[];
  update(t: number): void;
}

const WALL_H = 1.3;
const CURB_W = 1.8;

/** Builds a ribbon along the track between two lateral offsets */
function ribbon(
  track: Track,
  latA: number,
  latB: number,
  yA: (d: number) => number,
  yB: (d: number) => number,
  vScale: number,
  skip: (d: number) => boolean,
) {
  const n = track.samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = track.samples[i % n];
    const d = i * (track.length / n);
    pos.push(s.x + s.nx * latA, yA(s.d), s.z + s.nz * latA);
    pos.push(s.x + s.nx * latB, yB(s.d), s.z + s.nz * latB);
    uv.push(0, d / vScale, 1, d / vScale);
  }
  for (let i = 0; i < n; i++) {
    const dMid = track.samples[i].d + 1;
    if (skip(dMid)) continue;
    const a = i * 2;
    // counter-clockwise seen from above (latA = left, latB = right)
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildTrackVisuals(track: Track, theme: ThemeId): TrackVisuals {
  const st = THEME_STYLES[theme];
  const group = new THREE.Group();
  const hw = track.halfWidth;
  const h = (d: number) => track.heightAt(d);
  const inGap = (d: number) => track.inGap(d);

  // ---------- road
  const roadTex = roadTexture(theme);
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: theme === 'ocean' ? 0.6 : 0.85,
    metalness: 0.05,
  });
  const road = new THREE.Mesh(
    ribbon(track, -hw, hw, (d) => h(d) + 0.03, (d) => h(d) + 0.03, 12, inGap),
    roadMat,
  );
  road.receiveShadow = true;
  group.add(road);

  // ---------- curbs
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(theme), roughness: 0.6 });
  for (const side of [-1, 1]) {
    const a = side * hw;
    const b = side * (hw + CURB_W);
    const geo = ribbon(track, side < 0 ? b : a, side < 0 ? a : b, (d) => h(d) + 0.08, (d) => h(d) + 0.08, 4, inGap);
    const curb = new THREE.Mesh(geo, curbMat);
    curb.receiveShadow = true;
    group.add(curb);
  }

  // ---------- walls (inner face + top), not over the gap
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTexture(theme),
    roughness: 0.7,
    emissive: theme === 'ocean' ? new THREE.Color(st.wallA) : new THREE.Color(0),
    emissiveIntensity: theme === 'ocean' ? 0.35 : 0,
    side: THREE.DoubleSide,
  });
  const wallSkip = (d: number) => {
    const g = track.gap;
    return !!g && d > g.gapStart - 1 && d < g.gapEnd + 1;
  };
  for (const side of [-1, 1]) {
    const lat = side * (hw + CURB_W);
    const face = ribbon(track, lat, lat, (d) => h(d), (d) => h(d) + WALL_H, 6, wallSkip);
    // ribbon() gives a vertical strip here because both lats are equal and y differs
    const wall = new THREE.Mesh(face, wallMat);
    wall.castShadow = false;
    group.add(wall);
    const topA = side * (hw + CURB_W);
    const topB = side * (hw + CURB_W + 0.6);
    const top = new THREE.Mesh(
      ribbon(track, side < 0 ? topB : topA, side < 0 ? topA : topB, (d) => h(d) + WALL_H, (d) => h(d) + WALL_H, 6, wallSkip),
      wallMat,
    );
    group.add(top);
    const outer = new THREE.Mesh(
      ribbon(track, topB, topB, () => 0, (d) => h(d) + WALL_H, 6, wallSkip),
      wallMat,
    );
    group.add(outer);
  }

  // ---------- ground with a hole where the chasm is
  const size = 1100;
  const shape = new THREE.Shape();
  shape.moveTo(-size, -size);
  shape.lineTo(size, -size);
  shape.lineTo(size, size);
  shape.lineTo(-size, size);
  shape.closePath();
  const c = track.chasmRect();
  if (c) {
    const corner = (a: number, b: number) => {
      const x = c.cx + c.tx * a + c.nx * b;
      const z = c.cz + c.tz * a + c.nz * b;
      return new THREE.Vector2(x, -z);
    };
    const hole = new THREE.Path([
      corner(-c.halfLen, -c.halfWide),
      corner(c.halfLen, -c.halfWide),
      corner(c.halfLen, c.halfWide),
      corner(-c.halfLen, c.halfWide),
    ]);
    shape.holes.push(hole);
  }
  const groundGeo = new THREE.ShapeGeometry(shape);
  groundGeo.rotateX(-Math.PI / 2);
  const gTex = groundTexture(theme).clone();
  gTex.needsUpdate = true;
  gTex.repeat.set(1 / 18, 1 / 18);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: gTex, roughness: 1 }));
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);

  // ---------- chasm (open box seen from inside) + glowing bottom
  if (c && track.gap) {
    const depth = 70;
    const cliffTex = cliffTexture(theme).clone();
    cliffTex.needsUpdate = true;
    cliffTex.repeat.set(6, 1);
    const chasm = new THREE.Mesh(
      new THREE.BoxGeometry(c.halfWide * 2, depth, c.halfLen * 2),
      new THREE.MeshStandardMaterial({ map: cliffTex, side: THREE.BackSide, roughness: 1 }),
    );
    chasm.position.set(c.cx, -depth / 2 - 0.02, c.cz);
    chasm.rotation.y = Math.atan2(c.tx, c.tz);
    group.add(chasm);
    const bottom = new THREE.Mesh(
      new THREE.PlaneGeometry(c.halfWide * 2, c.halfLen * 2),
      new THREE.MeshStandardMaterial({
        color: st.abyss,
        emissive: st.abyss,
        emissiveIntensity: st.abyssGlow,
        roughness: 0.3,
        metalness: 0.2,
      }),
    );
    bottom.rotation.x = -Math.PI / 2;
    bottom.rotation.z = Math.atan2(c.tx, c.tz);
    bottom.position.set(c.cx, -depth * 0.55, c.cz);
    group.add(bottom);

    // ramp decal + sides
    const g = track.gap;
    const rampMat = new THREE.MeshStandardMaterial({ map: rampTexture(), roughness: 0.6 });
    const rampTop = new THREE.Mesh(
      ribbon(track, -hw, hw, (d) => h(d) + 0.06, (d) => h(d) + 0.06, 6, (d) => d < g.rampStart || d > g.rampEnd),
      rampMat,
    );
    rampTop.receiveShadow = true;
    group.add(rampTop);
    const sideMat = new THREE.MeshStandardMaterial({ color: st.cliffDark, roughness: 0.9, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const lat = side * (hw + CURB_W);
      group.add(new THREE.Mesh(ribbon(track, lat, lat, () => 0, (d) => h(d), 6, (d) => d < g.rampStart || d > g.rampEnd), sideMat));
    }
    // front face of the ramp lip
    const lip = track.pointAt(g.rampEnd, 0);
    const lipFace = new THREE.Mesh(new THREE.PlaneGeometry((hw + CURB_W) * 2, g.rampHeight), sideMat);
    lipFace.position.set(lip.x, g.rampHeight / 2, lip.z);
    lipFace.rotation.y = lip.heading;
    group.add(lipFace);
    // warning posts at both edges of the cliff
    const postMat = new THREE.MeshStandardMaterial({ map: stripeTexture('#111111', '#facc15') });
    for (const dd of [g.gapStart, g.gapEnd]) {
      for (const side of [-1, 1]) {
        const p = track.pointAt(dd, side * (hw + CURB_W + 0.3));
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.2, 0.7), postMat);
        post.position.set(p.x, 1.6 + (dd === g.gapStart ? g.rampHeight : 0), p.z);
        post.castShadow = true;
        group.add(post);
      }
    }
  }

  // ---------- start / finish line + gantry
  {
    const s = track.samples[0];
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, 3),
      new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7 }),
    );
    (line.material as THREE.MeshStandardMaterial).map!.repeat.set(hw / 4, 1);
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(s.tx, s.tz);
    line.position.set(s.x, 0.06, s.z);
    line.receiveShadow = true;
    group.add(line);
    const gantry = new THREE.Group();
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#27272a', metalness: 0.7, roughness: 0.35 });
    const span = hw + CURB_W + 1.2;
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 10, 1.2), pillarMat);
      p.position.set(side * span, 5, 0);
      p.castShadow = true;
      gantry.add(p);
    }
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(span * 2 + 1.2, 2.2, 0.6),
      [
        pillarMat, pillarMat, pillarMat, pillarMat,
        new THREE.MeshStandardMaterial({ map: bannerTexture('START  •  FINISH', '#111827', '#ffffff'), emissive: '#ffffff', emissiveMap: bannerTexture('START  •  FINISH', '#111827', '#ffffff'), emissiveIntensity: 0.6 }),
        new THREE.MeshStandardMaterial({ map: bannerTexture('ДАВАЙ  ДАВАЙ!', '#e11d48', '#ffffff'), emissive: '#ffffff', emissiveMap: bannerTexture('ДАВАЙ  ДАВАЙ!', '#e11d48', '#ffffff'), emissiveIntensity: 0.5 }),
      ],
    );
    banner.position.y = 9.5;
    gantry.add(banner);
    // start lights
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 8),
        new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 2 }),
      );
      l.position.set((i - 2) * 1.1, 8.0, -0.35);
      gantry.add(l);
    }
    gantry.position.set(s.x, 0, s.z);
    gantry.rotation.y = Math.atan2(s.tx, s.tz);
    group.add(gantry);
  }

  // ---------- boost pads
  const boostTex = boostTexture();
  boostTex.repeat.set(1, 3);
  const boostMat = new THREE.MeshStandardMaterial({
    map: boostTex,
    emissive: '#ffffff',
    emissiveMap: boostTex,
    emissiveIntensity: 1.3,
    roughness: 0.4,
    transparent: false,
  });
  for (const b of track.boosts) {
    const mid = track.pointAt(b.d + b.len / 2, b.lat);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(b.width, b.len), boostMat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = mid.heading + Math.PI;
    pad.position.set(mid.x, track.heightAt(b.d) + 0.09, mid.z);
    group.add(pad);
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(b.width + 0.8, b.len + 0.8),
      new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.5 }),
    );
    frame.rotation.copy(pad.rotation);
    frame.position.copy(pad.position);
    frame.position.y -= 0.01;
    group.add(frame);
  }

  // ---------- barricades
  const barrierMeshes: THREE.Object3D[] = [];
  const barTex = stripeTexture(st.barrierA, st.barrierB);
  const barMat = new THREE.MeshStandardMaterial({
    map: barTex,
    roughness: theme === 'candy' ? 0.35 : 0.6,
    emissive: theme === 'ocean' ? new THREE.Color(st.barrierA) : new THREE.Color(0),
    emissiveIntensity: theme === 'ocean' ? 0.3 : 0,
  });
  for (const b of track.barriers) {
    const gGroup = new THREE.Group();
    const geo = theme === 'pixel' ? new THREE.BoxGeometry(b.width, 2.2, b.depth) : new THREE.BoxGeometry(b.width, 1.6, b.depth, 1, 1, 1);
    const mesh = new THREE.Mesh(geo, barMat);
    mesh.position.y = theme === 'pixel' ? 1.1 : 0.8;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    gGroup.add(mesh);
    if (theme !== 'pixel') {
      // blinking warning lights on top
      for (const x of [-b.width / 2 + 0.5, b.width / 2 - 0.5]) {
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 10, 8),
          new THREE.MeshStandardMaterial({ color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 2.5 }),
        );
        lamp.position.set(x, 1.8, 0);
        gGroup.add(lamp);
      }
    }
    gGroup.position.set(b.x, 0, b.z);
    gGroup.rotation.y = Math.atan2(b.tx, b.tz);
    group.add(gGroup);
    barrierMeshes.push(gGroup);
  }

  return {
    group,
    boostTex,
    barrierMeshes,
    update(t: number) {
      boostTex.offset.y = -t * 1.6;
    },
  };
}
