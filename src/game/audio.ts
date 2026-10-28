import type { EngineKind } from './types';

/**
 * Engine character. The sound is a looped buffer of combustion pulses (one per cylinder firing)
 * filtered through exhaust resonances; its playback rate follows the RPM, so the pitch and the
 * firing rhythm change together like a real engine.
 */
interface EngineProfile {
  cyl: number;
  idle: number;
  redline: number;
  /** exhaust resonance frequencies at 1000 rpm */
  reso: [number, number];
  /** pulse decay (s) at 1000 rpm */
  decay: number;
  /** combustion noise / diesel clatter */
  noise: number;
  /** saturation amount */
  drive: number;
  cutoff: number;
  gain: number;
  /** relative loudness of each firing (uneven = burble) */
  amps?: number[];
  /** firing angle offsets in degrees from even spacing (unequal headers) */
  jitter?: number[];
}

const PROFILES: Record<EngineKind, EngineProfile> = {
  i4: { cyl: 4, idle: 850, redline: 7200, reso: [190, 560], decay: 0.0055, noise: 0.12, drive: 2.2, cutoff: 1000, gain: 0.55 },
  v6: { cyl: 6, idle: 800, redline: 7000, reso: [160, 470], decay: 0.006, noise: 0.1, drive: 2.5, cutoff: 1050, gain: 0.55 },
  v8: { cyl: 8, idle: 700, redline: 6800, reso: [105, 320], decay: 0.0085, noise: 0.1, drive: 3.2, cutoff: 760, gain: 0.66, amps: [1, 0.72, 0.95, 0.68, 1, 0.75, 0.9, 0.7] },
  v12: { cyl: 12, idle: 900, redline: 8600, reso: [220, 660], decay: 0.0045, noise: 0.07, drive: 2.0, cutoff: 1500, gain: 0.5 },
  single: { cyl: 1, idle: 1800, redline: 11000, reso: [260, 760], decay: 0.011, noise: 0.22, drive: 3.6, cutoff: 1700, gain: 0.42 },
  boxer: { cyl: 4, idle: 800, redline: 7000, reso: [135, 390], decay: 0.008, noise: 0.12, drive: 2.9, cutoff: 850, gain: 0.6, jitter: [0, -16, 22, -9], amps: [1, 0.8, 0.95, 0.75] },
  diesel: { cyl: 4, idle: 700, redline: 4600, reso: [125, 940], decay: 0.0042, noise: 0.38, drive: 2.0, cutoff: 700, gain: 0.58 },
  f1: { cyl: 10, idle: 4000, redline: 15000, reso: [320, 960], decay: 0.0038, noise: 0.06, drive: 1.8, cutoff: 2600, gain: 0.42 },
  electric: { cyl: 0, idle: 0, redline: 16000, reso: [0, 0], decay: 0, noise: 0, drive: 1, cutoff: 3000, gain: 0.3 },
};

export const engineRange = (kind: EngineKind) => ({ idle: PROFILES[kind].idle, redline: PROFILES[kind].redline });

const BASE_RPM = 1000;

/** Simple automatic gearbox: turns road speed into engine RPM with real up/down shifts */
export class Gearbox {
  gear = 1;
  rpm: number;
  /** > 0 right after an upshift: the engine note dips like a real gear change */
  shiftT = 0;
  private readonly idle: number;
  private readonly redline: number;

  constructor(
    private readonly gears: number,
    private readonly kind: EngineKind,
  ) {
    const p = PROFILES[kind];
    this.idle = kind === 'electric' ? 0 : p.idle;
    this.redline = p.redline;
    this.rpm = this.idle;
  }

  private top(g: number, maxSpeed: number) {
    return maxSpeed * 1.04 * Math.pow(g / this.gears, 0.72);
  }

  update(speed: number, maxSpeed: number, throttle: number, dt: number) {
    const v = Math.abs(speed);
    let target: number;
    if (this.gears <= 1) {
      // electric motor / kart CVT
      const k = Math.min(1.1, v / maxSpeed);
      target = this.kind === 'single' ? this.idle + (this.redline - this.idle) * Math.min(1, 0.5 * throttle + 0.5 * k) : this.redline * k * 0.9;
    } else {
      this.shiftT = Math.max(0, this.shiftT - dt);
      if (v > this.top(this.gear, maxSpeed) * 0.96 && this.gear < this.gears && this.shiftT <= 0) {
        this.gear++;
        this.shiftT = 0.2;
      }
      while (this.gear > 1 && v < this.top(this.gear - 1, maxSpeed) * 0.68) this.gear--;
      target = this.idle + (this.redline - this.idle) * Math.min(1.02, v / this.top(this.gear, maxSpeed));
      // clutch slip when pulling away
      if (this.gear === 1 && v < 6) target = Math.max(target, this.idle + (this.redline - this.idle) * 0.32 * throttle);
    }
    this.rpm += (target - this.rpm) * (1 - Math.exp(-(this.shiftT > 0 ? 18 : 9) * dt));
    return this.rpm;
  }
}

function buildEngineBuffer(ctx: BaseAudioContext, p: EngineProfile) {
  const cycles = 6;
  const cycleLen = 120 / BASE_RPM; // one 4-stroke cycle = 2 revolutions
  const sr = ctx.sampleRate;
  const n = Math.round(cycleLen * cycles * sr);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const [r1, r2] = p.reso;
  const tail = Math.round(p.decay * 10 * sr);
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < p.cyl; k++) {
      const angle = (k * 720) / p.cyl + (p.jitter?.[k % p.jitter.length] ?? 0) + (rand() - 0.5) * 6;
      const start = Math.round((c * cycleLen + (angle / 720) * cycleLen) * sr);
      const amp = (p.amps?.[k % p.amps.length] ?? 1) * (0.9 + rand() * 0.2);
      for (let i = 0; i < tail; i++) {
        const t = i / sr;
        const env = Math.exp(-t / p.decay);
        const s =
          Math.sin(2 * Math.PI * r1 * t) * env +
          0.55 * Math.sin(2 * Math.PI * r2 * t) * Math.exp(-t / (p.decay * 0.6)) +
          0.7 * Math.sin(2 * Math.PI * r1 * 0.5 * t) * Math.exp(-t / (p.decay * 2.5)) +
          p.noise * (rand() * 2 - 1) * Math.exp(-t / (p.decay * 0.5));
        d[(start + i) % n] += s * amp;
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < n; i++) d[i] = (d[i] / (peak || 1)) * 0.9;
  return buf;
}

function shaperCurve(drive: number) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

/** One running engine (the player's car, or the nearest rival passing by) */
class EngineVoice {
  readonly kind: EngineKind;
  private nodes: AudioNode[] = [];
  private srcs: (AudioScheduledSourceNode)[] = [];
  private out: GainNode;
  private filter: BiquadFilterNode;
  private main: AudioBufferSourceNode | null = null;
  private intake: GainNode;
  private intakeFilter: BiquadFilterNode;
  private whine: OscillatorNode[] = [];
  private p: EngineProfile;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    kind: EngineKind,
    buffer: AudioBuffer | null,
    noise: AudioBuffer,
  ) {
    this.kind = kind;
    this.p = PROFILES[kind];
    const c = ctx;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.9;
    this.filter.connect(this.out);
    this.nodes.push(this.out, this.filter);

    if (kind === 'electric') {
      // inverter + motor whine: a few detuned harmonics
      for (const [mul, type, g] of [[1, 'sine', 0.5], [2.02, 'triangle', 0.22], [3.5, 'sine', 0.12]] as const) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = 60 * mul;
        const og = c.createGain();
        og.gain.value = g;
        o.connect(og);
        og.connect(this.filter);
        o.start();
        this.whine.push(o);
        this.srcs.push(o);
        this.nodes.push(og);
      }
    } else if (buffer) {
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const shaper = c.createWaveShaper();
      shaper.curve = shaperCurve(this.p.drive);
      shaper.oversample = '2x';
      src.connect(shaper);
      shaper.connect(this.filter);
      src.start();
      this.main = src;
      this.srcs.push(src);
      this.nodes.push(shaper);
    }
    // intake / induction roar: band-passed noise that opens with the throttle
    const n = c.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    this.intakeFilter = c.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 1.2;
    this.intake = c.createGain();
    this.intake.gain.value = 0;
    n.connect(this.intakeFilter);
    this.intakeFilter.connect(this.intake);
    this.intake.connect(this.out);
    n.start();
    this.srcs.push(n);
    this.nodes.push(this.intakeFilter, this.intake);
  }

  set(rpm: number, throttle: number, volume: number, cut = false) {
    const t = this.ctx.currentTime;
    const p = this.p;
    const load = cut ? 0.1 : throttle;
    const rr = Math.min(1.1, rpm / p.redline);
    if (this.kind === 'electric') {
      const f = 40 + rpm * 0.06;
      this.whine.forEach((o, i) => o.frequency.setTargetAtTime(f * [1, 2.02, 3.5][i], t, 0.05));
      this.filter.frequency.setTargetAtTime(1800 + rr * 4000, t, 0.08);
      this.out.gain.setTargetAtTime(volume * p.gain * (0.15 + rr * 0.5) * (0.5 + load * 0.5), t, 0.08);
      this.intakeFilter.frequency.setTargetAtTime(500 + rr * 1500, t, 0.1);
      this.intake.gain.setTargetAtTime(0.25 * rr, t, 0.1);
      return;
    }
    if (this.main) this.main.playbackRate.setTargetAtTime(Math.max(0.3, rpm / BASE_RPM), t, 0.03);
    // loaded engines sound brighter; lifting off makes the note dull and quiet
    this.filter.frequency.setTargetAtTime(p.cutoff * (0.45 + load * 0.75) * (0.7 + rr * 0.9), t, 0.05);
    this.out.gain.setTargetAtTime(volume * p.gain * (0.32 + load * 0.68) * (0.55 + rr * 0.45), t, 0.05);
    this.intakeFilter.frequency.setTargetAtTime(300 + rpm * 0.25, t, 0.08);
    this.intake.gain.setTargetAtTime(load * rr * 0.32, t, 0.08);
  }

  stop() {
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.nodes.forEach((n) => n.disconnect());
  }
}

/** Synthesized sound engine — no audio files needed */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private buffers = new Map<EngineKind, AudioBuffer>();
  private player: EngineVoice | null = null;
  private other: EngineVoice | null = null;
  private engineBus: GainNode | null = null;
  private tyre: { g: GainNode; f: BiquadFilterNode; src: AudioBufferSourceNode } | null = null;
  private wind: { g: GainNode; src: AudioBufferSourceNode } | null = null;
  muted = false;

  init() {
    if (this.ctx) {
      this.syncFocus();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    // gentle compression glues engine, tyres and effects together
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // sound only plays while the game window is open and focused
    document.addEventListener('visibilitychange', this.syncFocus);
    window.addEventListener('blur', this.syncFocus);
    window.addEventListener('focus', this.syncFocus);
    this.syncFocus();
  }

  private syncFocus = () => {
    if (!this.ctx) return;
    const active = !document.hidden && document.hasFocus();
    if (active && this.ctx.state === 'suspended') void this.ctx.resume();
    else if (!active && this.ctx.state === 'running') void this.ctx.suspend();
  };

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  private buffer(kind: EngineKind) {
    if (kind === 'electric') return null;
    let b = this.buffers.get(kind);
    if (!b) {
      b = buildEngineBuffer(this.ctx!, PROFILES[kind]);
      this.buffers.set(kind, b);
    }
    return b;
  }

  startEngine(kind: EngineKind) {
    if (!this.ctx || !this.master || this.player) return;
    const c = this.ctx;
    this.engineBus = c.createGain();
    this.engineBus.gain.value = 1;
    this.engineBus.connect(this.master);
    this.player = new EngineVoice(c, this.engineBus, kind, this.buffer(kind), this.noiseBuf!);
    // tyre squeal
    const ts = c.createBufferSource();
    ts.buffer = this.noiseBuf;
    ts.loop = true;
    const tf = c.createBiquadFilter();
    tf.type = 'bandpass';
    tf.frequency.value = 1100;
    tf.Q.value = 2.5;
    const tg = c.createGain();
    tg.gain.value = 0;
    ts.connect(tf);
    tf.connect(tg);
    tg.connect(this.engineBus);
    ts.start();
    this.tyre = { g: tg, f: tf, src: ts };
    // wind rush at speed
    const ws = c.createBufferSource();
    ws.buffer = this.noiseBuf;
    ws.loop = true;
    ws.playbackRate.value = 0.5;
    const wf = c.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 450;
    const wg = c.createGain();
    wg.gain.value = 0;
    ws.connect(wf);
    wf.connect(wg);
    wg.connect(this.engineBus);
    ws.start();
    this.wind = { g: wg, src: ws };
  }

  /** player's engine: rpm from the gearbox, cut = throttle cut during a gear change */
  updateEngine(rpm: number, throttle: number, cut = false) {
    this.player?.set(rpm, throttle, 1, cut);
  }

  /** nearest rival engine (volume 0..1 by distance); pass null kind to silence */
  updateOther(kind: EngineKind | null, rpm: number, throttle: number, volume: number) {
    if (!this.ctx || !this.engineBus) return;
    if (!kind || volume < 0.01) {
      this.other?.set(0, 0, 0);
      return;
    }
    if (!this.other || this.other.kind !== kind) {
      this.other?.stop();
      this.other = new EngineVoice(this.ctx, this.engineBus, kind, this.buffer(kind), this.noiseBuf!);
    }
    this.other.set(rpm, throttle, volume * 0.55);
  }

  /** skid: 0..1 slide amount, speed: 0..1 */
  updateTyres(skid: number, speed: number) {
    if (!this.ctx || !this.tyre || !this.wind) return;
    const t = this.ctx.currentTime;
    this.tyre.g.gain.setTargetAtTime(Math.min(1, skid) * 0.22 * Math.min(1, speed * 1.5), t, 0.06);
    this.tyre.f.frequency.setTargetAtTime(900 + skid * 600, t, 0.1);
    this.wind.g.gain.setTargetAtTime(speed * speed * 0.18, t, 0.2);
  }

  /** silence all continuous sounds (pause / race end) */
  quiet() {
    this.player?.set(0, 0, 0);
    this.other?.set(0, 0, 0);
    this.updateTyres(0, 0);
  }

  stopEngine() {
    this.player?.stop();
    this.other?.stop();
    this.player = this.other = null;
    for (const x of [this.tyre, this.wind]) {
      try {
        x?.src.stop();
      } catch {
        /* already stopped */
      }
      x?.g.disconnect();
    }
    this.tyre = this.wind = null;
    this.engineBus?.disconnect();
    this.engineBus = null;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.15, slideTo?: number, delay = 0) {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', slideTo?: number, delay = 0) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  countdown(go: boolean) {
    this.tone(go ? 880 : 440, go ? 0.6 : 0.25, 'square', 0.12);
  }
  pickup() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.1, undefined, i * 0.05));
  }
  boost() {
    this.noise(0.7, 0.25, 300, 'bandpass', 3000);
  }
  shoot() {
    this.tone(900, 0.25, 'sawtooth', 0.08, 200);
    this.noise(0.3, 0.12, 2000, 'highpass');
  }
  ice() {
    this.tone(1800, 0.3, 'sine', 0.08, 2600);
    this.tone(2400, 0.2, 'triangle', 0.05, 1200, 0.05);
  }
  explosion() {
    this.noise(1.0, 0.5, 900, 'lowpass', 60);
    this.tone(120, 0.6, 'sine', 0.3, 30);
  }
  crash() {
    this.noise(0.35, 0.4, 1200, 'lowpass', 150);
    this.tone(90, 0.25, 'square', 0.12, 40);
  }
  shield() {
    this.tone(400, 0.4, 'sine', 0.1, 1200);
  }
  splat() {
    this.noise(0.4, 0.2, 500, 'lowpass', 100);
  }
  drop() {
    this.tone(300, 0.15, 'triangle', 0.1, 150);
  }
  fall() {
    this.tone(600, 1.0, 'sine', 0.1, 80);
  }
  land() {
    this.noise(0.2, 0.25, 400, 'lowpass');
  }
  lap() {
    [660, 880].forEach((f, i) => this.tone(f, 0.18, 'square', 0.08, undefined, i * 0.12));
  }
  finish() {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'square', 0.09, undefined, i * 0.12));
  }
  hit() {
    this.tone(220, 0.3, 'square', 0.12, 80);
  }
  /** exhaust pop when lifting off at high rpm */
  backfire() {
    this.noise(0.08, 0.22, 700, 'bandpass', 200);
  }
  /** cheering crowd for the intro */
  crowd() {
    for (let i = 0; i < 6; i++) this.noise(1.4, 0.06, 900 + i * 260, 'bandpass', 700 + i * 200, i * 0.25);
    [0.3, 0.9, 1.6].forEach((d) => this.noise(0.15, 0.1, 3000, 'highpass', undefined, d));
  }
  /** short radar beep: a missile is locked on the player */
  warn(urgent: boolean) {
    this.tone(urgent ? 1560 : 1180, 0.08, 'square', 0.07);
  }
  /** barricade smashed into pieces */
  smash() {
    this.noise(0.5, 0.45, 2600, 'bandpass', 300);
    this.tone(160, 0.2, 'triangle', 0.15, 60);
    this.noise(0.25, 0.2, 5000, 'highpass');
  }
  rebuild() {
    this.tone(500, 0.12, 'triangle', 0.05, 800);
  }
  takeoff() {
    this.noise(1.2, 0.25, 200, 'bandpass', 2400);
    this.tone(300, 0.8, 'sawtooth', 0.05, 900);
  }
  dodge() {
    this.noise(0.4, 0.2, 800, 'bandpass', 4000);
  }
}

export const audio = new AudioEngine();
