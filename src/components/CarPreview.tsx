import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar, disposeObject } from '../game/carModel';
import { HIP_H, buildDriver, type DriverModel } from '../game/driver';
import type { CarDef, DriverLook } from '../game/types';

interface Props {
  car: CarDef;
  /** driver shown in the seat (car view) or standing on the turntable (driver view) */
  driver?: DriverLook;
  view?: 'car' | 'driver';
  helmet?: boolean;
  className?: string;
  /** auto-rotation speed (rad/s) */
  spin?: number;
}

/** Small standalone 3D turntable used in the menu and garage */
export default function CarPreview({ car, driver, view = 'car', helmet = false, className = '', spin = 0.6 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ set: (c: CarDef, d: DriverLook | undefined, v: 'car' | 'driver', helmet: boolean) => void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const look = new THREE.Vector3(0, 0.7, 0);
    let camDist = 10.5;

    const key = new THREE.DirectionalLight('#ffffff', 2.6);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const rim = new THREE.DirectionalLight('#a5b4fc', 1.4);
    rim.position.set(-5, 3, -6);
    scene.add(key, rim, new THREE.HemisphereLight('#c7d2fe', '#1e1b4b', 0.8));

    // glowing turntable
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.6, 0.25, 64),
      new THREE.MeshStandardMaterial({ color: '#1e1b4b', metalness: 0.7, roughness: 0.3 }),
    );
    disc.position.y = -0.13;
    disc.receiveShadow = true;
    scene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.06, 8, 96), new THREE.MeshBasicMaterial({ color: '#f472b6' }));
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);

    const holder = new THREE.Group();
    scene.add(holder);
    let current: THREE.Object3D | null = null;
    let person: DriverModel | null = null;
    let mode: 'car' | 'driver' = 'car';

    const set = (c: CarDef, d: DriverLook | undefined, v: 'car' | 'driver', withHelmet: boolean) => {
      if (current) {
        holder.remove(current);
        disposeObject(current);
      }
      person = null;
      mode = v;
      if (v === 'driver' && d) {
        person = buildDriver(d);
        person.setHelmet(withHelmet);
        person.stand();
        person.root.scale.setScalar(2.4);
        current = person.root;
        look.set(0, 2.2, 0);
        camDist = 12.5;
      } else {
        const m = buildCar(c);
        if (d) {
          const p = buildDriver(d);
          p.setHelmet(true);
          p.sit();
          p.root.scale.setScalar(m.driverScale);
          p.root.position.set(m.seat.x, m.seat.y - HIP_H * m.driverScale, m.seat.z);
          m.body.add(p.root);
        }
        m.root.scale.setScalar(1.15);
        current = m.root;
        look.set(0, 0.7, 0);
        camDist = 10.5;
      }
      holder.add(current);
      (ring.material as THREE.MeshBasicMaterial).color.set(c.glow ?? c.color);
      resize();
    };
    api.current = { set };

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const dist = camDist * (w / h < 1 ? 1.25 : 1);
      camera.position.set(dist * 0.7, look.y + dist * 0.3, dist * 0.7);
      camera.lookAt(look);
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
    let time = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      if (!drag) holder.rotation.y += (spinRef.current + vel) * dt;
      vel *= Math.exp(-3 * dt);
      // the driver waves at the camera now and then
      if (person && mode === 'driver') {
        person.stand();
        const k = time % 5;
        if (k < 1.6) person.wave(time, -1);
        person.hips.position.y += Math.sin(time * 2) * 0.01;
      }
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

  // rebuild only when what is shown actually changes
  const lookKey = driver ? JSON.stringify(driver) : '';
  useEffect(() => {
    api.current?.set(car, driver, view, helmet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car.id, car.color, car.accent, lookKey, view, helmet]);

  return <div ref={host} className={`touch-none ${className}`} />;
}
