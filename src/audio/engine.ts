// The sound engine: everything synthesized with the Web Audio API — no sample, nothing downloaded.
//
//   voices ─┬─ beeps (the flight computer) ──────────────┐
//           ├─ engine (main engine: rumble, roar, sub) ──┤→ listener (cockpit / outside, air) ─┐
//           ├─ rcs (thruster hiss, valve pops) ──────────┘                                    ├→ master → limiter → out
//           ├─ ambience (life support, reaction wheels, wind) ────────────────────────────────┤
//           └─ ui (clicks) ────────────────────────────────────────────────────────────────────┘
//   a small procedural room (convolution) gives the beeps and the thrusters the cabin they ring in.
//   the main engine is placed (PLAN-AUDIO S1, audio/space.ts): a panner at its nozzles — equal-power, or HRTF
//   with headphones —, the air's absorption over the distance, its Doppler from a spectator's view.
//   its roar granular (S2, audio/rocket.ts in an AudioWorklet: the exhaust's eddies as grains, the Mach
//   waves' crackle in the air); without worklets, the filtered noises before it.
//
// The context starts on the first user gesture (browsers keep audio off until then) and sleeps
// while the page is hidden.

export type Cue =
  | "sas-on"
  | "sas-off"
  | "hold"
  | "hold-off"
  | "auto-on"
  | "auto-off"
  | "warp-up"
  | "warp-down"
  | "target"
  | "soi"
  | "node-tick"
  | "node-go"
  | "burn-end"
  | "touchdown"
  | "liftoff"
  | "error"
  | "notify"
  | "precision-on"
  | "precision-off"
  | "mount"
  | "click"
  | "hover"
  | "open"
  | "close"
  | "crash"
  | "arrive"
  | "wormhole"
  | "boom"
  | "dock"
  | "undock"
  | "transonic";

export interface Mix {
  master: number;
  beeps: number;
  engines: number;
  ambience: number;
  ui: number;
  /** the voices played here (TARS's — PLAN-TARS T5 —) and the radio's frame round the system's ones (T1) */
  voice: number;
  /** the score (PLAN-TARS T4) */
  music: number;
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
  /** the camera hears the ship through its hull — in the cabin or on the structure (true) — or outside */
  inside: boolean;
  /** where the main engine is from the ear (none: straight behind, near) */
  space?: EngineSpace | null;
  /** the attitude thrusters by cluster (S3): each one's place from the ear [m] and how hard it fires 0…1
   *  — none: the single RCS voice, panned to the side that fires */
  rcsClusters?: { pos: [number, number, number]; level: number }[] | null;
  /** the cabin (S4): how the camera hears the ship (the cabin's air, the hull's structure, outside), the
   *  load the crew feels [g], the hull's heating [K/s], where the panel's screens are from the ear */
  hearing?: "cabin" | "hull" | "outside";
  g?: number;
  heating?: number;
  panel?: [number, number, number] | null;
  /** on the ground (S5): each wheel's place from the ear and its load [N], the speed over the ground [m/s],
   *  the brakes 0…1; the wind at the ground [m/s] */
  ground?: { wheels: { pos: [number, number, number]; load: number }[]; speed: number; brake: number } | null;
  groundWind?: number;
  /** a station near (S6: the ISS, the Endurance): where it is from the ear [m], docked to it (its hum
   *  through the structure) */
  station?: { pos: [number, number, number]; dist: number; docked: boolean } | null;
  /** air: density relative to sea level (0: vacuum) and the airspeed [m/s] */
  air: number;
  airspeed: number;
  /** the re-entry's plasma, 0…1 (its roar) */
  plasma?: number;
  /** someone aboard (the ship flown) */
  aboard: boolean;
  /** the simulation runs (paused / warping far: thrusters quiet) */
  live: boolean;
}

/** Where the main engine is from the ear (audio/space.ts): its place in the listener's frame [m], its
 *  distance, the Doppler factor, the air's low-pass there [Hz]. */
export interface EngineSpace {
  pos: [number, number, number];
  dist: number;
  dop: number;
  cutoff: number;
}

const clamp = (x: number, a = 0, b = 1) => Math.min(Math.max(x, a), b);

/** An analyser's level now (RMS, dBFS). */
function rms(a: AnalyserNode) {
  const d = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(d);
  let e = 0;
  for (const x of d) e += x * x;
  return 10 * Math.log10(e / d.length + 1e-20);
}

export class SoundEngine {
  ctx: AudioContext | null = null;
  private mix: Mix = { master: 0.7, beeps: 0.8, engines: 0.9, ambience: 0.5, ui: 0.4, voice: 0.9, music: 0.6 };
  enabled = true;
  private busses!: Record<"master" | "beeps" | "engine" | "rcs" | "ambience" | "ui" | "room" | "listener" | "voice" | "music", GainNode>;
  /** TARS's voice being said (T5a) */
  private robotSrc: AudioBufferSourceNode | null = null;
  /** TARS's voice cut (a more urgent line) */
  stopRobot() {
    try {
      this.robotSrc?.stop();
    } catch {}
    this.robotSrc = null;
  }
  /** the radio's hiss under a line said by radio (PLAN-TARS T1), its band */
  private radioHiss: { g: GainNode; src: AudioBufferSourceNode } | null = null;
  private listenerLP!: BiquadFilterNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private slow!: AudioBuffer;
  private eng: {
    rumble: GainNode;
    rumbleLP: BiquadFilterNode;
    roar: GainNode;
    roarBP: BiquadFilterNode;
    sub: GainNode;
    subOsc: OscillatorNode;
    crackle: GainNode;
  } | null = null;
  private rcsV: { gain: GainNode; bp: BiquadFilterNode; pan: StereoPannerNode } | null = null;
  /** the engine's place: its panner, the air's low-pass after it; the pitches its Doppler shifts */
  private engSpace: { panner: PannerNode; air: BiquadFilterNode; detune: AudioParam[] } | null = null;
  /** headphones: the panners in HRTF (else equal-power) */
  private hrtf = false;
  /** the attitude thrusters' clusters (S3): a hiss and a panner each, its level last frame (the valves) */
  private clusters: { gain: GainNode; panner: PannerNode; was: number }[] = [];
  /** the cabin (S4): the hull's resonances on the listener's path, the ventilation's fan, the panel's place
   *  for the beeps; the creaks', the regulator's and the breaths' clocks */
  private cab: {
    eq1: BiquadFilterNode;
    eq2: BiquadFilterNode;
    fan: GainNode;
    beepPan: PannerNode;
    g: number;
    nextHiss: number;
    nextBreath: number;
    breathing: boolean;
  } | null = null;
  /** the granular engine (its worklet loaded), its output's gain; null: the filtered noises */
  private gran: { node: AudioWorkletNode; out: GainNode } | null = null;
  private amb: {
    hum: GainNode;
    air: GainNode;
    wheel: GainNode;
    wheelOsc: OscillatorNode;
    wheelOsc2: OscillatorNode;
    wind: GainNode;
    windBP: BiquadFilterNode;
    roar: GainNode;
    hiss: GainNode;
  } | null = null;
  private last: EngineState | null = null;
  /** the audio clock at the last update [s] */
  private lastT = 0;
  /** the ground (S5): the rolling's rumble, the tyres' hiss, the brakes' squeal (all at the wheels), the wind
   *  over the ground; each wheel's load last frame (the touchdown's chirps), the runway's joints' distance */
  private gnd: {
    pan: PannerNode;
    roll: GainNode;
    rollLP: BiquadFilterNode;
    hiss: GainNode;
    squeal: GainNode;
    wind: GainNode;
    loads: number[];
    dist: number;
  } | null = null;
  /** the station's hum (S6): its fans, its pumps, its mains' harmonics — at the station */
  private stn: { gain: GainNode; pan: PannerNode } | null = null;
  /** the audio clock at the ground's last update [s] */
  private groundT = 0;
  /** the creaks and the breaths played so far (tests) */
  private counts = { creaks: 0, breaths: 0, chirps: 0, joints: 0, docks: 0, booms: 0, transonic: 0 };
  private alarms = new Map<string, { stop: () => void }>();
  private started = false;
  meter: AnalyserNode | null = null;
  /** each bus metered (S8: the mix's balance, measured) */
  private busMeters: Record<string, AnalyserNode> = {};
  /** the output's two channels, metered apart (tests: a source's side — S1) */
  private sides: [AnalyserNode, AnalyserNode] | null = null;

  /** The output's level now (RMS, dBFS). */
  level() {
    return this.meter ? rms(this.meter) : -Infinity;
  }

  /** Each bus's level now and the output's peak (S8): RMS [dBFS] by bus, the output's peak [dBFS]. */
  /** A bus's spectrum now [dB per bin, 0 … Nyquist] (the measurements' spectrograms — PLAN-TARS T4). */
  busSpectrum(bus: string): number[] | null {
    const a = this.busMeters[bus];
    if (!a) return null;
    const d = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(d);
    return [...d];
  }

  busLevels() {
    const out: Record<string, number> = {};
    for (const [k, a] of Object.entries(this.busMeters)) out[k] = rms(a);
    let peak = 0;
    if (this.meter) {
      const d = new Float32Array(this.meter.fftSize);
      this.meter.getFloatTimeDomainData(d);
      for (const x of d) peak = Math.max(peak, Math.abs(x));
    }
    out.peak = 20 * Math.log10(peak + 1e-20);
    return out;
  }

  /** Each channel's level now (RMS, dBFS): left, right. */
  levels(): [number, number] {
    return this.sides ? [rms(this.sides[0]), rms(this.sides[1])] : [-Infinity, -Infinity];
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
    g(this.busses.voice, this.mix.voice);
    g(this.busses.music, this.mix.music);
    if (enabled && !document.hidden) void this.ctx.resume();
  }

  /** Headphones (the panners in HRTF: sources ahead, behind, above) or speakers (equal-power). */
  setHeadphones(on: boolean) {
    this.hrtf = on;
    if (this.engSpace) this.engSpace.panner.panningModel = on ? "HRTF" : "equalpower";
    for (const c of this.clusters) c.panner.panningModel = on ? "HRTF" : "equalpower";
    if (this.gnd) this.gnd.pan.panningModel = on ? "HRTF" : "equalpower";
    if (this.stn) this.stn.pan.panningModel = on ? "HRTF" : "equalpower";
  }

  /** Where the engine's panner is now, its model (tests: S1). */
  spaceState() {
    const p = this.engSpace?.panner;
    return p
      ? {
          x: p.positionX.value,
          y: p.positionY.value,
          z: p.positionZ.value,
          model: p.panningModel,
          cutoff: this.engSpace!.air.frequency.value,
          cents: this.engSpace!.detune[0]?.value ?? 0,
          engine: this.gran ? "granular" : "noise",
          cabin: this.cab
            ? {
                hull: this.cab.eq1.gain.value,
                fan: this.cab.fan.gain.value,
                breathing: this.cab.breathing,
                ...this.counts,
                roll: this.gnd?.roll.gain.value ?? 0,
                squeal: this.gnd?.squeal.gain.value ?? 0,
                wind: this.gnd?.wind.gain.value ?? 0,
                plasma: this.amb ? { roar: this.amb.roar.gain.value, hiss: this.amb.hiss.gain.value } : null,
                station: this.stn
                  ? { g: this.stn.gain.gain.value, x: this.stn.pan.positionX.value, z: this.stn.pan.positionZ.value }
                  : null,
                g: this.cab.g,
                beep: [this.cab.beepPan.positionX.value, this.cab.beepPan.positionY.value, this.cab.beepPan.positionZ.value],
              }
            : null,
          clusters: this.clusters.map((c) => ({
            x: c.panner.positionX.value,
            y: c.panner.positionY.value,
            z: c.panner.positionZ.value,
            g: c.gain.gain.value,
          })),
        }
      : null;
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
    const split = ctx.createChannelSplitter(2);
    limit.connect(split);
    this.sides = [ctx.createAnalyser(), ctx.createAnalyser()];
    this.sides.forEach((a, k) => {
      a.fftSize = 2048;
      split.connect(a, k);
    });

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
    // (the hull's own modes: what its structure carries rings at them — S4)
    const eq1 = new BiquadFilterNode(ctx, { type: "peaking", frequency: 85, Q: 2, gain: 0 });
    const eq2 = new BiquadFilterNode(ctx, { type: "peaking", frequency: 170, Q: 3, gain: 0 });
    listener.connect(this.listenerLP).connect(eq1).connect(eq2).connect(master);
    eq2.connect(room);

    // the flight computer's beeps: from the panel's screens in the cabin (S4), ahead elsewhere
    const beeps = gain(this.mix.beeps);
    const beepPan = new PannerNode(ctx, {
      panningModel: "equalpower",
      distanceModel: "inverse",
      refDistance: 1,
      rolloffFactor: 0.3,
      positionZ: -1,
    });
    beeps.connect(beepPan).connect(master);
    beepPan.connect(room);
    const engine = gain(this.mix.engines);
    // (the engine placed: a panner at its nozzles, the air's absorption after it — S1)
    const panner = new PannerNode(ctx, {
      panningModel: this.hrtf ? "HRTF" : "equalpower",
      distanceModel: "inverse",
      refDistance: 10,
      rolloffFactor: 1,
      maxDistance: 1e5,
      positionZ: 8,
    });
    const airLP = ctx.createBiquadFilter();
    airLP.type = "lowpass";
    airLP.frequency.value = 20000;
    airLP.Q.value = 0.5;
    engine.connect(panner).connect(airLP).connect(listener);
    this.engSpace = { panner, air: airLP, detune: [] };
    const rcs = gain(this.mix.engines);
    rcs.connect(listener);
    const ambience = gain(this.mix.ambience);
    ambience.connect(master);
    const ui = gain(this.mix.ui);
    ui.connect(master);
    // (the voices: TARS's, the radio's frame — not through the hull: heard as a headset hears them)
    const voice = gain(this.mix.voice);
    voice.connect(master);
    // (the score: straight to the master — music is not in the cabin)
    const music = gain(this.mix.music);
    music.connect(master);
    this.busses = { master, beeps, engine, rcs, ambience, ui, room, listener, voice, music };
    for (const [k, n] of Object.entries({ beeps, engine, rcs, ambience, listener: eq2, voice, music, master })) {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      n.connect(a);
      this.busMeters[k] = a;
    }
    // the ventilation's fan: its blades' tone and a hiss of air (S4) — inside only
    const fan = gain(0);
    const fanLP = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 900 });
    for (const [f, a] of [
      [147, 1],
      [294, 0.45],
      [441, 0.2],
    ] as const) {
      const o = new OscillatorNode(ctx, { type: "triangle", frequency: f * (1 + (Math.random() - 0.5) * 0.01) });
      const og = gain(a);
      o.connect(og).connect(fanLP);
      o.start();
    }
    fanLP.connect(fan).connect(ambience);
    this.cab = { eq1, eq2, fan, beepPan, g: 1, nextHiss: 0, nextBreath: 0, breathing: false };

    this.white = this.noise(ctx, 2, "white");
    this.brown = this.noise(ctx, 4, "brown");
    this.slow = this.noise(ctx, 4, "slow");
    this.buildEngine();
    void this.buildGranular();
    this.buildRcs();
    this.buildAmbience();
    this.buildGround();
    this.buildStation();
    if (this.last) this.update(this.last);
  }

  // ------------------------------------------------------------------------------ sources
  private noise(ctx: AudioContext, seconds: number, kind: "white" | "brown" | "slow") {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let b = 0,
        s = 0,
        target = 0;
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
        d[i] = lp * (1 - t) ** 3.2 * (i < 40 ? i / 40 : 1);
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
    const rumbleSrc = this.loop(this.brown, 0.8);
    rumbleSrc.connect(rumbleLP).connect(rumble).connect(this.busses.engine);
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
    const roarSrc = this.loop(this.white);
    roarSrc.connect(roarBP).connect(roarAmp).connect(roar).connect(this.busses.engine);
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
    // (the Doppler's pitch: the voices' detune, in cents)
    if (this.engSpace) this.engSpace.detune = [rumbleSrc.detune, roarSrc.detune, subOsc.detune];
  }

  /** The granular engine (S2): its worklet loaded (by URL next to the page), its voice into the engine's
   *  bus; the filtered noises' roar and rumble silenced from then on (the structure's sub kept). */
  private async buildGranular() {
    const ctx = this.ctx!;
    if (!ctx.audioWorklet) return;
    try {
      await ctx.audioWorklet.addModule(new URL("audio-worklet.js", location.href));
    } catch {
      return;
    }
    if (this.ctx !== ctx) return;
    const node = new AudioWorkletNode(ctx, "kerr-rocket", { numberOfInputs: 0, outputChannelCount: [1] });
    const out = ctx.createGain();
    // (the synth's full thrust at ~−15 dBFS RMS: brought to the mix's — S8: full thrust from the seat ~−12 dB
    // RMS at the output, its peaks under −3 dB; at 3.2 it held the limiter down, everything else crushed)
    out.gain.value = 1.0;
    node.connect(out).connect(this.busses.engine);
    this.gran = { node, out };
    if (this.last) this.update(this.last);
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
    // the clusters (S3): the same hiss — another stretch of the noise —, a gain and a panner each, at their
    // places on the hull
    const hp2 = ctx.createBiquadFilter();
    hp2.type = "highpass";
    hp2.frequency.value = 700;
    const pk2 = ctx.createBiquadFilter();
    pk2.type = "peaking";
    pk2.frequency.value = 2100;
    pk2.gain.value = 6;
    pk2.Q.value = 1.2;
    this.loop(this.white, 0.93).connect(hp2).connect(pk2);
    this.clusters = Array.from({ length: 8 }, () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      const panner = new PannerNode(ctx, {
        panningModel: this.hrtf ? "HRTF" : "equalpower",
        distanceModel: "inverse",
        refDistance: 4,
        rolloffFactor: 1,
        maxDistance: 1e5,
      });
      pk2.connect(g).connect(panner).connect(this.busses.rcs);
      return { gain: g, panner, was: 0 };
    });
  }

  private buildAmbience() {
    const ctx = this.ctx!;
    // life support: a mains-like hum (a few harmonics) and the air in the ducts
    const hum = ctx.createGain();
    hum.gain.value = 0;
    const humLP = ctx.createBiquadFilter();
    humLP.type = "lowpass";
    humLP.frequency.value = 260;
    for (const [f, a] of [
      [55, 1],
      [110, 0.5],
      [165, 0.25],
      [220, 0.12],
    ] as const) {
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
    // the re-entry's roar: the shock layer's low, buffeting rumble through the hull
    const roar = ctx.createGain();
    roar.gain.value = 0;
    const roarLP = ctx.createBiquadFilter();
    roarLP.type = "lowpass";
    roarLP.frequency.value = 140;
    roarLP.Q.value = 1.4;
    // (buffeting: the shock layer's level shaken by a slow random signal — S7)
    const buffet = ctx.createGain();
    buffet.gain.value = 1;
    const shake = ctx.createGain();
    shake.gain.value = 0.5;
    this.loop(this.slow, 3.2).connect(shake).connect(buffet.gain);
    this.loop(this.brown, 1.3).connect(roarLP).connect(buffet).connect(roar).connect(this.busses.listener);
    // the ionised flow's hiss along the hull (S7): bright, its level with the plasma's
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    this.loop(this.white, 1.05)
      .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 2800, Q: 0.6 }))
      .connect(hiss)
      .connect(this.busses.listener);
    this.amb = { hum, air, wheel, wheelOsc, wheelOsc2, wind, windBP, roar, hiss };
  }

  /** The ground's voices (S5): at the wheels — the rolling's rumble, the tyres' hiss, the brakes' squeal —,
   *  and the wind over the ground (through the hull, as the flight's). */
  private buildGround() {
    const ctx = this.ctx!;
    const pan = new PannerNode(ctx, {
      panningModel: this.hrtf ? "HRTF" : "equalpower",
      distanceModel: "inverse",
      refDistance: 6,
      rolloffFactor: 1,
      positionY: -5,
    });
    pan.connect(this.busses.listener);
    const roll = ctx.createGain();
    roll.gain.value = 0;
    const rollLP = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 80, Q: 0.9 });
    this.loop(this.brown, 1.1).connect(rollLP).connect(roll).connect(pan);
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    this.loop(this.white, 0.8)
      .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 900, Q: 0.8 }))
      .connect(hiss)
      .connect(pan);
    // (the brakes: a squeal wavering — a disc's resonance, the anti-skid's pulses under it)
    const squeal = ctx.createGain();
    squeal.gain.value = 0;
    const so = new OscillatorNode(ctx, { type: "sine", frequency: 1180 });
    const vib = new OscillatorNode(ctx, { type: "sine", frequency: 6.5 });
    const vibG = new GainNode(ctx, { gain: 35 });
    vib.connect(vibG).connect(so.frequency);
    so.connect(squeal).connect(pan);
    so.start();
    vib.start();
    const wind = ctx.createGain();
    wind.gain.value = 0;
    this.loop(this.white, 0.6)
      .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 320, Q: 0.7 }))
      .connect(wind)
      .connect(this.busses.listener);
    this.gnd = { pan, roll, rollLP, hiss, squeal, wind, loads: [], dist: 0 };
  }

  /** A station's hum (S6): its mains' harmonics, its coolant pumps' whine wavering, its fans' air. */
  private buildStation() {
    const ctx = this.ctx!;
    const pan = new PannerNode(ctx, {
      panningModel: this.hrtf ? "HRTF" : "equalpower",
      distanceModel: "inverse",
      refDistance: 12,
      rolloffFactor: 1,
    });
    const gain = new GainNode(ctx, { gain: 0 });
    gain.connect(pan).connect(this.busses.listener);
    const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 1200 });
    lp.connect(gain);
    for (const [f, a] of [
      [60, 1],
      [120, 0.6],
      [180, 0.3],
      [240, 0.15],
    ] as const) {
      const o = new OscillatorNode(ctx, { type: "sine", frequency: f * (1 + (Math.random() - 0.5) * 0.003) });
      o.connect(new GainNode(ctx, { gain: a })).connect(lp);
      o.start();
    }
    const pump = new OscillatorNode(ctx, { type: "triangle", frequency: 385 });
    const wob = new OscillatorNode(ctx, { type: "sine", frequency: 0.3 });
    wob.connect(new GainNode(ctx, { gain: 6 })).connect(pump.frequency);
    pump.connect(new GainNode(ctx, { gain: 0.12 })).connect(lp);
    pump.start();
    wob.start();
    this.loop(this.white, 0.55)
      .connect(new BiquadFilterNode(ctx, { type: "lowpass", frequency: 600 }))
      .connect(new GainNode(ctx, { gain: 0.5 }))
      .connect(gain);
    this.stn = { gain, pan };
  }

  /** A sonic boom heard where the Mach cone sweeps the listener (S7): its N-wave — the bow's shock (the
   *  pressure's leap up), the fall, the tail's shock (its leap back): the "double bang", `gap` [s] apart (0.06
   *  s at least) —, `level` 0…1 (the distance's). */
  boomAt(level: number, gap: number) {
    if (!this.running || !this.enabled) return;
    this.nwave(this.busses.master, 0.95 * clamp(level), 0, Math.max(gap, 0.06));
    this.counts.booms++;
  }

  /** A boom's N-wave, `dur` [s] long: the pressure leaping up, falling linearly below, leaping back; a low
   *  rumble after it (the ground's echo). */
  private nwave(out: AudioNode, level: number, at: number, dur: number) {
    const ctx = this.ctx!;
    const R = ctx.sampleRate;
    const n = Math.round(R * dur);
    const buf = ctx.createBuffer(1, n, R);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = 1 - (2 * i) / (n - 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 1800 });
    const g = new GainNode(ctx, { gain: level });
    src.connect(lp).connect(g).connect(out);
    src.start(ctx.currentTime + at);
    this.burst(out, level * 0.5, 60, 1.2, 0.6, at + dur);
  }

  /** A tyre touching at speed: its chirp — the rubber dragged up to the wheel's speed —, at the wheel. */
  private chirp(at: [number, number, number], k: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const p = new PannerNode(ctx, {
      panningModel: this.hrtf ? "HRTF" : "equalpower",
      distanceModel: "inverse",
      refDistance: 6,
      positionX: at[0],
      positionY: at[1],
      positionZ: at[2],
    });
    p.connect(this.busses.listener);
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const bp = new BiquadFilterNode(ctx, { type: "bandpass", Q: 3 });
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * k, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(bp).connect(g).connect(p);
    src.start(t, Math.random());
    src.stop(t + 0.5);
    this.burst(p, 0.5 * k, 140, 0.25, 0.8);
    this.counts.chirps++;
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

    // the engine's place: where it is, the air between, its Doppler (S1)
    const sp = this.engSpace;
    if (sp) {
      const at = s.space?.pos ?? [0, 0, 8];
      set(sp.panner.positionX, at[0], 0.03);
      set(sp.panner.positionY, at[1], 0.03);
      set(sp.panner.positionZ, at[2], 0.03);
      set(sp.air.frequency, s.space?.cutoff ?? 20000, 0.1);
      const cents = 1200 * Math.log2(s.space?.dop ?? 1);
      for (const d of sp.detune) set(d, cents, 0.1);
    }

    // main engine: granular (its worklet's controls), else the filtered noises
    const th = clamp(s.throttle) * live;
    const e = this.eng;
    const g = this.gran;
    if (g) {
      const P = g.node.parameters;
      set(P.get("throttle")!, th, 0.05);
      set(P.get("air")!, clamp(s.air, 0, 2), 0.2);
      set(P.get("pitch")!, s.space?.dop ?? 1, 0.1);
    }
    const old = g ? 0 : 1;
    set(e.rumble.gain, old * 0.9 * Math.sqrt(th), 0.08);
    set(e.rumbleLP.frequency, 90 + 260 * th, 0.1);
    set(e.roar.gain, old * (0.32 * th + 0.25 * th * air), 0.08);
    set(e.roarBP.frequency, 380 + 1200 * th + 1500 * air * th, 0.15);
    set(e.crackle.gain, 0.6 * th, 0.1);
    set(e.sub.gain, 0.25 * Math.sqrt(th), 0.08);
    set(e.subOsc.frequency, 36 + 14 * th, 0.2);
    // ignition and shutdown: a thump / a sigh
    const was = prev ? clamp(prev.throttle) * (prev.live ? 1 : 0) : 0;
    if (was < 0.02 && th >= 0.02) this.ignition(th);
    else if (was >= 0.05 && th < 0.02) this.cutoff();

    // RCS: by cluster, each where it sits (S3) — else the single voice, panned to the side that fires
    const cl = s.rcsClusters;
    this.clusters.forEach((c, k) => {
      const q = cl?.[k];
      const lv = q ? clamp(q.level) * live : 0;
      if (q) {
        set(c.panner.positionX, q.pos[0], 0.02);
        set(c.panner.positionY, q.pos[1], 0.02);
        set(c.panner.positionZ, q.pos[2], 0.02);
      }
      set(c.gain.gain, 0.5 * lv, 0.015);
      if (c.was < 0.05 && lv >= 0.05) this.valve(0, true, c.panner);
      else if (c.was >= 0.05 && lv < 0.05) this.valve(0, false, c.panner);
      c.was = lv;
    });
    const r = cl ? 0 : clamp(s.rcs) * live;
    set(this.rcsV.gain.gain, 0.9 * r, 0.02);
    set(this.rcsV.pan.pan, clamp(s.rcsPan, -1, 1) * 0.7, 0.05);
    set(this.rcsV.bp.frequency, 1500 + 900 * r, 0.05);
    const rWas = prev ? clamp(prev.rcs) * (prev.live ? 1 : 0) : 0;
    if (!cl && rWas < 0.05 && r >= 0.05) this.valve(s.rcsPan, true);
    else if (!cl && rWas >= 0.05 && r < 0.05) this.valve(s.rcsPan, false);

    // the cabin (S4): the hull's modes, the fan, the panel's beeps, the structure's creaks under the load and
    // the heat, the pressure regulator's sigh, the crew's breathing past 4 g
    const C = this.cab;
    const hear = s.hearing ?? (s.inside ? "cabin" : "outside");
    if (C) {
      const cabin = hear === "cabin" && s.aboard;
      set(C.eq1.gain, hear === "cabin" ? 5 : hear === "hull" ? 3 : 0, 0.3);
      set(C.eq2.gain, hear === "cabin" ? 4 : 0, 0.3);
      set(C.fan.gain, cabin ? 0.012 : 0, 0.5);
      const pp = cabin && s.panel ? s.panel : [0, 0, -1];
      set(C.beepPan.positionX, pp[0]!, 0.05);
      set(C.beepPan.positionY, pp[1]!, 0.05);
      set(C.beepPan.positionZ, pp[2]!, 0.05);
      const g = Math.max(s.g ?? 1, 0);
      const dt = prev ? Math.min(Math.max(t - (this.lastT || t), 0), 0.25) : 0;
      this.lastT = t;
      const dg = dt > 0 ? Math.abs(g - C.g) / dt : 0;
      C.g += (g - C.g) * Math.min(1, dt * 4);
      if (live && s.aboard && hear !== "outside" && dt > 0) {
        // (the structure creaks: as the load changes, under a heavy one, as the hull heats — a few a second
        // at most)
        const stress = Math.min(
          1.5 * Math.min(dg / 2, 1) + 0.25 * Math.max(g - 1.5, 0) + 0.15 * Math.min(Math.abs(s.heating ?? 0) / 20, 1),
          3,
        );
        if (Math.random() < stress * dt)
          this.creak(Math.min(0.15 + 0.25 * stress, 0.8) * (hear === "cabin" ? 1 : 0.6), (s.heating ?? 0) > 5);
        // (the pressure regulator: a soft sigh every half minute or so)
        if (cabin && t > C.nextHiss) {
          if (C.nextHiss > 0) this.burst(this.busses.ambience, 0.05, 2600, 1.4, 0.7);
          C.nextHiss = t + 25 + 20 * Math.random();
        }
      }
      // (breathing against the load: past 4 g, out of it under 3.6; faster and harder as it grows)
      C.breathing = cabin && live > 0 && (C.breathing ? C.g > 3.6 : C.g > 4);
      if (C.breathing && t > C.nextBreath) {
        const k = Math.min((C.g - 3.6) / 4, 1);
        this.breath(0.12 + 0.3 * k, k);
        C.nextBreath = t + Math.max(3.2 - 1.8 * k, 1.2);
      }
    }

    // the ground (S5): rolling, its tyres, the brakes, the joints of the runway's slabs; the touchdown's
    // chirps; the wind over the ground
    const Gd = this.gnd;
    const G = s.ground;
    if (Gd) {
      const on = !!G && G.wheels.some((w) => w.load > 0) && live > 0;
      const v = on ? G!.speed : 0;
      const n = G?.wheels.length ?? 0;
      if (G && n) {
        const c = [0, 1, 2].map((k) => G.wheels.reduce((m, w) => m + w.pos[k]! / n, 0));
        set(Gd.pan.positionX, c[0]!, 0.05);
        set(Gd.pan.positionY, c[1]!, 0.05);
        set(Gd.pan.positionZ, c[2]!, 0.05);
      }
      set(Gd.roll.gain, on ? 1.1 * Math.min(v / 80, 1) ** 0.8 : 0, 0.08);
      set(Gd.rollLP.frequency, 50 + 2.5 * v, 0.1);
      set(Gd.hiss.gain, on ? 0.2 * Math.min(v / 100, 1) : 0, 0.08);
      set(Gd.squeal.gain, on && (G?.brake ?? 0) > 0 && v > 4 ? 0.018 * Math.min(v / 40, 1) : 0, 0.15);
      set(Gd.wind.gain, s.aboard && G?.wheels.some((w) => w.load > 0) ? 0.3 * Math.min((s.groundWind ?? 0) / 15, 1) : 0, 0.5);
      G?.wheels.forEach((w, k) => {
        if ((Gd.loads[k] ?? 0) <= 0 && w.load > 0 && G.speed > 15 && live) this.chirp(w.pos, Math.min(G.speed / 100, 1));
        Gd.loads[k] = w.load;
      });
      if (!G) Gd.loads = [];
      // (the slabs' joints every 15 m: a thump at the wheels, the rumble's beat)
      const dtG = prev ? Math.min(Math.max(t - this.groundT, 0), 0.25) : 0;
      this.groundT = t;
      if (on && v > 3) {
        Gd.dist += v * dtG;
        if (Gd.dist > 15) {
          Gd.dist %= 15;
          this.burst(Gd.pan, 0.25 * Math.min(v / 60, 1), 90, 0.09, 1.2);
          this.counts.joints++;
        }
      }
    }

    // a station near (S6): its hum at it — through the structure, docked; else a game's licence, dulled
    const St = this.stn;
    if (St) {
      const q = s.station;
      if (q) {
        set(St.pan.positionX, q.pos[0], 0.05);
        set(St.pan.positionY, q.pos[1], 0.05);
        set(St.pan.positionZ, q.pos[2], 0.05);
      }
      set(St.gain.gain, !q || !s.aboard ? 0 : q.docked ? 0.09 : q.dist < 400 ? 0.035 : 0, 0.6);
    }

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
    set(a.roar.gain, aboard * 2.2 * clamp(s.plasma ?? 0) ** 1.5, 0.3);
    set(a.hiss.gain, aboard * 0.18 * clamp(s.plasma ?? 0) ** 2, 0.3);
  }

  /** The structure creaking: a groan (a resonance gliding down) — or, as the hull heats, the ticks of the
   *  panels expanding. */
  private creak(level: number, thermal: boolean) {
    this.counts.creaks++;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.busses.ambience;
    if (thermal && Math.random() < 0.6) {
      // (a few ticks, a metal panel's)
      const n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) this.burst(out, level * 0.7, 2200 + 1800 * Math.random(), 0.03, 6, k * (0.04 + 0.08 * Math.random()));
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f0 = 180 + 700 * Math.random();
    const bp = new BiquadFilterNode(ctx, { type: "bandpass", Q: 18 });
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f0 * (0.6 + 0.25 * Math.random()), t + 0.35);
    const g = ctx.createGain();
    const dur = 0.18 + 0.35 * Math.random();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** A breath under load (`k` 0…1: the strain): the inhalation through the teeth, a held grunt, the
   *  exhalation — noise through the mouth's formants. */
  private breath(level: number, k: number) {
    this.counts.breaths++;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.busses.ambience;
    const part = (at: number, dur: number, f0: number, f1: number, q: number, lv: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.white;
      const bp = new BiquadFilterNode(ctx, { type: "bandpass", Q: q });
      bp.frequency.setValueAtTime(f0, t + at);
      bp.frequency.linearRampToValueAtTime(f1, t + at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(lv, t + at + dur * 0.35);
      g.gain.linearRampToValueAtTime(0, t + at + dur);
      src.connect(bp).connect(g).connect(out);
      src.start(t + at, Math.random());
      src.stop(t + at + dur + 0.05);
    };
    const inh = 0.55 - 0.2 * k;
    part(0, inh, 1400, 2100, 2.5, level);
    // (the strain's grunt: the glottis closed against the load — the anti-g manoeuvre)
    if (k > 0.25) {
      const o = new OscillatorNode(ctx, { type: "sawtooth", frequency: 95 + 20 * k });
      const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 500 });
      const g = ctx.createGain();
      const at = t + inh + 0.05;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level * 0.25 * k, at + 0.05);
      g.gain.linearRampToValueAtTime(0, at + 0.28);
      o.connect(lp).connect(g).connect(out);
      o.start(at);
      o.stop(at + 0.32);
    }
    part(inh + 0.12 + 0.2 * k, 0.6 - 0.15 * k, 900, 600, 2, level * 0.8);
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

  /** An RCS valve: a pop when it opens, a softer one when it shuts — panned, or into a cluster's panner. */
  private valve(pan: number, open: boolean, at?: AudioNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = open ? 1700 : 1100;
    hp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.35 : 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.05 : 0.08));
    if (at) src.connect(hp).connect(g).connect(at);
    else {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1) * 0.7;
      src.connect(hp).connect(g).connect(p).connect(this.busses.rcs);
    }
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
  private tone(
    freq: number,
    at: number,
    dur: number,
    o: { level?: number; type?: OscillatorType; to?: number; out?: AudioNode; partial?: number; attack?: number } = {},
  ) {
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
      case "sas-on":
        T(988, 0, 0.07, { partial: 0.15 });
        T(1319, 0.08, 0.1, { partial: 0.15 });
        break;
      case "sas-off":
        T(1319, 0, 0.07, { partial: 0.15 });
        T(988, 0.08, 0.12, { partial: 0.15 });
        break;
      // (a hold: one blip, its pitch naming the mode — arg: 0…8)
      case "hold":
        T(1047 * 2 ** ((arg % 9) / 12), 0, 0.09, { level: 0.22, partial: 0.2 });
        T(1568, 0.1, 0.05, { level: 0.12 });
        break;
      case "hold-off":
        T(784, 0, 0.08, { level: 0.18 });
        break;
      case "auto-on":
        [659, 880, 1175].forEach((f, i) => T(f, i * 0.075, 0.09, { level: 0.2, partial: 0.12 }));
        break;
      case "auto-off":
        [1175, 880, 659].forEach((f, i) => T(f, i * 0.075, 0.09, { level: 0.18 }));
        break;
      case "warp-up":
        T(1400 + 90 * arg, 0, 0.035, { level: 0.14, type: "triangle" });
        break;
      case "warp-down":
        T(1100 + 60 * arg, 0, 0.035, { level: 0.14, type: "triangle" });
        break;
      case "target":
        T(1568, 0, 0.35, { level: 0.14 });
        T(2093, 0.06, 0.4, { level: 0.07 });
        break;
      case "soi":
        this.bell(784, 0);
        this.bell(1175, 0.18, 0.12);
        break;
      case "arrive":
        this.bell(988, 0, 0.16);
        this.bell(1319, 0.14, 0.13);
        this.bell(1976, 0.28, 0.08, 2.2);
        break;
      case "node-tick":
        T(1000, 0, 0.06, { level: 0.2, type: "square", partial: 0 });
        break;
      case "node-go":
        T(1500, 0, 0.45, { level: 0.2, type: "square" });
        break;
      case "burn-end":
        T(1200, 0, 0.07, { level: 0.2 });
        T(1200, 0.12, 0.07, { level: 0.2 });
        break;
      case "boom":
        this.boomAt(1, arg);
        break;
      case "transonic":
        // (aboard, through Mach 1: no boom — one's own is never heard —, the airframe's shudder)
        this.burst(this.busses.listener, 0.6, 70, 0.9, 0.7);
        this.burst(this.busses.listener, 0.35, 160, 0.6, 1.2, 0.15);
        this.counts.transonic++;
        break;
      case "touchdown":
        this.burst(this.busses.engine, 0.6, 220, 0.4, 0.7);
        T(880, 0.25, 0.08, { level: 0.18 });
        T(1320, 0.36, 0.14, { level: 0.18 });
        break;
      case "liftoff":
        T(660, 0, 0.1, { level: 0.18 });
        T(990, 0.12, 0.1, { level: 0.18 });
        T(1320, 0.24, 0.18, { level: 0.18 });
        break;
      case "error":
        T(185, 0, 0.18, { level: 0.2, type: "square" });
        T(175, 0.2, 0.22, { level: 0.2, type: "square" });
        break;
      case "notify":
        T(1175, 0, 0.08, { level: 0.1 });
        T(1568, 0.07, 0.14, { level: 0.08 });
        break;
      case "precision-on":
        T(2093, 0, 0.04, { level: 0.1 });
        T(2637, 0.05, 0.05, { level: 0.1 });
        break;
      case "precision-off":
        T(2637, 0, 0.04, { level: 0.1 });
        T(2093, 0.05, 0.05, { level: 0.1 });
        break;
      case "mount":
        this.burst(this.busses.ui, 0.12, 1800, 0.08, 1.5);
        T(740, 0.02, 0.06, { level: 0.08, out: this.busses.ui });
        break;
      case "click":
        this.burst(this.busses.ui, 0.2, 3200, 0.025, 3);
        break;
      case "hover":
        this.burst(this.busses.ui, 0.05, 4800, 0.015, 4);
        break;
      case "open":
        T(620, 0, 0.06, { level: 0.08, to: 900, out: this.busses.ui });
        break;
      case "close":
        T(900, 0, 0.06, { level: 0.07, to: 600, out: this.busses.ui });
        break;
      case "dock": {
        // (the capture: the rings meet — a thud through the structure —; the hooks' motor; the latches,
        // one after the other; the last one hard: hard-mated)
        const L = this.busses.listener;
        this.burst(L, 0.9, 110, 0.5, 0.8);
        this.burst(L, 0.4, 1800, 0.08, 4, 0.02);
        T(220, 0.6, 1.6, { level: 0.05, type: "sawtooth", to: 260, out: L, attack: 0.2 });
        for (let k = 0; k < 6; k++) this.burst(L, 0.35, 2400 - 150 * k, 0.04, 6, 2.3 + 0.18 * k);
        this.burst(L, 0.8, 150, 0.35, 0.9, 3.5);
        this.counts.docks++;
        break;
      }
      case "undock":
        // (the hooks open, the springs push: a release's clank, a soft thrust's hiss)
        this.burst(this.busses.listener, 0.6, 600, 0.15, 3);
        this.burst(this.busses.listener, 0.7, 120, 0.4, 0.8, 0.12);
        this.burst(this.busses.listener, 0.15, 3000, 0.8, 0.6, 0.2);
        this.counts.docks++;
        break;
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
   * A radio line's frame (PLAN-TARS T1) — the system's voice cannot be filtered, the radio is heard round
   * it: at its start Quindar's intro tone (2525 Hz, 250 ms, as Apollo's capcom keyed) and the squelch's
   * click, a hiss in the voice's band while it is said; at its end the outro tone (2475 Hz) and the
   * squelch's tail. `static` 0…1: the hiss louder (a radio blackout's, T3).
   */
  radio(on: boolean, staticLevel = 0) {
    if (!this.running || !this.enabled) return;
    const ctx = this.ctx!;
    const out = this.busses.voice;
    const t = ctx.currentTime;
    if (!this.radioHiss) {
      const src = ctx.createBufferSource();
      src.buffer = this.white;
      src.loop = true;
      const bp = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1800, Q: 0.7 });
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(bp).connect(g).connect(out);
      src.start();
      this.radioHiss = { g, src };
    }
    const hiss = 0.012 + 0.16 * Math.min(Math.max(staticLevel, 0), 1);
    this.radioHiss.g.gain.setTargetAtTime(on ? hiss : 0, t, on ? 0.02 : 0.08);
    this.tone(on ? 2525 : 2475, 0, 0.25, { level: 0.07, type: "sine", out });
    this.burst(out, 0.09, 2600, on ? 0.06 : 0.14, 0.8, on ? 0.25 : 0);
  }

  /** The score's way out (audio/music.ts): the context and the music bus, once the sound runs. */
  musicOut(): { ctx: AudioContext; bus: GainNode } | null {
    return this.running && this.enabled && this.ctx ? { ctx: this.ctx, bus: this.busses.music } : null;
  }

  /**
   * TARS's voice played (PLAN-TARS T5a): the samples of audio/formant.ts through a robot's timbre — the
   * voice's presence lifted, a short metallic comb (a small resonant chassis), a gentle saturation — placed
   * behind the pilot on the right in the cabin (his seat), ahead from outside; on the voice bus. Resolves
   * when it has been said (null: the sound not running).
   */
  playRobot(samples: Float32Array, sampleRate: number, inside: boolean): Promise<void> | null {
    if (!this.running || !this.enabled || !this.ctx) return null;
    const ctx = this.ctx;
    const src = robotVoice(ctx, samples, sampleRate, this.busses.voice, inside, this.hrtf);
    this.robotSrc = src;
    return new Promise((done) => {
      src.onended = () => {
        if (this.robotSrc === src) this.robotSrc = null;
        done();
      };
    });
  }

  /** The radio's hiss alone, held (the blackout's static — PLAN-TARS T3): 0 off … 1 loud. */
  radioNoise(level: number) {
    if (!this.running || !this.enabled) return;
    if (!this.radioHiss) {
      this.radio(true, 0);
      this.radio(false);
    }
    this.radioHiss!.g.gain.setTargetAtTime(level > 0 ? 0.012 + 0.16 * Math.min(level, 1) : 0, this.ctx!.currentTime, 0.3);
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

/** TARS's voice's chain (PLAN-TARS T5a): its samples, the robot's timbre — the presence lifted, a short
 *  metallic comb (a small resonant chassis), a gentle saturation —, placed (his seat in the cabin, ahead from
 *  outside), into `out`; started. Its source (to stop it). Any context: the game's, or an offline one (its
 *  measurement). */
export function robotVoice(
  ctx: BaseAudioContext,
  samples: Float32Array,
  sampleRate: number,
  out: AudioNode,
  inside: boolean,
  hrtf: boolean,
): AudioBufferSourceNode {
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = new AudioBufferSourceNode(ctx, { buffer: buf });
  const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 110, Q: 0.7 });
  const pres = new BiquadFilterNode(ctx, { type: "peaking", frequency: 2600, Q: 1, gain: 4 });
  const dry = new GainNode(ctx, { gain: 0.8 });
  const comb = new DelayNode(ctx, { delayTime: 0.0045 });
  const fb = new GainNode(ctx, { gain: 0.32 });
  const wet = new GainNode(ctx, { gain: 0.3 });
  const shape = new WaveShaperNode(ctx, { curve: robotCurve() });
  const pan = new PannerNode(ctx, {
    panningModel: hrtf ? "HRTF" : "equalpower",
    distanceModel: "inverse",
    refDistance: 1,
    rolloffFactor: 0.2,
    positionX: inside ? 0.7 : 0,
    positionY: inside ? -0.1 : 0,
    positionZ: inside ? 0.5 : -1,
  });
  src.connect(hp).connect(pres);
  pres.connect(dry).connect(shape);
  pres.connect(comb).connect(fb).connect(comb);
  comb.connect(wet).connect(shape);
  shape.connect(pan).connect(out);
  src.start();
  src.addEventListener("ended", () => setTimeout(() => pan.disconnect(), 300));
  return src;
}

/** A soft saturation's curve (TARS's voice: a little grit, its peaks rounded). */
let curve: Float32Array<ArrayBuffer> | null = null;
function robotCurve() {
  if (curve) return curve;
  curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(1.8 * x) / Math.tanh(1.8);
  }
  return curve;
}

/** (a hot reload replaces the engine: the old one is silenced, not left humming underneath) */
const g = globalThis as { __sound?: SoundEngine };
g.__sound?.dispose();
export const sound = (g.__sound = new SoundEngine());
