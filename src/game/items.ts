import * as THREE from 'three';
import type { ItemType } from './types';
import { itemBoxTexture } from './textures';
import { t, type TKey } from '../i18n';

export const ITEM_INFO: Record<ItemType, { icon: string; color: string }> = {
  missile: { icon: '🚀', color: '#ef4444' },
  bomb: { icon: '💣', color: '#111827' },
  oil: { icon: '🛢️', color: '#0f172a' },
  boost: { icon: '⚡', color: '#f59e0b' },
  shield: { icon: '🛡️', color: '#38bdf8' },
  ice: { icon: '❄️', color: '#67e8f9' },
  fly: { icon: '✈️', color: '#a78bfa' },
};

export const itemName = (it: ItemType) => t(`item.${it}.name` as TKey);
export const itemHint = (it: ItemType) => t(`item.${it}.hint` as TKey);

export const ITEM_LIST: ItemType[] = ['missile', 'bomb', 'oil', 'boost', 'shield', 'ice', 'fly'];

/** Missile fuse: it self-destructs if it has not reached its target in time */
export const MISSILE_FUSE = 6;
export const FLY_TIME = 5;

let shared: {
  box: THREE.BoxGeometry;
  boxMat: THREE.MeshStandardMaterial;
} | null = null;

export function itemBoxAssets() {
  if (!shared) {
    shared = {
      box: new THREE.BoxGeometry(2.2, 2.2, 2.2),
      boxMat: new THREE.MeshStandardMaterial({
        map: itemBoxTexture(),
        color: '#ffffff',
        emissive: '#ff00ff',
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.1,
      }),
    };
  }
  return shared;
}

export function resetItemAssets() {
  if (shared) {
    shared.box.dispose();
    shared.boxMat.dispose();
  }
  shared = null;
}

export function makeMissile() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: '#ef4444', metalness: 0.4, roughness: 0.35 });
  const white = new THREE.MeshStandardMaterial({ color: '#f8fafc', metalness: 0.3, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 12), white);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 12), red);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.1;
  g.add(nose);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.45), red);
    fin.position.z = -0.6;
    fin.rotation.z = (i / 4) * Math.PI * 2;
    fin.position.x = Math.sin((i / 4) * Math.PI * 2) * 0.3;
    fin.position.y = Math.cos((i / 4) * Math.PI * 2) * 0.3;
    g.add(fin);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.9, 10),
    new THREE.MeshBasicMaterial({ color: '#ffb703', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -1.2;
  g.add(flame);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export function makeIceShot() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.7, 0),
    new THREE.MeshStandardMaterial({ color: '#cffafe', emissive: '#22d3ee', emissiveIntensity: 1.8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 }),
  );
  g.add(core);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 14, 10),
    new THREE.MeshBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  g.add(halo);
  return g;
}

export function makeBomb() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 18, 14),
    new THREE.MeshStandardMaterial({ color: '#111827', metalness: 0.6, roughness: 0.3 }),
  );
  body.position.y = 0.85;
  body.castShadow = true;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.25, 10), new THREE.MeshStandardMaterial({ color: '#52525b', metalness: 0.8 }));
  cap.position.y = 1.75;
  g.add(cap);
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#ff0000', emissiveIntensity: 3 }),
  );
  light.position.y = 1.95;
  light.name = 'light';
  g.add(light);
  // stripe
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.05, 6, 24), new THREE.MeshStandardMaterial({ color: '#facc15' }));
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = 0.85;
  g.add(stripe);
  return g;
}

export function makeOil() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#05070d', metalness: 0.9, roughness: 0.08 });
  const main = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), mat);
  main.rotation.x = -Math.PI / 2;
  main.position.y = 0.1;
  g.add(main);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.9 + (i % 2) * 0.4, 16), mat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(Math.cos(a) * 2.4, 0.11, Math.sin(a) * 2.4);
    g.add(blob);
  }
  // rainbow sheen
  const sheen = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.6, 24),
    new THREE.MeshBasicMaterial({ color: '#a855f7', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.y = 0.12;
  g.add(sheen);
  return g;
}

export function makeShieldBubble() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 24, 16),
    new THREE.MeshStandardMaterial({
      color: '#7dd3fc',
      emissive: '#38bdf8',
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      roughness: 0.1,
      side: THREE.DoubleSide,
    }),
  );
}

export function makeIceCube() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 2.4, 5.4),
    new THREE.MeshStandardMaterial({
      color: '#cffafe',
      emissive: '#67e8f9',
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.55,
      roughness: 0.05,
      metalness: 0.1,
    }),
  );
}

export function makeNameTag(name: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 48, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(36, 32, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 30px Nunito, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 56, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}

/** Jet wings + thrusters shown while a car is flying */
export function makeWings() {
  const g = new THREE.Group();
  const wingMat = new THREE.MeshStandardMaterial({ color: '#e5e7eb', metalness: 0.7, roughness: 0.25, emissive: '#7c3aed', emissiveIntensity: 0.25 });
  const tipMat = new THREE.MeshStandardMaterial({ color: '#a78bfa', emissive: '#a78bfa', emissiveIntensity: 2.2 });
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.7);
    shape.lineTo(2.6, -0.2);
    shape.lineTo(2.6, -0.65);
    shape.lineTo(0, -0.7);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    const wing = new THREE.Mesh(geo, wingMat);
    wing.scale.x = side;
    wing.position.set(side * 0.9, 0.95, -0.2);
    wing.castShadow = true;
    g.add(wing);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.5), tipMat);
    tip.position.set(side * 3.5, 0.95, 0.15);
    g.add(tip);
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 12), wingMat);
    jet.rotation.x = Math.PI / 2;
    jet.position.set(side * 1.6, 0.8, -0.6);
    g.add(jet);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 1.3, 10),
      new THREE.MeshBasicMaterial({ color: '#c4b5fd', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flame.name = 'flame';
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(side * 1.6, 0.8, -1.65);
    g.add(flame);
  }
  return g;
}

/** Small canvas sprite that shows text (missile fuse timer / warnings), redrawn on demand */
export function makeLabel(w = 160, h = 64) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.renderOrder = 10;
  let last = '';
  const draw = (text: string, bg: string, fg = '#ffffff') => {
    if (text === last) return;
    last = text;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 18);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.font = '900 34px Nunito, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
    tex.needsUpdate = true;
  };
  return { sprite, draw };
}
