import * as THREE from 'three';
import type { Track } from './track';
import type { ThemeId } from './types';
import { THEME_STYLES } from './themes';
import {
  bannerTexture,
  canvasTexture,
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

  if (track.oval) buildArena(group, track, theme);
  else buildCircuit(group, track, theme);

  // ---------- boost pads
  const boostTex = boostTexture();
  boostTex.repeat.set(1, 3);
  const boostMat = new THREE.MeshStandardMaterial({
    map: boostTex,
    emissive: '#ffffff',
    emissiveMap: boostTex,
    emissiveIntensity: 0.9,
    roughness: 0.4,
    transparent: false,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.5 });
  for (const b of track.boosts) {
    const mid = b.x !== undefined ? { x: b.x, z: b.z!, heading: b.heading! } : track.pointAt(b.d + b.len / 2, b.lat);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(b.width, b.len), boostMat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = mid.heading + Math.PI;
    pad.position.set(mid.x, (track.oval ? 0.05 : track.heightAt(b.d)) + 0.09, mid.z);
    group.add(pad);
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(b.width + 0.8, b.len + 0.8),
      frameMat,
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
    emissiveIntensity: theme === 'ocean' ? 0.08 : 0,
  });
  // shared by every barricade
  const lampGeo = new THREE.SphereGeometry(0.22, 10, 8);
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 1.6 });
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
        const lamp = new THREE.Mesh(lampGeo, lampMat);
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


/** Ring circuit: road, curbs, walls, the chasm jump and the start gantry */
function buildCircuit(group: THREE.Group, track: Track, theme: ThemeId) {
  const st = THEME_STYLES[theme];
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
    emissiveIntensity: theme === 'ocean' ? 0.1 : 0,
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
        // face 4 (+z) faces away from approaching cars; face 5 (-z) is what drivers see coming to the line
        new THREE.MeshStandardMaterial({ map: bannerTexture('ДАВАЙ  ДАВАЙ!', '#c2334f', '#eeeeee'), roughness: 0.7 }),
        new THREE.MeshStandardMaterial({ map: bannerTexture('R_M_R_RACE', '#1b2233', '#eeeeee'), emissive: '#ffffff', emissiveMap: bannerTexture('R_M_R_RACE', '#1b2233', '#eeeeee'), emissiveIntensity: 0.15, roughness: 0.7 }),
      ],
    );
    banner.position.y = 9.5;
    gantry.add(banner);
    // start lights
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 8),
        new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 1.8 }),
      );
      l.position.set((i - 2) * 1.1, 8.0, -0.35);
      gantry.add(l);
    }
    gantry.position.set(s.x, 0, s.z);
    gantry.rotation.y = Math.atan2(s.tx, s.tz);
    group.add(gantry);
  }

}

/** Oval battle arena: the whole ellipse is a drivable floor surrounded by a curb and a wall */
function buildArena(group: THREE.Group, track: Track, theme: ThemeId) {
  const st = THEME_STYLES[theme];
  const { a, b } = track.oval!;
  const seg = 160;

  // ---------- floor
  const floorTex = canvasTexture('arena-floor-' + theme, 512, 512, (ctx, w, hh) => {
    ctx.fillStyle = st.road;
    ctx.fillRect(0, 0, w, hh);
    for (let i = 0; i < 9000; i++) {
      const v = Math.random() > 0.5 ? 255 : 0;
      ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.07})`;
      ctx.fillRect(Math.random() * w, Math.random() * hh, 2, 2);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= w; i += 128) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, hh);
      ctx.moveTo(0, i);
      ctx.lineTo(w, i);
      ctx.stroke();
    }
  });
  floorTex.repeat.set(1 / 16, 1 / 16);
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, a, b, 0, Math.PI * 2, false, 0);
  const floorGeo = new THREE.ShapeGeometry(shape, seg);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, metalness: 0.05 }));
  floor.position.y = 0.03;
  floor.receiveShadow = true;
  group.add(floor);

  // painted markings: centre circle, inner oval line and the arena logo
  const lineMat = new THREE.MeshStandardMaterial({ color: st.roadLine, roughness: 0.6, emissive: st.roadEdge, emissiveIntensity: 0.15 });
  const ringAt = (k: number, w: number) => {
    const g = new THREE.RingGeometry(1 - w, 1, seg, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, lineMat);
    m.scale.set(a * k, 1, b * k);
    m.position.y = 0.05;
    m.receiveShadow = true;
    group.add(m);
  };
  ringAt(0.55, 0.012);
  ringAt(0.86, 0.008);
  const circle = new THREE.Mesh(new THREE.RingGeometry(16, 17.2, 64), lineMat);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.05;
  group.add(circle);
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 6.5),
    new THREE.MeshStandardMaterial({ map: bannerTexture('R_M_R  ARENA', 'rgba(0,0,0,0)', '#ffffff'), color: '#cfcfd4', transparent: true, roughness: 0.8, depthWrite: false }),
  );
  logo.rotation.x = -Math.PI / 2;
  logo.position.y = 0.06;
  group.add(logo);

  // ---------- curb band + wall around the ellipse
  const ellipseRibbon = (k0: number, k1: number, y0: number, y1: number, vScale: number) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let dist = 0;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const cx = Math.cos(t);
      const sz = Math.sin(t);
      if (i > 0) {
        const tp = ((i - 1) / seg) * Math.PI * 2;
        dist += Math.hypot(a * (cx - Math.cos(tp)), b * (sz - Math.sin(tp)));
      }
      pos.push(cx * (a + k0), y0, sz * (b + k0));
      pos.push(cx * (a + k1), y1, sz * (b + k1));
      uv.push(0, dist / vScale, 1, dist / vScale);
    }
    for (let i = 0; i < seg; i++) {
      const j = i * 2;
      idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const curb = new THREE.Mesh(ellipseRibbon(-CURB_W, 0, 0.08, 0.08, 4), new THREE.MeshStandardMaterial({ map: curbTexture(theme), roughness: 0.6, side: THREE.DoubleSide }));
  curb.receiveShadow = true;
  group.add(curb);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(theme), roughness: 0.7, side: THREE.DoubleSide });
  const wallH = WALL_H * 1.3;
  group.add(new THREE.Mesh(ellipseRibbon(0, 0, 0, wallH, 6), wallMat));
  group.add(new THREE.Mesh(ellipseRibbon(0, 0.7, wallH, wallH, 6), wallMat));
  group.add(new THREE.Mesh(ellipseRibbon(0.7, 0.7, wallH, 0, 6), wallMat));

  // ---------- ground outside
  const gTex = groundTexture(theme).clone();
  gTex.needsUpdate = true;
  gTex.repeat.set(1 / 18, 1 / 18);
  const groundGeo = new THREE.PlaneGeometry(2200, 2200);
  groundGeo.rotateX(-Math.PI / 2);
  // planar UVs in world units so the texture repeat matches the circuits
  const guv = groundGeo.attributes.uv as THREE.BufferAttribute;
  const gp = groundGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < guv.count; i++) guv.setXY(i, gp.getX(i), -gp.getZ(i));
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: gTex, roughness: 1 }));
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);

  // ---------- floodlight towers
  const poleMat = new THREE.MeshStandardMaterial({ color: '#3f3f46', metalness: 0.7, roughness: 0.35 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff7d6', emissiveIntensity: 1.8 });
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(t) * (a + 14);
    const z = Math.sin(t) * (b + 14);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 26, 10), poleMat);
    pole.position.set(x, 13, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 1), lampMat);
    head.position.set(x, 26.5, z);
    head.lookAt(0, 0, 0);
    group.add(head);
  }
}
