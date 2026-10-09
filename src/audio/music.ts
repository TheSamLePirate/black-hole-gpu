// The score played (PLAN-TARS T4): a moment's piece (audio/score.ts) synthesized in the game's AudioContext,
// on the engine's music bus — nothing to download. The organ is additive: each note its pipes' partials (the
// drawbars 16', 8', 4', 2 2/3', 2'), sines a hair apart, a slow attack and release, a wide hall's reverb (an
// impulse response made of decaying noise); the pads two detuned saws under a slowly breathing low-pass; the
// pedal the root two octaves down; Miller's tick a dry click. A piece fades in, its chords turn every
// `chordS`, it fades out when its moment is over; a new moment crossfades.

import { hz, type Moment, PIECES, type Piece } from "./score";

/** The organ's drawbars: each partial's ratio to the note and its level. */
const DRAWBARS: [number, number][] = [
  [0.5, 0.35],
  [1, 1],
  [2, 0.55],
  [3, 0.22],
  [4, 0.28],
];

interface Playing {
  moment: Moment;
  piece: Piece;
  gain: GainNode;
  /** the next chord's index and when it starts [ctx s] */
  next: number;
  at: number;
  nextTick: number;
  stopping: boolean;
}

export class Music {
  private reverb: ConvolverNode | null = null;
  private dry: GainNode | null = null;
  private playing: Playing[] = [];
  /** the moment playing now (none: silence) */
  moment: Moment | null = null;
  /** notes started (the tests: the score heard) */
  notes = 0;
  ticks = 0;

  constructor(private out: () => { ctx: AudioContext; bus: GainNode } | null) {}

  /** The moment now (none: silence); called every frame. */
  update(m: Moment | null) {
    const o = this.out();
    if (!o) return;
    const { ctx } = o;
    this.ensure(o.ctx, o.bus);
    const t = ctx.currentTime;
    if (m !== this.moment) {
      // the old piece fades out, the new one in
      for (const p of this.playing)
        if (!p.stopping) {
          p.stopping = true;
          p.gain.gain.cancelScheduledValues(t);
          p.gain.gain.setTargetAtTime(0, t, p.piece.fadeOut / 3);
          const g = p.gain;
          setTimeout(() => g.disconnect(), p.piece.fadeOut * 1000 + 2000);
        }
      this.moment = m;
      if (m) {
        const piece = PIECES[m];
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.gain.setTargetAtTime(piece.level, t, piece.fadeIn / 3);
        gain.connect(this.dry!);
        gain.connect(this.reverb!);
        this.playing.push({ moment: m, piece, gain, next: 0, at: t + 0.05, nextTick: t + 0.5, stopping: false });
      }
    }
    this.playing = this.playing.filter((p) => !p.stopping || t < p.at + p.piece.fadeOut + 2);
    // the chords, scheduled a little ahead
    for (const p of this.playing) {
      if (p.stopping) continue;
      while (p.at < t + 0.5) {
        const chord = p.piece.chords[p.next % p.piece.chords.length]!;
        this.chord(ctx, p.gain, p.piece, chord, p.at, p.piece.chordS);
        p.next++;
        p.at += p.piece.chordS;
      }
      if (p.piece.tick > 0)
        while (p.nextTick < t + 0.3) {
          this.tick(ctx, p.gain, p.nextTick);
          p.nextTick += p.piece.tick;
        }
    }
  }

  /** Everything stopped at once (the sound off, a new scene). */
  stop() {
    for (const p of this.playing) p.gain.disconnect();
    this.playing = [];
    this.moment = null;
  }

  private ensure(ctx: AudioContext, bus: GainNode) {
    if (this.reverb) return;
    // a hall: 4.5 s of decaying stereo noise, darker as it fades
    const len = Math.floor(ctx.sampleRate * 4.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        const a = 0.25 + 0.7 * k;
        lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
        d[i] = lp * (1 - k) ** 2.2 * 3;
      }
    }
    this.reverb = new ConvolverNode(ctx, { buffer: ir });
    const wet = new GainNode(ctx, { gain: 0.55 });
    this.dry = new GainNode(ctx, { gain: 0.6 });
    this.reverb.connect(wet).connect(bus);
    this.dry.connect(bus);
  }

  /** A chord held from `at` for `dur` seconds: the organ's pipes, the pads, the pedal. */
  private chord(ctx: AudioContext, out: GainNode, P: Piece, notes: number[], at: number, dur: number) {
    const atk = Math.min(1.6, dur * 0.3),
      rel = Math.min(2.5, dur * 0.45);
    const env = (g: GainNode, level: number) => {
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level, at + atk);
      g.gain.setValueAtTime(level, at + dur);
      g.gain.linearRampToValueAtTime(0, at + dur + rel);
    };
    const end = at + dur + rel + 0.05;
    const per = 1 / Math.sqrt(notes.length);
    for (const n of notes) {
      const f = hz(n);
      this.notes++;
      if (P.organ > 0) {
        const g = ctx.createGain();
        env(g, 0.12 * P.organ * per);
        g.connect(out);
        for (const [ratio, lvl] of DRAWBARS) {
          const fr = f * ratio;
          if (fr > 6000) continue;
          const o = new OscillatorNode(ctx, { type: "sine", frequency: fr, detune: (Math.random() - 0.5) * 4 });
          const og = new GainNode(ctx, { gain: lvl });
          o.connect(og).connect(g);
          o.start(at);
          o.stop(end);
        }
      }
      if (P.pad > 0) {
        const g = ctx.createGain();
        env(g, 0.055 * P.pad * per);
        const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 700, Q: 0.4 });
        lp.frequency.setValueAtTime(500, at);
        lp.frequency.linearRampToValueAtTime(1300, at + dur * 0.6);
        lp.frequency.linearRampToValueAtTime(600, end);
        lp.connect(g).connect(out);
        for (const d of [-7, 7]) {
          const o = new OscillatorNode(ctx, { type: "sawtooth", frequency: f, detune: d });
          o.connect(lp);
          o.start(at);
          o.stop(end);
        }
      }
    }
    if (P.pedal > 0) {
      const root = Math.min(...notes);
      const g = ctx.createGain();
      env(g, 0.14 * P.pedal);
      g.connect(out);
      for (const [ratio, lvl] of [
        [0.25, 1],
        [0.5, 0.5],
      ] as const) {
        const o = new OscillatorNode(ctx, { type: "sine", frequency: hz(root) * ratio });
        const og = new GainNode(ctx, { gain: lvl });
        o.connect(og).connect(g);
        o.start(at);
        o.stop(end);
      }
    }
  }

  /** Miller's tick: a dry wooden click (a band of noise, a short high partial). */
  private tick(ctx: AudioContext, out: GainNode, at: number) {
    this.ticks++;
    const len = Math.floor(ctx.sampleRate * 0.05);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.006));
    const src = new AudioBufferSourceNode(ctx, { buffer: b });
    const bp = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 2400, Q: 3 });
    const g = new GainNode(ctx, { gain: 0.5 });
    src.connect(bp).connect(g).connect(out);
    src.start(at);
    const o = new OscillatorNode(ctx, { type: "sine", frequency: 1760 });
    const og = new GainNode(ctx, { gain: 0 });
    og.gain.setValueAtTime(0.12, at);
    og.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    o.connect(og).connect(out);
    o.start(at);
    o.stop(at + 0.06);
  }
}
