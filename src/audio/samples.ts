// Recorded sounds (docs/PLAN-A320.md, A12): the game's voices are synthesized; an aircraft's own — FlightGear's
// recordings of the A320, in Ogg Opus (assets/a320/sounds/) — are played here. A bank fetches and decodes each
// recording once, when first wanted; a craft's voices (src/a320/sound/types.ts CraftVoice, a frame's) each keep their
// nodes from frame to frame — a looped source, its gain and rate eased, a panner at its place about the ear (head-locked
// without one) —, heard from inside or from outside as FlightGear splits them, faded out once gone from the list; a
// one-shot plays to its end, again at each new count of its shot. The bookkeeping (which voice starts, goes on, fades;
// the shots' edges; inside/outside; the gains wanted) is VoiceBook's, pure — its nodes a factory's (the Web Audio's
// here, a fake in tests/audio-samples.test.ts).

import type { CraftVoice } from "../a320/sound/types";

type V3 = [number, number, number];

/** How the ear hears the craft: from inside its cabin or not; a ship's place [m] into the ear's frame (audio/space.ts:
 *  the listener facing −z). */
export interface Ear {
  inside: boolean;
  toEar(p: V3): V3;
}

/** A looped voice's nodes (the factory's). */
export interface VoiceNodes {
  gain(v: number, tau: number): void;
  rate(v: number, tau: number): void;
  place(p: V3 | null, refDist?: number, maxDist?: number): void;
  /** faded out over `fade` [s], then stopped and let go */
  stop(fade: number): void;
}

/** What makes the nodes: a looped voice (null: its recording not decoded yet — asked again next frame), a one-shot
 *  played to its end at a gain, a rate, a place (false: not playable yet). */
export interface VoiceFactory {
  loop(v: CraftVoice): VoiceNodes | null;
  shot(v: CraftVoice, gain: number, place: V3 | null): boolean;
}

/** a voice gone from the list: its fade [s] */
export const FADE_OUT = 0.15;
/** the gains' and rates' easing [s] */
export const EASE = 0.05;

/** The voices' bookkeeping: each frame's list against the last. */
export class VoiceBook {
  private loops = new Map<string, { n: VoiceNodes; gain: number }>();
  /** the one-shots seen last frame: their shot count (an edge: a new count, or a first appearance) */
  private shots = new Map<string, number | undefined>();
  /** the one-shots played lately, by id (state(): tests, measurement) */
  private lastShots: string[] = [];

  constructor(private f: VoiceFactory) {}

  /** A frame: `voices` heard (none: all faded), the ear, the simulation running (paused: all silent). */
  frame(voices: CraftVoice[] | null, ear: Ear, live = true) {
    const seen = new Set<string>();
    const shotsNow = new Map<string, number | undefined>();
    for (const v of voices ?? []) {
      const heard = live && (v.where === "both" || (v.where === "inside") === ear.inside);
      const g = heard ? Math.max(v.gain, 0) : 0;
      const at = v.pos ? ear.toEar(v.pos) : null;
      if (!v.loop) {
        shotsNow.set(v.id, v.shot);
        const was = this.shots.has(v.id);
        // (an edge: first seen, or its count changed; heard — a muted shot is not saved for later)
        if ((!was || this.shots.get(v.id) !== v.shot) && g > 0) {
          if (this.f.shot(v, g, at)) this.lastShots = [...this.lastShots.slice(-15), v.id];
          // (its recording not there yet: tried again next frame — not marked seen)
          else shotsNow.delete(v.id);
        }
        continue;
      }
      seen.add(v.id);
      let L = this.loops.get(v.id);
      if (!L) {
        const n = this.f.loop(v);
        if (!n) continue;
        L = { n, gain: 0 };
        this.loops.set(v.id, L);
      }
      L.gain = g;
      L.n.gain(g, EASE);
      L.n.rate(Math.max(v.rate, 0.01), EASE);
      L.n.place(at, v.refDist, v.maxDist);
    }
    this.shots = shotsNow;
    for (const [id, L] of this.loops)
      if (!seen.has(id)) {
        L.n.stop(FADE_OUT);
        this.loops.delete(id);
      }
  }

  /** every voice faded out */
  stop() {
    for (const L of this.loops.values()) L.n.stop(FADE_OUT);
    this.loops.clear();
    this.shots.clear();
  }

  /** the looped voices playing, their gains wanted; the one-shots played lately */
  state() {
    const gains: Record<string, number> = {};
    for (const [id, L] of this.loops) gains[id] = L.gain;
    return { voices: this.loops.size, playing: [...this.loops.keys()], gains, shots: [...this.lastShots] };
  }
}

/** The recordings: each URL fetched and decoded once, when first asked; a failure told once, that sound silent. */
export class SampleBank {
  private bufs = new Map<string, AudioBuffer | null>();
  private waiting = new Map<string, Promise<AudioBuffer | null>>();

  constructor(private ctx: BaseAudioContext) {}

  /** the recording decoded, or null (asked: loading — or failed) */
  get(url: string): AudioBuffer | null {
    const b = this.bufs.get(url);
    if (b !== undefined) return b;
    void this.load(url);
    return null;
  }

  /** the recording, once decoded (null: it failed) */
  load(url: string): Promise<AudioBuffer | null> {
    const b = this.bufs.get(url);
    if (b !== undefined) return Promise.resolve(b);
    let p = this.waiting.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.arrayBuffer();
        })
        .then((a) => this.ctx.decodeAudioData(a))
        .catch((e) => {
          console.warn("sound:", url, e);
          return null;
        })
        .then((buf) => {
          this.bufs.set(url, buf);
          this.waiting.delete(url);
          return buf;
        });
      this.waiting.set(url, p);
    }
    return p;
  }
}

/** Where a voice goes: an engine's sound into the engines' path, an alarm or a callout into the beeps', a switch's
 *  click into the interface's (the ids' prefixes: "alarm/", "gpws/", "click/"). */
export type BusOf = (id: string, inside: boolean) => AudioNode;

/**
 * A craft's voices played (the Web Audio's nodes for VoiceBook): per voice its source (looped; a new one per shot),
 * its gain, a panner (HRTF or equal-power as the engine's — headphones) at its place about the ear, into its bus — the
 * inside's (through the cabin's low-pass the engine applies on its listener's path) or the outside's —, a little of it
 * into the room.
 */
export class CraftVoices {
  readonly bank: SampleBank;
  private book: VoiceBook;
  private ear: Ear = { inside: true, toEar: (p) => p };

  constructor(
    private ctx: AudioContext,
    private outInside: AudioNode,
    private outOutside: AudioNode,
    private room?: AudioNode,
    private busOf?: BusOf,
    private model: () => PanningModelType = () => "HRTF",
  ) {
    this.bank = new SampleBank(ctx);
    this.book = new VoiceBook({ loop: (v) => this.loopNodes(v), shot: (v, g, at) => this.shotNodes(v, g, at) });
  }

  /** a voice's bus (its prefix's, else the inside's or the outside's) */
  private out(id: string): AudioNode {
    return this.busOf?.(id, this.ear.inside) ?? (this.ear.inside ? this.outInside : this.outOutside);
  }

  /** a panner at a place about the ear (head-locked: just ahead) */
  private panner(at: V3 | null, ref = 1, max = 1e4) {
    const p = at ?? [0, 0, -0.3];
    return new PannerNode(this.ctx, {
      panningModel: this.model(),
      distanceModel: "inverse",
      refDistance: ref,
      maxDistance: max,
      rolloffFactor: 1,
      positionX: p[0],
      positionY: p[1],
      positionZ: p[2],
    });
  }

  private wire(src: AudioNode, g: GainNode, pan: PannerNode, id: string) {
    src.connect(g).connect(pan).connect(this.out(id));
    if (this.room) {
      const send = new GainNode(this.ctx, { gain: 0.12 });
      pan.connect(send).connect(this.room);
    }
  }

  private loopNodes(v: CraftVoice): VoiceNodes | null {
    const buf = this.bank.get(v.url);
    if (!buf) return null;
    const ctx = this.ctx;
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true, playbackRate: Math.max(v.rate, 0.01) });
    const g = new GainNode(ctx, { gain: 0 });
    const pan = this.panner(null, v.refDist, v.maxDist);
    this.wire(src, g, pan, v.id);
    // (started somewhere in its loop: two engines' hums not in phase)
    src.start(0, Math.random() * buf.duration);
    let stopped = false;
    return {
      gain: (x, tau) => g.gain.setTargetAtTime(x, ctx.currentTime, tau),
      rate: (x, tau) => src.playbackRate.setTargetAtTime(x, ctx.currentTime, tau),
      place: (at, ref, max) => {
        const p = at ?? [0, 0, -0.3];
        const t = ctx.currentTime;
        pan.positionX.setTargetAtTime(p[0], t, 0.03);
        pan.positionY.setTargetAtTime(p[1], t, 0.03);
        pan.positionZ.setTargetAtTime(p[2], t, 0.03);
        if (ref !== undefined && pan.refDistance !== ref) pan.refDistance = ref;
        if (max !== undefined && pan.maxDistance !== max) pan.maxDistance = max;
        if (pan.panningModel !== this.model()) pan.panningModel = this.model();
      },
      stop: (fade) => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, fade / 3);
        src.stop(t + fade);
        src.onended = () => {
          src.disconnect();
          g.disconnect();
          pan.disconnect();
        };
      },
    };
  }

  private shotNodes(v: CraftVoice, gain: number, at: V3 | null): boolean {
    const buf = this.bank.get(v.url);
    if (!buf) return false;
    const ctx = this.ctx;
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: Math.max(v.rate, 0.01) });
    const g = new GainNode(ctx, { gain });
    const pan = this.panner(at, v.refDist, v.maxDist);
    this.wire(src, g, pan, v.id);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      pan.disconnect();
    };
    src.start();
    return true;
  }

  /** a frame of the craft's voices (null: all faded out); paused: all silent */
  frame(voices: CraftVoice[] | null, ear: Ear, _dt: number, live = true) {
    this.ear = ear;
    this.book.frame(voices, ear, live);
  }

  stop() {
    this.book.stop();
  }

  state() {
    return this.book.state();
  }
}
