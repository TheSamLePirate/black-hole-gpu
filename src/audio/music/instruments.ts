// The orchestra's instruments, synthesized in Web Audio (any context: the game's, or an offline one to render a
// theme). Each note: its nodes made, started and stopped at its time, gone after.
//  - The strings: an ensemble of bows (several voices a note, each a hair off in pitch and time, a vibrato that
//    comes in late, the bow's noise), through a body's resonances; held, tremolo, spiccato, the solo lines (violins,
//    viola, cello), the basses.
//  - The brass: a rich wave whose brightness follows the loudness (the filter opening with the breath), a scoop
//    into the pitch; the horns, the trumpets, the braam (the low brass's cluster, distorted).
//  - Rendered once per note, then played as a buffer: the piano (inharmonic partials, two strings beating, the
//    double decay), the celesta (a bar's modes), the timpani (a membrane's modes, the mallet), the harp and the
//    pizzicato (Karplus–Strong strings).
//  - The pipe organ (its ranks as one wave, two ranks beating, the pipes' chiff, the swell box), its 32' pedal; the
//    choir (voices through a vowel's formants); the flute (its breath, its vibrato); a Shepard tone; the sub.
//  - The percussion: taiko, concert bass drum, toms, the orchestral snare and its roll, the timpani's roll, the
//    suspended cymbal swelling, the clash, the boom, the clock's tick.

import { midiHz } from "./theory";

export type Ctx = BaseAudioContext;

/** What an instrument plays into: its layer's input, and the context's shared material. */
export interface Kit {
  ctx: Ctx;
  noise: AudioBuffer;
  /** the notes rendered once (piano, celesta, timpani, harp, pizzicato), the least recently used first, and their
   *  size [samples] (kept under BUFFER_CAP) */
  buffers: Map<string, AudioBuffer>;
  bufferSamples: number;
  /** the notes rendered so far (the cost's count) */
  made: number;
  soft: Float32Array<ArrayBuffer>;
  /** the waves: the bowed string's, the brass's, the organ's ranks, the flute's */
  bowed: PeriodicWave;
  brass: PeriodicWave;
  organ: PeriodicWave;
  /** the organ's partials on its 16' (harmonic, amplitude): its short notes rendered from them */
  organPartials: [number, number][];
  flute: PeriodicWave;
  /** a chord's shared nodes (its filter, its envelope): one per chord and instrument, not per note */
  shared: Map<string, { node: AudioNode; until: number }>;
  /** an id per destination (the shared nodes' keys) */
  ids: WeakMap<AudioNode, number>;
}

/** A periodic wave from its partials' amplitudes (sine phases). */
function waveOf(ctx: Ctx, n: number, amp: (h: number) => number): PeriodicWave {
  const real = new Float32Array(n + 1),
    imag = new Float32Array(n + 1);
  for (let h = 1; h <= n; h++) imag[h] = amp(h);
  return ctx.createPeriodicWave(real, imag);
}

/** The shared material: two seconds of white noise, a soft saturation's curve, the waves. */
export function makeKit(ctx: Ctx): Kit {
  const n = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noise.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (s / 0x7fffffff) * 2 - 1;
  }
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2);
  }
  // (a bowed string: a saw's 1/n, its partials uneven as a real string's — the bow's position, the body)
  const bowed = waveOf(ctx, 48, (h) => (1 / h) * (1 + 0.28 * Math.sin(h * 1.93)) * (h % 2 ? 1 : 0.86));
  // (brass: rich, falling slower than a saw — the filter shapes it by the loudness)
  const brass = waveOf(ctx, 40, (h) => h ** -0.78 * (1 + 0.15 * Math.cos(h * 0.9)));
  // (the organ's ranks on the 16' — 16', 8', 5 1/3', 4', 2 2/3', 2', the mixture —, each pipe with its own few
  // harmonics: a principal chorus)
  const ranks: [number, number][] = [
    [1, 0.42],
    [2, 1],
    [3, 0.16],
    [4, 0.62],
    [6, 0.3],
    [8, 0.36],
    [12, 0.18],
    [16, 0.13],
  ];
  const org = new Map<number, number>();
  for (const [r, a] of ranks) for (let k = 1; k <= 5; k++) if (r * k <= 64) org.set(r * k, (org.get(r * k) ?? 0) + a / k ** 1.7);
  const organ = waveOf(ctx, 64, (h) => org.get(h) ?? 0);
  // (the flute: nearly a sine, a little second and third)
  const flute = waveOf(ctx, 6, (h) => [0, 1, 0.22, 0.09, 0.04, 0.02, 0.01][h] ?? 0);
  const organPartials = [...org.entries()].sort((a, b) => a[0] - b[0]);
  return {
    ctx,
    noise,
    buffers: new Map(),
    bufferSamples: 0,
    made: 0,
    soft: curve,
    bowed,
    brass,
    organ,
    organPartials,
    flute,
    shared: new Map(),
    ids: new WeakMap(),
  };
}

let nextId = 1;
/** A node shared by the notes of one chord (same instrument, time and destination), made once. */
function shared<T extends AudioNode>(k: Kit, inst: string, t: number, dest: AudioNode, until: number, make: () => T): T {
  let id = k.ids.get(dest);
  if (!id) k.ids.set(dest, (id = nextId++));
  const key = `${inst}|${t.toFixed(3)}|${id}`;
  const hit = k.shared.get(key);
  if (hit) {
    hit.until = Math.max(hit.until, until);
    return hit.node as T;
  }
  // (the old ones forgotten — their nodes stop with their sources)
  if (k.shared.size > 64) for (const [kk, v] of k.shared) if (v.until < t - 1) k.shared.delete(kk);
  const node = make();
  k.shared.set(key, { node, until });
  return node;
}

const osc = (k: Kit, type: OscillatorType, f: number, detune = 0) => new OscillatorNode(k.ctx, { type, frequency: f, detune });
const waveOsc = (k: Kit, w: PeriodicWave, f: number, detune = 0) => new OscillatorNode(k.ctx, { periodicWave: w, frequency: f, detune });
const gain = (k: Kit, g = 0) => new GainNode(k.ctx, { gain: g });
const panTo = (k: Kit, dest: AudioNode, pan = 0): AudioNode => {
  if (!pan) return dest;
  const p = new StereoPannerNode(k.ctx, { pan: Math.max(-1, Math.min(1, pan)) });
  p.connect(dest);
  return p;
};
function noiseSrc(k: Kit, t: number, len: number, offset = 0) {
  const s = new AudioBufferSourceNode(k.ctx, { buffer: k.noise, loop: true });
  s.start(t, Math.abs(offset) % 1.9);
  s.stop(t + len);
  return s;
}
/** A filter whose cutoff glides slowly: its coefficients computed once a block (128 samples), not each sample —
 *  inaudible for a bow's or a breath's sweep, many times cheaper. */
function slowFilter(k: Kit, o: BiquadFilterOptions): BiquadFilterNode {
  const f = new BiquadFilterNode(k.ctx, o);
  try {
    f.frequency.automationRate = "k-rate";
  } catch {
    // (a context that keeps it a-rate: as it was)
  }
  return f;
}
/** An envelope on a gain: attack, hold to the end, release (linear in, exponential out). Returns when it is silent. */
function adsr(g: GainNode, t: number, dur: number, level: number, a: number, r: number) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + Math.min(a, dur));
  g.gain.setValueAtTime(level, t + Math.max(dur, a));
  g.gain.setTargetAtTime(0, t + Math.max(dur, a), r / 3);
  return t + Math.max(dur, a) + r + 0.05;
}
/** A deterministic jitter in [−1, 1] from a few numbers (a voice's detune, its delay). */
const jit = (...x: number[]) => {
  const v = Math.sin(x.reduce((a, b, i) => a + b * (12.9898 + i * 78.233), 0)) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
};

// ------------------------------------------------------------------ the strings

interface BowOpts {
  /** voices a note (an ensemble: several), their spread [cents] and their pan's */
  voices: number;
  spread: number;
  width: number;
  /** attack, release [s]; the vibrato's depth [cents] */
  attack: number;
  release: number;
  vib: number;
  /** the bright edge's top [Hz] at full loudness */
  bright: number;
  level: number;
  /** a crescendo then a little decrescendo over the note (the elegy's long bows) */
  swell?: boolean;
  /** the bow re-struck fast (tremolo) */
  tremolo?: boolean;
  /** the chord's notes through one body (held chords); a solo line: its own */
  chord?: string;
}

/**
 * The body a bowed note sounds through, and its envelope: the bright edge opening with the bow, the wood's
 * resonances (the air's ~280 Hz, the bridge's ~2.8 kHz), the top rolled off; the bow's noise; a tremolo's
 * re-bowing. Shared by a chord's notes when `o.chord`.
 */
function bowBody(k: Kit, out: AudioNode, t: number, dur: number, vel: number, o: BowOpts) {
  let end = t + Math.max(dur, o.attack) + o.release + 0.05;
  const make = () => {
    const env = gain(k);
    if (o.swell) {
      // (the long bow: in softly, swelling to two thirds of the note, easing a little before the release)
      const lv = o.level * vel;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(lv * 0.55, t + Math.min(o.attack, dur));
      env.gain.linearRampToValueAtTime(lv, t + Math.max(o.attack, dur * 0.66));
      env.gain.linearRampToValueAtTime(lv * 0.85, t + Math.max(o.attack, dur));
      env.gain.setTargetAtTime(0, t + Math.max(o.attack, dur), o.release / 3);
      end = t + Math.max(dur, o.attack) + o.release + 0.05;
    } else end = adsr(env, t, dur, o.level * vel, o.attack, o.release);
    const lp = slowFilter(k, { type: "lowpass", frequency: 800, Q: 0.6 });
    const top = o.bright * (0.45 + 0.55 * vel);
    lp.frequency.setValueAtTime(top * 0.35, t);
    lp.frequency.linearRampToValueAtTime(top, t + Math.max(0.05, o.attack * 1.2));
    if (o.swell) lp.frequency.linearRampToValueAtTime(top * 1.15, t + Math.max(o.attack, dur * 0.66));
    const air = new BiquadFilterNode(k.ctx, { type: "peaking", frequency: 280, Q: 1.2, gain: 3 });
    const bridge = new BiquadFilterNode(k.ctx, { type: "peaking", frequency: 2800, Q: 0.9, gain: 3.5 });
    const roll = new BiquadFilterNode(k.ctx, { type: "highshelf", frequency: 6500, gain: -9 });
    const sum = gain(k, 1);
    sum.connect(lp).connect(air).connect(bridge).connect(roll);
    if (o.tremolo) {
      // (the bow's quick strokes: the level rocking ~13 times a second, unevenly)
      const tr = gain(k, 0.62);
      const lfo = osc(k, "triangle", 12.5 + 1.5 * jit(t));
      const depth = gain(k, 0.38);
      lfo.connect(depth).connect(tr.gain);
      lfo.start(t);
      lfo.stop(end);
      roll.connect(tr).connect(env);
    } else roll.connect(env);
    env.connect(out);
    // (the bow on the string: a breath of noise at the attack, a whisper after)
    // (the bow's noise only where it is heard: the attack)
    const nl = Math.min(end - t, o.attack + 0.4);
    const n = noiseSrc(k, t, nl, t * 3.7);
    const bp = new BiquadFilterNode(k.ctx, { type: "bandpass", frequency: 2600, Q: 0.7 });
    const ng = gain(k);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.05, t + Math.min(0.08, o.attack));
    ng.gain.linearRampToValueAtTime(0, t + nl);
    n.connect(bp).connect(ng).connect(sum);
    // (the section's two sides: its voices panned left and right through one panner each)
    const left = gain(k, 1),
      right = gain(k, 1);
    left.connect(panTo(k, sum, -o.width));
    right.connect(panTo(k, sum, o.width));
    return { sum, left, right };
  };
  const body = o.chord
    ? shared(k, o.chord, t, out, end, () => {
        const b = make();
        // (the shared node is the centre; its sides hang on it)
        sides.set(b.sum, b);
        return b.sum;
      })
    : null;
  const b = body ? sides.get(body)! : make();
  return { ...b, end };
}
/** A vibrato's antiphase twin, by its in-phase gain. */
const vibs = new WeakMap<GainNode, GainNode>();
/** A shared bow body's sides (its left and right voices' inputs), by its centre. */
const sides = new WeakMap<AudioNode, { sum: GainNode; left: GainNode; right: GainNode }>();

/** A bowed note: its voices into its body (a chord's, or its own). */
function bowed(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number, o: BowOpts) {
  const f = midiHz(note);
  const { sum, left, right, end } = bowBody(k, out, t, dur, vel, o);
  // (the vibrato: in late; the voices on it in and out of phase — a chord's section sharing one)
  const makeVib = () => {
    const vib = osc(k, "sine", 5.1 + 0.6 * ((note * 7) % 5) * 0.2);
    const up = gain(k),
      down = gain(k);
    for (const [g, s] of [
      [up, 1],
      [down, -0.7],
    ] as const) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(o.vib * s, t + Math.min(dur, 0.45) + 0.1);
    }
    vib.connect(up);
    vib.connect(down);
    vib.start(t);
    vib.stop(end);
    vibs.set(up, down);
    return up;
  };
  const up = o.chord ? shared(k, `${o.chord}-vib`, t, out, end, makeVib) : makeVib();
  const down = vibs.get(up)!;
  for (let i = 0; i < o.voices; i++) {
    const x = o.voices > 1 ? (i / (o.voices - 1)) * 2 - 1 : 0;
    const det = o.spread * x + 3 * jit(note, i, t);
    // (the players a hair apart in time)
    const at = t + Math.abs(jit(i, note)) * 0.025;
    const v = waveOsc(k, k.bowed, f, det);
    (i % 2 ? down : up).connect(v.detune);
    const vg = gain(k, 1 / Math.sqrt(o.voices));
    v.connect(vg).connect(x < -0.01 ? left : x > 0.01 ? right : sum);
    v.start(at);
    v.stop(end);
  }
}

// ------------------------------------------------------------------ the brass

interface BrassOpts {
  voices: number;
  spread: number;
  attack: number;
  release: number;
  /** the scoop into the pitch [cents] */
  scoop: number;
  /** the brightness: the filter's top over the note's frequency, and its ceiling [Hz] */
  bright: number;
  ceiling: number;
  level: number;
  vib: number;
  /** the breath's edge (a soft saturation's drive) */
  drive: number;
  /** a chord's notes through one filter and one breath (the horns' held chords) */
  chord?: string;
}

/** A brass note: its voices scooping into the pitch, the filter opening with the breath and swelling on a long one. */
function brassNote(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number, o: BrassOpts) {
  const f = midiHz(note);
  const end = t + Math.max(dur, o.attack) + o.release + 0.05;
  const make = () => {
    const g = gain(k);
    adsr(g, t, dur, o.level * vel, o.attack, o.release);
    const lp = slowFilter(k, { type: "lowpass", frequency: 400, Q: 0.9 });
    // (a chord's: its brightness by the loudness about its middle, ~C4)
    const fb = o.chord ? 262 : f;
    const top = Math.min(o.ceiling, fb * o.bright * (0.6 + 0.9 * vel) + 300 * vel);
    lp.frequency.setValueAtTime(Math.min(top, fb * 1.3 + 150), t);
    lp.frequency.linearRampToValueAtTime(top, t + o.attack * 1.3);
    lp.frequency.linearRampToValueAtTime(top * 0.82, t + o.attack * 1.3 + 0.35);
    if (dur > 1.2) lp.frequency.linearRampToValueAtTime(Math.min(o.ceiling * 1.1, top * 1.12), t + dur);
    const pre = gain(k, 1 + o.drive * vel);
    const sh = new WaveShaperNode(k.ctx, { curve: k.soft });
    const post = gain(k, 1 / (1 + 0.6 * o.drive * vel));
    lp.connect(pre).connect(sh).connect(post).connect(g).connect(out);
    return lp;
  };
  const lp = o.chord ? shared(k, o.chord, t, out, end, make) : make();
  let vg: GainNode | null = null;
  if (o.vib > 0 && dur > 0.5) {
    const vib = osc(k, "sine", 5.4);
    vg = gain(k);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(o.vib, t + Math.min(dur, 0.6));
    vib.connect(vg);
    vib.start(t);
    vib.stop(end);
  }
  for (let i = 0; i < o.voices; i++) {
    const x = o.voices > 1 ? (i / (o.voices - 1)) * 2 - 1 : 0;
    const v = waveOsc(k, k.brass, f, o.spread * x + 2 * jit(note, i));
    const at = t + Math.abs(jit(note, i, 3)) * 0.018;
    v.detune.setValueAtTime(o.spread * x - o.scoop, at);
    v.detune.linearRampToValueAtTime(o.spread * x, at + 0.07);
    if (vg) vg.connect(v.detune);
    const vgain = gain(k, 1 / Math.sqrt(o.voices));
    v.connect(vgain).connect(lp);
    v.start(at);
    v.stop(end);
  }
}
const HORN: BrassOpts = {
  voices: 2,
  spread: 7,
  attack: 0.09,
  release: 0.3,
  scoop: 30,
  bright: 2.6,
  ceiling: 2600,
  level: 0.24,
  vib: 0,
  drive: 0.6,
};
const HORNS: BrassOpts = { ...HORN, voices: 2, attack: 0.16, release: 0.5, level: 0.075, scoop: 18, chord: "horns" };
const TRUMPET: BrassOpts = {
  voices: 2,
  spread: 5,
  attack: 0.035,
  release: 0.18,
  scoop: 18,
  bright: 4.2,
  ceiling: 6500,
  level: 0.17,
  vib: 7,
  drive: 0.9,
};

/** The braam: the low brass's cluster (the root, its octave, its fifth), distorted, a sub under it, the filter
 *  tearing open and closing. */
function braam(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const g = gain(k);
  const end = adsr(g, t, dur, 0.1 * vel, 0.06, 1.4);
  const lp = slowFilter(k, { type: "lowpass", frequency: 150, Q: 1.4 });
  lp.frequency.setValueAtTime(140, t);
  lp.frequency.exponentialRampToValueAtTime(700 + 900 * vel, t + 0.22);
  lp.frequency.exponentialRampToValueAtTime(380, t + Math.max(0.5, dur + 0.6));
  const pre = gain(k, 2.6);
  const sh = new WaveShaperNode(k.ctx, { curve: k.soft });
  lp.connect(pre).connect(sh).connect(g).connect(out);
  for (const [n, pan] of [
    [note - 12, 0],
    [note, -0.45],
    [note + 7, 0.45],
  ] as const)
    for (const d of [-11, 10]) {
      const v = waveOsc(k, k.brass, midiHz(n), d);
      v.detune.setValueAtTime(d - 40, t);
      v.detune.linearRampToValueAtTime(d, t + 0.1);
      v.connect(panTo(k, lp, pan));
      v.start(t);
      v.stop(end);
    }
  const s = osc(k, "sine", midiHz(note - 12));
  const sg = gain(k);
  adsr(sg, t, dur, 0.22 * vel, 0.05, 1.2);
  s.connect(sg).connect(out);
  s.start(t);
  s.stop(end);
}

// ------------------------------------------------------------------ notes rendered once

/** The rendered notes kept at most [samples]: 64 MB of them (a theme's working set fits; the next theme's
 *  pushes out the oldest). */
const BUFFER_CAP = 16 * 1024 * 1024;

/**
 * A note rendered once into a buffer (mono), its samples filled by `fill`. `low`: its content all well under a
 * quarter of the context's rate — rendered at half of it (half the work, half the memory; the source node
 * resamples it).
 */
function rendered(k: Kit, key: string, secs: number, fill: (d: Float32Array, sr: number) => void, low = false): AudioBuffer {
  const hit = k.buffers.get(key);
  if (hit) {
    // (used: the most recent again)
    k.buffers.delete(key);
    k.buffers.set(key, hit);
    return hit;
  }
  const sr = low && k.ctx.sampleRate >= 44100 ? k.ctx.sampleRate / 2 : k.ctx.sampleRate;
  const buf = k.ctx.createBuffer(1, Math.floor(sr * secs), sr);
  const d = buf.getChannelData(0);
  fill(d, sr);
  // (normalized, a fade at the end: no click)
  let peak = 0;
  for (const x of d) peak = Math.max(peak, Math.abs(x));
  const g = peak > 0 ? 0.9 / peak : 1;
  const fade = Math.min(4096, d.length >> 2);
  for (let i = 0; i < d.length; i++) d[i]! *= g * (i > d.length - fade ? (d.length - i) / fade : 1);
  k.buffers.set(key, buf);
  k.bufferSamples += d.length;
  k.made++;
  // (the least recently used let go: a playing source keeps its own)
  for (const [kk, b] of k.buffers) {
    if (k.bufferSamples <= BUFFER_CAP || kk === key) break;
    k.buffers.delete(kk);
    k.bufferSamples -= b.length;
  }
  return buf;
}

/** White noise's level in a band, the same at any rendering rate (its power spread over the rate's band). */
const noiseScale = (k: Kit, sr: number) => Math.sqrt(sr / k.ctx.sampleRate);
/** A one-pole low-pass's coefficient designed at the context's rate, at `sr`. */
const poleAt = (k: Kit, sr: number, c: number) => 1 - (1 - c) ** (k.ctx.sampleRate / sr);

/** Partials summed into `d`: each its frequency, amplitude and two decays (fast and slow, mixed by `mix`). */
function partials(d: Float32Array, sr: number, ps: { f: number; a: number; tau: number; tau2?: number; mix?: number }[]) {
  for (const p of ps) {
    if (p.f >= sr * 0.45 || p.a <= 0) continue;
    const w = (2 * Math.PI * p.f) / sr;
    const c = Math.cos(w),
      s = Math.sin(w);
    let x = Math.cos(p.f * 0.37),
      y = Math.sin(p.f * 0.37);
    const mix = p.mix ?? 0;
    const k1 = Math.exp(-1 / (p.tau * sr)),
      k2 = Math.exp(-1 / ((p.tau2 ?? p.tau) * sr));
    let a1 = p.a * (1 - mix),
      a2 = p.a * mix;
    for (let i = 0; i < d.length; i++) {
      d[i]! += (a1 + a2) * y;
      const nx = x * c - y * s;
      y = x * s + y * c;
      x = nx;
      a1 *= k1;
      a2 *= k2;
      if (a1 + a2 < 1e-5) break;
    }
  }
}

/** The piano: inharmonic partials (the string's stiffness), two strings beating, the prompt sound and the
 *  aftersound, the hammer's brightness by the velocity (three layers), its thump. */
function pianoBuffer(k: Kit, note: number, layer: number): AudioBuffer {
  const f0 = midiHz(note);
  const secs = note < 55 ? 5 : note < 79 ? 3.6 : 2.2;
  // (the low notes — their partials under ~5.5 kHz — at half the rate: the costliest notes made half as costly)
  return rendered(
    k,
    `piano|${note}|${layer}`,
    secs,
    (d, sr) => {
      const B = 0.00012 * 2 ** ((note - 48) / 18);
      const n = Math.min(28, Math.floor(9000 / f0));
      const tau0 = Math.min(7, Math.max(0.7, 4.2 * 2 ** (-(note - 48) / 22)));
      const hard = 2.5 + 3 * layer;
      const ps = [];
      for (let h = 1; h <= n; h++) {
        const f = f0 * h * Math.sqrt(1 + B * h * h);
        const a = (1 / h ** 1.05) * Math.exp(-h / hard) * (h === 1 ? 0.8 : 1);
        const tau = tau0 / (1 + 0.28 * (h - 1));
        // (two strings a hair apart: the beating that makes a piano's tone live)
        for (const det of [-0.0005, 0.0006]) ps.push({ f: f * (1 + det), a: a / 2, tau: tau * 0.18, tau2: tau, mix: 0.45 });
      }
      partials(d, sr, ps);
      // (the hammer's thump)
      let lp = 0,
        s = note * 911;
      const c = poleAt(k, sr, 0.08),
        ns = noiseScale(k, sr);
      for (let i = 0; i < Math.min(d.length, sr * 0.02); i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        lp += ((s / 0x7fffffff) * 2 - 1 - lp) * c;
        d[i]! += lp * ns * 0.25 * (1 + layer) * (1 - i / (sr * 0.02));
      }
    },
    note < 55,
  );
}

/** The celesta: a struck bar's modes over its resonator — the fundamental ringing, the upper ones brief. */
function celestaBuffer(k: Kit, note: number): AudioBuffer {
  const f = midiHz(note);
  return rendered(k, `celesta|${note}`, 2.4, (d, sr) =>
    partials(d, sr, [
      { f, a: 1, tau: 0.25, tau2: 1.3, mix: 0.7 },
      { f: f * 2, a: 0.15, tau: 0.45 },
      { f: f * 2.76, a: 0.4, tau: 0.09 },
      { f: f * 5.4, a: 0.2, tau: 0.04 },
      { f: f * 8.93, a: 0.07, tau: 0.025 },
    ]),
  );
}

/** The timpani: a membrane's modes (the principal and its near-harmonic overtones), the pitch settling as the head
 *  rebounds, the mallet's felt (soft or hard). */
function timpaniBuffer(k: Kit, note: number, hard: boolean): AudioBuffer {
  const f = midiHz(note);
  // (a membrane's modes under ~1 kHz: at half the rate)
  return rendered(
    k,
    `timp|${note}|${hard}`,
    3.5,
    (d, sr) => {
      const modes: [number, number, number][] = [
        [0.62, 0.35, 0.18],
        [1, 1, 2.4],
        [1.5, 0.72, 1.5],
        [1.98, 0.45, 1.05],
        [2.44, 0.3, 0.8],
        [2.94, 0.18, 0.55],
        [3.42, 0.1, 0.4],
      ];
      for (const [r, a, tau] of modes) {
        const amp = a * (hard || r < 2 ? 1 : 0.55);
        let ph = 0;
        const k1 = Math.exp(-1 / (tau * sr));
        let env = amp;
        for (let i = 0; i < d.length && env > 1e-5; i++) {
          const tt = i / sr;
          ph += (2 * Math.PI * f * r * (1 + 0.018 * Math.exp(-tt / 0.07))) / sr;
          d[i]! += env * Math.sin(ph);
          env *= k1;
        }
      }
      // (the mallet)
      let lp = 0,
        s = note * 37;
      const len = Math.floor(sr * 0.015);
      const c = poleAt(k, sr, hard ? 0.35 : 0.12),
        ns = noiseScale(k, sr);
      for (let i = 0; i < len; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        lp += ((s / 0x7fffffff) * 2 - 1 - lp) * c;
        d[i]! += lp * ns * 0.6 * (1 - i / len);
      }
    },
    note < 60,
  );
}

/** A plucked string (Karplus–Strong): noise in a delay line, averaged each period — the harp's (long, plucked at
 *  its middle), the pizzicato's (short, dark). */
function ksBuffer(k: Kit, note: number, kind: "harp" | "pizz"): AudioBuffer {
  const f = midiHz(note);
  const harp = kind === "harp";
  return rendered(k, `${kind}|${note}`, harp ? (note < 60 ? 5 : 3.2) : 1.4, (d, sr) => {
    const N = Math.max(2, Math.round(sr / f));
    const line = new Float32Array(N);
    let s = note * 7919 + (harp ? 3 : 5);
    let prev = 0;
    for (let i = 0; i < N; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const x = (s / 0x7fffffff) * 2 - 1;
      prev = harp ? 0.6 * x + 0.4 * prev : 0.3 * x + 0.7 * prev;
      line[i] = prev;
    }
    // (plucked at the middle: the even partials weaker — the line minus itself half a period on)
    if (harp) {
      const c = line.slice();
      for (let i = 0; i < N; i++) line[i] = c[i]! - 0.5 * c[(i + (N >> 1)) % N]!;
    }
    const ring = harp ? Math.min(4.5, 2.2 * 2 ** (-(note - 60) / 24) + 0.6) : 0.35;
    const decay = 0.001 ** (1 / (f * ring));
    const a = harp ? 0.5 : 0.45;
    let p = 0;
    for (let i = 0; i < d.length; i++) {
      const cur = line[p]!;
      const nxt = line[(p + 1) % N]!;
      line[p] = (a * cur + (1 - a) * nxt) * decay;
      d[i] = cur;
      p = (p + 1) % N;
    }
  });
}

/** A deterministic noise source for the rendered notes. */
function noiseGen(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
}
/** A two-pole band-pass in the samples (the rendered notes' noises). */
function bandpass(sr: number, f: number, q: number) {
  const w = (2 * Math.PI * f) / sr,
    al = Math.sin(w) / (2 * q),
    a0 = 1 + al;
  const b0 = al / a0,
    b2 = -al / a0,
    a1 = (-2 * Math.cos(w)) / a0,
    a2 = (1 - al) / a0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  return (x: number) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/** A spiccato note rendered once: two bows biting the string (the bowed spectrum, brighter when harder), their
 *  short decay, the bite's noise. */
function spicBuffer(k: Kit, note: number, low: boolean, hard: boolean): AudioBuffer {
  const f = midiHz(note);
  return rendered(k, `spic|${note}|${low}|${hard}`, low ? 0.6 : 0.45, (d, sr) => {
    const top = (low ? 1600 : 4800) * (hard ? 1 : 0.6);
    const tau = low ? 0.11 : 0.075;
    const ps = [];
    for (let h = 1; h <= 30 && f * h < 9000; h++) {
      const a = (1 / h) * (1 + 0.28 * Math.sin(h * 1.93)) * Math.exp(-(f * h) / top);
      for (const det of [-0.0035, 0.004]) ps.push({ f: f * h * (1 + det), a: a / 2, tau });
    }
    partials(d, sr, ps);
    const att = Math.floor(sr * 0.008);
    for (let i = 0; i < att; i++) d[i]! *= i / att;
    const bp = bandpass(sr, low ? 1500 : 3500, 1);
    const rnd = noiseGen(note * 13 + (hard ? 1 : 0));
    const nl = Math.floor(sr * 0.03);
    for (let i = 0; i < nl; i++) d[i]! += bp(rnd()) * 0.5 * (1 - i / nl);
  });
}

/** A short brass note rendered once (the fanfare's stabs): its partials blooming with the breath — the higher ones
 *  later and fainter, so the note brightens as it grows —, a scoop into the pitch, a quick release. */
function brassBuffer(k: Kit, note: number, trumpet: boolean, hard: boolean): AudioBuffer {
  const f = midiHz(note);
  const len = 0.6;
  return rendered(k, `brass|${note}|${trumpet}|${hard}`, len, (d, sr) => {
    const ceiling = (trumpet ? 6000 : 2400) * (hard ? 1 : 0.65);
    const att = trumpet ? 0.025 : 0.06;
    const hold = 0.3;
    const env = (t: number) => (t < att ? t / att : t < hold ? 1 - 0.15 * ((t - att) / (hold - att)) : 0.85 * Math.exp(-(t - hold) / 0.07));
    for (let h = 1; h <= 30 && f * h < Math.min(ceiling * 1.6, sr * 0.45); h++) {
      const A = h ** -0.78 * Math.exp(-(f * h) / ceiling);
      const p = 1 + 0.18 * (h - 1);
      let ph = h * 0.7;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const scoop = t < 0.07 ? 2 ** ((-(trumpet ? 18 : 30) * (1 - t / 0.07)) / 1200) : 1;
        ph += (2 * Math.PI * f * h * scoop) / sr;
        d[i]! += A * env(t) ** p * Math.sin(ph);
      }
    }
    // (the breath's edge: a soft saturation)
    for (let i = 0; i < d.length; i++) d[i] = Math.tanh(1.6 * d[i]!);
  });
}

/** A struck membrane rendered once: a sine falling to its pitch, saturated, decaying; its skin's noise — the taiko,
 *  the bass drum, the toms, the boom (a few variants each: no machine-gun). */
function drumBuffer(
  k: Kit,
  key: string,
  o: { from: number; to: number; drop: number; decay: number; skin: number; skinHz: number; seed: number },
) {
  return rendered(k, `drum|${key}`, Math.min(4, o.decay * 2.2 + 0.2), (d, sr) => {
    let ph = 0;
    const kd = Math.exp(-1 / (o.decay * sr * 0.45));
    let a = 1;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const f = o.to + (o.from - o.to) * Math.exp(-t / (o.drop / 3));
      ph += (2 * Math.PI * f) / sr;
      d[i] = Math.tanh(1.8 * Math.sin(ph)) * a;
      a *= kd;
    }
    const bp = bandpass(sr, o.skinHz, 0.8);
    const rnd = noiseGen(o.seed);
    const nl = Math.floor(sr * 0.12);
    for (let i = 0; i < nl; i++) d[i]! += bp(rnd()) * o.skin * 3 * Math.exp(-i / (sr * 0.012));
  });
}
/** The orchestral snare rendered once: the snares' rattle (noise, its highs), the shell's tone. */
function snareBuffer(k: Kit, v: number) {
  return rendered(k, `snare|${v}`, 0.35, (d, sr) => {
    const rnd = noiseGen(71 + v * 13);
    const bp = bandpass(sr, 4800, 0.6);
    let hp = 0,
      prev = 0;
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const x = rnd();
      hp = 0.85 * (hp + x - prev);
      prev = x;
      const rattle = (0.6 * hp + 0.8 * bp(x)) * Math.exp(-t / 0.05);
      ph += (2 * Math.PI * (185 + 55 * Math.exp(-t / 0.02))) / sr;
      d[i] = rattle + 0.6 * Math.sin(ph) * Math.exp(-t / 0.025);
    }
  });
}

/** A short organ note rendered once (the ostinato's sixteenths): the ranks' partials, two ranks beating, the
 *  pipe's chiff, the wind's quick speech. */
function organBuffer(k: Kit, note: number): AudioBuffer {
  const f = midiHz(note) / 2;
  return rendered(k, `organ|${note}`, 0.7, (d, sr) => {
    const ps = [];
    for (const [h, a] of k.organPartials)
      if (f * h < 10000) for (const det of [0, 0.0026]) ps.push({ f: f * h * (1 + det), a: det ? a * 0.55 : a, tau: 30 });
    partials(d, sr, ps);
    const att = Math.floor(sr * 0.012);
    for (let i = 0; i < att; i++) d[i]! *= i / att;
    const bp = bandpass(sr, Math.min(8000, f * 8), 4);
    const rnd = noiseGen(note * 5);
    const nl = Math.floor(sr * 0.04);
    for (let i = 0; i < nl; i++) d[i]! += bp(rnd()) * 1.2 * Math.exp(-i / (sr * 0.01));
  });
}

/** A buffer played: its level, its release (a damper: the note's end + `tail`), its tone filtered. */
function playBuffer(k: Kit, out: AudioNode, buf: AudioBuffer, t: number, dur: number, level: number, tail: number, lpHz = 0, detune = 0) {
  const src = new AudioBufferSourceNode(k.ctx, { buffer: buf, detune });
  const g = gain(k, level);
  const stop = Math.min(t + buf.duration, t + dur + tail);
  g.gain.setValueAtTime(level, t);
  if (stop < t + buf.duration) g.gain.setTargetAtTime(0, t + dur, tail / 4);
  if (lpHz) src.connect(new BiquadFilterNode(k.ctx, { type: "lowpass", frequency: lpHz, Q: 0.5 })).connect(g);
  else src.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(stop + 0.05);
}

// ------------------------------------------------------------------ the organ, the choir, the flute, the rest

/** The pipe organ: its ranks as one wave on the 16', a second rank a few cents off (the chorus of pipes), the pipes'
 *  chiff, the swell box opening with the loudness. A chord's notes through one box. */
function organ(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number, lead = false) {
  const f = midiHz(note);
  let end = t + Math.max(dur, 0.12) + 0.6;
  const make = () => {
    const env = gain(k);
    end = adsr(env, t, dur, (lead ? 0.2 : 0.085) * vel, lead ? 0.06 : 0.12, 0.55);
    const box = new BiquadFilterNode(k.ctx, { type: "lowpass", frequency: 1500 + 4500 * vel, Q: 0.4 });
    box.connect(env).connect(out);
    if (lead) {
      // (the tremulant: the wind trembling a little)
      const tr = osc(k, "sine", 6.1);
      const tg = gain(k, 0.06);
      const amp = gain(k, 1);
      tr.connect(tg).connect(amp.gain);
      tr.start(t);
      tr.stop(end);
      amp.connect(box);
      return amp;
    }
    return box;
  };
  const sum = lead ? make() : shared(k, "organ", t, out, end, make);
  for (const [det, lv] of [
    [((note * 31) % 7) - 3, 1],
    [((note * 31) % 7) - 3 + 4.5, 0.55],
  ] as const) {
    const o = waveOsc(k, k.organ, f / 2, det);
    const g = gain(k, lv);
    o.connect(g).connect(sum);
    o.start(t);
    o.stop(end);
  }
  // (the chiff: the pipe's speech, a puff on its octave)
  const n = noiseSrc(k, t, 0.06, note);
  const bp = new BiquadFilterNode(k.ctx, { type: "bandpass", frequency: Math.min(8000, f * 4), Q: 4 });
  const ng = gain(k);
  ng.gain.setValueAtTime(0.25, t);
  ng.gain.setTargetAtTime(0, t + 0.005, 0.015);
  n.connect(bp).connect(ng).connect(sum);
}
/** The pedal: the 16' principal and a 32' under it — felt more than heard. */
function pedal(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const f = midiHz(note);
  const g = gain(k);
  const end = adsr(g, t, dur, 0.08 * vel, 0.2, 0.9);
  const lp = new BiquadFilterNode(k.ctx, { type: "lowpass", frequency: 700, Q: 0.5 });
  lp.connect(g).connect(out);
  const o = waveOsc(k, k.organ, f);
  const s = osc(k, "sine", f / 2);
  const sg = gain(k, 0.8);
  o.connect(lp);
  s.connect(sg).connect(lp);
  for (const x of [o, s]) {
    x.start(t);
    x.stop(end);
  }
}

/** A choir: three singers a voice, a slow vibrato in late, through one bank of the vowel's formants per chord, a
 *  breath in it. */
function choir(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number, vowel: "ah" | "oo") {
  const f = midiHz(note);
  let end = t + Math.max(dur, 1) + 2.05;
  const sum = shared(k, `choir-${vowel}`, t, out, end, () => {
    const g = gain(k);
    end = adsr(g, t, dur, 0.11 * vel, 1, 2);
    g.connect(out);
    const s = gain(k, 1);
    const F: [number, number, number][] =
      vowel === "oo"
        ? [
            [330, 7, 1],
            [760, 9, 0.35],
            [2400, 12, 0.1],
          ]
        : [
            [740, 7, 1],
            [1150, 9, 0.55],
            [2600, 11, 0.28],
            [3400, 12, 0.12],
          ];
    for (const [fr, q, l] of F) {
      const bp = new BiquadFilterNode(k.ctx, { type: "bandpass", frequency: fr, Q: q });
      const bg = gain(k, l * 2.4);
      s.connect(bp).connect(bg).connect(g);
    }
    const n = noiseSrc(k, t, end - t, t * 1.3);
    const ng = gain(k, 0.06);
    n.connect(ng).connect(s);
    return s;
  });
  for (const [i, d] of [-11, 0, 12].entries()) {
    const vib = osc(k, "sine", 4.7 + 0.4 * i + 0.1 * jit(note, i));
    const vg = gain(k);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(16, t + 1.4);
    vib.connect(vg);
    const o = osc(k, "sawtooth", f, d);
    vg.connect(o.detune);
    o.connect(panTo(k, sum, (i - 1) * 0.4));
    for (const x of [o, vib]) {
      x.start(t + i * 0.03);
      x.stop(end);
    }
  }
}

/** The flute: nearly a sine, its breath, a vibrato in late, a chiff at the start. */
function flute(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const f = midiHz(note);
  const g = gain(k);
  const end = adsr(g, t, dur, 0.28 * vel, 0.07, 0.2);
  g.connect(out);
  const o = waveOsc(k, k.flute, f);
  const vib = osc(k, "sine", 5.2);
  const vg = gain(k);
  vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(14, t + Math.min(dur, 0.5) + 0.15);
  vib.connect(vg).connect(o.detune);
  o.connect(g);
  const n = noiseSrc(k, t, end - t, note * 0.7);
  const bp = new BiquadFilterNode(k.ctx, { type: "bandpass", frequency: Math.min(9000, f * 2.2), Q: 1.2 });
  const ng = gain(k);
  ng.gain.setValueAtTime(0.22, t);
  ng.gain.setTargetAtTime(0.05, t + 0.03, 0.05);
  n.connect(bp).connect(ng).connect(g);
  for (const x of [o, vib]) {
    x.start(t);
    x.stop(end);
  }
}

/** The sub: a soft sine under the low end (the hybrid score's weight), slow in, slow out. */
function sub(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const g = gain(k);
  const end = adsr(g, t, dur, 0.18 * vel, 0.25, 1);
  const sh = new WaveShaperNode(k.ctx, { curve: k.soft });
  const o = osc(k, "sine", midiHz(note));
  o.connect(sh).connect(g).connect(out);
  o.start(t);
  o.stop(end);
}

/** A Shepard tone: sines an octave apart rising two semitones over the note, each loudest in the middle of the range
 *  and silent at its ends — the next bar's going on from where this one ends, rising without end. */
function shepard(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const base = midiHz(note);
  const bell = (fr: number) => Math.exp(-0.5 * ((Math.log2(fr) - Math.log2(330)) / 1.25) ** 2);
  const rise = 2 ** (2 / 12);
  const x = 0.04;
  for (let i = 0; i < 8; i++) {
    const f0 = base * 2 ** (i - 4);
    if (f0 < 8 || f0 * rise > 9000) continue;
    const o = osc(k, "sine", f0);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * rise, t + dur);
    const g = gain(k);
    const lv = 0.05 * vel;
    g.gain.setValueAtTime(0, t - x);
    g.gain.linearRampToValueAtTime(lv * bell(f0), t + x);
    g.gain.linearRampToValueAtTime(lv * bell(f0 * rise), t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + x);
    o.connect(g).connect(out);
    o.start(Math.max(0, t - x));
    o.stop(t + dur + x + 0.02);
  }
}

// ------------------------------------------------------------------ the percussion

/** The snare's roll: the rattle re-struck ~22 times a second, swelling over its length. */
function roll(k: Kit, out: AudioNode, t: number, dur: number, vel: number) {
  const n = noiseSrc(k, t, dur + 0.3, t * 2.3);
  const hp = new BiquadFilterNode(k.ctx, { type: "highpass", frequency: 1800 });
  const pk = new BiquadFilterNode(k.ctx, { type: "peaking", frequency: 4600, Q: 0.7, gain: 4 });
  const strokes = gain(k, 0.55);
  const lfo = osc(k, "square", 22);
  const depth = gain(k, 0.45);
  lfo.connect(depth).connect(strokes.gain);
  const g = gain(k);
  g.gain.setValueAtTime(0.06 * vel, t);
  g.gain.exponentialRampToValueAtTime(0.4 * vel, t + dur);
  g.gain.setTargetAtTime(0, t + dur, 0.03);
  n.connect(hp).connect(pk).connect(strokes).connect(g).connect(out);
  lfo.start(t);
  lfo.stop(t + dur + 0.3);
}
/** The suspended cymbal under soft mallets: a shimmer rising to its peak at the note's end, then ringing away. */
function cymbal(k: Kit, out: AudioNode, t: number, dur: number, vel: number, swell: boolean) {
  const len = dur + 3.5;
  const n = noiseSrc(k, t, len, t * 13);
  const hp = new BiquadFilterNode(k.ctx, { type: "highpass", frequency: swell ? 2600 : 1400 });
  const p1 = new BiquadFilterNode(k.ctx, { type: "peaking", frequency: 5200, Q: 1.5, gain: 6 });
  const p2 = new BiquadFilterNode(k.ctx, { type: "peaking", frequency: 8300, Q: 2, gain: 4 });
  const g = gain(k);
  const peak = (swell ? 0.3 : 0.38) * vel;
  if (swell) {
    g.gain.setValueAtTime(0.0008, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.5);
  } else {
    g.gain.setValueAtTime(peak, t);
    g.gain.setTargetAtTime(0, t + 0.01, 0.6);
  }
  n.connect(hp)
    .connect(p1)
    .connect(p2)
    .connect(g)
    .connect(panTo(k, out, 0.3));
  // (the metal's ring: a few inharmonic partials)
  for (const fr of [3130, 4410, 5920, 7710]) {
    const o = osc(k, "square", fr);
    const og = gain(k, 0.012);
    o.connect(og).connect(hp);
    o.start(t);
    o.stop(t + len);
  }
}
/** A taiko's or a cinematic boom: a deep falling sine and a thump. */
function boom(k: Kit, out: AudioNode, t: number, vel: number, note: number) {
  const f = Math.max(28, Math.min(55, midiHz(note)));
  const buf = drumBuffer(k, `boom${Math.round(f)}`, {
    from: f * 2.2,
    to: f,
    drop: 0.22,
    decay: 1.6,
    skin: 0.5,
    skinHz: 220,
    seed: Math.round(f),
  });
  playBuffer(k, out, buf, t, 4, 0.5 * vel, 1);
}
/** The clock's tick (Miller's 1.25 s, the docking's eighths): a dry wooden click with a glint of metal. */
function tick(k: Kit, out: AudioNode, t: number, vel: number) {
  const n = noiseSrc(k, t, 0.05, t);
  const bp = new BiquadFilterNode(k.ctx, { type: "bandpass", frequency: 2400, Q: 3 });
  const g = gain(k);
  g.gain.setValueAtTime(0.55 * vel, t);
  g.gain.setTargetAtTime(0, t + 0.001, 0.006);
  n.connect(bp).connect(g).connect(out);
  const o = osc(k, "sine", 1760);
  const og = gain(k);
  og.gain.setValueAtTime(0.12 * vel, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  o.connect(og).connect(out);
  o.start(t);
  o.stop(t + 0.06);
}

/** The instruments' names (music/composer.ts's), every one. */
export const INSTRUMENTS = [
  "strings",
  "tremolo",
  "violins",
  "viola",
  "cello",
  "contrabass",
  "spiccato",
  "lowspic",
  "pizz",
  "horn",
  "horns",
  "trumpet",
  "braam",
  "piano",
  "celesta",
  "harp",
  "timpani",
  "timproll",
  "organ",
  "organlead",
  "pedal",
  "choir",
  "choiroo",
  "flute",
  "sub",
  "shepard",
  "taiko",
  "bassdrum",
  "tom",
  "snare",
  "roll",
  "cymbal",
  "crash",
  "boom",
  "tick",
] as const;

const CHORD_STR: Omit<BowOpts, "chord"> = {
  voices: 3,
  spread: 9,
  width: 0.5,
  attack: 0.45,
  release: 0.9,
  vib: 7,
  bright: 4200,
  level: 0.09,
};

// (the drums' variants by the time struck — a few each: no machine-gun —, the piano's layer by the velocity)
const taikoOf = (t: number) => Math.floor(Math.abs(jit(t, 1)) * 3);
const tomOf = (t: number) => Math.floor(Math.abs(jit(t, 2)) * 4);
const snareOf = (t: number) => Math.floor(Math.abs(jit(t, 3)) * 3);
const pianoLayer = (vel: number) => (vel > 0.75 ? 2 : vel > 0.45 ? 1 : 0);
const taikoBuffer = (k: Kit, v: number) =>
  drumBuffer(k, `taiko${v}`, { from: 125 + 8 * v, to: 60 + 3 * v, drop: 0.08, decay: 0.9, skin: 0.35, skinHz: 450, seed: v + 1 });
const tomBuffer = (k: Kit, v: number) =>
  drumBuffer(k, `tom${v}`, { from: 230 - 25 * v, to: 125 - 12 * v, drop: 0.12, decay: 0.55, skin: 0.28, skinHz: 900, seed: 20 + v });
const bassDrumBuffer = (k: Kit) =>
  drumBuffer(k, "bassdrum", { from: 70, to: 46, drop: 0.15, decay: 1.4, skin: 0.12, skinHz: 180, seed: 9 });

/**
 * The buffer a note will play rendered now, ahead of it (nothing for the notes made of live nodes): what the music
 * engine does in its idle slices, so that the frame that schedules the note does not pay for it. `t` unknown
 * (NaN): every variant of a drum. True when it was not rendered yet (the work was done here).
 */
export function prepareNote(k: Kit, inst: string, dur: number, note: number, vel: number, t = Number.NaN): boolean {
  const n = k.made;
  const some = (f: (v: number) => void, of: (t: number) => number, count: number) => {
    if (Number.isFinite(t)) f(of(t));
    else for (let v = 0; v < count; v++) f(v);
  };
  switch (inst) {
    case "spiccato":
    case "lowspic":
      spicBuffer(k, note, inst === "lowspic", vel > 0.65);
      break;
    case "pizz":
      ksBuffer(k, note, "pizz");
      break;
    case "harp":
      ksBuffer(k, note, "harp");
      break;
    case "horn":
    case "trumpet":
      if (dur <= 0.45) brassBuffer(k, note, inst === "trumpet", vel > 0.7);
      break;
    case "piano":
      pianoBuffer(k, note, pianoLayer(vel));
      break;
    case "celesta":
      celestaBuffer(k, note);
      break;
    case "timpani":
      timpaniBuffer(k, note, vel > 0.7);
      break;
    case "timproll":
      timpaniBuffer(k, note, false);
      break;
    case "organ":
      if (dur <= 0.5) organBuffer(k, note);
      break;
    case "taiko":
      some((v) => taikoBuffer(k, v), taikoOf, 3);
      break;
    case "bassdrum":
      bassDrumBuffer(k);
      break;
    case "tom":
      some((v) => tomBuffer(k, v), tomOf, 4);
      break;
    case "snare":
      some((v) => snareBuffer(k, v), snareOf, 3);
      break;
  }
  return k.made !== n;
}

/** Plays a note of an instrument by its name, at `t` [ctx s], `dur` [s]. */
export function playNote(k: Kit, out: AudioNode, inst: string, t: number, dur: number, note: number, vel: number, pan = 0) {
  const o = panTo(k, out, pan);
  switch (inst) {
    // the strings
    case "strings":
      return bowed(k, o, t, dur, note, vel, { ...CHORD_STR, chord: "strings" });
    case "tremolo":
      return bowed(k, o, t, dur, note, vel, { ...CHORD_STR, attack: 0.2, tremolo: true, chord: "tremolo" });
    case "violins":
      return bowed(k, o, t, dur, note, vel, {
        voices: 3,
        spread: 10,
        width: 0.3,
        attack: 0.18,
        release: 0.6,
        vib: 11,
        bright: 6500,
        level: 0.2,
        swell: dur > 2,
      });
    case "viola":
      return bowed(k, o, t, dur, note, vel, {
        voices: 3,
        spread: 8,
        width: 0.25,
        attack: 0.3,
        release: 0.9,
        vib: 10,
        bright: 4200,
        level: 0.24,
        swell: dur > 2,
      });
    case "cello":
      return bowed(k, o, t, dur, note, vel, {
        voices: 3,
        spread: 8,
        width: 0.3,
        attack: 0.35,
        release: 1,
        vib: 9,
        bright: 3000,
        level: 0.22,
        swell: dur > 2,
      });
    case "contrabass":
      return bowed(k, o, t, dur, note, vel, {
        voices: 2,
        spread: 7,
        width: 0.2,
        attack: 0.4,
        release: 0.9,
        vib: 5,
        bright: 1600,
        level: 0.13,
      });
    case "spiccato":
      return playBuffer(k, o, spicBuffer(k, note, false, vel > 0.65), t, dur, 0.45 * vel, 0.25);
    case "lowspic":
      return playBuffer(k, o, spicBuffer(k, note, true, vel > 0.65), t, dur, 0.26 * vel, 0.3);
    case "pizz":
      return playBuffer(k, o, ksBuffer(k, note, "pizz"), t, dur, 0.32 * vel, 0.4, 2400);
    // the brass
    case "horn":
      if (dur <= 0.45) return playBuffer(k, o, brassBuffer(k, note, false, vel > 0.7), t, dur, 0.24 * vel, 0.12);
      return brassNote(k, o, t, dur, note, vel, HORN);
    case "horns":
      return brassNote(k, o, t, dur, note, vel, HORNS);
    case "trumpet":
      // (the stabs rendered once; the long notes breathed live)
      if (dur <= 0.45) return playBuffer(k, o, brassBuffer(k, note, true, vel > 0.7), t, dur, 0.2 * vel, 0.12);
      return brassNote(k, o, t, dur, note, vel, TRUMPET);
    case "braam":
      return braam(k, o, t, dur, note, vel);
    // rendered once
    case "piano":
      return playBuffer(k, o, pianoBuffer(k, note, pianoLayer(vel)), t, dur, 0.4 * (0.35 + 0.65 * vel), 0.6);
    case "celesta":
      return playBuffer(k, o, celestaBuffer(k, note), t, dur, 0.35 * vel, 1.5);
    case "harp":
      return playBuffer(k, o, ksBuffer(k, note, "harp"), t, dur, 0.7 * vel, 3, 5200);
    case "timpani":
      return playBuffer(k, o, timpaniBuffer(k, note, vel > 0.7), t, dur, 0.34 * vel, 3);
    case "timproll": {
      // (the timpani re-struck ~14 times a second, swelling)
      const buf = timpaniBuffer(k, note, false);
      const n = Math.max(4, Math.round(dur * 14));
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1);
        playBuffer(k, o, buf, t + (i * dur) / n, 0.12, 0.34 * vel * (0.25 + 0.75 * x * x) * (i % 2 ? 0.85 : 1), 0.5, 0, (i % 2) * 4);
      }
      return;
    }
    // the organ, the choir, the flute, the rest
    case "organ":
      // (the ostinato's short notes rendered once; the chords breathed live through the swell box)
      if (dur <= 0.5) return playBuffer(k, o, organBuffer(k, note), t, dur, 0.26 * vel, 0.18, 1800 + 4000 * vel);
      return organ(k, o, t, dur, note, vel);
    case "organlead":
      return organ(k, o, t, dur, note, vel, true);
    case "pedal":
      return pedal(k, o, t, dur, note, vel);
    case "choir":
      return choir(k, o, t, dur, note, vel, "ah");
    case "choiroo":
      return choir(k, o, t, dur, note, vel, "oo");
    case "flute":
      return flute(k, o, t, dur, note, vel);
    case "sub":
      return sub(k, o, t, dur, note, vel);
    case "shepard":
      return shepard(k, o, t, dur, note, vel);
    // the percussion
    case "taiko":
      return playBuffer(k, o, taikoBuffer(k, taikoOf(t)), t, 4, 0.38 * vel, 0.5);
    case "bassdrum":
      return playBuffer(k, o, bassDrumBuffer(k), t, 4, 0.36 * vel, 0.5);
    case "tom":
      return playBuffer(k, o, tomBuffer(k, tomOf(t)), t, 2, 0.26 * vel, 0.3);
    case "snare":
      return playBuffer(k, o, snareBuffer(k, snareOf(t)), t, 1, 0.3 * vel, 0.2);
    case "roll":
      return roll(k, o, t, dur, vel);
    case "cymbal":
      return cymbal(k, o, t, dur, vel, true);
    case "crash":
      return cymbal(k, o, t, dur, vel, false);
    case "boom":
      return boom(k, o, t, vel, note);
    case "tick":
      return tick(k, o, t, vel);
  }
}

/** A hall's impulse response: stereo noise decaying over `secs`, darker as it fades (brighter: a plate), its early
 *  reflections a few distinct taps. */
export function impulseResponse(ctx: Ctx, secs: number, bright: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * secs);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 777;
  const taps = [0.013, 0.019, 0.027, 0.034, 0.043, 0.051, 0.062, 0.074];
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      s = (s * 1103515245 + 12345 + c) & 0x7fffffff;
      const x = (s / 0x7fffffff) * 2 - 1;
      const a = Math.min(0.95, (1 - bright) * 0.3 + 0.65 * k);
      lp = lp * a + x * (1 - a);
      // (a short pre-delay, the tail fading in over the early reflections)
      const pre = i < ctx.sampleRate * 0.02 ? 0 : Math.min(1, (i - ctx.sampleRate * 0.02) / (ctx.sampleRate * 0.06));
      d[i] = pre * lp * Math.exp(-6.9 * k) * 1.5;
    }
    for (const [j, tp] of taps.entries()) {
      const i = Math.floor((tp + (c ? 0.0037 : 0)) * ctx.sampleRate);
      if (i < len) d[i]! += (j % 2 ? -0.5 : 0.55) * (1 - j / taps.length);
    }
  }
  return ir;
}
