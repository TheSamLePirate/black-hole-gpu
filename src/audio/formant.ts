// TARS's voice (PLAN-TARS T5a): a formant synthesizer after Klatt's — phonemes (audio/g2p.ts) to samples.
// Each phoneme a target (its formants, how voiced, how much noise and where, how long); the targets in 5 ms
// frames, smoothed into one another (the transitions that make consonants heard); a voice source (Rosenberg's
// glottal pulse, differentiated: the lips' radiation) through second-order resonators in cascade (F1 … F4),
// a noise through its own resonator in parallel (the fricatives, the bursts, the aspiration); the stops their
// silence, burst and breath. The prosody is a robot's: the pitch in semitone steps, a step up on a stressed
// vowel, the phrase falling to its end, rising a little at a comma. Pure (a Float32Array out), fast (a few
// milliseconds a sentence).
//
// The vowels' formants: Peterson & Barney's (a man's voice); the consonants' loci from Klatt's. Its shape —
// a fifth formant, a little breath, the noise's gain — was chosen by measure: sentences transcribed by Whisper,
// 15–20 % of their words missed (the system's English voice: 4 %).

import { isVowel } from "./g2p";

interface Target {
  /** formants [Hz] at the start and (diphthongs) the end */
  f: [number, number, number];
  f2?: [number, number, number];
  /** duration [ms] */
  dur: number;
  /** voicing 0…1, the noise 0…1 and its centre [Hz] and bandwidth, aspiration (noise through the formants) */
  av: number;
  af?: number;
  fc?: number;
  bw?: number;
  ah?: number;
  /** nasal (a low extra resonance, the formants damped) */
  nasal?: boolean;
  /** a stop: its closure [ms], its burst's centre */
  stop?: { closure: number; burst: number; voiced: boolean; then?: string };
}

const V = (f1: number, f2: number, f3: number, dur: number, o: Partial<Target> = {}): Target => ({ f: [f1, f2, f3], dur, av: 1, ...o });
const DIPH = (a: [number, number, number], b: [number, number, number], dur: number): Target => ({ f: a, f2: b, dur, av: 1 });

export const TARGETS: Record<string, Target> = {
  i: V(280, 2250, 2890, 110),
  I: V(400, 1920, 2560, 80),
  e: V(400, 2100, 2700, 110),
  E: V(550, 1770, 2490, 100),
  ae: V(690, 1660, 2490, 120),
  a: V(750, 1350, 2500, 110),
  A: V(710, 1100, 2540, 120),
  O: V(590, 880, 2540, 120),
  o: V(400, 800, 2400, 110),
  U: V(450, 1030, 2380, 80),
  u: V(310, 870, 2250, 110),
  V: V(640, 1190, 2390, 90),
  "@": V(500, 1400, 2400, 60),
  "3": V(490, 1350, 1690, 110),
  aI: DIPH([710, 1100, 2540], [330, 2000, 2600], 170),
  eI: DIPH([480, 1800, 2500], [330, 2200, 2700], 150),
  oU: DIPH([500, 900, 2400], [350, 800, 2300], 150),
  aU: DIPH([710, 1100, 2540], [400, 870, 2300], 170),
  OI: DIPH([550, 850, 2500], [350, 2000, 2600], 170),
  l: V(360, 1300, 2700, 65, { av: 0.8 }),
  r: V(420, 1300, 1600, 65, { av: 0.8 }),
  w: V(300, 650, 2200, 55, { av: 0.8 }),
  j: V(280, 2200, 3000, 55, { av: 0.8 }),
  m: V(250, 1100, 2300, 70, { av: 0.55, nasal: true }),
  n: V(250, 1700, 2600, 65, { av: 0.55, nasal: true }),
  N: V(250, 2000, 2700, 75, { av: 0.55, nasal: true }),
  f: V(340, 1100, 2300, 95, { av: 0, af: 0.22, fc: 6000, bw: 4000 }),
  T: V(320, 1400, 2600, 95, { av: 0, af: 0.18, fc: 5000, bw: 4000 }),
  s: V(320, 1700, 2700, 105, { av: 0, af: 0.6, fc: 6000, bw: 2000 }),
  S: V(300, 1900, 2500, 105, { av: 0, af: 0.6, fc: 2800, bw: 1600 }),
  h: V(500, 1500, 2500, 65, { av: 0, ah: 0.45 }),
  v: V(320, 1100, 2300, 75, { av: 0.5, af: 0.12, fc: 6000, bw: 4000 }),
  D: V(320, 1400, 2600, 60, { av: 0.5, af: 0.1, fc: 5000, bw: 4000 }),
  z: V(320, 1700, 2700, 80, { av: 0.45, af: 0.35, fc: 6000, bw: 2000 }),
  Z: V(300, 1900, 2500, 80, { av: 0.45, af: 0.35, fc: 2800, bw: 1600 }),
  p: V(400, 800, 2200, 0, { av: 0, stop: { closure: 70, burst: 1200, voiced: false } }),
  t: V(400, 1800, 2600, 0, { av: 0, stop: { closure: 60, burst: 4000, voiced: false } }),
  k: V(400, 2200, 2500, 0, { av: 0, stop: { closure: 70, burst: 2200, voiced: false } }),
  b: V(300, 800, 2200, 0, { av: 0, stop: { closure: 60, burst: 1200, voiced: true } }),
  d: V(300, 1800, 2600, 0, { av: 0, stop: { closure: 50, burst: 4000, voiced: true } }),
  g: V(300, 2200, 2500, 0, { av: 0, stop: { closure: 60, burst: 2200, voiced: true } }),
  tS: V(400, 1900, 2500, 0, { av: 0, stop: { closure: 60, burst: 3000, voiced: false, then: "S" } }),
  dZ: V(300, 1900, 2500, 0, { av: 0, stop: { closure: 50, burst: 3000, voiced: true, then: "Z" } }),
};

/** A frame of the synthesis' parameters (5 ms). */
interface Frame {
  f: [number, number, number];
  av: number;
  af: number;
  fc: number;
  bw: number;
  ah: number;
  nasal: number;
  f0: number;
}

const FRAME_MS = 5;

/** The frames of a phoneme string: each phoneme's target held its duration (stops: closure, burst,
 *  aspiration), the pauses, the pitch — before the smoothing. */
export function frames(ph: string[], o: { f0?: number; rate?: number; steps?: number } = {}): Frame[] {
  const base = o.f0 ?? 98,
    rate = o.rate ?? 1;
  const out: Frame[] = [];
  const semis = (n: number) => base * 2 ** (n / 12);
  // the phrase: its vowels counted, to fall along it
  let vowelsLeft = ph.filter((p) => isVowel(p)).length;
  let step = 0;
  const silent = (ms: number, f: [number, number, number]) => {
    for (let k = 0; k < Math.round(ms / rate / FRAME_MS); k++)
      out.push({ f, av: 0, af: 0, fc: 3000, bw: 2000, ah: 0, nasal: 0, f0: semis(step) });
  };
  for (let i = 0; i < ph.length; i++) {
    const p0 = ph[i]!;
    if (p0 === "|") continue;
    const last = out[out.length - 1]?.f ?? ([500, 1500, 2500] as [number, number, number]);
    if (p0 === "," || p0 === ".") {
      silent(p0 === "," ? 160 : 340, last);
      // (a comma: a step up; a full stop: the next phrase from the top)
      step = p0 === "," ? Math.min(step + 1, 2) : 0;
      if (p0 === ".") vowelsLeft = ph.slice(i + 1).filter((p) => isVowel(p)).length;
      continue;
    }
    const stressed = p0.endsWith("'");
    const p = p0.replace("'", "");
    const T = TARGETS[p];
    if (!T) continue;
    if (isVowel(p)) {
      // (the robot's pitch: a step up stressed, the phrase falling, the last vowel of a phrase a fall)
      vowelsLeft--;
      const next = ph.slice(i + 1).find((x) => x !== "|");
      const final = next === "." || next === undefined;
      step =
        ((stressed ? 2 : 0) - (final ? 3 : 0)) * (o.steps ?? 1) -
        Math.min(3, Math.floor((1 - vowelsLeft / Math.max(vowelsLeft + 4, 1)) * 2));
    }
    const f0 = semis(step);
    if (T.stop) {
      const s = T.stop;
      // closure: silence (a voiced stop's low voice bar), the burst, then (voiceless) a breath
      const n = Math.round(s.closure / rate / FRAME_MS);
      for (let k = 0; k < n; k++) out.push({ f: T.f, av: s.voiced ? 0.15 : 0, af: 0, fc: s.burst, bw: 2000, ah: 0, nasal: 0, f0 });
      out.push({ f: T.f, av: s.voiced ? 0.3 : 0, af: 0.9, fc: s.burst, bw: s.burst * 0.8, ah: 0, nasal: 0, f0 });
      out.push({ f: T.f, av: s.voiced ? 0.3 : 0, af: 0.5, fc: s.burst, bw: s.burst * 0.8, ah: 0, nasal: 0, f0 });
      if (s.then) {
        const F = TARGETS[s.then]!;
        for (let k = 0; k < Math.round(70 / rate / FRAME_MS); k++)
          out.push({ f: F.f, av: s.voiced ? 0.4 : 0, af: F.af ?? 0, fc: F.fc ?? 3000, bw: F.bw ?? 2000, ah: 0, nasal: 0, f0 });
      } else if (!s.voiced)
        for (let k = 0; k < Math.round(30 / rate / FRAME_MS); k++)
          out.push({ f: T.f, av: 0, af: 0, fc: 3000, bw: 2000, ah: 0.35, nasal: 0, f0 });
      continue;
    }
    const dur = (T.dur * (stressed ? 1.3 : 1)) / rate;
    const n = Math.max(2, Math.round(dur / FRAME_MS));
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      const f: [number, number, number] = T.f2
        ? ([0, 1, 2].map((j) => T.f[j]! + (T.f2![j]! - T.f[j]!) * Math.min(1, Math.max(0, (u - 0.3) / 0.6))) as [number, number, number])
        : T.f;
      out.push({ f, av: T.av, af: T.af ?? 0, fc: T.fc ?? 3000, bw: T.bw ?? 2000, ah: T.ah ?? 0, nasal: T.nasal ? 1 : 0, f0 });
    }
  }
  return out;
}

/** The frames smoothed: the formants over ±20 ms (the transitions), the amplitudes over ±10 ms. */
export function smooth(F: Frame[]): Frame[] {
  const avg = (k: number, w: number, get: (x: Frame) => number) => {
    let s = 0,
      n = 0;
    for (let j = Math.max(0, k - w); j <= Math.min(F.length - 1, k + w); j++) (s += get(F[j]!)), n++;
    return s / n;
  };
  return F.map((x, k) => ({
    ...x,
    f: [0, 1, 2].map((j) => avg(k, 4, (y) => y.f[j]!)) as [number, number, number],
    av: avg(k, 2, (y) => y.av),
    af: x.af > 0.8 ? x.af : avg(k, 1, (y) => y.af),
    ah: avg(k, 2, (y) => y.ah),
    nasal: avg(k, 3, (y) => y.nasal),
  }));
}

/** A second-order resonator (Klatt): its coefficients for a frequency and a bandwidth at a sample rate. */
function reson(f: number, bw: number, sr: number): [number, number, number] {
  const T = 1 / sr;
  const C = -Math.exp(-2 * Math.PI * bw * T);
  const B = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * f * T);
  return [1 - B - C, B, C];
}

/** The samples of a phoneme string at `sr` (a few milliseconds a sentence). */
export interface VoiceShape {
  /** the base pitch [Hz], the speaking rate (1: the targets' durations) */
  f0?: number;
  rate?: number;
  /** the formants' bandwidths scaled (narrower: brighter, more ringing) */
  bw?: number;
  /** the robot's pitch steps scaled (0: a flat voice, its phrase still falling) */
  steps?: number;
  /** the noise's gain (the fricatives, the bursts) against the voice's: their clarity */
  fric?: number;
  /** a fifth formant (4500 Hz): the voice's top (on unless false) */
  f5?: boolean;
  /** breath in the voice (noise in the glottis' open phase) 0…0.2 (0.05 unless given) */
  breath?: number;
  seed?: number;
}

export function synthesize(ph: string[], sr = 22050, o: VoiceShape = {}): Float32Array {
  const F = smooth(frames(ph, o));
  const per = Math.round((sr * FRAME_MS) / 1000);
  const out = new Float32Array(F.length * per + Math.round(sr * 0.05));
  // the resonators' states: F1–F4 (cascade), the nasal pole, the noise's
  const st = new Float64Array(16);
  const bws = o.bw ?? 1,
    breath = o.breath ?? 0.05,
    fricGain = o.fric ?? 0.6;
  let phase = 0,
    prevG = 0;
  let seed = o.seed ?? 12345;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 31 - 1;
  };
  const run = (x: number, k: number, c: [number, number, number]) => {
    const y = c[0] * x + c[1] * st[k]! + c[2] * st[k + 1]!;
    st[k + 1] = st[k]!;
    st[k] = y;
    return y;
  };
  let n = 0;
  for (const fr of F) {
    const bwScale = 1 + fr.nasal * 0.8;
    const r1 = reson(fr.f[0], 80 * bwScale * bws, sr),
      r2 = reson(fr.f[1], 100 * bwScale * bws, sr),
      r3 = reson(fr.f[2], 140 * bws, sr),
      r4 = reson(3500, 250 * bws, sr),
      r5 = reson(4500, 300 * bws, sr),
      rn = reson(270, 100, sr),
      rf = reson(Math.min(fr.fc, sr * 0.45), Math.min(fr.bw, sr * 0.4), sr);
    for (let k = 0; k < per; k++, n++) {
      // the voice: Rosenberg's pulse (open 40 %, closing 20 %), differentiated
      phase += fr.f0 / sr;
      if (phase >= 1) phase -= 1;
      const g = phase < 0.4 ? 0.5 * (1 - Math.cos((Math.PI * phase) / 0.4)) : phase < 0.6 ? Math.cos((Math.PI * (phase - 0.4)) / 0.4) : 0;
      const dg = (g - prevG) * 8;
      prevG = g;
      const nz = noise();
      // the voiced path and the aspiration through the vocal tract's formants (the nasal pole beside)
      const src = dg * fr.av + nz * (fr.ah * 0.6 + (phase < 0.6 ? breath * fr.av : 0));
      let v = run(run(run(run(src, 0, r1), 2, r2), 4, r3), 6, r4);
      if (o.f5 !== false) v = run(v, 12, r5);
      if (fr.nasal > 0) v = v * (1 - 0.5 * fr.nasal) + run(dg * fr.av, 8, rn) * fr.nasal * 2;
      // the frication: noise through its own resonance, in parallel
      const fric = run(nz * fr.af, 10, rf) * fricGain;
      out[n] = v * 0.5 + fric;
    }
  }
  // normalized to −3 dBFS peak
  let pk = 0;
  for (const x of out) pk = Math.max(pk, Math.abs(x));
  if (pk > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i]! / pk) * 0.7;
  return out;
}
