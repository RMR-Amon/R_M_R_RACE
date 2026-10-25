import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CARS, carParams, getCar } from '../data/cars';
import { getMap } from '../data/maps';
import { audio } from './audio';
import { buildCar, type CarModel } from './carModel';
import { buildEnvironment, type Environment } from './environment';
import { Input } from './input';
import {
  itemBoxAssets,
  makeBomb,
  makeIceCube,
  makeIceShot,
  makeMissile,
  makeNameTag,
  makeOil,
  makeShieldBubble,
  resetItemAssets,
} from './items';
import { Particles } from './particles';
import { clamp, damp, makeRng, wrapAngle } from './rng';
import { THEME_STYLES } from './themes';
import { disposeTextureCache } from './textures';
import { Track } from './track';
import { buildTrackVisuals, type TrackVisuals } from './trackMesh';
import type {
  CarDef,
  CarParams,
  HudState,
  ItemType,
  RaceConfig,
  RaceResult,
  ResultRow,
  StandingRow,
} from './types';

const GRAV = 24;
const CAR_R = 1.25;
const CURB_W = 1.8;
const AI_NAMES = ['Макс', 'Луна', 'Турбо', 'Ракета', 'Вихрь', 'Нитро', 'Блиц', 'Комета'];

interface Controls {
  throttle: number;
  brake: number;
  steer: number;
}

interface AiState {
  lane: number;
  laneTarget: number;
  laneTimer: number;
  itemT: number;
  holdT: number;
  skill: number;
  stuckT: number;
}

interface Racer {
  id: number;
  name: string;
  isPlayer: boolean;
  def: CarDef;
  params: CarParams;
  model: CarModel;
  tag: THREE.Sprite | null;
  shieldMesh: THREE.Mesh;
  iceMesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  vy: number;
  heading: number;
  speed: number;
  steer: number;
  airborne: boolean;
  trackIndex: number;
  lastD: number;
  lat: number;
  progress: number;
  lapShown: number;
  finished: boolean;
  finishTime: number;
  place: number;
  item: ItemType | null;
  itemCharges: number;
  rouletteT: number;
  boostT: number;
  shieldT: number;
  frozenT: number;
  spinT: number;
  spinVis: number;
  fallingT: number;
  invulnT: number;
  hitCooldown: number;
  padCooldown: number;
  points: number;
  hits: number;
  rubber: number;
  rollVis: number;
  pitchVis: number;
  lastThrottle: number;
  ai: AiState;
}

interface Projectile {
  kind: 'missile' | 'ice';
  owner: Racer;
  target: Racer | null;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  life: number;
  index: number;
  mesh: THREE.Group;
}

interface Hazard {
  kind: 'bomb' | 'oil';
  owner: Racer;
  x: number;
  y: number;
  z: number;
  armT: number;
  mesh: THREE.Group;
  t: number;
}

interface ItemBox {
  x: number;
  y: number;
  z: number;
  lat: number;
  d: number;
  active: boolean;
  respawn: number;
  mesh: THREE.Mesh;
}

interface Flash {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  size: number;
}

export interface GameCallbacks {
  onHud(h: HudState): void;
  onFinish(r: RaceResult): void;
  onPauseRequest(): void;
}

const isTouch = () => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export class Game {
  readonly input = new Input();
  /** debug: let the AI drive the player's car */
  autopilot = false;
  /** debug counters (visible via ?debug) */
  readonly stats = { falls: 0, jumps: 0, items: 0, hits: 0, barriers: 0, boxes: 0, pads: 0 };
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private track: Track;
  private visuals: TrackVisuals;
  private env: Environment;
  private particles: Particles;
  private smoke: Particles;
  private racers: Racer[] = [];
  private player!: Racer;
  private projectiles: Projectile[] = [];
  private hazards: Hazard[] = [];
  private boxes: ItemBox[] = [];
  private flashes: Flash[] = [];
  private raf = 0;
  private last = 0;
  private time = 0;
  private raceTime = 0;
  private countdown = 4;
  private lastBeep = 5;
  private phase: HudState['phase'] = 'countdown';
  private paused = false;
  private ended = false;
  private endTimer = -1;
  private hudTimer = 0;
  private shake = 0;
  private camYaw = 0;
  private camLook = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private message = '';
  private messageId = 0;
  private rng = makeRng(Date.now() & 0xffff);
  private resizeObs: ResizeObserver;
  private minimap: HTMLCanvasElement | null;
  private minimapPath: Path2D | null = null;
  private mmTransform = { s: 1, ox: 0, oy: 0 };
  private pmrem: THREE.PMREMGenerator;
  private readonly laps: number;
  private readonly battle: boolean;
  private readonly duration: number;
  private readonly mapName: string;
  private tmpV = new THREE.Vector3();
  private cfg: RaceConfig;
  private cb: GameCallbacks;
  private container: HTMLElement;

  constructor(container: HTMLElement, minimap: HTMLCanvasElement | null, cfg: RaceConfig, cb: GameCallbacks) {
    this.container = container;
    this.cfg = cfg;
    this.cb = cb;
    this.minimap = minimap;
    const map = getMap(cfg.mapId);
    this.mapName = map.name;
    this.battle = cfg.mode.kind === 'battle';
    this.laps = cfg.mode.kind === 'race' ? cfg.mode.laps : 0;
    this.duration = cfg.mode.kind === 'battle' ? cfg.mode.duration : 0;
    const theme = cfg.theme;
    const st = THEME_STYLES[theme];
    const mobile = isTouch();

    // ---------- renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = st.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = st.envIntensity;

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.5, 4000);

    // ---------- world
    this.track = new Track(map);
    this.visuals = buildTrackVisuals(this.track, theme);
    this.scene.add(this.visuals.group);
    this.env = buildEnvironment(this.scene, this.track, theme, map.seed);
    this.particles = new Particles(2500, true);
    this.smoke = new Particles(1200, false);
    this.scene.add(this.particles.points, this.smoke.points);

    this.buildItemBoxes();
    this.spawnRacers();
    this.buildMinimap();

    // camera starts behind the player
    const p = this.player;
    this.camYaw = p.heading;
    this.camPos.set(p.x - Math.sin(p.heading) * 14, 7, p.z - Math.cos(p.heading) * 14);
    this.camera.position.copy(this.camPos);
    this.camLook.set(p.x, 1, p.z);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    this.input.onPause = () => this.cb.onPauseRequest();
    this.input.attach();
    document.addEventListener('visibilitychange', this.onVisibility);

    audio.init();
    audio.startEngine();

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ======================================================================== setup

  private buildItemBoxes() {
    const { box, boxMat } = itemBoxAssets();
    const hw = this.track.halfWidth;
    const lats = this.battle ? [-0.7, -0.42, -0.14, 0.14, 0.42, 0.7] : [-0.66, -0.33, 0, 0.33, 0.66];
    for (const d of this.track.itemRows) {
      for (const f of lats) {
        const lat = f * hw;
        const p = this.track.pointAt(d, lat);
        const mesh = new THREE.Mesh(box, boxMat);
        mesh.position.set(p.x, 1.6, p.z);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.boxes.push({ x: p.x, y: 1.6, z: p.z, lat, d, active: true, respawn: 0, mesh });
      }
    }
  }

  private spawnRacers() {
    const playerDef = getCar(this.cfg.carId);
    const others = CARS.filter((c) => c.id !== playerDef.id);
    // shuffle
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    const names = [...AI_NAMES].sort(() => this.rng.next() - 0.5);
    const total = 6;
    const playerSlot = this.battle ? 0 : 3;
    const L = this.track.length;
    for (let k = 0; k < total; k++) {
      const isPlayer = k === playerSlot;
      const def = isPlayer ? playerDef : others[k % others.length];
      let d: number;
      let lat: number;
      if (this.battle) {
        d = (k / total) * L;
        lat = 0;
      } else {
        const row = Math.floor(k / 2);
        d = L - 12 - row * 11;
        lat = k % 2 ? 7 : -7;
      }
      const pos = this.track.pointAt(d, lat);
      const model = buildCar(def);
      this.scene.add(model.root);
      const shieldMesh = makeShieldBubble();
      shieldMesh.position.y = 1.0;
      shieldMesh.visible = false;
      model.root.add(shieldMesh);
      const iceMesh = makeIceCube();
      iceMesh.position.y = 1.0;
      iceMesh.visible = false;
      model.root.add(iceMesh);
      const name = isPlayer ? 'Ты' : names[k % names.length];
      let tag: THREE.Sprite | null = null;
      if (!isPlayer) {
        tag = makeNameTag(name, def.color);
        tag.position.y = 3.4;
        model.root.add(tag);
      }
      const proj = this.track.project(pos.x, pos.z);
      const startProgress = this.battle ? d : -this.track.ahead(d, 0);
      const r: Racer = {
        id: k,
        name,
        isPlayer,
        def,
        params: carParams(def),
        model,
        tag,
        shieldMesh,
        iceMesh,
        x: pos.x,
        y: 0,
        z: pos.z,
        vx: 0,
        vz: 0,
        vy: 0,
        heading: pos.heading,
        speed: 0,
        steer: 0,
        airborne: false,
        trackIndex: proj.index,
        lastD: proj.d,
        lat,
        progress: startProgress,
        lapShown: 1,
        finished: false,
        finishTime: 0,
        place: k + 1,
        item: null,
        itemCharges: 0,
        rouletteT: 0,
        boostT: 0,
        shieldT: 0,
        frozenT: 0,
        spinT: 0,
        spinVis: 0,
        fallingT: 0,
        invulnT: 0,
        hitCooldown: 0,
        padCooldown: 0,
        points: 0,
        hits: 0,
        rubber: 1,
        rollVis: 0,
        pitchVis: 0,
        lastThrottle: 0,
        ai: {
          lane: lat,
          laneTarget: lat,
          laneTimer: this.rng.range(1, 3),
          itemT: 1,
          holdT: 0,
          skill: this.rng.range(0.94, 1.0),
          stuckT: 0,
        },
      };
      this.racers.push(r);
      if (isPlayer) this.player = r;
      this.syncModel(r, 0);
    }
  }

  private buildMinimap() {
    const c = this.minimap;
    if (!c) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of this.track.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    const size = 200;
    const pad = 16;
    const s = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    // seen from above: +x to the right, +z downwards
    this.mmTransform = {
      s,
      ox: pad + ((size - pad * 2) - (maxX - minX) * s) / 2 - minX * s,
      oy: pad + ((size - pad * 2) - (maxZ - minZ) * s) / 2 - minZ * s,
    };
    const path = new Path2D();
    this.track.samples.forEach((p, i) => {
      const [x, y] = this.mm(p.x, p.z);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
    this.minimapPath = path;
    c.width = size;
    c.height = size;
  }

  private mm(x: number, z: number): [number, number] {
    const t = this.mmTransform;
    return [t.ox + x * t.s, t.oy + z * t.s];
  }

  // ======================================================================== public API

  setPaused(p: boolean) {
    this.paused = p;
    if (p) audio.updateEngine(0, 0);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.input.detach();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObs.disconnect();
    audio.stopEngine();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const x of list) {
        const mm = x as THREE.MeshStandardMaterial & THREE.SpriteMaterial;
        if (mm.map && !(mm.map as THREE.CanvasTexture).isCanvasTexture) mm.map.dispose();
        x.dispose();
      }
    });
    this.racers.forEach((r) => r.tag?.material.map?.dispose());
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    disposeTextureCache();
    resetItemAssets();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private onVisibility = () => {
    if (document.hidden && !this.ended && !this.paused) this.cb.onPauseRequest();
  };

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const ph = h * this.renderer.getPixelRatio();
    this.particles.setScale(ph);
    this.smoke.setScale(ph);
  }

  // ======================================================================== main loop

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) return;
    if (!this.paused) {
      // sub-step physics for stability at low frame rates
      const steps = Math.ceil(dt / (1 / 90));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) this.step(h);
      this.updateVisuals(dt);
    }
    this.renderer.render(this.scene, this.camera);
  };

  private step(dt: number) {
    this.time += dt;

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown - 1);
      if (c < this.lastBeep && c >= 0) {
        this.lastBeep = c;
        audio.countdown(c === 0);
        if (c === 0) this.flash('СТАРТ!');
      }
      if (this.countdown <= 1) {
        this.phase = 'racing';
      }
    } else if (!this.ended) {
      this.raceTime += dt;
    }

    const racing = this.phase !== 'countdown';

    for (const r of this.racers) {
      let ctl: Controls;
      if (!racing) ctl = { throttle: 0, brake: 0, steer: 0 };
      else if (r.isPlayer && !r.finished && !this.autopilot) {
        ctl = { throttle: this.input.throttle, brake: this.input.brake, steer: this.input.steer };
        if (this.input.consumeFire()) this.useItem(r);
      } else ctl = this.aiControl(r, dt);
      r.lastThrottle = ctl.throttle;
      this.physics(r, ctl, dt);
      this.interact(r, dt);
    }
    this.carCollisions();
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updateBoxes(dt);
    this.rank();
    this.checkEnd(dt);
  }

  // ======================================================================== physics

  private physics(r: Racer, ctl: Controls, dt: number) {
    const p = r.params;
    const tr = this.track;

    r.boostT = Math.max(0, r.boostT - dt);
    r.shieldT = Math.max(0, r.shieldT - dt);
    r.invulnT = Math.max(0, r.invulnT - dt);
    r.hitCooldown = Math.max(0, r.hitCooldown - dt);
    r.padCooldown = Math.max(0, r.padCooldown - dt);
    if (r.rouletteT > 0) r.rouletteT -= dt;

    if (r.fallingT > 0) {
      r.fallingT -= dt;
      r.vy -= GRAV * dt;
      r.y += r.vy * dt;
      r.x += r.vx * dt * 0.4;
      r.z += r.vz * dt * 0.4;
      if (r.fallingT <= 0) this.respawnAfterFall(r);
      return;
    }

    let { throttle, brake, steer: steerIn } = ctl;
    if (r.frozenT > 0) {
      r.frozenT -= dt;
      r.speed *= Math.exp(-3.5 * dt);
      throttle = brake = steerIn = 0;
    }
    if (r.spinT > 0) {
      r.spinT -= dt;
      r.spinVis += dt * 13;
      r.speed *= Math.exp(-1.4 * dt);
      throttle = brake = 0;
      steerIn = 0;
    } else {
      // settle the visual spin back to a full turn
      const target = Math.round(r.spinVis / (Math.PI * 2)) * Math.PI * 2;
      r.spinVis += (target - r.spinVis) * damp(10, dt);
    }

    // smooth steering input -> no jerky, sharp turns
    const steerRate = steerIn === 0 ? 7 : 3.2;
    r.steer += (steerIn - r.steer) * damp(steerRate, dt);

    const boosting = r.boostT > 0;
    const maxS = p.maxSpeed * r.rubber * (boosting ? 1.32 : 1);

    if (throttle > 0) {
      if (r.speed < 0) r.speed += p.brake * dt;
      else if (r.speed < maxS) {
        const ratio = r.speed / maxS;
        r.speed += p.accel * (1 - ratio * ratio * 0.85) * throttle * dt;
      }
    }
    if (brake > 0) {
      if (r.speed > 0.5) r.speed -= p.brake * dt;
      else r.speed = Math.max(-p.maxSpeed * 0.3, r.speed - p.accel * 0.6 * dt);
    }
    if (!throttle && !brake && !boosting) {
      const drag = (2.2 + Math.abs(r.speed) * 0.04) * dt;
      r.speed -= Math.sign(r.speed) * Math.min(Math.abs(r.speed), drag);
    }
    if (boosting && r.frozenT <= 0) r.speed = Math.min(maxS, r.speed + p.accel * 1.6 * dt);
    if (r.speed > maxS) r.speed -= (r.speed - maxS) * damp(1.2, dt);

    // steering: gentle at low and high speed
    const absS = Math.abs(r.speed);
    const low = clamp(absS / 7, 0, 1);
    const high = 1 - 0.32 * clamp(absS / p.maxSpeed, 0, 1.2);
    const air = r.airborne ? 0.25 : 1;
    const dir = r.speed >= 0 ? 1 : -1;
    r.heading -= r.steer * p.turnRate * low * high * air * dir * dt;

    // velocity follows heading with limited grip (slight drift feel)
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    const grip = r.airborne ? 0.3 : r.spinT > 0 ? 0.7 : p.grip;
    const k = damp(grip, dt);
    r.vx += (fx * r.speed - r.vx) * k;
    r.vz += (fz * r.speed - r.vz) * k;
    r.x += r.vx * dt;
    r.z += r.vz * dt;

    // ---------- track progress
    const pr = tr.project(r.x, r.z, r.trackIndex);
    let delta = pr.d - r.lastD;
    if (delta > tr.length / 2) delta -= tr.length;
    if (delta < -tr.length / 2) delta += tr.length;
    r.progress += delta;
    r.lastD = pr.d;
    r.trackIndex = pr.index;
    r.lat = pr.lat;

    // ---------- walls
    const limit = tr.halfWidth + CURB_W - 1.05;
    if (Math.abs(pr.lat) > limit) {
      const s = tr.samples[pr.index];
      const side = Math.sign(pr.lat);
      const over = Math.abs(pr.lat) - limit;
      r.x -= s.nx * side * over;
      r.z -= s.nz * side * over;
      const vn = (r.vx * s.nx + r.vz * s.nz) * side;
      if (vn > 0) {
        r.vx -= s.nx * side * vn * 1.4;
        r.vz -= s.nz * side * vn * 1.4;
        r.speed *= Math.max(0.6, 1 - vn * 0.022);
        const th = Math.atan2(s.tx, s.tz) + (r.speed < 0 ? Math.PI : 0);
        r.heading += wrapAngle(th - r.heading) * Math.min(0.5, vn * 0.03);
        if (vn > 3 && !r.airborne) {
          const wx = r.x + s.nx * side * 1.1;
          const wz = r.z + s.nz * side * 1.1;
          this.particles.burst(wx, r.y + 0.6, wz, Math.min(14, Math.floor(vn * 1.5)), 8, ['#ffd166', '#ff9f1c', '#ffffff'], 0.5, 0.4, 14);
          if (r.isPlayer && vn > 7 && r.hitCooldown <= 0) {
            this.shake = Math.max(this.shake, Math.min(0.6, vn * 0.05));
            audio.crash();
            r.hitCooldown = 0.4;
          }
        }
      }
    }

    // ---------- vertical: ramp, jump, cliff
    const ground = tr.groundAt(pr.d);
    if (!r.airborne) {
      if (ground < r.y - 0.4) {
        r.airborne = true;
      } else {
        r.vy = clamp((ground - r.y) / dt, -25, 25);
        r.y = ground;
      }
    }
    if (r.airborne) {
      r.vy -= GRAV * dt;
      r.y += r.vy * dt;
      if (r.y <= ground) {
        const hard = r.vy < -9;
        r.y = ground;
        r.vy = 0;
        r.airborne = false;
        if (tr.gap && tr.ahead(tr.gap.gapEnd, pr.d) < 120) this.stats.jumps++;
        if (hard) {
          this.smoke.burst(r.x, 0.3, r.z, 12, 6, ['#d6d3d1', '#a8a29e'], 2.2, 0.8, -1);
          if (r.isPlayer) {
            this.shake = Math.max(this.shake, 0.3);
            audio.land();
          }
        }
      }
    }
    if (tr.inGap(pr.d) && r.y < -0.4) {
      r.fallingT = 1.6;
      this.stats.falls++;
      r.frozenT = 0;
      r.spinT = 0;
      if (r.isPlayer) {
        this.flash('Упал в пропасть! 😱');
        audio.fall();
      }
    }

    // AI stuck detection
    if (!r.isPlayer || r.finished) {
      if (this.phase !== 'countdown' && absS < 2.5 && r.frozenT <= 0 && r.spinT <= 0) r.ai.stuckT += dt;
      else r.ai.stuckT = Math.max(0, r.ai.stuckT - dt * 2);
      if (r.ai.stuckT > 4) this.respawnAt(r, r.lastD, 0);
    }
  }

  private respawnAt(r: Racer, d: number, lat: number) {
    const tr = this.track;
    const p = tr.pointAt(d, lat);
    let delta = tr.wrapD(d) - r.lastD;
    if (delta > tr.length / 2) delta -= tr.length;
    if (delta < -tr.length / 2) delta += tr.length;
    r.progress += delta;
    r.x = p.x;
    r.z = p.z;
    r.y = 0;
    r.vy = 0;
    r.vx = r.vz = 0;
    r.speed = 0;
    r.heading = p.heading;
    r.airborne = false;
    r.fallingT = 0;
    r.invulnT = 2;
    r.ai.stuckT = 0;
    const pr = tr.project(p.x, p.z);
    r.trackIndex = pr.index;
    r.lastD = pr.d;
    r.lat = pr.lat;
  }

  private respawnAfterFall(r: Racer) {
    const g = this.track.gap!;
    this.respawnAt(r, g.gapEnd + 10, clamp(r.lat, -this.track.halfWidth * 0.5, this.track.halfWidth * 0.5));
    this.smoke.burst(r.x, 1, r.z, 20, 5, ['#ffffff', '#e0f2fe'], 2, 0.8);
    if (r.isPlayer) this.flash('Возрождение! Газуй!');
  }

  // ======================================================================== interactions with track objects

  private interact(r: Racer, dt: number) {
    if (r.fallingT > 0) return;
    const tr = this.track;

    // barricades
    for (const b of tr.barriers) {
      const dx = r.x - b.x;
      const dz = r.z - b.z;
      if (dx * dx + dz * dz > 100) continue;
      if (r.y > 1.8) continue;
      const along = dx * b.tx + dz * b.tz;
      const nx = -b.tz;
      const nz = b.tx;
      const across = dx * nx + dz * nz;
      const ca = clamp(along, -b.depth / 2, b.depth / 2);
      const cc = clamp(across, -b.width / 2, b.width / 2);
      let ox = along - ca;
      let oc = across - cc;
      let dist = Math.hypot(ox, oc);
      if (dist >= CAR_R) continue;
      if (dist < 1e-4) {
        ox = along >= 0 ? 1 : -1;
        oc = 0;
        dist = 0;
      } else {
        ox /= dist;
        oc /= dist;
      }
      const push = CAR_R - dist;
      const pxw = b.tx * ox + nx * oc;
      const pzw = b.tz * ox + nz * oc;
      r.x += pxw * push;
      r.z += pzw * push;
      const vIn = -(r.vx * pxw + r.vz * pzw);
      if (vIn > 0) {
        r.vx += pxw * vIn * 1.3;
        r.vz += pzw * vIn * 1.3;
        if (vIn > 4 && r.hitCooldown <= 0) {
          r.speed *= r.shieldT > 0 ? 0.65 : 0.3;
          r.hitCooldown = 0.5;
          this.stats.barriers++;
          this.particles.burst(r.x - pxw * CAR_R, 1, r.z - pzw * CAR_R, 22, 11, ['#ffd166', '#ff7b00', '#ffffff'], 0.6, 0.5, 16);
          this.smoke.burst(r.x - pxw * CAR_R, 1, r.z - pzw * CAR_R, 8, 3, ['#9ca3af', '#6b7280'], 2, 0.8, -1);
          if (r.isPlayer) {
            this.shake = Math.max(this.shake, 0.9);
            audio.crash();
            this.flash('Бам! Баррикада 💥');
          }
        } else {
          r.speed *= 0.97;
        }
      }
    }

    // boost pads
    if (r.padCooldown <= 0 && !r.airborne) {
      for (const b of tr.boosts) {
        const a = tr.ahead(b.d, r.lastD);
        if (a < b.len && Math.abs(r.lat - b.lat) < b.width / 2 + 0.6) {
          r.boostT = Math.max(r.boostT, 1.8);
          r.speed += 3;
          r.padCooldown = 0.6;
          this.stats.pads++;
          if (r.isPlayer) {
            audio.boost();
            this.shake = Math.max(this.shake, 0.15);
          }
          break;
        }
      }
    }

    // item boxes
    for (const box of this.boxes) {
      if (!box.active) continue;
      const dx = r.x - box.x;
      const dz = r.z - box.z;
      if (dx * dx + dz * dz > 2.9 * 2.9 || Math.abs(r.y + 1 - box.y) > 3) continue;
      box.active = false;
      box.respawn = this.battle ? 2.5 : 4;
      box.mesh.visible = false;
      this.particles.burst(box.x, box.y, box.z, 26, 9, ['#f472b6', '#22d3ee', '#facc15', '#a3e635'], 0.7, 0.6, 6);
      if (!r.item && r.rouletteT <= 0) {
        this.stats.boxes++;
        r.item = this.rollItem(r);
        r.itemCharges = r.item === 'ice' ? 3 : 1;
        r.rouletteT = 1.1;
        r.ai.itemT = this.rng.range(0.4, 1.4);
        r.ai.holdT = 0;
        if (r.isPlayer) audio.pickup();
      }
    }
    void dt;
  }

  private rollItem(r: Racer): ItemType {
    const n = this.racers.length;
    const frac = this.battle ? 0.5 : (r.place - 1) / (n - 1);
    const w: [ItemType, number][] = this.battle
      ? [['missile', 1.5], ['ice', 1.5], ['bomb', 1.2], ['oil', 1.0], ['boost', 0.7], ['shield', 0.9]]
      : [
          ['missile', 0.5 + 2 * frac],
          ['ice', 1.2],
          ['bomb', 1.2 - 0.4 * frac],
          ['oil', 1.4 - 0.6 * frac],
          ['boost', 0.6 + 1.8 * frac],
          ['shield', 1.0],
        ];
    const total = w.reduce((a, x) => a + x[1], 0);
    let v = this.rng.next() * total;
    for (const [it, wt] of w) {
      v -= wt;
      if (v <= 0) return it;
    }
    return 'boost';
  }

  private carCollisions() {
    const rs = this.racers;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i];
        const b = rs[j];
        if (a.fallingT > 0 || b.fallingT > 0) continue;
        if (Math.abs(a.y - b.y) > 1.6) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        const minD = CAR_R * 2.1;
        if (d2 > minD * minD || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const overlap = minD - d;
        const ma = a.params.mass;
        const mb = b.params.mass;
        const ta = mb / (ma + mb);
        const tb = ma / (ma + mb);
        a.x -= nx * overlap * ta;
        a.z -= nz * overlap * ta;
        b.x += nx * overlap * tb;
        b.z += nz * overlap * tb;
        const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (rel > 0) {
          const imp = rel * 1.3;
          a.vx -= nx * imp * ta;
          a.vz -= nz * imp * ta;
          b.vx += nx * imp * tb;
          b.vz += nz * imp * tb;
          a.speed = a.vx * Math.sin(a.heading) + a.vz * Math.cos(a.heading);
          b.speed = b.vx * Math.sin(b.heading) + b.vz * Math.cos(b.heading);
          if (rel > 5) {
            this.particles.burst(a.x + nx * CAR_R, 0.9, a.z + nz * CAR_R, 10, 7, ['#ffd166', '#ffffff'], 0.45, 0.35, 14);
            if (a.isPlayer || b.isPlayer) {
              this.shake = Math.max(this.shake, Math.min(0.5, rel * 0.04));
              audio.hit();
            }
          }
        }
      }
    }
  }

  // ======================================================================== items

  private findTarget(r: Racer): Racer | null {
    if (!this.battle && r.place > 1) {
      const t = this.racers.find((o) => o.place === r.place - 1 && o.fallingT <= 0);
      if (t) return t;
    }
    let best: Racer | null = null;
    let bestScore = Infinity;
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    for (const o of this.racers) {
      if (o === r || o.fallingT > 0) continue;
      const dx = o.x - r.x;
      const dz = o.z - r.z;
      const dist = Math.hypot(dx, dz);
      const front = (dx * fx + dz * fz) / (dist || 1);
      const score = dist * (front > 0.2 ? 1 : 3);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  private useItem(r: Racer) {
    if (!r.item || r.rouletteT > 0 || r.fallingT > 0 || r.frozenT > 0) return;
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    const item = r.item;
    let consumed = true;
    this.stats.items++;
    switch (item) {
      case 'missile': {
        const mesh = makeMissile();
        this.scene.add(mesh);
        this.projectiles.push({
          kind: 'missile', owner: r, target: this.findTarget(r),
          x: r.x + fx * 3, y: r.y + 1.3, z: r.z + fz * 3, heading: r.heading, speed: Math.max(45, r.speed + 20), life: 7,
          index: r.trackIndex, mesh,
        });
        if (r.isPlayer || this.near(r, 60)) audio.shoot();
        break;
      }
      case 'ice': {
        const mesh = makeIceShot();
        this.scene.add(mesh);
        this.projectiles.push({
          kind: 'ice', owner: r, target: null,
          x: r.x + fx * 3, y: r.y + 1.2, z: r.z + fz * 3, heading: r.heading, speed: Math.max(80, r.speed + 40), life: 1.5,
          index: r.trackIndex, mesh,
        });
        r.itemCharges--;
        consumed = r.itemCharges <= 0;
        if (r.isPlayer || this.near(r, 60)) audio.ice();
        break;
      }
      case 'bomb':
      case 'oil': {
        const mesh = item === 'bomb' ? makeBomb() : makeOil();
        const x = r.x - fx * 4.5;
        const z = r.z - fz * 4.5;
        const pr = this.track.project(x, z, r.trackIndex);
        const y = this.track.groundAt(pr.d);
        mesh.position.set(x, Math.max(0, y), z);
        this.scene.add(mesh);
        this.hazards.push({ kind: item, owner: r, x, y: Math.max(0, y), z, armT: 0.6, mesh, t: 0 });
        // keep the track from filling up
        if (this.hazards.length > 14) this.removeHazard(this.hazards[0]);
        if (r.isPlayer) audio.drop();
        break;
      }
      case 'boost':
        r.boostT = 3;
        if (r.isPlayer) {
          audio.boost();
          this.flash('НИТРО! ⚡');
        }
        break;
      case 'shield':
        r.shieldT = 6;
        if (r.isPlayer) audio.shield();
        break;
    }
    if (consumed) {
      r.item = null;
      r.itemCharges = 0;
    }
  }

  private near(r: Racer, dist: number) {
    const p = this.player;
    return (r.x - p.x) ** 2 + (r.z - p.z) ** 2 < dist * dist;
  }

  /** returns true if the hit landed */
  private applyHit(target: Racer, kind: ItemType, owner: Racer): boolean {
    if (target.shieldT > 0 || target.invulnT > 0) {
      this.particles.burst(target.x, target.y + 1.2, target.z, 30, 10, ['#7dd3fc', '#ffffff'], 0.6, 0.5);
      if (target.isPlayer) this.flash('Щит отразил атаку! 🛡️');
      if (target.isPlayer || owner.isPlayer) audio.shield();
      return false;
    }
    switch (kind) {
      case 'missile':
      case 'bomb':
        target.airborne = true;
        target.vy = kind === 'bomb' ? 11 : 9;
        target.spinT = 1.2;
        target.speed *= 0.25;
        target.vx *= 0.3;
        target.vz *= 0.3;
        this.explosion(target.x, target.y + 1, target.z);
        break;
      case 'oil':
        target.spinT = 1.4;
        target.speed *= 0.6;
        this.smoke.burst(target.x, 0.4, target.z, 14, 4, ['#111827', '#1f2937'], 1.4, 0.7);
        if (target.isPlayer || this.near(target, 50)) audio.splat();
        break;
      case 'ice':
        target.frozenT = 1.5;
        target.spinT = 0;
        this.particles.burst(target.x, target.y + 1.2, target.z, 30, 9, ['#cffafe', '#67e8f9', '#ffffff'], 0.7, 0.7, 4);
        if (target.isPlayer || this.near(target, 60)) audio.ice();
        break;
      default:
        break;
    }
    this.stats.hits++;
    if (owner !== target) {
      owner.hits++;
      owner.points++;
      if (owner.isPlayer) this.flash(this.battle ? '+1 очко! 🎯' : 'Попадание! 🎯');
    }
    if (target.isPlayer) {
      const msg: Partial<Record<ItemType, string>> = {
        missile: 'В тебя попала ракета! 🚀',
        bomb: 'Бомба! 💣',
        oil: 'Масло! Занос! 🛢️',
        ice: 'Заморожен на 1.5 сек! ❄️',
      };
      this.flash(msg[kind] ?? 'Попадание!');
      this.shake = Math.max(this.shake, kind === 'ice' ? 0.3 : 0.9);
    }
    return true;
  }

  private explosion(x: number, y: number, z: number) {
    this.particles.burst(x, y, z, 60, 18, ['#fff3b0', '#ffb703', '#fb8500', '#ef233c'], 1.4, 0.7, 4, 4);
    this.smoke.burst(x, y, z, 24, 6, ['#4b5563', '#374151', '#6b7280'], 3, 1.4, -2);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: '#ffb703', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.flashes.push({ mesh, life: 0.45, max: 0.45, size: 6 });
    const d = Math.hypot(x - this.player.x, z - this.player.z);
    if (d < 60) {
      this.shake = Math.max(this.shake, 1 - d / 60);
      audio.explosion();
    }
  }

  private updateProjectiles(dt: number) {
    const tr = this.track;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.kind === 'missile') {
        if (p.target && p.target.fallingT <= 0) {
          const desired = Math.atan2(p.target.x - p.x, p.target.z - p.z);
          const diff = wrapAngle(desired - p.heading);
          p.heading += clamp(diff, -3.2 * dt, 3.2 * dt);
          p.speed = Math.min(72, p.speed + 30 * dt);
        } else {
          // no target: follow the track
          const ahead = tr.pointAt(tr.samples[p.index].d + 20, 0);
          const desired = Math.atan2(ahead.x - p.x, ahead.z - p.z);
          p.heading += clamp(wrapAngle(desired - p.heading), -2 * dt, 2 * dt);
        }
      }
      p.x += Math.sin(p.heading) * p.speed * dt;
      p.z += Math.cos(p.heading) * p.speed * dt;
      const pr = tr.project(p.x, p.z, p.index);
      p.index = pr.index;
      const groundY = Math.max(0, tr.heightAt(pr.d));
      p.y += (groundY + 1.3 - p.y) * damp(6, dt);
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.set(0, p.heading, 0);
      if (p.kind === 'ice') p.mesh.children[0].rotation.set(this.time * 6, this.time * 8, 0);

      // trails
      if (p.kind === 'missile') {
        this.smoke.emit(p.x - Math.sin(p.heading) * 1.4, p.y, p.z - Math.cos(p.heading) * 1.4, 0, 0.5, 0, '#d1d5db', 1.2, 0.7, 0, 1.5);
        this.particles.emit(p.x - Math.sin(p.heading) * 1.4, p.y, p.z - Math.cos(p.heading) * 1.4, 0, 0, 0, '#ffb703', 0.9, 0.15);
      } else {
        this.particles.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, '#a5f3fc', 0.6, 0.35);
      }

      let dead = p.life <= 0;
      if (p.kind === 'ice' && Math.abs(pr.lat) > tr.halfWidth + CURB_W) dead = true;
      if (!dead) {
        for (const r of this.racers) {
          if (r === p.owner && p.life > (p.kind === 'missile' ? 6.6 : 1.3)) continue;
          if (r.fallingT > 0) continue;
          if ((r.x - p.x) ** 2 + (r.z - p.z) ** 2 < 2.6 * 2.6 && Math.abs(r.y + 1 - p.y) < 2.5) {
            this.applyHit(r, p.kind, p.owner);
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        if (p.kind === 'ice') this.particles.burst(p.x, p.y, p.z, 14, 6, ['#cffafe', '#67e8f9'], 0.5, 0.4, 6);
        else if (p.life <= 0) this.explosion(p.x, p.y, p.z);
        this.scene.remove(p.mesh);
        p.mesh.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          (m.material as THREE.Material | undefined)?.dispose();
        });
        this.projectiles.splice(i, 1);
      }
    }
  }

  private removeHazard(h: Hazard) {
    this.scene.remove(h.mesh);
    h.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.hazards.splice(this.hazards.indexOf(h), 1);
  }

  private updateHazards(dt: number) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.armT -= dt;
      h.t += dt;
      if (h.kind === 'bomb') {
        const light = h.mesh.getObjectByName('light') as THREE.Mesh | undefined;
        if (light) light.visible = Math.sin(h.t * 12) > 0;
      }
      if (h.armT > 0) continue;
      const radius = h.kind === 'bomb' ? 2.5 : 2.9;
      for (const r of this.racers) {
        if (r.fallingT > 0 || r.y > 2) continue;
        if ((r.x - h.x) ** 2 + (r.z - h.z) ** 2 < radius * radius) {
          this.applyHit(r, h.kind, h.owner);
          if (h.kind === 'bomb' && r.shieldT > 0) this.explosion(h.x, 1, h.z);
          // one-time use: bomb and oil disappear after a single hit
          this.removeHazard(h);
          break;
        }
      }
    }
  }

  private updateBoxes(dt: number) {
    for (const b of this.boxes) {
      if (!b.active) {
        b.respawn -= dt;
        if (b.respawn <= 0) {
          b.active = true;
          b.mesh.visible = true;
          b.mesh.scale.setScalar(0.01);
        }
      }
    }
  }

  // ======================================================================== AI

  private aiControl(r: Racer, dt: number): Controls {
    const tr = this.track;
    const ai = r.ai;
    const p = r.params;
    const hw = tr.halfWidth;
    const d = r.lastD;
    const absS = Math.abs(r.speed);

    ai.laneTimer -= dt;
    if (ai.laneTimer <= 0) {
      ai.laneTarget = this.rng.range(-hw * 0.55, hw * 0.55);
      ai.laneTimer = this.rng.range(2.5, 5.5);
    }
    let lane = ai.laneTarget;
    let fullThrottle = false;

    // battle: chase the nearest opponent ahead
    if (this.battle) {
      let best: Racer | null = null;
      let bestA = 90;
      for (const o of this.racers) {
        if (o === r) continue;
        const a = tr.ahead(d, o.lastD);
        if (a > 4 && a < bestA) {
          bestA = a;
          best = o;
        }
      }
      if (best) lane = best.lat;
    }

    // grab item boxes when empty-handed
    if (!r.item) {
      for (const row of tr.itemRows) {
        const a = tr.ahead(d, row);
        if (a > 6 && a < 70) {
          let bestLat = lane;
          let bestDiff = Infinity;
          for (const b of this.boxes) {
            if (b.d !== row || !b.active) continue;
            const diff = Math.abs(b.lat - r.lat);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestLat = b.lat;
            }
          }
          lane = bestLat;
          break;
        }
      }
    }

    // the jump: line up in the middle and floor it
    const g = tr.gap;
    if (g) {
      const toRamp = tr.ahead(d, g.rampStart);
      if (toRamp < 110 || (d > g.rampStart - 5 && d < g.gapEnd + 5)) {
        lane = 0;
        fullThrottle = true;
      }
    }

    // avoid barricades and hazards
    const avoid = (oLat: number, half: number) => {
      if (Math.abs(lane - oLat) < half + 2.8) {
        const left = oLat - half - 4;
        const right = oLat + half + 4;
        const canL = left > -hw + 2.5;
        const canR = right < hw - 2.5;
        if (canL && canR) lane = Math.abs(left - r.lat) < Math.abs(right - r.lat) ? left : right;
        else lane = canL ? left : right;
      }
    };
    for (const b of tr.barriers) {
      const a = tr.ahead(d, b.d);
      if (a > 0 && a < 60) avoid(b.lat, b.width / 2);
    }
    for (const h of this.hazards) {
      if (h.owner === r && h.armT > 0) continue;
      const pr = tr.project(h.x, h.z, r.trackIndex);
      const a = tr.ahead(d, pr.d);
      if (a > 0 && a < 40) avoid(pr.lat, 2.6);
    }
    lane = clamp(lane, -hw + 2.5, hw - 2.5);
    ai.lane += (lane - ai.lane) * damp(1.6, dt);

    // steering towards a look-ahead point
    const look = 9 + absS * 0.55;
    const tp = tr.pointAt(d + look, ai.lane);
    const desired = Math.atan2(tp.x - r.x, tp.z - r.z);
    const diff = wrapAngle(desired - r.heading);
    let steer = clamp(-diff * 2.6, -1, 1);

    // speed: slow down for upcoming curves
    let maxCurv = 0;
    const horizon = Math.max(20, absS * 1.7);
    for (let k = 0; k < horizon; k += 4) maxCurv = Math.max(maxCurv, Math.abs(tr.sampleAt(d + k).curv));
    const tRate = p.turnRate;
    const safe = maxCurv > 0.0005 ? (tRate / (maxCurv + (0.32 * tRate) / p.maxSpeed)) * 0.9 : 999;
    let targetSpeed = Math.min(p.maxSpeed * 1.5, safe) * ai.skill;
    if (fullThrottle) targetSpeed = 999;

    let throttle = absS < targetSpeed ? 1 : 0;
    let brake = r.speed > targetSpeed + 4 ? 1 : 0;

    if (ai.stuckT > 1.5) {
      throttle = 0;
      brake = 1;
      steer = -steer;
    }

    // rubber banding (gentle)
    if (!this.battle && !r.isPlayer) {
      const gap = r.progress - this.player.progress;
      const target = gap > 120 ? 0.93 : gap < -120 ? 1.06 : 1;
      r.rubber += (target - r.rubber) * damp(0.5, dt);
    }

    // items
    if (r.item && r.rouletteT <= 0) {
      ai.itemT -= dt;
      ai.holdT += dt;
      if (ai.itemT <= 0) {
        ai.itemT = this.rng.range(0.3, 0.8);
        if (this.aiWantsItem(r, maxCurv)) this.useItem(r);
      }
    }

    return { throttle, brake, steer };
  }

  private aiWantsItem(r: Racer, curv: number): boolean {
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    switch (r.item) {
      case 'missile': {
        const t = this.findTarget(r);
        if (!t) return r.ai.holdT > 6;
        const dist = Math.hypot(t.x - r.x, t.z - r.z);
        return dist < 220 || r.ai.holdT > 6;
      }
      case 'ice':
        for (const o of this.racers) {
          if (o === r) continue;
          const dx = o.x - r.x;
          const dz = o.z - r.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 75 || dist < 3) continue;
          const dot = (dx * fx + dz * fz) / dist;
          if (dot > 0.985) return true;
        }
        return r.ai.holdT > 9;
      case 'bomb':
      case 'oil':
        for (const o of this.racers) {
          if (o === r) continue;
          const dx = o.x - r.x;
          const dz = o.z - r.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 35 && dx * fx + dz * fz < 0) return true;
        }
        return r.ai.holdT > 7;
      case 'boost':
        return curv < 0.008 || r.ai.holdT > 5;
      case 'shield':
        for (const p of this.projectiles) {
          if (p.owner !== r && (p.target === r || p.kind === 'ice') && (p.x - r.x) ** 2 + (p.z - r.z) ** 2 < 45 * 45) return true;
        }
        return r.ai.holdT > 8;
      default:
        return false;
    }
  }

  // ======================================================================== race state

  private rank() {
    const sorted = [...this.racers].sort((a, b) => {
      if (this.battle) return b.points - a.points || b.hits - a.hits || a.id - b.id;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((r, i) => (r.place = i + 1));

    if (this.battle || this.phase === 'countdown') return;
    const L = this.track.length;
    for (const r of this.racers) {
      if (r.finished) continue;
      const lap = Math.floor(r.progress / L) + 1;
      if (lap > this.laps) {
        r.finished = true;
        r.finishTime = this.raceTime;
        if (r.isPlayer) {
          this.phase = 'finished';
          audio.finish();
          this.flash(r.place === 1 ? 'ПОБЕДА! 🏆' : `Финиш! ${r.place} место`);
          this.endTimer = 6;
        }
      } else if (r.isPlayer && lap > r.lapShown) {
        r.lapShown = lap;
        audio.lap();
        this.flash(lap === this.laps ? 'Последний круг! 🔥' : `Круг ${lap}/${this.laps}`);
      }
    }
  }

  private checkEnd(dt: number) {
    if (this.ended || this.phase === 'countdown') return;
    if (this.battle) {
      if (this.raceTime >= this.duration && this.endTimer < 0) {
        this.phase = 'finished';
        this.endTimer = 2;
        audio.finish();
        this.flash('Время вышло! ⏱️');
      }
    } else if (this.endTimer > 0 && this.racers.every((r) => r.finished)) {
      this.endTimer = Math.min(this.endTimer, 1.5);
    }
    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.finishGame();
    }
  }

  private finishGame() {
    this.ended = true;
    this.rank();
    const placeReward = [500, 350, 250, 160, 110, 70];
    const lapMul = 0.5 + this.laps * 0.25;
    const rows: ResultRow[] = [...this.racers]
      .sort((a, b) => a.place - b.place)
      .map((r) => {
        const base = placeReward[r.place - 1] ?? 50;
        const coins = this.battle
          ? Math.round(r.points * 40 + base * 0.6)
          : Math.round(base * lapMul + r.hits * 15);
        return {
          name: r.name,
          isPlayer: r.isPlayer,
          color: r.def.color,
          carName: r.def.name,
          place: r.place,
          time: r.finished ? r.finishTime : null,
          points: r.points,
          hits: r.hits,
          coins,
        };
      });
    const me = rows.find((r) => r.isPlayer)!;
    audio.updateEngine(0, 0);
    this.cb.onFinish({
      mode: this.cfg.mode,
      mapName: this.mapName,
      rows,
      playerCoins: me.coins,
      playerPlace: me.place,
    });
  }

  private flash(msg: string) {
    this.message = msg;
    this.messageId++;
    this.pushHud();
  }

  private pushHud() {
    const p = this.player;
    const L = this.track.length;
    const standings: StandingRow[] = [...this.racers]
      .sort((a, b) => a.place - b.place)
      .map((r) => ({
        id: r.id,
        name: r.name,
        isPlayer: r.isPlayer,
        color: r.def.color,
        place: r.place,
        lap: clamp(Math.floor(r.progress / L) + 1, 1, Math.max(1, this.laps)),
        points: r.points,
        finished: r.finished,
      }));
    this.cb.onHud({
      phase: this.phase,
      countdown: Math.max(0, Math.ceil(this.countdown - 1)),
      speedKmh: Math.round(Math.abs(p.speed) * 3.6),
      place: p.place,
      total: this.racers.length,
      lap: clamp(Math.floor(p.progress / L) + 1, 1, Math.max(1, this.laps)),
      laps: this.laps,
      time: this.raceTime,
      timeLeft: Math.max(0, this.duration - this.raceTime),
      item: p.item,
      itemCharges: p.itemCharges,
      rouletting: p.rouletteT > 0,
      boost: p.boostT,
      shield: p.shieldT,
      frozen: p.frozenT > 0,
      points: p.points,
      standings,
      message: this.message,
      messageId: this.messageId,
    });
  }

  // ======================================================================== visuals

  private syncModel(r: Racer, dt: number) {
    const m = r.model;
    m.root.position.set(r.x, r.y, r.z);
    m.root.rotation.y = r.heading;
    const ratio = r.speed / r.params.maxSpeed;
    const rollTarget = r.airborne ? 0 : r.steer * ratio * 0.07;
    const accel = r.lastThrottle > 0 && r.speed < r.params.maxSpeed * 0.9 ? -0.025 : 0;
    const pitchTarget = r.airborne ? clamp(-r.vy * 0.035, -0.4, 0.4) : accel;
    r.rollVis += (rollTarget - r.rollVis) * damp(6, dt || 1);
    r.pitchVis += (pitchTarget - r.pitchVis) * damp(5, dt || 1);
    m.body.rotation.set(r.pitchVis, r.spinVis, r.rollVis, 'YXZ');
    if (r.fallingT > 0) m.body.rotation.x = Math.min(0.9, (1.6 - r.fallingT) * 0.8);
    const spin = (r.speed * dt) / m.wheelRadius;
    for (const w of m.wheels) w.rotation.x += spin;
    for (const fp of m.frontPivots) fp.rotation.y = -r.steer * 0.45;
    r.shieldMesh.visible = r.shieldT > 0 && (r.shieldT > 1.2 || Math.sin(this.time * 20) > 0);
    if (r.shieldMesh.visible) r.shieldMesh.scale.setScalar(1 + Math.sin(this.time * 6) * 0.04);
    r.iceMesh.visible = r.frozenT > 0;
    m.root.visible = r.invulnT <= 0 || Math.sin(this.time * 25) > -0.3;
  }

  private updateVisuals(dt: number) {
    const t = this.time;

    for (const r of this.racers) {
      this.syncModel(r, dt);
      const m = r.model;
      if (r.tag) r.tag.visible = this.camera.position.distanceToSquared(m.root.position) > 16 * 16;
      // boost flames
      if (r.boostT > 0 && r.fallingT <= 0) {
        for (const e of m.exhausts) {
          this.tmpV.copy(e);
          m.root.localToWorld(this.tmpV);
          const bx = -Math.sin(r.heading) * 6;
          const bz = -Math.cos(r.heading) * 6;
          this.particles.emit(this.tmpV.x, this.tmpV.y, this.tmpV.z, bx + (Math.random() - 0.5) * 2, Math.random(), bz + (Math.random() - 0.5) * 2, Math.random() > 0.5 ? '#ffb703' : '#fb5607', 1.1, 0.22);
          this.particles.emit(this.tmpV.x, this.tmpV.y, this.tmpV.z, bx, 0, bz, '#4cc9f0', 0.6, 0.12);
        }
      }
      // drift / spin smoke
      const right = r.vx * Math.cos(r.heading) - r.vz * Math.sin(r.heading);
      if (!r.airborne && r.fallingT <= 0 && (Math.abs(right) > 5 || r.spinT > 0) && Math.random() < 0.6) {
        this.smoke.emit(r.x + (Math.random() - 0.5) * 2, 0.3, r.z + (Math.random() - 0.5) * 2, 0, 0.8, 0, '#d4d4d8', 1.6, 0.8, -0.5, 1.5);
      }
      if (r.frozenT > 0 && Math.random() < 0.3) {
        this.particles.emit(r.x + (Math.random() - 0.5) * 3, r.y + 2.2, r.z + (Math.random() - 0.5) * 4, 0, 1, 0, '#e0f2fe', 0.4, 0.6);
      }
    }

    // item boxes spin & hue cycle
    const { boxMat } = itemBoxAssets();
    const hue = (t * 0.2) % 1;
    boxMat.color.setHSL(hue, 1, 0.55);
    boxMat.emissive.setHSL(hue, 1, 0.3);
    for (const b of this.boxes) {
      if (!b.active) continue;
      b.mesh.rotation.set(t * 0.8, t * 1.2, 0);
      b.mesh.position.y = b.y + Math.sin(t * 2.5 + b.lat) * 0.25;
      if (b.mesh.scale.x < 1) b.mesh.scale.setScalar(Math.min(1, b.mesh.scale.x + dt * 3));
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const k = 1 - f.life / f.max;
      f.mesh.scale.setScalar(1 + k * f.size);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }

    this.particles.update(dt);
    this.smoke.update(dt);
    this.visuals.update(t);
    this.updateCamera(dt);
    this.env.update(t, dt, this.tmpV.set(this.player.x, 0, this.player.z));

    const p = this.player;
    audio.updateEngine(clamp(Math.abs(p.speed) / p.params.maxSpeed, 0, 1.4), this.phase === 'countdown' ? this.input.throttle * 0.5 : p.lastThrottle);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.pushHud();
    }
    this.drawMinimap();
  }

  private updateCamera(dt: number) {
    const r = this.player;
    const cam = this.camera;
    const ratio = clamp(Math.abs(r.speed) / r.params.maxSpeed, 0, 1.4);
    const portrait = cam.aspect < 1;

    if (r.fallingT <= 0) {
      const yawTarget = r.heading + (r.speed < -2 ? 0 : 0);
      this.camYaw += wrapAngle(yawTarget - this.camYaw) * damp(4.5, dt);
      const dist = (portrait ? 13 : 10.5) + ratio * 2.5;
      const height = (portrait ? 5.6 : 4.4) + ratio * 0.6;
      const desired = this.tmpV.set(
        r.x - Math.sin(this.camYaw) * dist,
        Math.max(r.y, 0) * 0.8 + height,
        r.z - Math.cos(this.camYaw) * dist,
      );
      this.camPos.lerp(desired, damp(8, dt));
      const look = new THREE.Vector3(r.x + Math.sin(this.camYaw) * 7, r.y + 1.4, r.z + Math.cos(this.camYaw) * 7);
      this.camLook.lerp(look, damp(12, dt));
    } else {
      this.camLook.lerp(new THREE.Vector3(r.x, r.y, r.z), damp(6, dt));
    }

    cam.position.copy(this.camPos);
    if (this.shake > 0.001) {
      const s = this.shake;
      cam.position.x += (Math.sin(this.time * 61) + Math.sin(this.time * 37)) * 0.25 * s;
      cam.position.y += Math.sin(this.time * 53) * 0.35 * s;
      cam.position.z += Math.cos(this.time * 47) * 0.25 * s;
      this.shake *= Math.exp(-5 * dt);
    }
    cam.lookAt(this.camLook);
    if (this.shake > 0.001) cam.rotation.z += Math.sin(this.time * 43) * 0.03 * this.shake;

    const baseFov = portrait ? 78 : 64;
    const fov = baseFov + ratio * 9 + (r.boostT > 0 ? 7 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * damp(3, dt);
      cam.updateProjectionMatrix();
    }
  }

  private drawMinimap() {
    const c = this.minimap;
    if (!c || !this.minimapPath) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 12;
    ctx.stroke(this.minimapPath);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 6;
    ctx.stroke(this.minimapPath);
    // start line + gap
    const s0 = this.track.samples[0];
    const [sx, sy] = this.mm(s0.x, s0.z);
    ctx.fillStyle = '#111';
    ctx.fillRect(sx - 4, sy - 4, 8, 8);
    if (this.track.gap) {
      const gp = this.track.pointAt((this.track.gap.gapStart + this.track.gap.gapEnd) / 2, 0);
      const [gx, gy] = this.mm(gp.x, gp.z);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(gx, gy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const r of [...this.racers].sort((a) => (a.isPlayer ? 1 : -1))) {
      const [x, y] = this.mm(r.x, r.z);
      ctx.beginPath();
      ctx.arc(x, y, r.isPlayer ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = r.def.color;
      ctx.fill();
      ctx.lineWidth = r.isPlayer ? 3 : 2;
      ctx.strokeStyle = r.isPlayer ? '#ffffff' : 'rgba(0,0,0,0.7)';
      ctx.stroke();
    }
  }
}
