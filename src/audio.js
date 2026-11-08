// WebAudio score: drone, rising hum, silence at the door, a chord when colour arrives.
// Everything is synthesised; there are no files to load. Must be started from a user gesture.

export class Audio {
  constructor() { this.ok = false; }

  start() {
    if (this.ok) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.ok = true;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = this._reverb(3.2);
    this.reverb.connect(this.master);

    // drone: detuned saws, low-passed
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
    this.droneFilter = ctx.createBiquadFilter(); this.droneFilter.type = 'lowpass'; this.droneFilter.frequency.value = 180; this.droneFilter.Q.value = 3;
    this.droneFilter.connect(this.droneGain).connect(this.master);
    this.droneOsc = [55, 55.4, 82.4].map((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f;
      o.connect(this.droneFilter); o.start(); return o;
    });
    // hum: a sine that rises with tension
    this.hum = ctx.createOscillator(); this.hum.type = 'sine'; this.hum.frequency.value = 110;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    this.hum.connect(this.humGain).connect(this.master); this.hum.start();
    // room tone: filtered noise
    this.noise = this._noiseSrc();
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 0.6;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
    this.noise.connect(nf).connect(this.noiseGain).connect(this.master);
    this.noise.start();

    this._ramp(this.droneGain.gain, 0.09, 3);
    this._ramp(this.noiseGain.gain, 0.012, 3);
  }

  _ramp(param, v, dur) {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(v, t + dur);
  }

  _noiseSrc() {
    const ctx = this.ctx, len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    return src;
  }

  _reverb(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = ctx.createConvolver(); conv.buffer = buf;
    return conv;
  }

  /** 0..1: pushes the drone filter open and raises the hum. */
  tension(v, dur = 4) {
    if (!this.ok) return;
    this._ramp(this.droneFilter.frequency, 180 + v * 900, dur);
    this._ramp(this.hum.frequency, 110 + v * 110, dur);
    this._ramp(this.humGain.gain, v * 0.05, dur);
    this._ramp(this.droneGain.gain, 0.09 + v * 0.05, dur);
  }

  silence(dur = 0.4) {
    if (!this.ok) return;
    this._ramp(this.droneGain.gain, 0, dur);
    this._ramp(this.humGain.gain, 0, dur);
    this._ramp(this.noiseGain.gain, 0, dur);
  }

  resume(level = 0.09, dur = 3) {
    if (!this.ok) return;
    this._ramp(this.droneGain.gain, level, dur);
    this._ramp(this.noiseGain.gain, 0.012, dur);
  }

  _tone(freq, { type = 'sine', at = 0, attack = 0.01, hold = 0.1, release = 0.3, gain = 0.1, wet = 0.3, detune = 0 } = {}) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    o.connect(g);
    g.connect(this.master);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w).connect(this.reverb); }
    o.start(t); o.stop(t + attack + hold + release + 0.05);
  }

  blip() { this._tone(1320, { type: 'sine', hold: 0.02, release: 0.12, gain: 0.03, wet: 0.2 }); }
  mention() { this._tone(880, { hold: 0.04, release: 0.2, gain: 0.05 }); this._tone(1320, { at: 0.09, hold: 0.04, release: 0.25, gain: 0.05 }); }
  click() { this._tone(220, { type: 'square', hold: 0.005, release: 0.05, gain: 0.03, wet: 0 }); }
  fail() { this._tone(98, { type: 'triangle', hold: 0.08, release: 0.35, gain: 0.12, wet: 0.2 }); }

  /** The door opens: a high, thin, clean tone. */
  door() { this._tone(1760, { attack: 1.5, hold: 1.5, release: 3, gain: 0.025, wet: 0.8 }); }

  /** Colour arrives: a wide major-9 pad. */
  chord() {
    const root = 130.81; // C3
    [1, 1.5, 2, 2.5, 3, 4.5, 6].forEach((m, i) => {
      this._tone(root * m, { type: i < 2 ? 'triangle' : 'sine', attack: 2.2, hold: 3.5, release: 5, gain: 0.05 / (1 + i * 0.3), wet: 0.9, detune: (i % 2 ? 4 : -4) });
    });
  }

  /** The report light: one soft bell nobody answers. */
  bell() { [523.25, 1046.5, 1568].forEach((f, i) => this._tone(f, { attack: 0.01, hold: 0.05, release: 3.5, gain: 0.05 / (i + 1), wet: 0.9 })); }

  glitch(amt = 1) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noiseSrc();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 2000; f.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.06 * amt, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.15);
  }

  thud() {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 1);
  }

  /** The hall: a low, slow swell. */
  hall() {
    const root = 65.41;
    [1, 1.5, 2, 3, 4].forEach((m, i) => this._tone(root * m, { type: 'sine', attack: 4, hold: 6, release: 6, gain: 0.06 / (1 + i * 0.4), wet: 0.9 }));
  }
}
