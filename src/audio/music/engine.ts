// The music engine: themes (music/themes.ts) composed bar by bar (music/composer.ts) and played by the band
// (music/instruments.ts) a little ahead of the clock; a theme changed on the bar — the old one faded out as the
// new one comes in —; the flight's intensity eased into the energy; the mixer: a bus per layer (its level, its
// mute, a solo, a meter), the kick ducking the sub, the pads and the arpeggio (a sidechain's pump), the reverbs
// (a hall, a plate, a cathedral — impulse responses made here), a ping-pong delay on the beat, a glue compressor
// and a limiter, the spectrum. Any context: the game's (the music bus), or an offline one (a theme rendered).

import { type BarPlan, composeBar } from "./composer";
import { impulseResponse, type Kit, makeKit, playNote } from "./instruments";
import { type Layer, LAYERS, type Theme, THEME_BY_ID } from "./themes";

export type ReverbKind = "hall" | "plate" | "cathedral";

/** The mixer's levels (0 … 1.5; 1: as mixed), the reverb's and the delay's returns, the sidechain's depth. */
export interface MusicMix {
  master: number;
  drums: number;
  bass: number;
  pad: number;
  arp: number;
  lead: number;
  guitar: number;
  organ: number;
  choir: number;
  reverb: number;
  delay: number;
  pump: number;
}
export const DEFAULT_MIX: MusicMix = {
  master: 0.9,
  drums: 1,
  bass: 1,
  pad: 1,
  arp: 1,
  lead: 1,
  guitar: 1,
  organ: 1,
  choir: 1,
  reverb: 1,
  delay: 1,
  pump: 1,
};

/** Each layer's sends to the reverb and the delay (× the theme's own). */
const SEND: Record<Layer, [number, number]> = {
  drums: [0.18, 0],
  bass: [0, 0],
  pad: [0.55, 0.12],
  arp: [0.45, 0.45],
  lead: [0.35, 0.4],
  guitar: [0.85, 0.7],
  organ: [0.75, 0],
  choir: [0.8, 0.1],
};
/** How deep the kick ducks each layer (the sidechain). */
const DUCK: Partial<Record<Layer, number>> = { bass: 0.6, pad: 0.35, arp: 0.25, guitar: 0.2, choir: 0.2 };

interface Track {
  theme: Theme;
  /** its bar 0's time, the next bar to compose and when [ctx s] */
  t0: number;
  bar: number;
  at: number;
  layers: Record<Layer, GainNode>;
  sends: GainNode[];
  prev: number[] | null;
  stopping: boolean;
  endAt: number;
  /** the bars composed (the panel shows the one playing) */
  plans: BarPlan[];
  nextTick: number;
}

export interface MusicState {
  playing: boolean;
  theme: string | null;
  name: string;
  bpm: number;
  section: string;
  bar: number;
  beat: number;
  energy: number;
  intensity: number;
  chord: number[];
  /** the chord's root (MIDI; NaN: none) */
  root: number;
  /** the notes started (all of them) */
  notes: number;
}

export class MusicEngine {
  readonly kit: Kit;
  readonly analyser: AnalyserNode;
  private input: GainNode;
  private master: GainNode;
  private buses = {} as Record<Layer, { mix: GainNode; duck: GainNode; meter: AnalyserNode }>;
  private reverbs = {} as Partial<Record<ReverbKind, { conv: ConvolverNode; ret: GainNode }>>;
  private delayIn: GainNode;
  private delayL: DelayNode;
  private delayR: DelayNode;
  private delayFb: GainNode;
  private delayRet: GainNode;
  private tracks: Track[] = [];
  mix: MusicMix = { ...DEFAULT_MIX };
  muted = new Set<Layer>();
  solo: Layer | null = null;
  /** the intensity asked (0 … 1) and the one eased to; the variation (another melody) */
  intensityWant = 0.5;
  intensity = 0.5;
  seed = 0;
  notes = 0;
  ticks = 0;

  constructor(
    readonly ctx: BaseAudioContext,
    out: AudioNode,
  ) {
    this.kit = makeKit(ctx);
    this.input = new GainNode(ctx, { gain: 1 });
    const glue = new DynamicsCompressorNode(ctx, { threshold: -16, knee: 8, ratio: 2.5, attack: 0.02, release: 0.25 });
    const limit = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.12 });
    this.master = new GainNode(ctx, { gain: this.mix.master });
    this.analyser = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0.8, minDecibels: -90, maxDecibels: -12 });
    this.input.connect(glue).connect(limit).connect(this.master).connect(this.analyser);
    this.master.connect(out);
    for (const l of LAYERS) {
      const duck = new GainNode(ctx, { gain: 1 });
      const mix = new GainNode(ctx, { gain: 1 });
      const meter = new AnalyserNode(ctx, { fftSize: 256 });
      duck.connect(mix).connect(this.input);
      mix.connect(meter);
      this.buses[l] = { mix, duck, meter };
    }
    // (the ping-pong delay: left into right into left, darkened each time round)
    this.delayIn = new GainNode(ctx, { gain: 1 });
    this.delayL = new DelayNode(ctx, { maxDelayTime: 3, delayTime: 0.375 });
    this.delayR = new DelayNode(ctx, { maxDelayTime: 3, delayTime: 0.375 });
    this.delayFb = new GainNode(ctx, { gain: 0.4 });
    const tone = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 4200 });
    const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    this.delayRet = new GainNode(ctx, { gain: 0.5 });
    this.delayIn.connect(this.delayL);
    this.delayL.connect(this.delayR);
    this.delayR.connect(tone).connect(this.delayFb).connect(this.delayL);
    this.delayL.connect(merge, 0, 0);
    this.delayR.connect(merge, 0, 1);
    merge.connect(this.delayRet).connect(this.input);
    this.applyMix();
  }

  private reverb(kind: ReverbKind) {
    let r = this.reverbs[kind];
    if (!r) {
      const [secs, bright] = kind === "cathedral" ? [6.5, 0.35] : kind === "plate" ? [2, 0.85] : [3.4, 0.55];
      const conv = new ConvolverNode(this.ctx, { buffer: impulseResponse(this.ctx, secs, bright) });
      const ret = new GainNode(this.ctx, { gain: this.mix.reverb });
      conv.connect(ret).connect(this.input);
      r = this.reverbs[kind] = { conv, ret };
    }
    return r;
  }

  /** The mixer's levels, mutes and solo applied (eased: no click). */
  applyMix() {
    const t = this.ctx.currentTime;
    for (const l of LAYERS) {
      const on = !this.muted.has(l) && (!this.solo || this.solo === l);
      this.buses[l].mix.gain.setTargetAtTime(on ? this.mix[l] : 0, t, 0.05);
    }
    for (const r of Object.values(this.reverbs)) r?.ret.gain.setTargetAtTime(this.mix.reverb, t, 0.05);
    this.delayRet.gain.setTargetAtTime(0.5 * this.mix.delay, t, 0.05);
    this.master.gain.setTargetAtTime(this.mix.master, t, 0.05);
  }

  /** The theme playing (the last asked), or null. */
  get current(): Track | null {
    return [...this.tracks].reverse().find((t) => !t.stopping) ?? null;
  }

  /**
   * A theme started: on the bar of the one playing (crossfaded over `fade` s; 0: a cut), or `now` + 0.1 s.
   */
  play(id: string, now: number, fade = 2.5) {
    const theme = THEME_BY_ID[id];
    if (!theme) return;
    const cur = this.current;
    if (cur?.theme.id === id) return;
    // (on the playing theme's next bar, unless it is far: then at once)
    const at = cur && cur.at - now < 3 && cur.at > now + 0.05 ? cur.at : now + 0.1;
    if (cur) this.release(cur, at, fade);
    const ctx = this.ctx;
    const layers = {} as Record<Layer, GainNode>;
    const sends: GainNode[] = [];
    const rev = this.reverb(theme.fx.reverb);
    for (const l of LAYERS) {
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(1, at + Math.max(0.05, fade * 0.8));
      g.connect(this.buses[l].duck);
      const [rs, ds] = SEND[l];
      if (rs > 0) {
        const s = new GainNode(ctx, { gain: rs * theme.fx.wet });
        g.connect(s).connect(rev.conv);
        sends.push(s);
      }
      if (ds > 0) {
        const s = new GainNode(ctx, { gain: ds });
        g.connect(s).connect(this.delayIn);
        sends.push(s);
      }
      layers[l] = g;
    }
    // (the delay on this theme's beat)
    const dly = Math.min(2.9, (60 / theme.bpm) * theme.fx.delay);
    for (const d of [this.delayL, this.delayR]) d.delayTime.setValueAtTime(dly, at);
    this.delayFb.gain.setValueAtTime(theme.fx.feedback, at);
    this.tracks.push({ theme, t0: at, bar: 0, at, layers, sends, prev: null, stopping: false, endAt: Infinity, plans: [], nextTick: at });
  }

  private release(tr: Track, at: number, fade: number) {
    tr.stopping = true;
    tr.endAt = at + Math.max(0.05, fade) + 3;
    for (const g of Object.values(tr.layers)) {
      g.gain.cancelScheduledValues(at);
      g.gain.setValueAtTime(g.gain.value, at);
      g.gain.linearRampToValueAtTime(0, at + Math.max(0.05, fade));
    }
  }

  /** Everything faded out over `fade` s from `now`. */
  stop(now: number, fade = 3) {
    for (const tr of this.tracks) if (!tr.stopping) this.release(tr, now, fade);
  }

  /** The bars due composed and scheduled (`ahead` s ahead of `now`); the intensity eased. */
  pump(now: number, dt = 0, ahead = 0.4) {
    if (dt > 0) this.intensity += (this.intensityWant - this.intensity) * (1 - Math.exp(-dt / 4));
    for (const tr of this.tracks) {
      const spb = 60 / tr.theme.bpm;
      // (the playing theme's bars ahead — a fading one's too, until its fade is done)
      while (tr.at < now + ahead && tr.at < tr.endAt - 3) {
        const plan = composeBar(tr.theme, tr.bar, this.intensity, this.seed, tr.prev);
        tr.prev = plan.chord;
        tr.plans.push(plan);
        if (tr.plans.length > 6) tr.plans.shift();
        for (const e of plan.events) {
          const t = tr.at + e.beat * spb;
          playNote(this.kit, tr.layers[e.layer], e.inst, t, e.dur * spb, e.note, e.vel, e.pan ?? 0);
          this.notes++;
          if (e.inst === "kick") this.duck(t, e.vel);
        }
        tr.bar++;
        tr.at += 4 * spb;
      }
      if (tr.theme.tick)
        while (tr.nextTick < now + ahead && tr.nextTick < tr.endAt - 3) {
          playNote(this.kit, tr.layers.drums, "tick", tr.nextTick, 0.05, 0, 0.8);
          this.ticks++;
          tr.nextTick += tr.theme.tick;
        }
    }
    // (the faded ones let go)
    for (const tr of this.tracks.filter((x) => x.stopping && now > x.endAt)) {
      for (const g of Object.values(tr.layers)) g.disconnect();
      for (const s of tr.sends) s.disconnect();
    }
    this.tracks = this.tracks.filter((x) => !(x.stopping && now > x.endAt));
  }

  /** The kick's sidechain: the sub, the pads, the arpeggio ducked and back over ~0.2 s. */
  private duck(t: number, vel: number) {
    const k = this.mix.pump;
    if (k <= 0) return;
    for (const [l, depth] of Object.entries(DUCK) as [Layer, number][]) {
      const g = this.buses[l].duck.gain;
      g.setValueAtTime(1 - Math.min(0.9, depth * k * vel), t);
      g.setTargetAtTime(1, t + 0.012, 0.07);
    }
  }

  /** What plays now (the panel). */
  state(now: number): MusicState {
    const tr = this.current;
    if (!tr)
      return {
        playing: false,
        theme: null,
        name: "",
        bpm: 0,
        section: "",
        bar: 0,
        beat: 0,
        energy: 0,
        intensity: this.intensity,
        chord: [],
        root: Number.NaN,
        notes: this.notes,
      };
    const spb = 60 / tr.theme.bpm;
    const pos = Math.max(0, (now - tr.t0) / spb);
    const bar = Math.floor(pos / 4);
    const plan = tr.plans.find((p) => p.bar === bar) ?? tr.plans[0];
    return {
      playing: true,
      theme: tr.theme.id,
      name: tr.theme.name,
      bpm: tr.theme.bpm,
      section: plan?.section.name ?? "",
      bar,
      beat: pos % 4,
      energy: plan?.energy ?? 0,
      intensity: this.intensity,
      chord: plan?.chord ?? [],
      root: plan?.root ?? Number.NaN,
      notes: this.notes,
    };
  }

  /** Each layer's level now [dBFS, RMS] (the panel's meters). */
  levels(): Record<Layer, number> {
    const out = {} as Record<Layer, number>;
    const buf = new Float32Array(256);
    for (const l of LAYERS) {
      this.buses[l].meter.getFloatTimeDomainData(buf);
      let s = 0;
      for (const x of buf) s += x * x;
      out[l] = 10 * Math.log10(s / buf.length + 1e-12);
    }
    return out;
  }
}
