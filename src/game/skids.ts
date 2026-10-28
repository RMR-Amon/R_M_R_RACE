import * as THREE from 'three';

const MAX = 2400;
const WIDTH = 0.3;

/** Tyre marks left on the road by drifting, hard braking and spins (ring buffer of quads) */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private attr: THREE.BufferAttribute;
  private next = 0;
  private count = 0;
  private last = new Map<string, { x: number; z: number; y: number }>();

  constructor() {
    this.pos = new Float32Array(MAX * 4 * 3);
    const idx = new Uint32Array(MAX * 6);
    for (let i = 0; i < MAX; i++) {
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: '#0a0a0a',
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** extend the mark of one tyre (key) to a new ground point */
  add(key: string, x: number, y: number, z: number) {
    const prev = this.last.get(key);
    this.last.set(key, { x, z, y });
    if (!prev) return;
    const dx = x - prev.x;
    const dz = z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.25) {
      this.last.set(key, prev);
      return;
    }
    if (len > 4) return;
    const nx = (-dz / len) * WIDTH * 0.5;
    const nz = (dx / len) * WIDTH * 0.5;
    const o = this.next * 12;
    const p = this.pos;
    p[o] = prev.x + nx; p[o + 1] = prev.y; p[o + 2] = prev.z + nz;
    p[o + 3] = prev.x - nx; p[o + 4] = prev.y; p[o + 5] = prev.z - nz;
    p[o + 6] = x + nx; p[o + 7] = y; p[o + 8] = z + nz;
    p[o + 9] = x - nx; p[o + 10] = y; p[o + 11] = z - nz;
    this.attr.addUpdateRange(o, 12);
    this.attr.needsUpdate = true;
    this.next = (this.next + 1) % MAX;
    this.count = Math.min(MAX, this.count + 1);
    this.mesh.geometry.setDrawRange(0, this.count * 6);
  }

  /** the tyre stopped sliding: the next mark starts a new strip */
  lift(key: string) {
    this.last.delete(key);
  }
}
