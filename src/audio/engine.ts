// The sound engine: everything synthesized with the Web Audio API — no sample, nothing downloaded.
//
//   voices ─┬─ beeps (the flight computer) ──────────────┐
//           ├─ engine (main engine: rumble, roar, sub) ──┤→ listener (cockpit / outside, air) ─┐
//           ├─ rcs (thruster hiss, valve pops) ──────────┘                                    ├→ master → limiter → out
//           ├─ ambience (life support, reaction wheels, wind) ────────────────────────────────┤
//           └─ ui (clicks) ────────────────────────────────────────────────────────────────────┘
//   a small procedural room (convolution) gives the beeps and the thrusters the cabin they ring in.
//
// The context starts on the first user gesture (browsers keep audio off until then) and sleeps
// while the page is hidden.

export type Cue =
  | "sas-on" | "sas-off" | "hold" | "hold-off" | "auto-on" | "auto-off" | "warp-up" | "warp-down"
  | "target" | "soi" | "node-tick" | "node-go" | "burn-end" | "touchdown" | "liftoff" | "error"
  | "notify" | "precision-on" | "precision-off" | "mount" | "click" | "hover" | "open" | "close"
  | "crash" | "arrive" | "wormhole";

export interface Mix {
  master: number;
  beeps: number;
  engines: number;
  ambience: number;
  ui: number;
}

/** What the thrusters and the cabin are doing now (set every frame by the director). */
export interface EngineState {
  /** main engine throttle actually applied, 0…1 */
  throttle: number;
  /** RCS firing: translation and rotation command magnitudes (0…1), and where it pushes (−1 left … 1 right) */
  rcs: number;
  rcsPan: number;
  /** reaction wheels: angular speed of the ship [rad/s] and its change */
  spin: number;
  torque: number;
  /** the camera is in the cabin (true) or outside */
  inside: boolean;
  /** air: density relative to sea level (0: vacuum) and the airspeed [m/s] */
  air: number;
  airspeed: number;
  /** someone aboard (the ship flown) */
  aboard: boolean;
  /** the simulation runs (paused / warping far: thrusters quiet) */
  live: boolean;
}

const clamp = (x: number, a = 0, b = 1) => Math.min(Math.max(x, a), b);

export class SoundEngine {
  ctx: AudioContext | null = null;
  private mix: Mix = { master: 0.7, beeps: 0.8, engines: 0.9, ambience: 0.5, ui: 0.4 };
  enabled = true;
  private busses!: Record<"master" | "beeps" | "engine" | "rcs" | "ambience" | "ui" | "room" | "listener", GainNode>;
  private listenerLP!: BiquadFilterNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private slow!: AudioBuffer;
  private eng: {
    rumble: GainNode; rumbleLP: BiquadFilterNode; roar: GainNode; roarBP: BiquadFilterNode; sub: GainNode; subOsc: OscillatorNode;
    crackle: GainNode;
  } | null = null;
  private rcsV: { gain: GainNode; bp: BiquadFilterNode; pan: StereoPannerNode } | null = null;
  private amb: { hum: GainNode; air: GainNode; wheel: GainNode; wheelOsc: OscillatorNode; wheelOsc2: OscillatorNode; wind: GainNode; windBP: BiquadFilterNode } | null = null;
  private last: EngineState | null = null;
  private alarms = new Map<string, { stop: () => void }>();
  private started = false;
  meter: AnalyserNode | null = null;

  /** The output's level now (RMS, dBFS). */
  level() {
    if (!this.meter) return -Infinity;
    const d = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(d);
    let e = 0;
    for (const x of d) e += x * x;
    return 10 * Math.log10(e / d.length + 1e-20);
  }

  constructor() {
    const start = () => this.start();
    // (audio may only start from a user gesture)
    for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, start, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.enabled) void this.ctx.resume();
    });
  }

  dispose() {
    for (const a of this.alarms.values()) a.stop();
    this.alarms.clear();
    this.enabled = false;
    void this.ctx?.close();
    this.ctx = null;
  }

  get running() {
    return this.ctx?.state === "running";
  }

  setMix(m: Partial<Mix>, enabled = this.enabled) {
    Object.assign(this.mix, m);
    this.enabled = enabled;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = (n: GainNode, v: number) => n.gain.setTargetAtTime(v, t, 0.05);
    g(this.busses.master, enabled ? this.mix.master : 0);
    g(this.busses.beeps, this.mix.beeps);
    g(this.busses.engine, this.mix.engines);
    g(this.busses.rcs, this.mix.engines);
    g(this.busses.ambience, this.mix.ambience);
    g(this.busses.ui, this.mix.ui);
    if (enabled && !document.hidden) void this.ctx.resume();
  }

  private start() {
    if (this.started) {
      if (this.ctx?.state === "suspended" && this.enabled && !document.hidden) void this.ctx.resume();
      return;
    }
    this.started = true;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    const gain = (v: number) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    // master → a gentle bus compressor → a limiter → out
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.25;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.1;
    const master = gain(this.enabled ? this.mix.master : 0);
    master.connect(glue).connect(limit).connect(ctx.destination);
    // (a meter on the output: tests, and the level shown in the settings)
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 2048;
    limit.connect(this.meter);

    // the cabin: a short procedural room
    const room = gain(0.22);
    const conv = ctx.createConvolver();
    conv.buffer = this.roomIR(ctx, 0.55);
    room.connect(conv).connect(master);

    // what the camera hears of the ship: through the hull (inside) or through the air (outside)
    const listener = gain(1);
    this.listenerLP = ctx.createBiquadFilter();
    this.listenerLP.type = "lowpass";
    this.listenerLP.frequency.value = 2400;
    this.listenerLP.Q.value = 0.5;
    listener.connect(this.listenerLP).connect(master);
    this.listenerLP.connect(room);

    const beeps = gain(this.mix.beeps);
    beeps.connect(master);
    beeps.connect(room);
    const engine = gain(this.mix.engines);
    engine.connect(listener);
    const rcs = gain(this.mix.engines);
    rcs.connect(listener);
    const ambience = gain(this.mix.ambience);
    ambience.connect(master);
    const ui = gain(this.mix.ui);
    ui.connect(master);
    this.busses = { master, beeps, engine, rcs, ambience, ui, room, listener };

    this.white = this.noise(ctx, 2, "white");
    this.brown = this.noise(ctx, 4, "brown");
    this.slow = this.noise(ctx, 4, "slow");
    this.buildEngine();
    this.buildRcs();
    this.buildAmbience();
    if (this.last) this.update(this.last);
  }

  // ------------------------------------------------------------------------------ sources
  private noise(ctx: AudioContext, seconds: number, kind: "white" | "brown" | "slow") {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let b = 0, s = 0, target = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === "white") d[i] = w;
        else if (kind === "brown") {
          b = (b + 0.02 * w) / 1.02;
          d[i] = b * 3.5;
        } else {
          // a random walk between random levels every ~40 ms: the flicker of a flame
          if (i % Math.floor(ctx.sampleRate * 0.04) === 0) target = Math.random() * 2 - 1;
          s += (target - s) * 0.002;
          d[i] = s;
        }
      }
      // (a seamless loop: fade the ends into each other)
      const f = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < f; i++) {
        const k = i / f;
        d[i] = d[i]! * k + d[n - f + i]! * (1 - k);
      }
    }
    return buf;
  }

  private loop(buf: AudioBuffer, rate = 1) {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    src.loopEnd = buf.duration - 0.05;
    src.start(0, Math.random() * (buf.duration - 0.1));
    return src;
  }

  /** A room's impulse response: decaying noise, darker as it fades. */
  private roomIR(ctx: AudioContext, seconds: number) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const a = 1 - t * 0.9;
        lp += (Math.random() * 2 - 1 - lp) * a;
        d[i] = lp * Math.pow(1 - t, 3.2) * (i < 40 ? i / 40 : 1);
      }
    }
    return buf;
  }

  private buildEngine() {
    const ctx = this.ctx!;
    // rumble: brown noise, low-passed — the body of the burn
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    const rumbleLP = ctx.createBiquadFilter();
    rumbleLP.type = "lowpass";
    rumbleLP.frequency.value = 120;
    rumbleLP.Q.value = 0.8;
    this.loop(this.brown, 0.8).connect(rumbleLP).connect(rumble).connect(this.busses.engine);
    // roar: white noise, band-passed — the jet's hiss, brighter with the throttle
    const roar = ctx.createGain();
    roar.gain.value = 0;
    const roarBP = ctx.createBiquadFilter();
    roarBP.type = "bandpass";
    roarBP.frequency.value = 500;
    roarBP.Q.value = 0.6;
    // (a flickering flame: the roar's level modulated by a slow random signal)
    const crackle = ctx.createGain();
    crackle.gain.value = 0;
    const flick = this.loop(this.slow, 1.7);
    flick.connect(crackle);
    const roarAmp = ctx.createGain();
    roarAmp.gain.value = 1;
    crackle.connect(roarAmp.gain);
    this.loop(this.white).connect(roarBP).connect(roarAmp).connect(roar).connect(this.busses.engine);
    // sub: the structure shaking
    const sub = ctx.createGain();
    sub.gain.value = 0;
    const subOsc = ctx.createOscillator();
    subOsc.type = "sine";
    subOsc.frequency.value = 42;
    const subMod = ctx.createGain();
    subMod.gain.value = 3;
    this.loop(this.slow, 0.6).connect(subMod).connect(subOsc.frequency);
    subOsc.connect(sub).connect(this.busses.engine);
    subOsc.start();
    this.eng = { rumble, rumbleLP, roar, roarBP, sub, subOsc, crackle };
  }

  private buildRcs() {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 700;
    const bp = ctx.createBiquadFilter();
    bp.type = "peaking";
    bp.frequency.value = 1800;
    bp.gain.value = 6;
    bp.Q.value = 1.2;
    const pan = ctx.createStereoPanner();
    this.loop(this.white, 0.9).connect(hp).connect(bp).connect(gain).connect(pan).connect(this.busses.rcs);
    this.rcsV = { gain, bp, pan };
  }

  private buildAmbience() {
    const ctx = this.ctx!;
    // life support: a mains-like hum (a few harmonics) and the air in the ducts
    const hum = ctx.createGain();
    hum.gain.value = 0;
    const humLP = ctx.createBiquadFilter();
    humLP.type = "lowpass";
    humLP.frequency.value = 260;
    for (const [f, a] of [[55, 1], [110, 0.5], [165, 0.25], [220, 0.12]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(humLP);
      o.start();
    }
    humLP.connect(hum).connect(this.busses.ambience);
    const air = ctx.createGain();
    air.gain.value = 0;
    const airLP = ctx.createBiquadFilter();
    airLP.type = "lowpass";
    airLP.frequency.value = 700;
    this.loop(this.white, 0.5).connect(airLP).connect(air).connect(this.busses.ambience);
    // reaction wheels: a faint whine that follows their speed
    const wheel = ctx.createGain();
    wheel.gain.value = 0;
    const wheelOsc = ctx.createOscillator();
    wheelOsc.type = "triangle";
    wheelOsc.frequency.value = 300;
    const wheelOsc2 = ctx.createOscillator();
    wheelOsc2.type = "sine";
    wheelOsc2.frequency.value = 600;
    const w2 = ctx.createGain();
    w2.gain.value = 0.4;
    wheelOsc.connect(wheel);
    wheelOsc2.connect(w2).connect(wheel);
    wheel.connect(this.busses.ambience);
    wheelOsc.start();
    wheelOsc2.start();
    // wind: the air rushing past the hull, in an atmosphere
    const wind = ctx.createGain();
    wind.gain.value = 0;
    const windBP = ctx.createBiquadFilter();
    windBP.type = "bandpass";
    windBP.frequency.value = 400;
    windBP.Q.value = 0.9;
    this.loop(this.white, 0.7).connect(windBP).connect(wind).connect(this.busses.listener);
    this.amb = { hum, air, wheel, wheelOsc, wheelOsc2, wind, windBP };
  }

  // ------------------------------------------------------------------------------ continuous
  /** Follows the ship's state (every frame). */
  update(s: EngineState) {
    const prev = this.last;
    this.last = { ...s };
    const ctx = this.ctx;
    if (!ctx || !this.eng || !this.rcsV || !this.amb || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number, tau = 0.06) => p.setTargetAtTime(v, t, tau);
    const live = s.live ? 1 : 0;
    // in vacuum only the hull carries the sound: inside, muffled and heavy; outside, far quieter
    const air = clamp(s.air);
    // (a game's licence: outside in vacuum the ship stays audible, dulled and further away)
    const cutoff = s.inside ? 2200 + 3000 * air : 1100 + 8000 * Math.sqrt(air);
    set(this.listenerLP.frequency, cutoff, 0.2);
    set(this.busses.listener.gain, s.inside ? 1 : 0.5 + 0.5 * Math.sqrt(air), 0.2);

    // main engine
    const th = clamp(s.throttle) * live;
    const e = this.eng;
    set(e.rumble.gain, 0.9 * Math.sqrt(th), 0.08);
    set(e.rumbleLP.frequency, 90 + 260 * th, 0.1);
    set(e.roar.gain, 0.32 * th + 0.25 * th * air, 0.08);
    set(e.roarBP.frequency, 380 + 1200 * th + 1500 * air * th, 0.15);
    set(e.crackle.gain, 0.6 * th, 0.1);
    set(e.sub.gain, 0.5 * Math.sqrt(th), 0.08);
    set(e.subOsc.frequency, 36 + 14 * th, 0.2);
    // ignition and shutdown: a thump / a sigh
    const was = prev ? clamp(prev.throttle) * (prev.live ? 1 : 0) : 0;
    if (was < 0.02 && th >= 0.02) this.ignition(th);
    else if (was >= 0.05 && th < 0.02) this.cutoff();

    // RCS
    const r = clamp(s.rcs) * live;
    set(this.rcsV.gain.gain, 0.9 * r, 0.02);
    set(this.rcsV.pan.pan, clamp(s.rcsPan, -1, 1) * 0.7, 0.05);
    set(this.rcsV.bp.frequency, 1500 + 900 * r, 0.05);
    const rWas = prev ? clamp(prev.rcs) * (prev.live ? 1 : 0) : 0;
    if (rWas < 0.05 && r >= 0.05) this.valve(s.rcsPan, true);
    else if (rWas >= 0.05 && r < 0.05) this.valve(s.rcsPan, false);

    // cabin
    const a = this.amb;
    const aboard = s.aboard ? 1 : 0;
    set(a.hum.gain, aboard * (s.inside ? 0.05 : 0.012), 0.5);
    set(a.air.gain, aboard * (s.inside ? 0.05 : 0.01), 0.5);
    const wheelSpeed = clamp(Math.abs(s.spin) / 0.6);
    const wheelWork = clamp(Math.abs(s.torque) / 0.4);
    set(a.wheel.gain, aboard * live * (s.inside ? 1 : 0.2) * (0.006 + 0.03 * wheelWork) * (0.3 + wheelSpeed), 0.15);
    set(a.wheelOsc.frequency, 220 + 900 * wheelSpeed + 200 * wheelWork, 0.2);
    set(a.wheelOsc2.frequency, 2 * (220 + 900 * wheelSpeed + 200 * wheelWork) * 1.003, 0.2);
    // wind ∝ dynamic pressure (½ρv²), its pitch with the speed
    const q = clamp((air * s.airspeed * s.airspeed) / 2.5e5);
    set(a.wind.gain, aboard * 0.6 * Math.sqrt(q), 0.25);
    set(a.windBP.frequency, 200 + clamp(s.airspeed / 2000) * 1800, 0.3);
  }

  private ignition(th: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // a low thump, a burst of hiss
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7 * (0.5 + th), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g).connect(this.busses.engine);
    o.start(t);
    o.stop(t + 0.65);
    this.burst(this.busses.engine, 0.35, 900, 0.25, 0.8);
  }

  private cutoff() {
    this.burst(this.busses.engine, 0.12, 500, 0.5, 0.6);
  }

  /** An RCS valve: a pop when it opens, a softer one when it shuts. */
  private valve(pan: number, open: boolean) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = open ? 1700 : 1100;
    hp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.5 : 0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.05 : 0.08));
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1) * 0.7;
    src.connect(hp).connect(g).connect(p).connect(this.busses.rcs);
    src.start(t, Math.random());
    src.stop(t + 0.12);
  }

  /** A burst of filtered noise (a puff, a thud's tail). */
  private burst(out: AudioNode, level: number, freq: number, dur: number, q = 1, at = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.4), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------------------ beeps
  /**
   * One tone of the flight computer: a clean oscillator with a soft attack and an exponential
   * decay, a touch of a second partial (a small speaker's colour).
   */
  private tone(freq: number, at: number, dur: number, o: { level?: number; type?: OscillatorType; to?: number; out?: AudioNode; partial?: number; attack?: number } = {}) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const level = o.level ?? 0.25;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + (o.attack ?? 0.006));
    g.gain.setTargetAtTime(0, t + dur * 0.55, dur * 0.22);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    g.connect(lp).connect(o.out ?? this.busses.beeps);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + dur * 2 + 0.05);
    if (o.partial) {
      const p = ctx.createOscillator();
      p.type = "sine";
      p.frequency.setValueAtTime(freq * 2.01, t);
      if (o.to) p.frequency.exponentialRampToValueAtTime(o.to * 2.01, t + dur);
      const pg = ctx.createGain();
      pg.gain.value = o.partial;
      p.connect(pg).connect(g);
      p.start(t);
      p.stop(t + dur * 2 + 0.05);
    }
  }

  /** A bell (two-operator FM): chimes for arrivals and changes of sphere of influence. */
  private bell(freq: number, at: number, level = 0.18, dur = 1.6) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 3.5;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    car.connect(g).connect(this.busses.beeps);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  /** Plays a cue of the flight computer (or of the interface). */
  play(cue: Cue, arg = 0) {
    if (!this.running || !this.enabled) return;
    const T = (f: number, at: number, dur: number, o?: Parameters<SoundEngine["tone"]>[3]) => this.tone(f, at, dur, o);
    switch (cue) {
      case "sas-on": T(988, 0, 0.07, { partial: 0.15 }); T(1319, 0.08, 0.1, { partial: 0.15 }); break;
      case "sas-off": T(1319, 0, 0.07, { partial: 0.15 }); T(988, 0.08, 0.12, { partial: 0.15 }); break;
      // (a hold: one blip, its pitch naming the mode — arg: 0…8)
      case "hold": T(1047 * Math.pow(2, (arg % 9) / 12), 0, 0.09, { level: 0.22, partial: 0.2 }); T(1568, 0.1, 0.05, { level: 0.12 }); break;
      case "hold-off": T(784, 0, 0.08, { level: 0.18 }); break;
      case "auto-on": [659, 880, 1175].forEach((f, i) => T(f, i * 0.075, 0.09, { level: 0.2, partial: 0.12 })); break;
      case "auto-off": [1175, 880, 659].forEach((f, i) => T(f, i * 0.075, 0.09, { level: 0.18 })); break;
      case "warp-up": T(1400 + 90 * arg, 0, 0.035, { level: 0.14, type: "triangle" }); break;
      case "warp-down": T(1100 + 60 * arg, 0, 0.035, { level: 0.14, type: "triangle" }); break;
      case "target": T(1568, 0, 0.35, { level: 0.14 }); T(2093, 0.06, 0.4, { level: 0.07 }); break;
      case "soi": this.bell(784, 0); this.bell(1175, 0.18, 0.12); break;
      case "arrive": this.bell(988, 0, 0.16); this.bell(1319, 0.14, 0.13); this.bell(1976, 0.28, 0.08, 2.2); break;
      case "node-tick": T(1000, 0, 0.06, { level: 0.2, type: "square", partial: 0 }); break;
      case "node-go": T(1500, 0, 0.45, { level: 0.2, type: "square" }); break;
      case "burn-end": T(1200, 0, 0.07, { level: 0.2 }); T(1200, 0.12, 0.07, { level: 0.2 }); break;
      case "touchdown":
        this.burst(this.busses.engine, 0.6, 220, 0.4, 0.7);
        T(880, 0.25, 0.08, { level: 0.18 }); T(1320, 0.36, 0.14, { level: 0.18 });
        break;
      case "liftoff": T(660, 0, 0.1, { level: 0.18 }); T(990, 0.12, 0.1, { level: 0.18 }); T(1320, 0.24, 0.18, { level: 0.18 }); break;
      case "error": T(185, 0, 0.18, { level: 0.2, type: "square" }); T(175, 0.2, 0.22, { level: 0.2, type: "square" }); break;
      case "notify": T(1175, 0, 0.08, { level: 0.1 }); T(1568, 0.07, 0.14, { level: 0.08 }); break;
      case "precision-on": T(2093, 0, 0.04, { level: 0.1 }); T(2637, 0.05, 0.05, { level: 0.1 }); break;
      case "precision-off": T(2637, 0, 0.04, { level: 0.1 }); T(2093, 0.05, 0.05, { level: 0.1 }); break;
      case "mount": this.burst(this.busses.ui, 0.12, 1800, 0.08, 1.5); T(740, 0.02, 0.06, { level: 0.08, out: this.busses.ui }); break;
      case "click": this.burst(this.busses.ui, 0.2, 3200, 0.025, 3); break;
      case "hover": this.burst(this.busses.ui, 0.05, 4800, 0.015, 4); break;
      case "open": T(620, 0, 0.06, { level: 0.08, to: 900, out: this.busses.ui }); break;
      case "close": T(900, 0, 0.06, { level: 0.07, to: 600, out: this.busses.ui }); break;
      case "crash":
        this.burst(this.busses.engine, 1, 160, 1.4, 0.5);
        this.burst(this.busses.engine, 0.6, 1200, 0.6, 0.8, 0.05);
        break;
      case "wormhole":
        T(110, 0, 2.5, { level: 0.2, to: 55, attack: 0.6 });
        T(165, 0.2, 2.2, { level: 0.1, to: 330, attack: 0.8 });
        this.bell(523, 1.2, 0.1, 3);
        break;
    }
  }

  /**
   * A repeating alarm while `on` (e.g. a collision course, terrain): two tones, `rate` per second.
   * kind "caution": slow and soft; "warning": fast and insistent.
   */
  alarm(id: string, on: boolean, kind: "caution" | "warning" = "warning") {
    const cur = this.alarms.get(id);
    if (!on || !this.running || !this.enabled) {
      cur?.stop();
      this.alarms.delete(id);
      return;
    }
    if (cur) return;
    const period = kind === "warning" ? 0.5 : 1.6;
    let stop = false;
    const tick = () => {
      if (stop || !this.running) return;
      if (kind === "warning") {
        this.tone(950, 0, 0.16, { level: 0.2, type: "square" });
        this.tone(740, 0.2, 0.16, { level: 0.2, type: "square" });
      } else this.tone(880, 0, 0.22, { level: 0.14, type: "triangle", partial: 0.1 });
      timer = window.setTimeout(tick, period * 1000);
    };
    let timer = window.setTimeout(tick, 0);
    this.alarms.set(id, {
      stop: () => {
        stop = true;
        clearTimeout(timer);
      },
    });
  }
}

/** (a hot reload replaces the engine: the old one is silenced, not left humming underneath) */
const g = globalThis as { __sound?: SoundEngine };
g.__sound?.dispose();
export const sound = (g.__sound = new SoundEngine());
