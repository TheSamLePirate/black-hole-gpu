// The music engine: themes (music/themes.ts) composed bar by bar (music/composer.ts) and played by the orchestra
// (music/instruments.ts) a little ahead of the clock; a theme changed on the bar — the old one faded out as the
// new one comes in —; the flight's intensity eased into the energy; the mixer: a bus per section of the orchestra
// (its level, its mute, a solo, a meter), the reverbs (a hall, a plate, a cathedral — impulse responses made here),
// a ping-pong delay on the beat (the harp's and the celesta's only, lightly), a gentle glue compressor and a
// limiter, the spectrum. Any context: the game's (the music bus), or an offline one (a theme rendered).

import { type BarPlan, composeBar, type NoteEvent } from "./composer";
import { adoptRendered, impulseResponse, type Kit, makeKit, type NoteJob, playNote, prepareNote } from "./instruments";
import { cpuWorkerAvailable, impulseOff, renderNotesOff } from "../../system/cpu-client";
import { beatsOf, type Layer, LAYERS, type Theme, THEME_BY_ID } from "./themes";

export type ReverbKind = "hall" | "plate" | "cathedral";

/** The mixer's levels (0 … 1.5; 1: as mixed), the reverb's and the delay's returns. */
export interface MusicMix {
  master: number;
  perc: number;
  bass: number;
  strings: number;
  ostinato: number;
  brass: number;
  melody: number;
  keys: number;
  organ: number;
  choir: number;
  reverb: number;
  delay: number;
}
export const DEFAULT_MIX: MusicMix = {
  master: 0.9,
  perc: 1,
  bass: 1,
  strings: 1,
  ostinato: 1,
  brass: 1,
  melody: 1,
  keys: 1,
  organ: 1,
  choir: 1,
  reverb: 1,
  delay: 1,
};

/** Each section's sends to the reverb and the delay (× the theme's own). */
const SEND: Record<Layer, [number, number]> = {
  perc: [0.32, 0],
  bass: [0.25, 0],
  strings: [0.6, 0],
  ostinato: [0.4, 0.05],
  brass: [0.55, 0],
  melody: [0.5, 0.05],
  keys: [0.6, 0.35],
  organ: [0.75, 0],
  choir: [0.8, 0],
};

/** The bars of a theme foreseen when it starts (at a calm and a full intensity): its likely rendered notes. */
const FORESEE = 16;
/** the rendered notes sent to the CPU worker at once (one message), and the longest a theme waits for its first bar's [s] */
const BATCH = 4;
const HOLD_S = 0.6;
/** the reverbs' impulse responses: length [s], brightness */
const REVERBS: Record<ReverbKind, [number, number]> = { cathedral: [7, 0.32], plate: [2.2, 0.75], hall: [3.2, 0.5] };

interface Track {
  theme: Theme;
  /** its bar 0's time, the next bar to play and when [ctx s] */
  t0: number;
  bar: number;
  at: number;
  /** that bar composed ahead (its rendered notes made in the frames before it plays), or null */
  next: BarPlan | null;
  /** its entry's ramp [ctx s] (0 to 1 between them) */
  fadeIn: [number, number];
  layers: Record<Layer, GainNode>;
  sends: GainNode[];
  prev: number[] | null;
  stopping: boolean;
  endAt: number;
  /** the bars composed (the panel shows the one playing) */
  plans: BarPlan[];
  nextTick: number;
  /** held until its first bar's rendered notes are in (made off the page — PLAN-J7 J7-8b), at most until then [ctx s]; 0: not held */
  hold: number;
  ready: boolean;
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
  /** the chord's symbol ("Fmaj7", "Em/G"; "": none) */
  symbol: string;
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
  private buses = {} as Record<Layer, { mix: GainNode; meter: AnalyserNode }>;
  private reverbs = {} as Partial<Record<ReverbKind, { conv: ConvolverNode; ret: GainNode }>>;
  private delayIn: GainNode;
  private delayL: DelayNode;
  private delayR: DelayNode;
  private delayFb: GainNode;
  private delayRet: GainNode;
  private tracks: Track[] = [];
  mix: MusicMix = { ...DEFAULT_MIX };
  muted = new Set<Layer>();
  /** the section heard alone (the panel's solo: the mutes kept under it), or none */
  solo: Layer | null = null;
  /** the intensity asked (0 … 1) and the one eased to; the variation (another melody) */
  intensityWant = 0.5;
  intensity = 0.5;
  seed = 0;
  notes = 0;
  ticks = 0;
  /** the notes to render ahead (a theme's likely ones, the next bar's — first), a frame's share of the work [ms] */
  private jobs: NoteEvent[] = [];
  /** the theme foreseen: its bars composed one by one in the slices (the n-th of FORESEE at each intensity) */
  private foreseen: { theme: Theme; n: number; prev: number[] | null; seen: Set<string> } | null = null;
  private idle = false;
  budgetMs = 2;
  /**
   * The rendered notes and the reverbs' impulse responses made in the CPU worker (PLAN-J7 J7-8b — at the flight's start, 25–60 ms a
   * brass note and ~40 ms a reverb on the page's thread); false: here, in the frames' slices and the idle time (no worker, an offline
   * context — a theme rendered —, or the worker failed).
   */
  offThread: boolean;
  /** the worker's messages under way (one at a time: the next bar's notes, queued first, pass the foreseen theme's) */
  private inFlight = 0;
  private freshNext = true;
  /** the last themes' start delays [s]: what waiting for their first bar's notes added (0: none — the bar on time), the latest last */
  readonly startDelays: number[] = [];
  /** the levels' scratch (no allocation a frame) */
  private meterBuf = new Float32Array(256);
  private levelsOut = {} as Record<Layer, number>;

  constructor(
    readonly ctx: BaseAudioContext,
    out: AudioNode,
  ) {
    this.kit = makeKit(ctx);
    this.input = new GainNode(ctx, { gain: 1 });
    // (an orchestra's dynamics kept: the glue gentle, the limiter only for the peaks)
    const glue = new DynamicsCompressorNode(ctx, { threshold: -20, knee: 12, ratio: 1.8, attack: 0.03, release: 0.4 });
    const limit = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.12 });
    this.master = new GainNode(ctx, { gain: this.mix.master });
    this.analyser = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0.8, minDecibels: -90, maxDecibels: -12 });
    this.input.connect(glue).connect(limit).connect(this.master).connect(this.analyser);
    this.master.connect(out);
    for (const l of LAYERS) {
      const mix = new GainNode(ctx, { gain: 1 });
      const meter = new AnalyserNode(ctx, { fftSize: 256 });
      mix.connect(this.input);
      mix.connect(meter);
      this.buses[l] = { mix, meter };
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
    this.offThread = !("startRendering" in ctx) && cpuWorkerAvailable();
    // (the reverbs made ahead — when the engine is, before any theme —, their impulse responses in the worker)
    if (this.offThread)
      for (const kind of Object.keys(REVERBS) as ReverbKind[]) {
        const [secs, bright] = REVERBS[kind];
        void impulseOff(ctx.sampleRate, secs, bright).then((ir) => {
          if (!ir || this.reverbs[kind]) return;
          const buf = ctx.createBuffer(2, ir[0]!.length, ctx.sampleRate);
          buf.copyToChannel(ir[0]!, 0);
          buf.copyToChannel(ir[1]!, 1);
          this.makeReverb(kind, buf);
        });
      }
  }

  private makeReverb(kind: ReverbKind, buffer: AudioBuffer) {
    const conv = new ConvolverNode(this.ctx, { buffer });
    const ret = new GainNode(this.ctx, { gain: this.mix.reverb });
    conv.connect(ret).connect(this.input);
    return (this.reverbs[kind] = { conv, ret });
  }

  private reverb(kind: ReverbKind) {
    // (not in yet — no worker, or a theme asked before it came —: made here)
    return this.reverbs[kind] ?? this.makeReverb(kind, impulseResponse(this.ctx, ...REVERBS[kind]));
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
    for (let i = this.tracks.length - 1; i >= 0; i--) if (!this.tracks[i]!.stopping) return this.tracks[i]!;
    return null;
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
    const inEnd = at + Math.max(0.05, fade * 0.8);
    for (const l of LAYERS) {
      const g = new GainNode(ctx, { gain: 0 });
      g.connect(this.buses[l].mix);
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
    // (the delay on this theme's beat — glided there: a jump of a delay line's length is a click in its echoes)
    const dly = Math.min(2.9, (60 / theme.bpm) * theme.fx.delay);
    for (const d of [this.delayL, this.delayR]) {
      d.delayTime.cancelScheduledValues(at);
      d.delayTime.setTargetAtTime(dly, at, 0.3);
    }
    this.delayFb.gain.cancelScheduledValues(at);
    this.delayFb.gain.setTargetAtTime(theme.fx.feedback, at, 0.3);
    this.tracks.push({
      theme,
      t0: at,
      bar: 0,
      at,
      next: null,
      fadeIn: [at, inEnd],
      layers,
      sends,
      prev: null,
      stopping: false,
      endAt: Infinity,
      plans: [],
      nextTick: at,
      hold: 0,
      ready: true,
    });
    const tr = this.tracks.at(-1)!;
    this.foresee(theme);
    if (this.offThread) {
      // (its first bar composed now and its notes made first, in the worker: the theme held until they are in — HOLD_S at most —,
      // not rendered here in the frame it starts; its entry's ramp set once it starts)
      tr.next = this.compose(tr);
      tr.hold = now + HOLD_S;
      tr.ready = false;
      this.send(
        tr.next.events.map((e) => ({ ...e, beat: Number.NaN })),
        () => (tr.ready = true),
      );
    } else this.started(tr);
  }

  /** A track's entry: its layers' ramp from its first bar, the delay its notes' wait added noted. */
  private started(tr: Track, added = 0) {
    for (const g of Object.values(tr.layers)) {
      g.gain.setValueAtTime(0, tr.fadeIn[0]);
      g.gain.linearRampToValueAtTime(1, tr.fadeIn[1]);
    }
    this.startDelays.push(+added.toFixed(3));
    if (this.startDelays.length > 8) this.startDelays.shift();
  }

  /** These notes rendered in the worker and taken in; failed: here from then on, the notes queued again. */
  private send(batch: NoteJob[], done?: () => void) {
    this.inFlight++;
    const fresh = this.freshNext;
    this.freshNext = false;
    void renderNotesOff(this.ctx.sampleRate, batch, fresh).then((notes) => {
      this.inFlight--;
      if (notes) for (const n of notes) adoptRendered(this.kit, n.key, n.data, n.sr);
      else {
        this.offThread = false;
        this.jobs.unshift(...(batch as NoteEvent[]));
      }
      done?.();
      if (this.offThread) this.dispatch();
      else this.idleWork();
    });
  }

  /** The queue sent to the worker a batch at a time (the next bar's first, then the foreseen theme's bars composed one by one). */
  private dispatch() {
    while (this.inFlight < 1 && (this.jobs.length || this.foreseen)) {
      const batch: NoteJob[] = [];
      while (batch.length < BATCH && (this.jobs.length || this.foreseen)) {
        const e = this.jobs.shift();
        if (e) batch.push(e);
        else this.foreseeBar();
      }
      if (batch.length) this.send(batch);
    }
  }

  /**
   * A theme's likely rendered notes (its first bars at a calm and a full intensity) queued to be made in the idle
   * slices: a low piano note costs 10 to 30 ms, not to be paid in the frame that schedules it.
   */
  private foresee(theme: Theme) {
    this.jobs.length = 0;
    this.foreseen = { theme, n: 0, prev: null, seen: new Set() };
    // (a new theme: the worker's « handed out » forgotten — the page's kit may have let some notes go since)
    this.freshNext = true;
    if (this.offThread) this.dispatch();
    else this.idleWork();
  }

  /** One of the foreseen theme's bars composed, its notes not seen yet queued. */
  private foreseeBar() {
    const f = this.foreseen!;
    const bar = f.n % FORESEE;
    if (bar === 0) f.prev = null;
    const plan = composeBar(f.theme, bar, f.n < FORESEE ? 0.5 : 1, this.seed, f.prev);
    f.prev = plan.chord;
    for (const e of plan.events) {
      const key = `${e.inst}|${e.note}|${e.vel > 0.7}|${e.dur <= 0.5}`;
      if (f.seen.has(key)) continue;
      f.seen.add(key);
      this.jobs.push({ ...e, beat: Number.NaN });
    }
    if (++f.n >= 2 * FORESEE) this.foreseen = null;
  }

  /** Rendered notes made for at most `ms` [ms] (the next bar's first, then the foreseen theme's). */
  private work(ms: number) {
    const t0 = performance.now();
    while ((this.jobs.length || this.foreseen) && performance.now() - t0 < ms) {
      const e = this.jobs.shift();
      if (e) prepareNote(this.kit, e.inst, e.dur, e.note, e.vel, e.beat);
      else this.foreseeBar();
    }
  }

  /** The queue drained in the browser's idle time too (between the frames), when it has some. */
  private idleWork() {
    const ric = (globalThis as { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (!ric || this.idle || !(this.jobs.length || this.foreseen)) return;
    this.idle = true;
    // (no timeout: a forced call came in the middle of a busy frame and ran past its budget — J7-8, the flight's start)
    ric((d) => {
      this.idle = false;
      while ((this.jobs.length || this.foreseen) && d.timeRemaining() > 3) this.work(1);
      this.idleWork();
    });
  }

  private release(tr: Track, at: number, fade: number) {
    tr.stopping = true;
    tr.endAt = at + Math.max(0.05, fade) + 3;
    // (from the level the entry's ramp has reached at `at` — cancelling the ramp from a time after its start would
    // leave it at 0 until then: a silence, then a pop)
    const [a, b] = tr.fadeIn;
    const v = Math.min(1, Math.max(0, (at - a) / Math.max(1e-6, b - a)));
    for (const g of Object.values(tr.layers)) {
      if (typeof g.gain.cancelAndHoldAtTime === "function") g.gain.cancelAndHoldAtTime(at);
      else {
        // (no hold — Firefox —: the ramp cut at `at`, ending where it would have been then)
        g.gain.cancelScheduledValues(at);
        g.gain.linearRampToValueAtTime(v, at);
      }
      g.gain.linearRampToValueAtTime(0, at + Math.max(0.05, fade));
    }
  }

  /** Every theme let go at once, nothing faded (the output gone: the sound off). */
  halt() {
    for (const tr of this.tracks) {
      for (const g of Object.values(tr.layers)) g.disconnect();
      for (const s of tr.sends) s.disconnect();
    }
    if (this.tracks.length) this.tracks = [];
    this.jobs.length = 0;
    this.foreseen = null;
  }

  /** Everything faded out over `fade` s from `now`. */
  stop(now: number, fade = 3) {
    for (const tr of this.tracks) if (!tr.stopping) this.release(tr, now, fade);
  }

  /**
   * The bars due composed and scheduled (`ahead` s ahead of `now`; the next one composed `prepare` s ahead, its
   * rendered notes made over the frames before); the intensity eased.
   */
  pump(now: number, dt = 0, ahead = 0.4, prepare = 1.5) {
    if (dt > 0) this.intensity += (this.intensityWant - this.intensity) * (1 - Math.exp(-dt / 4));
    for (const tr of this.tracks) {
      if (tr.hold) {
        // (held for its first bar's notes: from now once they are in, or the wait over — then those not in made here as they play)
        if (!tr.ready && now < tr.hold) continue;
        const d = Math.max(0, now + 0.05 - tr.at);
        tr.t0 += d;
        tr.at += d;
        tr.nextTick += d;
        tr.fadeIn = [tr.fadeIn[0] + d, tr.fadeIn[1] + d];
        tr.hold = 0;
        this.started(tr, d);
      }
      const spb = 60 / tr.theme.bpm;
      const barS = beatsOf(tr.theme) * spb;
      // (late — the sound was off, the tab hidden, a long frame —: the bars wholly past skipped, not played all at
      // once with their notes in the past)
      if (tr.at + barS < now) {
        const n = Math.floor((now - tr.at) / barS);
        tr.bar += n;
        tr.at += n * barS;
        tr.next = null;
      }
      if (tr.theme.tick && tr.nextTick < now) tr.nextTick += Math.ceil((now - tr.nextTick) / tr.theme.tick) * tr.theme.tick;
      // (the playing theme's bars ahead — a fading one's too, until its fade is done)
      while (tr.at < now + ahead && tr.at < tr.endAt - 3) {
        const plan = tr.next ?? this.compose(tr);
        tr.next = null;
        for (const e of plan.events) {
          const t = tr.at + e.beat * spb;
          // (a note of a bar begun late, already past: left out)
          if (t < now - 0.02) continue;
          playNote(this.kit, tr.layers[e.layer], e.inst, t, e.dur * spb, e.note, e.vel, e.pan ?? 0);
          this.notes++;
        }
        tr.bar++;
        tr.at += barS;
      }
      // (the next bar composed ahead, its rendered notes queued first)
      if (!tr.next && tr.at < now + prepare && tr.at < tr.endAt - 3) {
        tr.next = this.compose(tr);
        for (let i = tr.next.events.length - 1; i >= 0; i--) {
          const e = tr.next.events[i]!;
          this.jobs.unshift({ ...e, beat: tr.at + e.beat * spb });
        }
      }
      if (tr.theme.tick)
        while (tr.nextTick < now + ahead && tr.nextTick < tr.endAt - 3) {
          playNote(this.kit, tr.layers.perc, "tick", tr.nextTick, 0.05, 0, 0.8);
          this.ticks++;
          tr.nextTick += tr.theme.tick;
        }
    }
    // (the rendering in the worker; without it a frame's share here, the rest in the idle time)
    if (this.offThread) this.dispatch();
    else {
      this.work(this.budgetMs);
      this.idleWork();
    }
    // (the faded ones let go — no array made a frame unless one is)
    if (this.tracks.some((x) => x.stopping && now > x.endAt)) {
      for (const tr of this.tracks.filter((x) => x.stopping && now > x.endAt)) {
        for (const g of Object.values(tr.layers)) g.disconnect();
        for (const s of tr.sends) s.disconnect();
      }
      this.tracks = this.tracks.filter((x) => !(x.stopping && now > x.endAt));
    }
  }

  /** A track's bar `tr.bar` composed (the panel keeps the last few). */
  private compose(tr: Track): BarPlan {
    const plan = composeBar(tr.theme, tr.bar, this.intensity, this.seed, tr.prev);
    tr.prev = plan.chord;
    tr.plans.push(plan);
    if (tr.plans.length > 6) tr.plans.shift();
    return plan;
  }

  /**
   * (A measuring tool — PLAN-J7 J7-8b's A/B) these notes rendered here, on a fresh kit of the game's context, and in the worker: the
   * keys of each, the largest sample gap. `where`: "worker" the worker against the page (the A/B); "page" the page twice (the A/A);
   * `tamper` added to one sample of each of the worker's (the positive control: it must be seen). Null: no worker.
   */
  async abRender(
    jobs: NoteJob[],
    o: { where?: "worker" | "page"; tamper?: number } = {},
  ): Promise<{ keys: number; here: number; missing: string[]; lengths: boolean; maxDiff: number } | null> {
    const page = () => {
      const k = makeKit(this.ctx);
      for (const j of jobs) prepareNote(k, j.inst, j.dur, j.note, j.vel, j.beat);
      return k;
    };
    const here = page();
    let other: { key: string; data: Float32Array }[] | null;
    if (o.where === "page") other = [...page().buffers].map(([key, b]) => ({ key, data: b.getChannelData(0) }));
    else {
      other = await renderNotesOff(this.ctx.sampleRate, jobs, true);
      // (the worker's « handed out » forgotten by this: the engine's next notes sent as new)
      this.freshNext = true;
    }
    if (!other) return null;
    let maxDiff = 0;
    let lengths = true;
    const missing: string[] = [];
    for (const n of other) {
      if (o.tamper && n.data.length > 1000) n.data[1000]! += o.tamper;
      const b = here.buffers.get(n.key);
      if (!b) {
        missing.push(n.key);
        continue;
      }
      const d = b.getChannelData(0);
      if (d.length !== n.data.length) {
        lengths = false;
        continue;
      }
      for (let i = 0; i < d.length; i++) maxDiff = Math.max(maxDiff, Math.abs(d[i]! - n.data[i]!));
    }
    return { keys: other.length, here: here.buffers.size, missing, lengths, maxDiff };
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
        symbol: "",
        root: Number.NaN,
        notes: this.notes,
      };
    const spb = 60 / tr.theme.bpm;
    const pos = Math.max(0, (now - tr.t0) / spb);
    const bpb = beatsOf(tr.theme);
    const bar = Math.floor(pos / bpb);
    const plan = tr.plans.find((p) => p.bar === bar) ?? tr.plans[0];
    return {
      playing: true,
      theme: tr.theme.id,
      name: tr.theme.name,
      bpm: tr.theme.bpm,
      section: plan?.section.name ?? "",
      bar,
      beat: pos % bpb,
      energy: plan?.energy ?? 0,
      intensity: this.intensity,
      chord: plan?.chord ?? [],
      symbol: plan?.symbol ?? "",
      root: plan?.root ?? Number.NaN,
      notes: this.notes,
    };
  }

  /** Each layer's level now [dBFS, RMS] (the panel's meters). */
  levels(): Record<Layer, number> {
    const out = this.levelsOut;
    const buf = this.meterBuf;
    for (const l of LAYERS) {
      this.buses[l].meter.getFloatTimeDomainData(buf);
      let s = 0;
      for (const x of buf) s += x * x;
      out[l] = 10 * Math.log10(s / buf.length + 1e-12);
    }
    return out;
  }
}
