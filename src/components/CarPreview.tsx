import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar, disposeObject } from '../game/carModel';
import type { CarDef } from '../game/types';

interface Props {
  car: CarDef;
  className?: string;
  /** auto-rotation speed (rad/s) */
  spin?: number;
}

/** Small standalone 3D turntable used in the menu and garage */
export default function CarPreview({ car, className = '', spin = 0.6 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setCar: (c: CarDef) => void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(7.5, 3.6, 7.5);
    camera.lookAt(0, 0.7, 0);

    const key = new THREE.DirectionalLight('#ffffff', 2.5);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key, new THREE.HemisphereLight('#c7d2fe', '#1e1b4b', 0.8));

    // glowing turntable
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.6, 0.25, 64),
      new THREE.MeshStandardMaterial({ color: '#1e1b4b', metalness: 0.7, roughness: 0.3 }),
    );
    disc.position.y = -0.13;
    disc.receiveShadow = true;
    scene.add(disc);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.5, 0.06, 8, 96),
      new THREE.MeshBasicMaterial({ color: '#f472b6' }),
    );
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);

    const holder = new THREE.Group();
    scene.add(holder);
    let current: THREE.Group | null = null;

    const setCar = (c: CarDef) => {
      if (current) {
        holder.remove(current);
        disposeObject(current);
      }
      const m = buildCar(c);
      const s = 1.15;
      m.root.scale.setScalar(s);
      current = m.root;
      holder.add(m.root);
      (ring.material as THREE.MeshBasicMaterial).color.set(c.glow ?? c.color);
    };
    api.current = { setCar };

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.setLength(w / h < 1 ? 13 : 10.5);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    let last = performance.now();
    let drag = false;
    let lastX = 0;
    let vel = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!drag) holder.rotation.y += (spinRef.current + vel) * dt;
      vel *= Math.exp(-3 * dt);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    const down = (e: PointerEvent) => {
      drag = true;
      lastX = e.clientX;
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      holder.rotation.y += dx * 0.01;
      vel = dx * 0.6;
    };
    const up = () => (drag = false);
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      disposeObject(scene);
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []);

  const spinRef = useRef(spin);
  spinRef.current = spin;

  useEffect(() => {
    api.current?.setCar(car);
  }, [car]);

  return <div ref={host} className={`touch-none ${className}`} />;
}
