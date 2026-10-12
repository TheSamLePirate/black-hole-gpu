// The band's instruments, synthesized in Web Audio (any context: the game's, or an offline one to render a
// theme): the drum kit (a kick with its click, a snare, a clap, hats, a shaker, toms, a taiko's boom, a crash,
// a riser), the sub bass and its growl, the pads (a supersaw, a warm analog, a glass), the arpeggio's plucks,
// bells (FM) and glass, the leads, the ethereal guitar (Karplus–Strong strings: plucked, swelled as with an
// ebow, high harmonics — chorused, the delay and the hall doing the rest), the organ (its drawbars) and the
// choir (formants). Each note: its nodes made, started and stopped at its time, gone after.

import { midiHz } from "./theory";

export type Ctx = BaseAudioContext;

/** What an instrument plays into: its layer's input, and the context's shared material. */
export interface Kit {
  ctx: Ctx;
  noise: AudioBuffer;
  strings: Map<string, AudioBuffer>;
  soft: Float32Array<ArrayBuffer>;
  /** the organ's drawbars as one wave (on the note's octave below: its partials harmonics of it) */
  organWave: PeriodicWave;
  /** a chord's shared nodes (its pad's filter, its choir's formants): one per chord and layer, not per note */
  shared: Map<string, { node: AudioNode; until: number }>;
  /** an id per destination (the shared nodes' keys) */
  ids: WeakMap<AudioNode, number>;
}

/** The shared material: two seconds of white noise, the strings' cache, a soft saturation's curve. */
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
  // (16', 8', 4', 2 2/3', 2' — on the 16' as the fundamental: harmonics 1, 2, 4, 6, 8)
  const real = new Float32Array(9),
    imag = new Float32Array(9);
  for (const [h, l] of [
    [1, 0.35],
    [2, 1],
    [4, 0.55],
    [6, 0.22],
    [8, 0.28],
  ])
    imag[h!] = l!;
  const organWave = ctx.createPeriodicWave(real, imag);
  return { ctx, noise, strings: new Map(), soft: curve, organWave, shared: new Map(), ids: new WeakMap() };
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
const gain = (k: Kit, g = 0) => new GainNode(k.ctx, { gain: g });
const panTo = (k: Kit, dest: AudioNode, pan = 0): AudioNode => {
  if (!pan) return dest;
  const p = new StereoPannerNode(k.ctx, { pan: Math.max(-1, Math.min(1, pan)) });
  p.connect(dest);
  return p;
};
function noiseSrc(k: Kit, t: number, len: number, offset = 0) {
  const s = new AudioBufferSourceNode(k.ctx, { buffer: k.noise, loop: true });
  s.start(t, offset % 1.9);
  s.stop(t + len);
  return s;
}
/** An envelope on a gain: attack, hold to the end, release (linear in, exponential out). */
function adsr(g: GainNode, t: number, dur: number, level: number, a: number, r: number) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + Math.min(a, dur));
  g.gain.setValueAtTime(level, t + Math.max(dur, a));
  g.gain.setTargetAtTime(0, t + Math.max(dur, a), r / 3);
  return t + Math.max(dur, a) + r + 0.05;
}

// ---- the drums
function kick(k: Kit, out: AudioNode, t: number, vel: number) {
  const o = osc(k, "sine", 150);
  o.frequency.setValueAtTime(155, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.09);
  const g = gain(k);
  g.gain.setValueAtTime(1.1 * vel, t);
  g.gain.setTargetAtTime(0, t + 0.06, 0.14);
  const sh = new WaveShaperNode(k.ctx, { curve: k.soft });
  o.connect(sh).connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.8);
  // (the beater's click)
  const n = noiseSrc(k, t, 0.012);
  const hp = new BiquadFilterNode(k.ctx, { type: "highpass", frequency: 2500 });
  const ng = gain(k, 0.25 * vel);
  n.connect(hp).connect(ng).connect(out);
}
function snare(k: Kit, out: AudioNode, t: number, vel: number) {
  const n = noiseSrc(k, t, 0.3, t * 7);
  const bp = new BiquadFilterNode(k.ctx, { type: "bandpass", frequency: 1900, Q: 0.7 });
  const g = gain(k);
  g.gain.setValueAtTime(0.75 * vel, t);
  g.gain.setTargetAtTime(0, t + 0.01, 0.06);
  n.connect(bp).connect(g).connect(out);
  const o = osc(k, "triangle", 195);
  o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
  const og = gain(k);
  og.gain.setValueAtTime(0.5 * vel, t);
  og.gain.setTargetAtTime(0, t + 0.005, 0.03);
  o.connect(og).connect(out);
  o.start(t);
  o.stop(t + 0.25);
}
function clap(k: Kit, out: AudioNode, t: number, vel: number) {
  const n = noiseSrc(k, t, 0.4, t * 3);
  const bp = new BiquadFilterNode(k.ctx, { type: "bandpass", frequency: 1250, Q: 1.1 });
  const g = gain(k);
  for (const d of [0, 0.011, 0.023]) {
    g.gain.setValueAtTime(0.8 * vel, t + d);
    g.gain.setTargetAtTime(0.05, t + d + 0.002, 0.004);
  }
  g.gain.setValueAtTime(0.6 * vel, t + 0.03);
  g.gain.setTargetAtTime(0, t + 0.032, 0.06);
  n.connect(bp).connect(g).connect(out);
}
function hat(k: Kit, out: AudioNode, t: number, vel: number, open: boolean) {
  const n = noiseSrc(k, t, open ? 0.5 : 0.12, t * 11);
  const hp = new BiquadFilterNode(k.ctx, { type: "highpass", frequency: 7500, Q: 1.2 });
  const g = gain(k);
  g.gain.setValueAtTime(0.3 * vel, t);
  g.gain.setTargetAtTime(0, t + 0.004, open ? 0.09 : 0.016);
  n.connect(hp).connect(g).connect(out);
}
function shaker(k: Kit, out: AudioNode, t: number, vel: number) {
  const n = noiseSrc(k, t, 0.12, t * 5);
  const bp = new BiquadFilterNode(k.ctx, { type: "bandpass", frequency: 6200, Q: 1.4 });
  const g = gain(k);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.012);
  g.gain.setTargetAtTime(0, t + 0.015, 0.02);
  n.connect(bp).connect(g).connect(out);
}
function tom(k: Kit, out: AudioNode, t: number, vel: number, pitch = 120) {
  const o = osc(k, "sine", pitch);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.62, t + 0.25);
  const g = gain(k);
  g.gain.setValueAtTime(0.85 * vel, t);
  g.gain.setTargetAtTime(0, t + 0.02, 0.11);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.7);
  const n = noiseSrc(k, t, 0.05);
  const lp = new BiquadFilterNode(k.ctx, { type: "lowpass", frequency: 1800 });
  const ng = gain(k, 0.15 * vel);
  n.connect(lp).connect(ng).connect(out);
}
/** A taiko's boom, a cinematic hit: a deep falling sine and a thump. */
function boom(k: Kit, out: AudioNode, t: number, vel: number, note: number) {
  const f = Math.max(28, Math.min(55, midiHz(note)));
  const o = osc(k, "sine", f * 2.2);
  o.frequency.setValueAtTime(f * 2.2, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.22);
  const g = gain(k);
  g.gain.setValueAtTime(1.0 * vel, t);
  g.gain.setTargetAtTime(0, t + 0.1, 0.7);
  const sh = new WaveShaperNode(k.ctx, { curve: k.soft });
  o.connect(sh).connect(g).connect(out);
  o.start(t);
  o.stop(t + 3.5);
  const n = noiseSrc(k, t, 0.6);
  const lp = new BiquadFilterNode(k.ctx, { type: "lowpass", frequency: 260 });
  const ng = gain(k);
  ng.gain.setValueAtTime(0.7 * vel, t);
  ng.gain.setTargetAtTime(0, t + 0.01, 0.08);
  n.connect(lp).connect(ng).connect(out);
}
function crash(k: Kit, out: AudioNode, t: number, vel: number) {
  const n = noiseSrc(k, t, 3, t * 13);
  const hp = new BiquadFilterNode(k.ctx, { type: "highpass", frequency: 3800 });
  const pk = new BiquadFilterNode(k.ctx, { type: "peaking", frequency: 7200, Q: 1.2, gain: 8 });
  const g = gain(k);
  g.gain.setValueAtTime(0.32 * vel, t);
  g.gain.setTargetAtTime(0, t + 0.02, 0.75);
  n.connect(hp)
    .connect(pk)
    .connect(g)
    .connect(panTo(k, out, 0.25));
}
/** A riser: noise swept up through a band, a saw climbing two octaves under it. */
function riser(k: Kit, out: AudioNode, t: number, vel: number, dur: number) {
  const n = noiseSrc(k, t, dur + 0.1, t);
  const bp = new BiquadFilterNode(k.ctx, { type: "bandpass", frequency: 300, Q: 2.5 });
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
  const g = gain(k);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35 * vel, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.08);
  n.connect(bp).connect(g).connect(out);
  const o = osc(k, "sawtooth", 110);
  o.frequency.exponentialRampToValueAtTime(440, t + dur);
  const lp = new BiquadFilterNode(k.ctx, { type: "lowpass", frequency: 1500 });
  const og = gain(k);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.06 * vel, t + dur);
  og.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  o.connect(lp).connect(og).connect(out);
  o.start(t);
  o.stop(t + dur + 0.1);
}
/** Miller's tick: a dry wooden click. */
function tick(k: Kit, out: AudioNode, t: number, vel: number) {
  const n = noiseSrc(k, t, 0.05);
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

// ---- the bass
function sub(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const f = midiHz(note);
  const g = gain(k);
  const end = adsr(g, t, dur, 0.34 * vel, 0.008, 0.09);
  const sh = new WaveShaperNode(k.ctx, { curve: k.soft });
  const o1 = osc(k, "sine", f),
    o2 = osc(k, "triangle", f * 2);
  const g2 = gain(k, 0.12);
  o1.connect(sh);
  o2.connect(g2).connect(sh);
  sh.connect(g).connect(out);
  for (const o of [o1, o2]) {
    o.start(t);
    o.stop(end);
  }
}
function growl(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const f = midiHz(note);
  const g = gain(k);
  const end = adsr(g, t, dur, 0.28 * vel, 0.005, 0.06);
  const lp = new BiquadFilterNode(k.ctx, { type: "lowpass", frequency: 300, Q: 6 });
  lp.frequency.setValueAtTime(260, t);
  lp.frequency.exponentialRampToValueAtTime(1700, t + 0.04);
  lp.frequency.exponentialRampToValueAtTime(320, t + Math.max(0.12, dur));
  const sh = new WaveShaperNode(k.ctx, { curve: k.soft });
  for (const d of [-9, 9]) {
    const o = osc(k, "sawtooth", f, d);
    o.connect(lp);
    o.start(t);
    o.stop(end);
  }
  lp.connect(sh).connect(g).connect(out);
}

// ---- the pads
function pad(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number, kind: string) {
  const f = midiHz(note);
  const a = kind === "glass" ? 1.6 : 0.9;
  // (the chord's notes into one filter and one envelope: a pad's chord breathes as one)
  let end = t + Math.max(dur, a) + 1.85;
  const lp = shared(k, kind, t, out, end, () => {
    const g = gain(k);
    end = adsr(g, t, dur, (kind === "supersaw" ? 0.06 : 0.08) * vel, a, 1.8);
    const f = new BiquadFilterNode(k.ctx, { type: "lowpass", frequency: 800, Q: 0.5 });
    const top = kind === "supersaw" ? 2400 + 2000 * vel : kind === "warm" ? 1100 : 3800;
    f.frequency.setValueAtTime(top * 0.4, t);
    f.frequency.linearRampToValueAtTime(top, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(top * 0.55, t + dur + 1.5);
    f.connect(g).connect(out);
    return f;
  });
  const voices: [OscillatorType, number, number, number][] =
    kind === "supersaw"
      ? [
          ["sawtooth", -16, -0.8, 1.2],
          ["sawtooth", 0, 0, 1],
          ["sawtooth", 16, 0.8, 1.2],
        ]
      : kind === "warm"
        ? [
            ["sawtooth", -7, -0.5, 1],
            ["sawtooth", 7, 0.5, 1],
            ["triangle", 0, 0, 1.4],
          ]
        : [
            ["sine", -4, -0.6, 1.4],
            ["triangle", 4, 0.6, 0.8],
            ["sine", 1200, 0, 0.35],
            ["sine", 1902, 0.3, 0.12],
          ];
  for (const [type, det, pan, lvl] of voices) {
    const o = osc(k, type, f, det);
    const vg = gain(k, lvl);
    o.connect(vg).connect(panTo(k, lp, pan));
    o.start(t);
    o.stop(end);
  }
}

// ---- the arpeggio, the leads
function pluck(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const f = midiHz(note);
  const g = gain(k);
  g.gain.setValueAtTime(0.16 * vel, t);
  g.gain.setTargetAtTime(0, t + 0.005, Math.min(0.18, dur * 0.6));
  const lp = new BiquadFilterNode(k.ctx, { type: "lowpass", frequency: 4000, Q: 3 });
  lp.frequency.setValueAtTime(600 + 5000 * vel, t);
  lp.frequency.setTargetAtTime(500, t + 0.005, 0.07);
  const o = osc(k, "sawtooth", f);
  o.connect(lp);
  o.start(t);
  o.stop(t + Math.min(dur + 0.6, 0.9));
  lp.connect(g).connect(out);
}
function bell(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const f = midiHz(note);
  const c = osc(k, "sine", f);
  const m = osc(k, "sine", f * 3.5);
  const mg = gain(k);
  mg.gain.setValueAtTime(f * 2.2, t);
  mg.gain.setTargetAtTime(f * 0.15, t, 0.35);
  m.connect(mg).connect(c.frequency);
  const g = gain(k);
  g.gain.setValueAtTime(0.13 * vel, t);
  g.gain.setTargetAtTime(0, t + 0.003, 0.55 + dur * 0.1);
  c.connect(g).connect(out);
  for (const o of [c, m]) {
    o.start(t);
    o.stop(t + 2.6);
  }
}
function glass(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const f = midiHz(note);
  const g = gain(k);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.1 * vel, t + 0.01);
  g.gain.setTargetAtTime(0, t + 0.02, 0.3);
  for (const [r, l] of [
    [1, 1],
    [2, 0.3],
    [4.01, 0.12],
  ]) {
    const o = osc(k, "sine", f * r!);
    const og = gain(k, l);
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + 1.6);
  }
  g.connect(out);
}
function lead(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number, soft: boolean) {
  const f = midiHz(note);
  const g = gain(k);
  const end = adsr(g, t, dur, (soft ? 0.12 : 0.085) * vel, soft ? 0.05 : 0.015, soft ? 0.35 : 0.18);
  const lp = new BiquadFilterNode(k.ctx, { type: "lowpass", frequency: soft ? 1800 : 3200, Q: soft ? 0.5 : 1.5 });
  const vib = osc(k, "sine", 5.3);
  const vg = gain(k);
  vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(14, t + Math.min(0.4, dur));
  vib.connect(vg);
  const types: [OscillatorType, number][] = soft
    ? [
        ["triangle", 0],
        ["sine", 1200],
      ]
    : [
        ["sawtooth", -6],
        ["sawtooth", 6],
        ["square", -1200],
      ];
  for (const [type, d] of types) {
    const o = osc(k, type, f, d);
    vg.connect(o.detune);
    const og = gain(k, type === "square" ? 0.35 : type === "sine" ? 0.3 : 1);
    o.connect(og).connect(lp);
    o.start(t);
    o.stop(end);
  }
  vib.start(t);
  vib.stop(end);
  lp.connect(g).connect(out);
}

// ---- the ethereal guitar: Karplus–Strong strings
/** A plucked string's sound (Karplus–Strong: noise in a delay line averaged), cached per note and brightness. */
export function stringBuffer(k: Kit, note: number, bright: boolean): AudioBuffer {
  const key = `${note}|${bright}`;
  const hit = k.strings.get(key);
  if (hit) return hit;
  const sr = k.ctx.sampleRate;
  const f = midiHz(note);
  const N = Math.max(2, Math.round(sr / f));
  const len = Math.floor(sr * 3.2);
  const buf = k.ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const line = new Float32Array(N);
  let s = note * 7919 + (bright ? 13 : 0);
  // (the pick: noise, softened for the darker string)
  let prev = 0;
  for (let i = 0; i < N; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const x = (s / 0x7fffffff) * 2 - 1;
    prev = bright ? x : 0.5 * x + 0.5 * prev;
    line[i] = prev;
  }
  // (the loss per period: the string's ring ~3 s, the higher notes shorter; the brightness's averaging)
  const decay = 0.001 ** (1 / (f * (bright ? 2.4 : 3.2)));
  const a = bright ? 0.5 : 0.48;
  let p = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[p]!;
    const nxt = line[(p + 1) % N]!;
    const y = (a * cur + (1 - a) * nxt) * decay;
    line[p] = y;
    d[i] = cur;
    p = (p + 1) % N;
  }
  // (a fade at the end: no click)
  for (let i = 0; i < 2048; i++) d[len - 1 - i]! *= i / 2048;
  k.strings.set(key, buf);
  return buf;
}
function guitar(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number, kind: "pluck" | "swell" | "harmonic") {
  const harmonic = kind === "harmonic";
  const buf = stringBuffer(k, note, harmonic);
  const g = gain(k);
  const lvl = (harmonic ? 0.3 : 0.42) * vel;
  if (kind === "swell") {
    // (the volume pedal: the attack hidden, the string rising in)
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl * 1.4, t + Math.min(0.9, dur * 0.4));
    g.gain.setTargetAtTime(0, t + dur, 0.5);
  } else {
    g.gain.setValueAtTime(lvl, t);
    g.gain.setTargetAtTime(0, t + dur, 0.35);
  }
  // (a chorus: the string twice, one a hair late and detuned)
  const end = t + Math.min(3.1, dur + 1.5);
  for (const [det, delay, l] of [
    [0, 0, 1],
    [9, 0.012, 0.6],
  ] as const) {
    const s = new AudioBufferSourceNode(k.ctx, { buffer: buf, detune: det });
    const sg = gain(k, l);
    s.connect(sg).connect(g);
    s.start(t + delay);
    s.stop(end);
  }
  const hp = new BiquadFilterNode(k.ctx, { type: "highpass", frequency: harmonic ? 600 : 160 });
  g.connect(hp).connect(out);
}

// ---- the organ, the choir
function organ(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const f = midiHz(note);
  const g = gain(k);
  const end = adsr(g, t, dur, 0.07 * vel, Math.min(1.4, dur * 0.3), 2.2);
  g.connect(out);
  // (the drawbars in one wave on the note's octave below — its 16' —, a hair off the others)
  const o = new OscillatorNode(k.ctx, { periodicWave: k.organWave, frequency: f / 2, detune: ((note * 31) % 9) - 4 });
  o.connect(g);
  o.start(t);
  o.stop(end);
}
/** A choir's "ah": two detuned saws a voice, the chord's voices through one bank of the vowel's formants, a
 *  late vibrato. */
function choir(k: Kit, out: AudioNode, t: number, dur: number, note: number, vel: number) {
  const f = midiHz(note);
  let end = t + Math.max(dur, 1.2) + 2.05;
  const sum = shared(k, "choir", t, out, end, () => {
    const g = gain(k);
    end = adsr(g, t, dur, 0.065 * vel, 1.2, 2);
    g.connect(out);
    const s = gain(k, 1);
    for (const [fr, q, l] of [
      [730, 8, 1],
      [1090, 9, 0.5],
      [2440, 10, 0.25],
    ]) {
      const bp = new BiquadFilterNode(k.ctx, { type: "bandpass", frequency: fr!, Q: q! });
      const bg = gain(k, l! * 2.2);
      s.connect(bp).connect(bg).connect(g);
    }
    return s;
  });
  const vib = osc(k, "sine", 4.6 + (note % 5) * 0.07);
  const vg = gain(k);
  vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(18, t + 1.5);
  vib.connect(vg);
  for (const d of [-8, 8]) {
    const o = osc(k, "sawtooth", f, d);
    vg.connect(o.detune);
    o.connect(sum);
    o.start(t);
    o.stop(end);
  }
  vib.start(t);
  vib.stop(end);
}

/** Plays a note of an instrument by its name (music/composer.ts's), at `t` [ctx s], `dur` [s]. */
export function playNote(k: Kit, out: AudioNode, inst: string, t: number, dur: number, note: number, vel: number, pan = 0) {
  const o = panTo(k, out, pan);
  switch (inst) {
    case "kick":
      return kick(k, o, t, vel);
    case "snare":
      return snare(k, o, t, vel);
    case "clap":
      return clap(k, o, t, vel);
    case "hat":
      return hat(k, o, t, vel, false);
    case "openhat":
      return hat(k, o, t, vel, true);
    case "shaker":
      return shaker(k, o, t, vel);
    case "tom":
      return tom(k, o, t, vel, 95 + ((t * 37) % 1) * 70);
    case "boom":
      return boom(k, o, t, vel, note);
    case "crash":
      return crash(k, o, t, vel);
    case "riser":
      return riser(k, o, t, vel, dur);
    case "tick":
      return tick(k, o, t, vel);
    case "sub":
      return sub(k, o, t, dur, note, vel);
    case "growl":
      return growl(k, o, t, dur, note, vel);
    case "supersaw":
    case "warm":
    case "glass":
      return pad(k, o, t, dur, note, vel, inst);
    case "pluck":
      return pluck(k, o, t, dur, note, vel);
    case "bell":
      return bell(k, o, t, dur, note, vel);
    case "glassArp":
      return glass(k, o, t, dur, note, vel);
    case "lead":
      return lead(k, o, t, dur, note, vel, false);
    case "softlead":
      return lead(k, o, t, dur, note, vel, true);
    case "guitar":
      return guitar(k, o, t, dur, note, vel, "pluck");
    case "swell":
      return guitar(k, o, t, dur, note, vel, "swell");
    case "harmonic":
      return guitar(k, o, t, dur, note, vel, "harmonic");
    case "organ":
      return organ(k, o, t, dur, note, vel);
    case "choir":
      return choir(k, o, t, dur, note, vel);
  }
}

/** A hall's impulse response: stereo noise decaying over `secs`, darker as it fades (brighter: a plate). */
export function impulseResponse(ctx: Ctx, secs: number, bright: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * secs);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 777;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      s = (s * 1103515245 + 12345 + c) & 0x7fffffff;
      const x = (s / 0x7fffffff) * 2 - 1;
      const a = Math.min(0.95, (1 - bright) * 0.3 + 0.65 * k);
      lp = lp * a + x * (1 - a);
      // (a short pre-delay, the early reflections denser)
      const pre = i < ctx.sampleRate * 0.012 ? 0 : 1;
      d[i] = pre * lp * Math.exp(-6.9 * k) * 1.6;
    }
  }
  return ir;
}
