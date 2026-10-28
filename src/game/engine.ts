import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CARS, carParams, getCar, paintedCar } from '../data/cars';
import { getMap, mapName } from '../data/maps';
import { randomLook } from '../data/cosmetics';
import { t } from '../i18n';
import { Gearbox, audio, engineRange } from './audio';
import { buildCar, type CarModel } from './carModel';
import { HIP_H, buildDriver, type DriverModel } from './driver';
import { PostFX } from './post';
import { SkidMarks } from './skids';
import { buildEnvironment, type Environment } from './environment';
import { Input } from './input';
import {
  FLY_TIME,
  MISSILE_FUSE,
  itemBoxAssets,
  makeBomb,
  makeIceCube,
  makeIceShot,
  makeLabel,
  makeMissile,
  makeNameTag,
  makeOil,
  makeShieldBubble,
  makeWings,
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
  Difficulty,
  HudState,
  ItemType,
  RaceConfig,
  RaceResult,
  ResultRow,
  StandingRow,
} from './types';

/** translate helper for scopes where `t` is a local (the missile target) */
const t_ = t;

const GRAV = 24;
const CAR_R = 1.25;
const CURB_W = 1.8;
/** a car that smashes a barricade keeps rolling at this speed (km/h) */
const BARRIER_SLOW_KMH = 10;
const BARRIER_REBUILD = 5;
/** drift intensity needed to shake off a homing missile */
const GOOD_DRIFT = 0.55;
const FLY_HEIGHT = 6.5;
/** on "impossible" the race can only be won with at most this many mistakes */
const MAX_MISTAKES = 3;

interface DiffTuning {
  /** fraction of the car's top speed the bot aims for */
  skill: [number, number];
  /** how close to the grip limit bots take corners */
  corner: number;
  /** lazy weaving across the road */
  wobble: number;
  /** seconds between item-use decisions */
  itemDelay: [number, number];
  /** chance to try a drift-dodge against a homing missile */
  dodge: number;
  /** speed factor when far ahead of / behind the player */
  rubberAhead: number;
  rubberBehind: number;
  /** chance per second of a driving mistake (lifting off, running wide) */
  slips: number;
  /** bots steer onto boost pads */
  pads: boolean;
  coinMul: number;
}

const DIFF: Record<Difficulty, DiffTuning> = {
  easy: { skill: [0.8, 0.86], corner: 0.8, wobble: 0.5, itemDelay: [1.4, 2.8], dodge: 0.1, rubberAhead: 0.86, rubberBehind: 1.0, slips: 0.08, pads: false, coinMul: 0.8 },
  medium: { skill: [0.9, 0.95], corner: 0.9, wobble: 0.25, itemDelay: [0.6, 1.3], dodge: 0.3, rubberAhead: 0.93, rubberBehind: 1.05, slips: 0.025, pads: false, coinMul: 1 },
  hard: { skill: [0.97, 1.0], corner: 0.95, wobble: 0.1, itemDelay: [0.3, 0.8], dodge: 0.55, rubberAhead: 0.97, rubberBehind: 1.07, slips: 0.006, pads: true, coinMul: 1.3 },
  impossible: { skill: [1.0, 1.03], corner: 1.0, wobble: 0, itemDelay: [0.2, 0.5], dodge: 0.75, rubberAhead: 1.0, rubberBehind: 1.1, slips: 0, pads: true, coinMul: 1.7 },
};

/** intro timeline (seconds, per driver before their stagger delay) */
const INTRO_WAVE = 1.3;
const INTRO_WALK = 1.9;
const INTRO_ENTER = 0.6;

interface Controls {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
}

interface AiState {
  lane: number;
  laneTarget: number;
  laneTimer: number;
  itemT: number;
  holdT: number;
  skill: number;
  stuckT: number;
  /** missile the AI already decided how to react to */
  dodgeFor: Projectile | null;
  willDodge: boolean;
  /** > 0 while the bot is making a driving mistake */
  slipT: number;
  /** wander waypoint in the arena */
  wpX: number;
  wpZ: number;
  wpT: number;
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
  flyT: number;
  wings: THREE.Group;
  /** "missile incoming" marker above bots */
  warn: THREE.Sprite;
  driftT: number;
  /** 0..1, how well the car is drifting right now */
  driftAmt: number;
  lastBrake: number;
  driver: DriverModel;
  /** driver is sitting in the car (false while walking to it in the intro) */
  seated: boolean;
  gearbox: Gearbox;
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
  /** remaining seconds; for missiles this is the self-destruct fuse */
  life: number;
  index: number;
  mesh: THREE.Group;
  /** track distance / lateral offset of the missile */
  d: number;
  lat: number;
  /** +1 flies with the race direction, -1 against it */
  dir: number;
  /** racer that escaped this missile with a drift (can no longer be hit by it) */
  dodged: Racer | null;
  label: ReturnType<typeof makeLabel> | null;
}

interface Debris {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  life: number;
  size: number;
}

export interface MirrorViews {
  left: HTMLElement;
  rear: HTMLElement;
  right: HTMLElement;
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
  onToggleMirrors?(): void;
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
  private debris: Debris[] = [];
  private debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  /** grow-in animation of rebuilt barricades (1 = fully built) */
  private barrierScale: number[] = [];
  private mirrorViews: MirrorViews | null;
  private mirrorsOn: boolean;
  private mirrorCams: { rear: THREE.PerspectiveCamera; left: THREE.PerspectiveCamera; right: THREE.PerspectiveCamera };
  private warnBeepT = 0;
  private post: PostFX | null = null;
  private skids = new SkidMarks();
  private readonly diff: DiffTuning;
  private mistakes = 0;
  private mistakeCooldown = 0;
  private introT = 0;
  private introLen = 0;
  private prevThrottle = 0;
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

  constructor(
    container: HTMLElement,
    minimap: HTMLCanvasElement | null,
    cfg: RaceConfig,
    cb: GameCallbacks,
    mirrors: MirrorViews | null = null,
    mirrorsOn = true,
  ) {
    this.container = container;
    this.cfg = cfg;
    this.cb = cb;
    this.minimap = minimap;
    this.mirrorViews = mirrors;
    this.mirrorsOn = mirrorsOn;
    const map = getMap(cfg.mapId);
    this.mapName = mapName(map);
    this.diff = DIFF[cfg.difficulty];
    this.battle = cfg.mode.kind === 'battle';
    this.laps = cfg.mode.kind === 'race' ? cfg.mode.laps : 0;
    this.duration = cfg.mode.kind === 'battle' ? cfg.mode.duration : 0;
    const theme = cfg.theme;
    const st = THEME_STYLES[theme];
    const mobile = isTouch();
    const q = cfg.quality;

    // ---------- renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const maxRatio = q === 'low' ? 1 : q === 'medium' ? 1.5 : mobile ? 1.75 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    // refreshed once per frame for the main view and reused by the mirror views
    this.renderer.shadowMap.autoUpdate = false;
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
    this.mirrorCams = {
      rear: new THREE.PerspectiveCamera(52, 3, 0.3, 700),
      left: new THREE.PerspectiveCamera(42, 1.4, 0.3, 500),
      right: new THREE.PerspectiveCamera(42, 1.4, 0.3, 500),
    };

    // ---------- world
    this.track = new Track(map);
    this.visuals = buildTrackVisuals(this.track, theme);
    this.scene.add(this.visuals.group);
    this.env = buildEnvironment(this.scene, this.track, theme, map.seed);
    if (q !== 'high') this.env.sun.shadow.mapSize.set(q === 'low' ? 1024 : 1536, q === 'low' ? 1024 : 1536);
    this.scene.add(this.skids.mesh);
    if (q !== 'low') this.post = new PostFX(this.renderer, this.scene, this.camera, q);
    this.particles = new Particles(2500, true);
    this.smoke = new Particles(1200, false);
    this.scene.add(this.particles.points, this.smoke.points);

    this.barrierScale = this.track.barriers.map(() => 1);
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
    this.input.onMirrors = () => this.cb.onToggleMirrors?.();
    this.input.attach();
    document.addEventListener('visibilitychange', this.onVisibility);

    audio.init();
    audio.startEngine(this.player.def.engine);

    if (cfg.intro) this.startIntro();
    else {
      this.phase = 'countdown';
      this.racers.forEach((r) => this.seatDriver(r));
    }

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ======================================================================== setup

  private buildItemBoxes() {
    if (!this.cfg.items) return;
    const { box, boxMat } = itemBoxAssets();
    if (this.track.oval) {
      for (const p of this.track.arenaBoxes) {
        const mesh = new THREE.Mesh(box, boxMat);
        mesh.position.set(p.x, 1.6, p.z);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.boxes.push({ x: p.x, y: 1.6, z: p.z, lat: 0, d: -1, active: true, respawn: 0, mesh });
      }
      return;
    }
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
    const playerDef = paintedCar(getCar(this.cfg.carId), this.cfg.paint);
    const rival = this.cfg.rival;
    let others = CARS.filter((c) => c.id !== playerDef.id && c.id !== rival?.carId);
    // shuffle
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    if (rival) others = [getCar(rival.carId), ...others];
    const names = t('ai.names').split(',').sort(() => this.rng.next() - 0.5);
    const total = 1 + Math.max(1, this.cfg.opponents);
    // the player starts mid-pack (in a duel the rival takes pole)
    const playerSlot = this.battle ? 0 : Math.min(total - 1, rival ? 1 : 3);
    const L = this.track.length;
    const oval = this.track.oval;
    let aiIndex = 0;
    for (let k = 0; k < total; k++) {
      const isPlayer = k === playerSlot;
      const ai = isPlayer ? -1 : aiIndex++;
      const def = isPlayer ? playerDef : others[ai % others.length];
      let d: number;
      let lat: number;
      let pos: { x: number; z: number; heading: number };
      if (oval) {
        // arena: spread around the oval, everybody facing the centre
        const a = (k / total) * Math.PI * 2;
        const x = Math.cos(a) * oval.a * 0.62;
        const z = Math.sin(a) * oval.b * 0.62;
        pos = { x, z, heading: Math.atan2(-x, -z) };
        const pr = this.track.project(x, z);
        d = pr.d;
        lat = pr.lat;
      } else if (this.battle) {
        d = (k / total) * L;
        lat = 0;
        pos = this.track.pointAt(d, lat);
      } else {
        const row = Math.floor(k / 2);
        d = L - 12 - row * 11;
        lat = k % 2 ? 7 : -7;
        pos = this.track.pointAt(d, lat);
      }
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
      const wings = makeWings();
      wings.visible = false;
      wings.scale.setScalar(0.001);
      model.body.add(wings);
      const warnLabel = makeLabel(150, 64);
      warnLabel.draw('🚀 !', '#dc2626');
      warnLabel.sprite.scale.set(2.3, 1, 1);
      warnLabel.sprite.position.y = 4.5;
      warnLabel.sprite.visible = false;
      model.root.add(warnLabel.sprite);
      const isRival = !!rival && ai === 0;
      const name = isPlayer ? t('you') : isRival ? rival!.name : names[ai % names.length];
      const look = isPlayer ? this.cfg.driver : isRival ? rival!.look : randomLook(this.rng);
      const driver = buildDriver(look);
      driver.root.scale.setScalar(model.driverScale);
      let tag: THREE.Sprite | null = null;
      if (!isPlayer) {
        tag = makeNameTag(name, def.color);
        tag.position.y = 3.4;
        model.root.add(tag);
      }
      const proj = this.track.project(pos.x, pos.z);
      const startProgress = this.battle ? d : -this.track.ahead(d, 0);
      const skill = this.rng.range(this.diff.skill[0], this.diff.skill[1]) * (isRival ? 1.02 : 1);
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
        flyT: 0,
        wings,
        warn: warnLabel.sprite,
        driftT: 0,
        driftAmt: 0,
        lastBrake: 0,
        driver,
        seated: false,
        gearbox: new Gearbox(carParams(def).gears, def.engine),
        ai: {
          lane: lat,
          laneTarget: lat,
          laneTimer: this.rng.range(1, 3),
          itemT: 1,
          holdT: 0,
          skill,
          stuckT: 0,
          dodgeFor: null,
          willDodge: false,
          slipT: 0,
          wpX: 0,
          wpZ: 0,
          wpT: 0,
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

  setMirrors(on: boolean) {
    this.mirrorsOn = on;
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) audio.quiet();
  }

  /** jump straight to the countdown */
  skipIntro() {
    if (this.phase === 'intro') this.endIntro();
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
    this.racers.forEach((r) => {
      r.tag?.material.map?.dispose();
      (r.warn.material as THREE.SpriteMaterial).map?.dispose();
    });
    for (const p of this.projectiles) p.label?.sprite.material.map?.dispose();
    this.debrisGeo.dispose();
    this.post?.dispose();
    // drivers still walking in the intro are not inside a car
    for (const r of this.racers) if (!r.seated) r.driver.dispose();
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
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
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
    this.renderer.shadowMap.needsUpdate = true;
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (this.mirrorsOn && this.mirrorViews && this.phase !== 'intro') this.renderMirrors();
  };

  /** Rear-view camera + both side mirrors, rendered into the frames at the top of the HUD */
  private renderMirrors() {
    const views = this.mirrorViews!;
    const cr = this.container.getBoundingClientRect();
    const p = this.player;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    // driver's right-hand side
    const rx = -fz;
    const rz = fx;
    const y = Math.max(p.y, -2);
    const cams = this.mirrorCams;
    const r = this.renderer;
    // rear window camera: above the boot, looking straight back
    cams.rear.position.set(p.x - fx * 2.5, y + 1.75, p.z - fz * 2.5);
    cams.rear.lookAt(p.x - fx * 40, y + 0.6, p.z - fz * 40);
    // side mirrors sit at the doors and look back and slightly outward
    for (const side of [-1, 1]) {
      const cam = side < 0 ? cams.left : cams.right;
      const px = p.x + rx * side * 1.25 + fx * 0.6;
      const pz = p.z + rz * side * 1.25 + fz * 0.6;
      cam.position.set(px, y + 1.15, pz);
      cam.lookAt(px - fx * 30 + rx * side * 6, y + 0.5, pz - fz * 30 + rz * side * 6);
    }
    // point sprites are sized for the full screen and would look huge in the small mirrors
    this.particles.points.visible = false;
    this.smoke.points.visible = false;
    r.setScissorTest(true);
    const list: [HTMLElement, THREE.PerspectiveCamera][] = [
      [views.rear, cams.rear],
      [views.left, cams.left],
      [views.right, cams.right],
    ];
    for (const [el, cam] of list) {
      const b = el.getBoundingClientRect();
      if (b.width < 8 || b.height < 8) continue;
      const x = b.left - cr.left;
      const yy = cr.height - (b.top - cr.top) - b.height;
      r.setViewport(x, yy, b.width, b.height);
      r.setScissor(x, yy, b.width, b.height);
      const aspect = b.width / b.height;
      if (Math.abs(cam.aspect - aspect) > 0.01) {
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
      }
      r.render(this.scene, cam);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, cr.width, cr.height);
    this.particles.points.visible = true;
    this.smoke.points.visible = true;
  }

  private step(dt: number) {
    this.time += dt;
    this.mistakeCooldown = Math.max(0, this.mistakeCooldown - dt);

    if (this.phase === 'intro') {
      this.introT += dt;
      if (this.input.consumeFire() || this.introT >= this.introLen) this.endIntro();
      return;
    }

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown - 1);
      if (c < this.lastBeep && c >= 0) {
        this.lastBeep = c;
        audio.countdown(c === 0);
        if (c === 0) this.flash(t('msg.go'));
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
      if (!racing) ctl = { throttle: 0, brake: 0, steer: 0, drift: false };
      else if (r.isPlayer && !r.finished && !this.autopilot) {
        ctl = { throttle: this.input.throttle, brake: this.input.brake, steer: this.input.steer, drift: this.input.drift };
        if (this.input.consumeFire()) this.useItem(r);
      } else ctl = this.aiControl(r, dt);
      r.lastThrottle = ctl.throttle;
      r.lastBrake = ctl.brake;
      this.physics(r, ctl, dt);
      this.interact(r, dt);
    }
    this.carCollisions();
    this.updateBarriers(dt);
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
    if (r.flyT > 0) {
      r.flyT -= dt;
      // never touch down above the chasm: keep hovering until it is behind us
      if (r.flyT <= 0 && tr.gap && (tr.inGap(r.lastD) || tr.inGap(r.lastD + 8))) r.flyT = 0.05;
      if (r.flyT <= 0) {
        r.flyT = 0;
        r.airborne = true;
        r.vy = 0;
      }
    }

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

    // drift: hold the drift key while steering at speed — less grip, sharper turn, the tail slides out
    const drifting =
      ctl.drift && !r.airborne && r.flyT <= 0 && r.spinT <= 0 && r.frozenT <= 0 && Math.abs(r.speed) > 12 && Math.abs(steerIn) > 0.2;
    r.driftT = drifting ? r.driftT + dt : 0;
    if (drifting) r.speed *= Math.exp(-0.12 * dt);

    const boosting = r.boostT > 0;
    const maxS = p.maxSpeed * r.rubber * (boosting ? 1.32 : 1) * (r.flyT > 0 ? 1.12 : 1);

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
    r.heading -= r.steer * p.turnRate * low * high * air * dir * (drifting ? 1.35 : 1) * dt;

    // velocity follows heading with limited grip (slight drift feel)
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    const grip = r.airborne ? 0.3 : r.spinT > 0 ? 0.7 : drifting ? Math.max(2.2, p.grip * 0.45) : p.grip;
    const k = damp(grip, dt);
    r.vx += (fx * r.speed - r.vx) * k;
    r.vz += (fz * r.speed - r.vz) * k;
    r.x += r.vx * dt;
    r.z += r.vz * dt;

    // drift quality: needs both time in the slide and a real slip angle
    {
      const side = r.vx * Math.cos(r.heading) - r.vz * Math.sin(r.heading);
      const fwd = r.vx * fx + r.vz * fz;
      const slip = Math.atan2(Math.abs(side), Math.max(1, Math.abs(fwd)));
      const amt = drifting ? clamp(r.driftT / 0.45, 0, 1) * clamp(slip / 0.22, 0, 1) : 0;
      r.driftAmt += (amt - r.driftAmt) * damp(amt > r.driftAmt ? 12 : 4, dt);
    }

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
    if (tr.oval) this.ovalWall(r);
    else if (Math.abs(pr.lat) > limit) {
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
            if (vn > 10) this.addMistake();
          }
        }
      }
    }

    // ---------- vertical: flight, ramp, jump, cliff
    if (r.flyT > 0) {
      const target = Math.max(0, tr.heightAt(pr.d)) + FLY_HEIGHT + Math.sin(this.time * 2.2 + r.id) * 0.25;
      r.y += (target - r.y) * damp(2.5, dt);
      r.vy = 0;
      r.airborne = false;
    } else this.vertical(r, pr.d, dt);

    // AI stuck detection
    if (!r.isPlayer || r.finished) {
      if (this.phase !== 'countdown' && absS < 2.5 && r.frozenT <= 0 && r.spinT <= 0) r.ai.stuckT += dt;
      else r.ai.stuckT = Math.max(0, r.ai.stuckT - dt * 2);
      if (r.ai.stuckT > 4) this.respawnAt(r, r.lastD, 0);
    }
  }

  private vertical(r: Racer, d: number, dt: number) {
    const tr = this.track;
    const ground = tr.groundAt(d);
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
        if (tr.gap && tr.ahead(tr.gap.gapEnd, d) < 120) this.stats.jumps++;
        if (hard) {
          this.smoke.burst(r.x, 0.3, r.z, 12, 6, ['#d6d3d1', '#a8a29e'], 2.2, 0.8, -1);
          if (r.isPlayer) {
            this.shake = Math.max(this.shake, 0.3);
            audio.land();
          }
        }
      }
    }
    if (tr.inGap(d) && r.y < -0.4) {
      r.fallingT = 1.6;
      this.stats.falls++;
      r.frozenT = 0;
      r.spinT = 0;
      if (r.isPlayer) {
        this.flash(t('msg.fell'));
        audio.fall();
        this.addMistake();
      }
    }
  }

  /** The arena is an ellipse: keep cars inside and bounce them off the wall */
  private ovalWall(r: Racer) {
    const o = this.track.oval!;
    const a = o.a - CAR_R;
    const b = o.b - CAR_R;
    const v = (r.x / a) ** 2 + (r.z / b) ** 2;
    if (v <= 1) return;
    const k = 1 / Math.sqrt(v);
    r.x *= k;
    r.z *= k;
    let nx = r.x / (a * a);
    let nz = r.z / (b * b);
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const vn = r.vx * nx + r.vz * nz;
    if (vn <= 0) return;
    r.vx -= nx * vn * 1.4;
    r.vz -= nz * vn * 1.4;
    r.speed *= Math.max(0.6, 1 - vn * 0.022);
    // turn the nose along the wall
    let tx = -nz;
    let tz = nx;
    if (tx * Math.sin(r.heading) + tz * Math.cos(r.heading) < 0) {
      tx = -tx;
      tz = -tz;
    }
    r.heading += wrapAngle(Math.atan2(tx, tz) - r.heading) * Math.min(0.5, vn * 0.03);
    if (vn > 3 && !r.airborne) {
      this.particles.burst(r.x + nx * 1.1, r.y + 0.6, r.z + nz * 1.1, Math.min(14, Math.floor(vn * 1.5)), 8, ['#ffd166', '#ff9f1c', '#ffffff'], 0.5, 0.4, 14);
      if (r.isPlayer && vn > 7 && r.hitCooldown <= 0) {
        this.shake = Math.max(this.shake, Math.min(0.6, vn * 0.05));
        audio.crash();
        r.hitCooldown = 0.4;
      }
    }
  }

  /** player's driving mistakes (crashes, falls, hazards); on "impossible" more than 3 lose the race */
  private addMistake() {
    if (this.mistakeCooldown > 0 || this.phase !== 'racing') return;
    this.mistakeCooldown = 1.5;
    this.mistakes++;
    if (this.cfg.difficulty !== 'impossible') return;
    if (this.mistakes === MAX_MISTAKES + 1) this.flash(t('msg.tooMany'));
    else if (this.mistakes <= MAX_MISTAKES) this.flash(t('msg.mistake', { n: this.mistakes }));
  }

  // ======================================================================== intro

  /** drivers walk out, wave to the fans and get into their cars */
  private startIntro() {
    this.phase = 'intro';
    this.introT = 0;
    const lookOut = new THREE.Vector3();
    for (const r of this.racers) {
      const m = r.model;
      m.root.updateMatrixWorld(true);
      const door = m.root.localToWorld(m.door.clone());
      // walk out from the left side of the car, a few metres towards the fans
      lookOut.set(Math.cos(r.heading), 0, -Math.sin(r.heading));
      const start = door.clone().addScaledVector(lookOut, 5.5);
      const d = r.driver;
      d.setHelmet(false);
      d.stand();
      d.root.position.copy(start);
      d.root.rotation.set(0, Math.atan2(lookOut.x, lookOut.z), 0);
      d.root.userData = { start, door, delay: r.id * 0.18 };
      this.scene.add(d.root);
    }
    this.introLen = INTRO_WAVE + INTRO_WALK + INTRO_ENTER + this.racers.length * 0.18 + 0.9;
    audio.crowd();
  }

  private animateIntro() {
    const tmp = new THREE.Vector3();
    for (const r of this.racers) {
      if (r.seated) continue;
      const d = r.driver;
      const u = d.root.userData as { start: THREE.Vector3; door: THREE.Vector3; delay: number };
      const tt = Math.max(0, this.introT - u.delay);
      const faceOut = Math.atan2(u.start.x - u.door.x, u.start.z - u.door.z);
      if (tt < INTRO_WAVE) {
        // wave to the crowd with one hand, then the other
        d.stand();
        d.root.position.copy(u.start);
        d.root.rotation.y = faceOut;
        d.wave(tt + r.id, tt < INTRO_WAVE * 0.55 ? -1 : 1);
      } else if (tt < INTRO_WAVE + INTRO_WALK) {
        const k = (tt - INTRO_WAVE) / INTRO_WALK;
        tmp.lerpVectors(u.start, u.door, k);
        d.root.position.copy(tmp);
        d.root.rotation.y = faceOut + Math.PI;
        d.walk(tt * 9);
        if (k > 0.7) d.setHelmet(true);
      } else if (tt < INTRO_WAVE + INTRO_WALK + INTRO_ENTER) {
        // climb in: rise over the sill and drop into the seat
        const k = (tt - INTRO_WAVE - INTRO_WALK) / INTRO_ENTER;
        const seat = r.model.body.localToWorld(r.model.seat.clone());
        seat.y -= HIP_H * r.model.driverScale;
        tmp.lerpVectors(u.door, seat, k);
        tmp.y += Math.sin(k * Math.PI) * 0.6;
        d.root.position.copy(tmp);
        d.root.rotation.y = r.heading;
        d.sit();
        d.setHelmet(true);
      } else this.seatDriver(r);
    }
  }

  private endIntro() {
    for (const r of this.racers) this.seatDriver(r);
    this.phase = 'countdown';
    this.countdown = 4;
    this.lastBeep = 5;
    if (this.cfg.rival) this.flash(t('msg.duel'));
  }

  /** put the driver into the seat (in the car's body group) */
  private seatDriver(r: Racer) {
    if (r.seated) return;
    r.seated = true;
    const d = r.driver;
    d.setHelmet(true);
    d.sit();
    r.model.body.add(d.root);
    const s = r.model.seat;
    d.root.position.set(s.x, s.y - HIP_H * r.model.driverScale, s.z);
    d.root.rotation.set(0, 0, 0);
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
    r.flyT = 0;
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
    if (r.isPlayer) this.flash(t('msg.respawn'));
  }

  // ======================================================================== interactions with track objects

  private interact(r: Racer, dt: number) {
    if (r.fallingT > 0) return;
    const tr = this.track;

    // barricades: smashed on contact — the car slows to a crawl and rolls on through the wreck
    for (let bi = 0; bi < tr.barriers.length; bi++) {
      const b = tr.barriers[bi];
      if (b.brokenT > 0 || r.y > 1.8) continue;
      const dx = r.x - b.x;
      const dz = r.z - b.z;
      if (dx * dx + dz * dz > 100) continue;
      const along = dx * b.tx + dz * b.tz;
      const across = dx * -b.tz + dz * b.tx;
      const ox = along - clamp(along, -b.depth / 2, b.depth / 2);
      const oc = across - clamp(across, -b.width / 2, b.width / 2);
      if (Math.hypot(ox, oc) >= CAR_R) continue;
      this.smashBarrier(bi, r);
    }

    // boost pads
    if (r.padCooldown <= 0 && !r.airborne && r.flyT <= 0) {
      for (const b of tr.boosts) {
        let on: boolean;
        if (b.x !== undefined) {
          // free-standing arena pad
          const dx = r.x - b.x;
          const dz = r.z - b.z!;
          const h = b.heading!;
          on = Math.abs(dx * Math.sin(h) + dz * Math.cos(h)) < b.len / 2 && Math.abs(dx * Math.cos(h) - dz * Math.sin(h)) < b.width / 2 + 0.6;
        } else on = tr.ahead(b.d, r.lastD) < b.len && Math.abs(r.lat - b.lat) < b.width / 2 + 0.6;
        if (on) {
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
        r.ai.itemT = this.rng.range(this.diff.itemDelay[0], this.diff.itemDelay[1]);
        r.ai.holdT = 0;
        if (r.isPlayer) audio.pickup();
      }
    }
    void dt;
  }

  private smashBarrier(bi: number, r: Racer) {
    const b = this.track.barriers[bi];
    b.brokenT = BARRIER_REBUILD;
    const hitSpeed = Math.hypot(r.vx, r.vz);
    const dirX = hitSpeed > 0.5 ? r.vx / hitSpeed : Math.sin(r.heading);
    const dirZ = hitSpeed > 0.5 ? r.vz / hitSpeed : Math.cos(r.heading);
    const cap = BARRIER_SLOW_KMH / 3.6;
    if (r.shieldT > 0) {
      r.speed *= 0.7;
      r.vx *= 0.7;
      r.vz *= 0.7;
    } else {
      r.speed = clamp(r.speed, -cap, cap);
      if (hitSpeed > cap) {
        r.vx *= cap / hitSpeed;
        r.vz *= cap / hitSpeed;
      }
      r.boostT = 0;
    }
    this.stats.barriers++;

    // the barricade bursts into flying chunks
    const group = this.visuals.barrierMeshes[bi];
    group.visible = false;
    const mat = (group.children[0] as THREE.Mesh).material as THREE.Material;
    const nx = -b.tz;
    const nz = b.tx;
    const pieces = 10;
    for (let i = 0; i < pieces; i++) {
      const off = (i / (pieces - 1) - 0.5) * b.width;
      const size = this.rng.range(0.5, 1.1);
      const mesh = new THREE.Mesh(this.debrisGeo, mat);
      mesh.scale.set(size * 1.4, size, size);
      mesh.position.set(b.x + nx * off, 0.4 + this.rng.range(0, 1.2), b.z + nz * off);
      mesh.rotation.set(this.rng.range(0, 3), this.rng.range(0, 3), 0);
      mesh.castShadow = true;
      this.scene.add(mesh);
      const push = 4 + hitSpeed * this.rng.range(0.35, 0.7);
      this.debris.push({
        mesh,
        vx: dirX * push + nx * off * 0.6 + this.rng.range(-1.5, 1.5),
        vy: this.rng.range(3.5, 8.5),
        vz: dirZ * push + nz * off * 0.6 + this.rng.range(-1.5, 1.5),
        rx: this.rng.range(-8, 8),
        ry: this.rng.range(-8, 8),
        life: this.rng.range(1.4, 2.0),
        size,
      });
    }
    this.particles.burst(b.x, 1, b.z, 30, 12, ['#ffd166', '#ff7b00', '#ffffff'], 0.6, 0.5, 16);
    this.smoke.burst(b.x, 1, b.z, 12, 4, ['#9ca3af', '#6b7280'], 2.2, 0.9, -1);
    if (r.isPlayer) {
      this.shake = Math.max(this.shake, 0.7);
      audio.smash();
      this.flash(t('msg.barrier'));
      this.addMistake();
    } else if (this.near(r, 70)) audio.smash();
  }

  /** broken barricades rebuild themselves after a few seconds (once nobody is in the way) */
  private updateBarriers(dt: number) {
    const tr = this.track;
    for (let bi = 0; bi < tr.barriers.length; bi++) {
      const b = tr.barriers[bi];
      if (b.brokenT <= 0) continue;
      b.brokenT -= dt;
      if (b.brokenT > 0) continue;
      const blocked = this.racers.some((r) => {
        if (r.y > 2.5) return false;
        const dx = r.x - b.x;
        const dz = r.z - b.z;
        const along = dx * b.tx + dz * b.tz;
        const across = dx * -b.tz + dz * b.tx;
        return Math.abs(along) < b.depth / 2 + CAR_R + 0.6 && Math.abs(across) < b.width / 2 + CAR_R + 0.6;
      });
      if (blocked) {
        b.brokenT = 0.3;
        continue;
      }
      b.brokenT = 0;
      const g = this.visuals.barrierMeshes[bi];
      g.visible = true;
      g.scale.setScalar(0.02);
      this.barrierScale[bi] = 0.02;
      this.particles.burst(b.x, 1, b.z, 16, 5, ['#ffffff', '#fde68a'], 0.5, 0.5, 4);
      if ((b.x - this.player.x) ** 2 + (b.z - this.player.z) ** 2 < 70 * 70) audio.rebuild();
    }
  }

  private rollItem(r: Racer): ItemType {
    const n = this.racers.length;
    const frac = this.battle ? 0.5 : (r.place - 1) / (n - 1);
    const w: [ItemType, number][] = this.battle
      ? [['missile', 1.5], ['ice', 1.5], ['bomb', 1.2], ['oil', 1.0], ['boost', 0.7], ['shield', 0.9], ['fly', 0.6]]
      : [
          ['missile', 0.5 + 2 * frac],
          ['ice', 1.2],
          ['bomb', 1.2 - 0.4 * frac],
          ['oil', 1.4 - 0.6 * frac],
          ['boost', 0.6 + 1.8 * frac],
          ['shield', 1.0],
          // flight is a bit rarer than everything else
          ['fly', 0.5 + 0.35 * frac],
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

  /**
   * Nearest rival measured along the road. The missile normally flies with the race
   * direction; it is fired backwards only when the closest rival is clearly behind.
   */
  private findMissileTarget(r: Racer): { target: Racer | null; dir: number } {
    const tr = this.track;
    let best: Racer | null = null;
    let bestD = Infinity;
    let dir = 1;
    if (tr.oval) {
      // open arena: nearest rival, preferring the ones in front
      const fx = Math.sin(r.heading);
      const fz = Math.cos(r.heading);
      for (const o of this.racers) {
        if (o === r || o.fallingT > 0 || o.flyT > 0) continue;
        const dx = o.x - r.x;
        const dz = o.z - r.z;
        const dist = Math.hypot(dx, dz);
        const score = dist * ((dx * fx + dz * fz) / (dist || 1) > 0 ? 1 : 1.8);
        if (score < bestD) {
          bestD = score;
          best = o;
        }
      }
      return { target: best, dir: 1 };
    }
    for (const o of this.racers) {
      if (o === r || o.fallingT > 0 || o.flyT > 0 || (o.finished && !this.battle)) continue;
      const fwd = tr.ahead(r.lastD, o.lastD);
      const back = (tr.length - fwd) * 1.3;
      if (fwd < bestD) {
        bestD = fwd;
        best = o;
        dir = 1;
      }
      if (back < bestD) {
        bestD = back;
        best = o;
        dir = -1;
      }
    }
    return { target: best, dir };
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
        const { target, dir } = this.findMissileTarget(r);
        const mesh = makeMissile();
        // fuse countdown floating above the missile
        const label = makeLabel(150, 60);
        label.sprite.scale.set(2.3, 0.92, 1);
        label.sprite.position.y = 1.5;
        mesh.add(label.sprite);
        this.scene.add(mesh);
        const sx = r.x + fx * 3.2 * dir;
        const sz = r.z + fz * 3.2 * dir;
        const pr = this.track.project(sx, sz, r.trackIndex);
        this.projectiles.push({
          kind: 'missile', owner: r, target,
          x: sx, y: r.y + 1.3, z: sz, heading: r.heading + (dir < 0 ? Math.PI : 0),
          speed: Math.max(45, (dir > 0 ? r.speed : 0) + 18), life: MISSILE_FUSE,
          index: pr.index, mesh, d: pr.d, lat: pr.lat, dir, dodged: null, label,
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
          index: r.trackIndex, mesh, d: r.lastD, lat: r.lat, dir: 1, dodged: null, label: null,
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
          this.flash(t('msg.nitro'));
        }
        break;
      case 'shield':
        r.shieldT = 6;
        if (r.isPlayer) audio.shield();
        break;
      case 'fly':
        r.flyT = FLY_TIME;
        r.spinT = 0;
        r.frozenT = 0;
        r.airborne = false;
        if (r.isPlayer) {
          audio.takeoff();
          this.flash(t('msg.fly'));
        } else if (this.near(r, 60)) audio.takeoff();
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
      if (target.isPlayer) this.flash(t('msg.shieldBlock'));
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
      if (owner.isPlayer) this.flash(this.battle ? t('msg.plusPoint') : t('msg.hit'));
    }
    if (target.isPlayer) {
      const msg: Partial<Record<ItemType, string>> = {
        missile: t('msg.hitMissile'),
        bomb: t('msg.hitBomb'),
        oil: t('msg.hitOil'),
        ice: t('msg.hitIce'),
      };
      this.flash(msg[kind] ?? t('msg.hit'));
      this.shake = Math.max(this.shake, kind === 'ice' ? 0.3 : 0.9);
      // driving into a bomb or an oil slick is the player's own mistake
      if (kind === 'oil' || kind === 'bomb') this.addMistake();
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
      if (p.kind === 'missile') this.steerMissile(p, dt);
      p.x += Math.sin(p.heading) * p.speed * dt;
      p.z += Math.cos(p.heading) * p.speed * dt;
      const pr = tr.project(p.x, p.z, p.index);
      p.index = pr.index;
      if (p.kind === 'missile') {
        p.d = pr.d;
        p.lat = pr.lat;
        // the missile stays between the walls: it follows the road and never cuts across the map
        const lim = tr.halfWidth + CURB_W - 0.8;
        if (tr.oval) {
          if (tr.ovalValue(p.x, p.z) > 1) p.life = 0;
        } else if (Math.abs(pr.lat) > lim) {
          const s = tr.samples[pr.index];
          const side = Math.sign(pr.lat);
          const over = Math.abs(pr.lat) - lim;
          p.x -= s.nx * side * over;
          p.z -= s.nz * side * over;
          p.lat = side * lim;
          const along = Math.atan2(s.tx, s.tz) + (p.dir < 0 ? Math.PI : 0);
          p.heading += wrapAngle(along - p.heading) * 0.5;
        }
        p.label?.draw(`⏱ ${Math.max(0, p.life).toFixed(1)}`, p.life < 2 ? '#dc2626' : '#111827');
      }
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
      if (p.kind === 'ice' && (tr.oval ? tr.ovalValue(p.x, p.z) > 1 : Math.abs(pr.lat) > tr.halfWidth + CURB_W)) dead = true;
      if (!dead) {
        for (const r of this.racers) {
          if (r === p.owner && p.life > (p.kind === 'missile' ? MISSILE_FUSE - 0.4 : 1.3)) continue;
          if (r.fallingT > 0 || r === p.dodged) continue;
          if ((r.x - p.x) ** 2 + (r.z - p.z) ** 2 < 2.6 * 2.6 && Math.abs(r.y + 1 - p.y) < 2.5) {
            this.applyHit(r, p.kind, p.owner);
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        if (p.kind === 'ice') this.particles.burst(p.x, p.y, p.z, 14, 6, ['#cffafe', '#67e8f9'], 0.5, 0.4, 6);
        else if (p.life <= 0) {
          // fuse ran out before reaching the target: self-destruct
          this.explosion(p.x, p.y, p.z);
          if (p.owner.isPlayer) this.flash(t('msg.missileGone'));
        }
        p.label?.sprite.material.map?.dispose();
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

  /** Steering of a homing missile: follows the road towards the target, direct lock only on final approach */
  private steerMissile(p: Projectile, dt: number) {
    const tr = this.track;
    const hw = tr.halfWidth;
    p.speed = Math.min(70, p.speed + 30 * dt);
    if (p.target && (p.target.fallingT > 0 || p.target.flyT > 0)) p.target = null;
    const t = p.target;
    let ax: number;
    let az: number;
    let turn = 4.5;
    if (t) {
      const dist = Math.hypot(t.x - p.x, t.z - p.z);
      const along = p.dir > 0 ? tr.ahead(p.d, t.lastD) : tr.ahead(t.lastD, p.d);
      // in the open arena there is no road to follow: home in directly
      if (tr.oval || dist < 10 || (dist < 28 && along < 40)) {
        // final approach: direct homing with a limited turn rate
        ax = t.x + t.vx * 0.08;
        az = t.z + t.vz * 0.08;
        turn = tr.oval ? 2.6 : 3.0;
        // a good drift shakes off the lock
        if (dist < 16 && t.driftAmt >= GOOD_DRIFT) {
          p.dodged = t;
          p.target = null;
          this.smoke.burst(t.x, 0.5, t.z, 14, 6, ['#e5e7eb', '#cbd5e1'], 1.6, 0.7);
          if (t.isPlayer) {
            this.flash(t_('msg.dodged'));
            audio.dodge();
          } else if (p.owner.isPlayer) this.flash(t_('msg.dodgedOther', { name: t.name }));
        }
      } else {
        // aim at a point further down the road, sliding sideways towards the target's lane
        const look = 14 + p.speed * 0.25;
        const k = clamp(1 - along / 140, 0.1, 1);
        const lat = clamp(p.lat + (t.lat - p.lat) * k, -hw + 1, hw - 1);
        const pt = tr.pointAt(p.d + p.dir * look, lat);
        ax = pt.x;
        az = pt.z;
      }
    } else if (tr.oval) {
      ax = p.x + Math.sin(p.heading) * 20;
      az = p.z + Math.cos(p.heading) * 20;
    } else {
      const pt = tr.pointAt(p.d + p.dir * 20, clamp(p.lat, -hw + 1.5, hw - 1.5));
      ax = pt.x;
      az = pt.z;
    }
    const desired = Math.atan2(ax - p.x, az - p.z);
    p.heading += clamp(wrapAngle(desired - p.heading), -turn * dt, turn * dt);
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
    if (this.track.oval) return this.aiArena(r, dt);
    const tr = this.track;
    const ai = r.ai;
    const p = r.params;
    const hw = tr.halfWidth;
    const d = r.lastD;
    const absS = Math.abs(r.speed);
    const df = this.diff;

    ai.laneTimer -= dt;
    if (ai.laneTimer <= 0) {
      ai.laneTarget = this.rng.range(-hw * 0.55, hw * 0.55);
      ai.laneTimer = this.rng.range(2.5, 5.5);
    }
    // weaker bots drift across the road instead of holding a line
    let lane = ai.laneTarget + Math.sin(this.time * 0.6 + r.id * 1.7) * hw * 0.35 * df.wobble;
    let fullThrottle = false;

    // strong bots line up for boost pads
    if (df.pads) {
      for (const b of tr.boosts) {
        const a = tr.ahead(d, b.d);
        if (a > 8 && a < 70) {
          lane = b.lat;
          break;
        }
      }
    }

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
      if (b.brokenT > 0) continue;
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
    const safe = maxCurv > 0.0005 ? (tRate / (maxCurv + (0.32 * tRate) / p.maxSpeed)) * df.corner : 999;
    let targetSpeed = Math.min(p.maxSpeed * 1.5, safe) * ai.skill;
    if (fullThrottle) targetSpeed = 999;

    let throttle = absS < targetSpeed ? 1 : 0;
    let brake = r.speed > targetSpeed + 4 ? 1 : 0;

    // driving mistakes of weaker bots: lifting off and running wide for a moment
    if (ai.slipT > 0) {
      ai.slipT -= dt;
      throttle = 0;
      steer = clamp(steer + Math.sin(this.time * 7 + r.id) * 0.6, -1, 1);
    } else if (!fullThrottle && this.rng.chance(df.slips * dt)) ai.slipT = this.rng.range(0.5, 1.1);

    if (ai.stuckT > 1.5) {
      throttle = 0;
      brake = 1;
      steer = -steer;
    }

    // a missile is coming: some bots try to shake it off with a drift
    let drift = false;
    for (const pj of this.projectiles) {
      if (pj.kind !== 'missile' || pj.target !== r) continue;
      if ((pj.x - r.x) ** 2 + (pj.z - r.z) ** 2 > 42 * 42) continue;
      if (ai.dodgeFor !== pj) {
        ai.dodgeFor = pj;
        ai.willDodge = this.rng.chance(df.dodge);
      }
      if (ai.willDodge && absS > 13) {
        drift = true;
        throttle = 1;
        brake = 0;
        steer = Math.abs(steer) > 0.25 ? Math.sign(steer) : 1;
      }
    }

    if (!this.battle && !r.isPlayer) r.rubber += (this.rubberTarget(r) - r.rubber) * damp(0.5, dt);
    this.aiItems(r, dt, maxCurv);
    return { throttle, brake, steer, drift };
  }

  /**
   * Rubber banding by difficulty. On "impossible" a clean driver (≤ 3 mistakes) can still catch
   * the leaders; after the 4th mistake the bots stop waiting and pull away.
   */
  private rubberTarget(r: Racer) {
    const df = this.diff;
    const gap = r.progress - this.player.progress;
    if (this.cfg.difficulty === 'impossible') {
      if (this.mistakes > MAX_MISTAKES) return 1.06;
      return gap > 30 ? 0.95 : gap < -60 ? df.rubberBehind : 1;
    }
    return gap > 120 ? df.rubberAhead : gap < -120 ? df.rubberBehind : 1;
  }

  private aiItems(r: Racer, dt: number, curv: number) {
    const ai = r.ai;
    if (!r.item || r.rouletteT > 0) return;
    ai.itemT -= dt;
    ai.holdT += dt;
    if (ai.itemT <= 0) {
      ai.itemT = this.rng.range(this.diff.itemDelay[0], this.diff.itemDelay[1]);
      if (this.aiWantsItem(r, curv)) this.useItem(r);
    }
  }

  /** Battle-arena bots: hunt rivals, collect boxes, wander, keep off the wall */
  private aiArena(r: Racer, dt: number): Controls {
    const tr = this.track;
    const o = tr.oval!;
    const ai = r.ai;
    const p = r.params;
    const absS = Math.abs(r.speed);
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    let tx: number | null = null;
    let tz = 0;

    if (!r.item && r.rouletteT <= 0) {
      // nearest active lucky block, preferring ones in front
      let best = Infinity;
      for (const b of this.boxes) {
        if (!b.active) continue;
        const dx = b.x - r.x;
        const dz = b.z - r.z;
        const dist = Math.hypot(dx, dz);
        const s = dist * ((dx * fx + dz * fz) / (dist || 1) > 0 ? 1 : 2.2);
        if (s < best) {
          best = s;
          tx = b.x;
          tz = b.z;
        }
      }
    } else if (r.item === 'missile' || r.item === 'ice') {
      // hunt the closest rival
      let best = Infinity;
      for (const t2 of this.racers) {
        if (t2 === r || t2.fallingT > 0) continue;
        const dist = Math.hypot(t2.x - r.x, t2.z - r.z);
        if (dist < best) {
          best = dist;
          tx = t2.x + t2.vx * 0.4;
          tz = t2.z + t2.vz * 0.4;
        }
      }
    }
    if (tx === null) {
      ai.wpT -= dt;
      if (ai.wpT <= 0 || Math.hypot(ai.wpX - r.x, ai.wpZ - r.z) < 12) {
        const a = this.rng.range(0, Math.PI * 2);
        const k = this.rng.range(0.15, 0.8);
        ai.wpX = Math.cos(a) * o.a * k;
        ai.wpZ = Math.sin(a) * o.b * k;
        ai.wpT = this.rng.range(3, 6);
      }
      tx = ai.wpX;
      tz = ai.wpZ;
    }
    // steer around intact barricades in the way
    for (const b of tr.barriers) {
      if (b.brokenT > 0) continue;
      const dx = b.x - r.x;
      const dz = b.z - r.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0 || ahead > 20) continue;
      const side = dx * fz - dz * fx;
      if (Math.abs(side) < b.width / 2 + 2.5) {
        const push = side > 0 ? -1 : 1;
        tx = r.x + fx * 15 + fz * push * 9;
        tz = r.z + fz * 15 - fx * push * 9;
        break;
      }
    }
    // keep away from the outer wall
    const lx = r.x + fx * (8 + absS * 0.6);
    const lz = r.z + fz * (8 + absS * 0.6);
    if (tr.ovalValue(lx, lz) > 0.85) {
      tx = r.x * 0.2;
      tz = r.z * 0.2;
    }
    const desired = Math.atan2(tx - r.x, tz - r.z);
    const diff = wrapAngle(desired - r.heading);
    let steer = clamp(-diff * 2.4, -1, 1);
    const targetSpeed = p.maxSpeed * ai.skill * (1 - Math.min(0.6, Math.abs(diff) * 0.45));
    let throttle = absS < targetSpeed ? 1 : 0;
    let brake = r.speed > targetSpeed + 5 ? 1 : 0;
    if (ai.stuckT > 1.5) {
      throttle = 0;
      brake = 1;
      steer = -steer;
    }
    let drift = false;
    for (const pj of this.projectiles) {
      if (pj.kind !== 'missile' || pj.target !== r) continue;
      if ((pj.x - r.x) ** 2 + (pj.z - r.z) ** 2 > 42 * 42) continue;
      if (ai.dodgeFor !== pj) {
        ai.dodgeFor = pj;
        ai.willDodge = this.rng.chance(this.diff.dodge);
      }
      if (ai.willDodge && absS > 13) {
        drift = true;
        throttle = 1;
        brake = 0;
        steer = Math.abs(steer) > 0.25 ? Math.sign(steer) : 1;
      }
    }
    this.aiItems(r, dt, 0);
    return { throttle, brake, steer, drift };
  }

  private aiWantsItem(r: Racer, curv: number): boolean {
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    switch (r.item) {
      case 'missile': {
        const t = this.findMissileTarget(r).target;
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
      case 'fly': {
        const tr = this.track;
        if (tr.gap && tr.ahead(r.lastD, tr.gap.rampStart) < 60) return true;
        for (const b of tr.barriers) {
          if (b.brokenT > 0) continue;
          const a = tr.ahead(r.lastD, b.d);
          if (a > 5 && a < 35 && Math.abs(b.lat - r.lat) < b.width / 2 + 2) return true;
        }
        for (const p of this.projectiles) {
          if (p.target === r && (p.x - r.x) ** 2 + (p.z - r.z) ** 2 < 50 * 50) return true;
        }
        return r.ai.holdT > 6;
      }
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
          this.flash(r.place === 1 ? t('msg.win') : t('msg.finish', { place: r.place }));
          this.endTimer = 6;
        }
      } else if (r.isPlayer && lap > r.lapShown) {
        r.lapShown = lap;
        audio.lap();
        this.flash(lap === this.laps ? t('msg.lastLap') : t('msg.lap', { lap, laps: this.laps }));
      }
    }
  }

  private checkEnd(dt: number) {
    if (this.ended || this.phase === 'countdown' || this.phase === 'intro') return;
    if (this.battle) {
      if (this.raceTime >= this.duration && this.endTimer < 0) {
        this.phase = 'finished';
        this.endTimer = 2;
        audio.finish();
        this.flash(t('msg.timeUp'));
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
        const coins = Math.round(
          (this.battle ? r.points * 40 + base * 0.6 * (this.duration / 120) : base * lapMul + r.hits * 15) * this.diff.coinMul,
        );
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
    audio.quiet();
    this.cb.onFinish({
      mode: this.cfg.mode,
      mapName: this.mapName,
      rows,
      playerCoins: me.coins,
      playerPlace: me.place,
      mistakes: this.mistakes,
      storyLevel: this.cfg.storyLevel,
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
    let incoming: HudState['incoming'] = null;
    let ownMissile: number | null = null;
    for (const pj of this.projectiles) {
      if (pj.kind !== 'missile') continue;
      if (pj.owner === p) ownMissile = Math.max(ownMissile ?? 0, pj.life);
      if (pj.target === p) {
        const dist = Math.round(Math.hypot(pj.x - p.x, pj.z - p.z));
        if (!incoming || dist < incoming.dist) incoming = { time: Math.max(0, pj.life), dist };
      }
    }
    this.cb.onHud({
      phase: this.phase,
      countdown: this.phase === 'intro' ? 0 : Math.max(0, Math.ceil(this.countdown - 1)),
      speedKmh: Math.round(Math.abs(p.speed) * 3.6),
      gear: p.gearbox.gear,
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
      fly: p.flyT,
      drift: p.driftAmt,
      incoming,
      ownMissile,
      mirrors: this.mirrorsOn,
      points: p.points,
      mistakes: this.mistakes,
      difficulty: this.cfg.difficulty,
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
    const rollTarget = r.flyT > 0 ? r.steer * 0.28 : r.airborne ? 0 : r.steer * ratio * 0.07;
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
    // wings unfold for the flight and fold back after landing
    const ws = r.flyT > 0 ? Math.min(1, r.wings.scale.x + dt * 4) : Math.max(0.001, r.wings.scale.x - dt * 4);
    r.wings.scale.setScalar(ws);
    r.wings.visible = ws > 0.01;
    if (r.wings.visible) {
      for (const c of r.wings.children) if (c.name === 'flame') c.scale.set(1, 0.7 + Math.random() * 0.6, 1);
    }
    m.root.visible = r.invulnT <= 0 || Math.sin(this.time * 25) > -0.3;
  }

  private updateVisuals(dt: number) {
    const t = this.time;
    if (this.phase === 'intro') this.animateIntro();

    for (const r of this.racers) {
      this.syncModel(r, dt);
      const m = r.model;
      this.updateSkids(r);
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
      // sparks from the rear tyres show a drift good enough to dodge missiles
      if (r.driftAmt >= GOOD_DRIFT && Math.random() < 0.7) {
        const bx = r.x - Math.sin(r.heading) * 1.8;
        const bz = r.z - Math.cos(r.heading) * 1.8;
        this.particles.emit(bx + (Math.random() - 0.5) * 2, 0.3, bz, (Math.random() - 0.5) * 4, 2 + Math.random() * 2, (Math.random() - 0.5) * 4, Math.random() > 0.5 ? '#fbbf24' : '#60a5fa', 0.45, 0.3);
      }
      // jet trail while flying
      if (r.flyT > 0 && Math.random() < 0.8) {
        const bx = r.x - Math.sin(r.heading) * 2.2;
        const bz = r.z - Math.cos(r.heading) * 2.2;
        this.particles.emit(bx, r.y + 0.8, bz, 0, -2, 0, Math.random() > 0.5 ? '#c4b5fd' : '#ffffff', 0.9, 0.35);
      }
      // "missile incoming" marker above targeted bots
      const targeted = !r.isPlayer && this.projectiles.some((pj) => pj.kind === 'missile' && pj.target === r);
      r.warn.visible = targeted && Math.sin(t * 14) > -0.3;
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

    // barricade wreckage
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vy -= GRAV * dt;
      const m = d.mesh;
      m.position.x += d.vx * dt;
      m.position.y += d.vy * dt;
      m.position.z += d.vz * dt;
      const half = d.size * 0.5;
      if (m.position.y < half) {
        m.position.y = half;
        d.vy *= -0.3;
        d.vx *= 0.7;
        d.vz *= 0.7;
        d.rx *= 0.6;
        d.ry *= 0.6;
      }
      m.rotation.x += d.rx * dt;
      m.rotation.y += d.ry * dt;
      const k = clamp(d.life / 0.4, 0, 1);
      m.scale.set(d.size * 1.4 * k, d.size * k, d.size * k);
      if (d.life <= 0) {
        this.scene.remove(m);
        this.debris.splice(i, 1);
      }
    }
    // rebuilt barricades grow back up
    for (let i = 0; i < this.barrierScale.length; i++) {
      const s = this.barrierScale[i];
      if (s >= 1) continue;
      const ns = Math.min(1, s + dt * 2.5);
      this.barrierScale[i] = ns;
      const e = 1 - (1 - ns) ** 3;
      this.visuals.barrierMeshes[i].scale.set(1, Math.max(0.02, e), 1);
    }
    // radar beep while a missile is locked on the player
    {
      let minD = Infinity;
      for (const pj of this.projectiles) {
        if (pj.kind === 'missile' && pj.target === this.player) minD = Math.min(minD, Math.hypot(pj.x - this.player.x, pj.z - this.player.z));
      }
      this.warnBeepT -= dt;
      if (minD < 160 && this.warnBeepT <= 0) {
        audio.warn(minD < 45);
        this.warnBeepT = minD < 45 ? 0.16 : 0.42;
      }
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

    this.updateAudio(dt);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.pushHud();
    }
    this.drawMinimap();
  }

  /** tyre marks while sliding, spinning or braking hard (only near the camera) */
  private updateSkids(r: Racer) {
    const m = r.model;
    const keyBase = r.id * 4;
    const near = (r.x - this.camera.position.x) ** 2 + (r.z - this.camera.position.z) ** 2 < 160 * 160;
    const side = Math.abs(r.vx * Math.cos(r.heading) - r.vz * Math.sin(r.heading));
    const sliding =
      near && !r.airborne && r.flyT <= 0 && r.fallingT <= 0 && (side > 4 || r.spinT > 0 || (r.lastBrake > 0 && r.speed > 14));
    m.rearWheels.forEach((w, i) => {
      const key = String(keyBase + i);
      if (!sliding) {
        this.skids.lift(key);
        return;
      }
      this.tmpV.copy(w);
      m.root.localToWorld(this.tmpV);
      this.skids.add(key, this.tmpV.x, r.y + 0.06, this.tmpV.z);
    });
  }

  /** player's engine via the gearbox, the nearest rival's engine, tyre squeal and wind */
  private updateAudio(dt: number) {
    const p = this.player;
    const { idle, redline } = engineRange(p.def.engine);
    let thr = p.lastThrottle;
    let rpm: number;
    if (this.phase === 'intro' || this.phase === 'countdown') {
      // revving on the grid
      thr = this.phase === 'intro' ? 0 : this.input.throttle;
      const target = idle + (redline - idle) * 0.75 * thr;
      p.gearbox.rpm += (target - p.gearbox.rpm) * damp(thr ? 5 : 3, dt);
      rpm = p.gearbox.rpm;
    } else rpm = p.gearbox.update(p.speed, p.params.maxSpeed, thr, dt);
    audio.updateEngine(rpm, thr, p.gearbox.shiftT > 0.06);
    // exhaust pops when lifting off at high revs
    if (this.prevThrottle > 0 && thr === 0 && rpm > redline * 0.6 && p.def.engine !== 'electric') audio.backfire();
    this.prevThrottle = thr;

    let near: Racer | null = null;
    let nd = 70;
    for (const r of this.racers) {
      if (r === p) continue;
      if (this.phase === 'racing' || this.phase === 'finished') r.gearbox.update(r.speed, r.params.maxSpeed, r.lastThrottle, dt);
      const dist = Math.hypot(r.x - p.x, r.z - p.z);
      if (dist < nd) {
        nd = dist;
        near = r;
      }
    }
    if (near) audio.updateOther(near.def.engine, near.gearbox.rpm, near.lastThrottle, (1 - nd / 70) ** 2);
    else audio.updateOther(null, 0, 0, 0);

    const side = Math.abs(p.vx * Math.cos(p.heading) - p.vz * Math.sin(p.heading));
    const skid = p.airborne || p.flyT > 0 ? 0 : Math.max(p.driftAmt, p.spinT > 0 ? 1 : 0, clamp((side - 3) / 8, 0, 1), p.lastBrake && p.speed > 15 ? 0.6 : 0);
    audio.updateTyres(skid, clamp(Math.abs(p.speed) / 45, 0, 1.2));
  }

  private updateCamera(dt: number) {
    const r = this.player;
    const cam = this.camera;
    const ratio = clamp(Math.abs(r.speed) / r.params.maxSpeed, 0, 1.4);
    const portrait = cam.aspect < 1;

    if (this.phase === 'intro') {
      // cinematic sweep from the side of the grid to behind the player's car
      const k = clamp(this.introT / this.introLen, 0, 1);
      const e = k * k * (3 - 2 * k);
      const a = r.heading + Math.PI * 0.3 + Math.PI * 0.7 * e;
      const dist = 17 - 6.5 * e;
      this.camPos.set(r.x + Math.sin(a) * dist, 5.5 - 1.1 * e, r.z + Math.cos(a) * dist);
      this.camLook.set(r.x + Math.sin(r.heading) * 3 * e, 1.2, r.z + Math.cos(r.heading) * 3 * e);
      this.camYaw = r.heading;
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      return;
    }

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
