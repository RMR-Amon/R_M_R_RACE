/** Tiny synthesized sound engine — no audio files needed */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  startEngine() {
    if (!this.ctx || !this.master || this.engineOsc) return;
    const c = this.ctx;
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = c.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineOsc = c.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc2 = c.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();
  }

  updateEngine(speedRatio: number, throttle: number) {
    if (!this.ctx || !this.engineOsc || !this.engineOsc2 || !this.engineGain || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const f = 45 + speedRatio * 110 + throttle * 12;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(400 + speedRatio * 1400, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.05 + throttle * 0.035, t, 0.1);
  }

  stopEngine() {
    try {
      this.engineOsc?.stop();
      this.engineOsc2?.stop();
    } catch {
      /* already stopped */
    }
    this.engineGain?.disconnect();
    this.engineOsc = this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
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

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', slideTo?: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const c = this.ctx;
    const t = c.currentTime;
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
}

export const audio = new AudioEngine();
