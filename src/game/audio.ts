import type { EngineKind } from './types';

/**
 * Engine character. The engine is a small subtractive synth: a fundamental tone with a soft
 * harmonic series (a slightly detuned twin makes it warm), a sub-octave for body, a gentle
 * amplitude "burble" for V8 / boxer engines and a low-pass filter that opens with the revs.
 * The pitch range is compressed into a calm band, so high revs never turn into a shrill whine.
 */
interface EngineProfile {
  idle: number;
  redline: number;
  /** fundamental pitch (Hz) at idle and at the redline */
  pitch: [number, number];
  /** amplitudes of harmonics 1..n of the main tone */
  harm: number[];
  /** sub-octave level (rumble) */
  sub: number;
  /** depth of the uneven-firing amplitude modulation (burble) */
  lump: number;
  /** low-pass cut-off (Hz) at idle and at the redline, full throttle */
  bright: [number, number];
  /** intake / mechanical noise level */
  noise: number;
  gain: number;
}

const PROFILES: Record<EngineKind, EngineProfile> = {
  i4: { idle: 850, redline: 7200, pitch: [48, 168], harm: [1, 0.5, 0.28, 0.14, 0.07], sub: 0.32, lump: 0.05, bright: [420, 1300], noise: 0.04, gain: 0.5 },
  v6: { idle: 800, redline: 7000, pitch: [44, 156], harm: [1, 0.55, 0.32, 0.18, 0.09], sub: 0.38, lump: 0.06, bright: [400, 1250], noise: 0.04, gain: 0.5 },
  v8: { idle: 700, redline: 6800, pitch: [36, 132], harm: [1, 0.62, 0.38, 0.2, 0.1], sub: 0.55, lump: 0.2, bright: [320, 1050], noise: 0.035, gain: 0.55 },
  v12: { idle: 900, redline: 8600, pitch: [54, 196], harm: [1, 0.45, 0.32, 0.22, 0.14, 0.08], sub: 0.28, lump: 0.03, bright: [520, 1600], noise: 0.03, gain: 0.46 },
  single: { idle: 1800, redline: 11000, pitch: [60, 200], harm: [1, 0.45, 0.22, 0.1], sub: 0.2, lump: 0.1, bright: [480, 1400], noise: 0.05, gain: 0.38 },
  boxer: { idle: 800, redline: 7000, pitch: [42, 146], harm: [1, 0.6, 0.35, 0.18, 0.08], sub: 0.5, lump: 0.16, bright: [360, 1100], noise: 0.04, gain: 0.5 },
  diesel: { idle: 700, redline: 4600, pitch: [34, 100], harm: [1, 0.7, 0.45, 0.26, 0.15], sub: 0.5, lump: 0.08, bright: [300, 800], noise: 0.06, gain: 0.5 },
  f1: { idle: 4000, redline: 15000, pitch: [80, 270], harm: [1, 0.42, 0.26, 0.16, 0.09], sub: 0.15, lump: 0.02, bright: [760, 2100], noise: 0.025, gain: 0.4 },
  electric: { idle: 0, redline: 16000, pitch: [55, 420], harm: [1, 0.12], sub: 0, lump: 0, bright: [900, 2600], noise: 0.02, gain: 0.2 },
};

export const engineRange = (kind: EngineKind) => ({ idle: PROFILES[kind].idle, redline: PROFILES[kind].redline });

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

/** periodic waves are cached per engine kind and audio context */
const waveCache = new WeakMap<BaseAudioContext, Map<EngineKind, PeriodicWave>>();
function engineWave(ctx: BaseAudioContext, kind: EngineKind) {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  let w = m.get(kind);
  if (!w) {
    const h = PROFILES[kind].harm;
    const real = new Float32Array(h.length + 1);
    const imag = new Float32Array(h.length + 1);
    h.forEach((a, i) => (imag[i + 1] = a));
    w = ctx.createPeriodicWave(real, imag);
    m.set(kind, w);
  }
  return w;
}

/** One running engine (the player's car, or the nearest rival passing by) */
class EngineVoice {
  readonly kind: EngineKind;
  private nodes: AudioNode[] = [];
  private srcs: AudioScheduledSourceNode[] = [];
  private out: GainNode;
  private filter: BiquadFilterNode;
  private main: OscillatorNode;
  private twin: OscillatorNode;
  private sub: OscillatorNode;
  private lfo: OscillatorNode;
  private intake: GainNode;
  private intakeFilter: BiquadFilterNode;
  private p: EngineProfile;
  private smoothRpm = -1;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    kind: EngineKind,
    noise: AudioBuffer,
  ) {
    this.kind = kind;
    const p = (this.p = PROFILES[kind]);
    const c = ctx;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    // two gentle low-pass stages = a soft roll-off with no resonant peak
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.5;
    const smooth = c.createBiquadFilter();
    smooth.type = 'lowpass';
    smooth.Q.value = 0.3;
    smooth.frequency.value = 2600;
    this.filter.connect(smooth);
    smooth.connect(this.out);
    // amplitude modulation for the burble (base gain 1, the LFO adds ±lump)
    const am = c.createGain();
    am.gain.value = 1;
    am.connect(this.filter);
    this.nodes.push(this.out, this.filter, smooth, am);

    const wave = engineWave(c, kind);
    const osc = (type: 'wave' | OscillatorType, level: number, detune = 0) => {
      const o = c.createOscillator();
      if (type === 'wave') o.setPeriodicWave(wave);
      else o.type = type;
      o.frequency.value = p.pitch[0];
      o.detune.value = detune;
      const g = c.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(am);
      o.start();
      this.srcs.push(o);
      this.nodes.push(g);
      return o;
    };
    this.main = osc('wave', 0.55);
    this.twin = osc('wave', 0.3, 9);
    this.sub = osc('sine', p.sub);

    this.lfo = c.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = p.pitch[0] / 2;
    const depth = c.createGain();
    depth.gain.value = p.lump;
    this.lfo.connect(depth);
    depth.connect(am.gain);
    this.lfo.start();
    this.srcs.push(this.lfo);
    this.nodes.push(depth);

    // soft intake breath that opens with the throttle
    const n = c.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    this.intakeFilter = c.createBiquadFilter();
    this.intakeFilter.type = 'lowpass';
    this.intakeFilter.Q.value = 0.4;
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
    const load = cut ? 0.15 : throttle;
    // light smoothing on top of the gearbox so the pitch never jumps
    this.smoothRpm = this.smoothRpm < 0 ? rpm : this.smoothRpm + (rpm - this.smoothRpm) * 0.5;
    const span = Math.max(1, p.redline - p.idle);
    const frac = Math.min(1.04, Math.max(0, (this.smoothRpm - p.idle) / span));
    // exponential mapping = evenly spaced musical steps across the rev range
    const f = p.pitch[0] * Math.pow(p.pitch[1] / p.pitch[0], frac);
    this.main.frequency.setTargetAtTime(f, t, 0.04);
    this.twin.frequency.setTargetAtTime(f, t, 0.04);
    this.sub.frequency.setTargetAtTime(f / 2, t, 0.04);
    this.lfo.frequency.setTargetAtTime(f / 2, t, 0.06);
    const cutoff = (p.bright[0] + (p.bright[1] - p.bright[0]) * frac) * (0.6 + 0.4 * load);
    this.filter.frequency.setTargetAtTime(cutoff, t, 0.06);
    const level = volume * p.gain * (0.4 + 0.6 * load) * (0.62 + 0.38 * frac);
    this.out.gain.setTargetAtTime(level, t, 0.06);
    this.intakeFilter.frequency.setTargetAtTime(260 + frac * 900, t, 0.1);
    this.intake.gain.setTargetAtTime(p.noise * load * (0.3 + frac), t, 0.1);
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
/** overall output level */
const MASTER = 0.45;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private player: EngineVoice | null = null;
  private backfireT = 0;
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
    this.master.gain.value = this.muted ? 0 : MASTER;
    // soften the whole mix: tame the harsh top end, then gently glue it with a compressor
    const shelf = this.ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 3200;
    shelf.gain.value = -7;
    const top = this.ctx.createBiquadFilter();
    top.type = 'lowpass';
    top.frequency.value = 9000;
    top.Q.value = 0.5;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 18;
    comp.ratio.value = 3;
    this.master.connect(shelf);
    shelf.connect(top);
    top.connect(comp);
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
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.05);
  }

  startEngine(kind: EngineKind) {
    if (!this.ctx || !this.master || this.player) return;
    const c = this.ctx;
    this.engineBus = c.createGain();
    this.engineBus.gain.value = 0.85;
    this.engineBus.connect(this.master);
    this.player = new EngineVoice(c, this.engineBus, kind, this.noiseBuf!);
    // tyre slide: a soft, low hiss instead of a sharp squeal
    const ts = c.createBufferSource();
    ts.buffer = this.noiseBuf;
    ts.loop = true;
    const tf = c.createBiquadFilter();
    tf.type = 'bandpass';
    tf.frequency.value = 750;
    tf.Q.value = 1.1;
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
      this.other = new EngineVoice(this.ctx, this.engineBus, kind, this.noiseBuf!);
    }
    this.other.set(rpm, throttle, volume * 0.4);
  }

  /** skid: 0..1 slide amount, speed: 0..1 */
  updateTyres(skid: number, speed: number) {
    if (!this.ctx || !this.tyre || !this.wind) return;
    const t = this.ctx.currentTime;
    this.tyre.g.gain.setTargetAtTime(Math.min(1, skid) * 0.11 * Math.min(1, speed * 1.5), t, 0.08);
    this.tyre.f.frequency.setTargetAtTime(700 + skid * 250, t, 0.12);
    this.wind.g.gain.setTargetAtTime(speed * speed * 0.09, t, 0.25);
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
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
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
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  countdown(go: boolean) {
    this.tone(go ? 784 : 523, go ? 0.55 : 0.22, 'triangle', 0.11);
  }
  pickup() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, 'sine', 0.08, undefined, i * 0.05));
  }
  boost() {
    this.noise(0.7, 0.16, 260, 'bandpass', 1800);
  }
  shoot() {
    this.tone(700, 0.25, 'triangle', 0.07, 180);
    this.noise(0.3, 0.08, 1400, 'bandpass', 400);
  }
  ice() {
    this.tone(1320, 0.3, 'sine', 0.06, 1760);
    this.tone(1760, 0.2, 'sine', 0.035, 1100, 0.05);
  }
  explosion() {
    this.noise(1.0, 0.38, 700, 'lowpass', 60);
    this.tone(110, 0.6, 'sine', 0.24, 30);
  }
  crash() {
    this.noise(0.35, 0.28, 900, 'lowpass', 150);
    this.tone(85, 0.25, 'sine', 0.12, 40);
  }
  shield() {
    this.tone(392, 0.4, 'sine', 0.08, 784);
  }
  splat() {
    this.noise(0.4, 0.16, 450, 'lowpass', 100);
  }
  drop() {
    this.tone(300, 0.15, 'sine', 0.09, 150);
  }
  fall() {
    this.tone(520, 1.0, 'sine', 0.08, 90);
  }
  land() {
    this.noise(0.2, 0.18, 350, 'lowpass');
  }
  lap() {
    [659, 880].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.07, undefined, i * 0.12));
  }
  finish() {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.08, undefined, i * 0.12));
  }
  hit() {
    this.tone(196, 0.3, 'sine', 0.12, 80);
  }
  /** soft exhaust burble when lifting off at high rpm (rate-limited so it never machine-guns) */
  backfire() {
    if (!this.ctx || this.ctx.currentTime < this.backfireT) return;
    this.backfireT = this.ctx.currentTime + 0.9;
    this.noise(0.09, 0.1, 420, 'lowpass', 140);
  }
  /** cheering crowd for the intro */
  crowd() {
    for (let i = 0; i < 6; i++) this.noise(1.4, 0.045, 800 + i * 200, 'bandpass', 650 + i * 160, i * 0.25);
  }
  /** soft radar ping: a missile is locked on the player */
  warn(urgent: boolean) {
    this.tone(urgent ? 988 : 784, 0.09, 'sine', 0.05);
  }
  /** barricade smashed into pieces */
  smash() {
    this.noise(0.5, 0.3, 1800, 'bandpass', 300);
    this.tone(150, 0.2, 'sine', 0.13, 60);
  }
  rebuild() {
    this.tone(523, 0.12, 'sine', 0.04, 784);
  }
  takeoff() {
    this.noise(1.2, 0.16, 200, 'bandpass', 1600);
    this.tone(300, 0.8, 'triangle', 0.04, 700);
  }
  dodge() {
    this.noise(0.4, 0.14, 700, 'bandpass', 2500);
  }
}

export const audio = new AudioEngine();
