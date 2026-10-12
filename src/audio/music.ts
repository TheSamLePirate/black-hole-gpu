// The music system (PLAN-TARS T4): the themes (audio/music/*) played in the game's AudioContext on the engine's
// music bus — nothing downloaded. What plays: in the "moments" mode (the default: silence otherwise) a theme at
// each of the flight's great moments (audio/score.ts); in the "adaptive" mode one between them too, by the
// flight's context (in orbit, far out, in the air, landed, on foot); in the "playlist" mode the player's list,
// in turn; and the music panel's "listen" over all of them. Each moment and context its theme (the player's
// choice — the panel's), the flight's intensity raising the band (or the player's own), the mixer's levels, a
// variation (another melody). Its preferences kept in the browser (the panel's).

import { type Context, type Moment, MOMENTS } from "./score";
import { DEFAULT_MIX, MusicEngine, type MusicMix, type MusicState } from "./music/engine";
import { type Layer, LAYERS, THEMES } from "./music/themes";
import { store } from "../util/storage";

export type MusicMode = "moments" | "adaptive" | "playlist";

/** Each moment's and context's theme by default. */
export const DEFAULT_MAP: Record<Moment | Context, string> = {
  liftoff: "ascent",
  entry: "reentry",
  final: "final-approach",
  wormhole: "wormhole",
  gargantua: "event-horizon",
  miller: "millers-tide",
  docking: "docking",
  lowpass: "low-pass",
  orbit: "orbit-drift",
  deep: "deep-space",
  air: "endurance",
  ground: "new-worlds",
  onFoot: "new-worlds",
};

/** The music panel's preferences (the browser's). */
export interface MusicPrefs {
  mode: MusicMode;
  map: Record<Moment | Context, string>;
  mix: MusicMix;
  muted: Layer[];
  /** the intensity: the flight's (null), or the player's own 0 … 1 */
  intensity: number | null;
  /** the variation (another melody for each theme) */
  seed: number;
  /** the playlist's themes, and how long each plays [s] */
  playlist: string[];
  playlistS: number;
  /** the crossfade between themes [s] */
  fade: number;
}
const KEY = "kerr.music";
export const DEFAULT_PREFS = (): MusicPrefs => ({
  mode: "moments",
  map: { ...DEFAULT_MAP },
  mix: { ...DEFAULT_MIX },
  muted: [],
  intensity: null,
  seed: 0,
  playlist: THEMES.map((t) => t.id),
  playlistS: 180,
  fade: 3,
});

export class Music {
  private engine: MusicEngine | null = null;
  private ctx: AudioContext | null = null;
  prefs: MusicPrefs;
  /** the moment playing now (none), the context (adaptive) */
  moment: Moment | null = null;
  context: Context | null = null;
  /** the panel's "listen": a theme played over the game's choice (null: none) */
  preview: string | null = null;
  /** the playlist's place, since when */
  private listAt = 0;
  private listSince = -Infinity;
  private lastT = 0;
  /** what is asked now (the theme), and the flight's intensity */
  wanted: string | null = null;
  flight = 0.5;

  constructor(private out: () => { ctx: AudioContext; bus: GainNode } | null) {
    const p = store.getJSON<Partial<MusicPrefs>>(KEY, {});
    const d = DEFAULT_PREFS();
    // (kept preferences from the former band — its drums, its guitar, its pump — dropped: the orchestra's sections
    // only)
    const mix = Object.fromEntries(Object.entries(p.mix ?? {}).filter(([key]) => key in d.mix)) as Partial<MusicMix>;
    this.prefs = {
      ...d,
      ...p,
      map: { ...d.map, ...(p.map ?? {}) },
      mix: { ...d.mix, ...mix },
      muted: (p.muted ?? []).filter((l) => (LAYERS as string[]).includes(l)),
    };
  }

  /** The notes played, the ticks (Miller's) — the tests'. */
  get notes() {
    return this.engine?.notes ?? 0;
  }
  get ticks() {
    return this.engine?.ticks ?? 0;
  }

  /** The preferences kept, applied to the mixer. */
  save() {
    store.set(KEY, JSON.stringify(this.prefs));
    this.applyMix();
  }

  private applyMix() {
    const e = this.engine;
    if (!e) return;
    e.mix = { ...this.prefs.mix };
    e.muted = new Set(this.prefs.muted);
    e.seed = this.prefs.seed;
    e.applyMix();
  }

  private ensure(): MusicEngine | null {
    const o = this.out();
    if (!o) return null;
    if (!this.engine || this.ctx !== o.ctx) {
      this.ctx = o.ctx;
      this.engine = new MusicEngine(o.ctx, o.bus);
      this.applyMix();
    }
    return this.engine;
  }

  /** The theme the game asks now (none: silence), by the mode. */
  private choose(now: number, enabled: boolean): string | null {
    if (this.preview) return this.preview;
    if (!enabled) return null;
    const p = this.prefs;
    if (p.mode === "playlist") {
      const list = p.playlist.length ? p.playlist : THEMES.map((t) => t.id);
      if (now - this.listSince > p.playlistS) {
        if (Number.isFinite(this.listSince)) this.listAt = (this.listAt + 1) % list.length;
        this.listSince = now;
      }
      return list[this.listAt % list.length] ?? null;
    }
    if (this.moment) return p.map[this.moment] ?? null;
    if (p.mode === "adaptive" && this.context) return p.map[this.context] ?? null;
    return null;
  }

  /**
   * A frame: the moment (none), the context (the adaptive mode's), the flight's intensity, whether the music is
   * on (the settings' and the sound's).
   */
  update(m: Moment | null, o: { context?: Context | null; intensity?: number; enabled?: boolean } = {}) {
    const e = this.ensure();
    if (!e) return;
    const now = e.ctx.currentTime;
    const dt = this.lastT ? Math.min(0.5, Math.max(0, now - this.lastT)) : 0;
    this.lastT = now;
    // (the music off: no moment, as the flight's — the panel's listening still plays)
    const enabled = o.enabled ?? m !== null;
    this.moment = enabled ? m : null;
    this.context = enabled ? (o.context ?? null) : null;
    if (o.intensity !== undefined) this.flight = o.intensity;
    e.intensityWant = this.prefs.intensity ?? this.flight;
    const want = this.choose(now, enabled);
    if (want !== this.wanted) {
      this.wanted = want;
      if (want) e.play(want, now, this.preview ? 0.8 : this.prefs.fade);
      else e.stop(now, this.prefs.fade);
    }
    e.pump(now, dt);
  }

  /** Everything stopped at once (a new scene). */
  stop() {
    const e = this.engine;
    if (e) e.stop(e.ctx.currentTime, 0.3);
    this.wanted = null;
    this.moment = null;
    this.preview = null;
  }

  /** The panel's "listen" (null: back to the game's choice). */
  listen(id: string | null) {
    this.preview = id;
  }

  /** The playlist's next (or previous) theme at once. */
  skip(dir: 1 | -1) {
    const list = this.prefs.playlist.length ? this.prefs.playlist : THEMES.map((t) => t.id);
    this.listAt = (this.listAt + dir + list.length) % list.length;
    this.listSince = this.lastT;
  }

  state(): MusicState & { mode: MusicMode; moment: Moment | null; context: Context | null; preview: string | null } {
    const e = this.engine;
    const s = e
      ? e.state(e.ctx.currentTime)
      : {
          playing: false,
          theme: null,
          name: "",
          bpm: 0,
          section: "",
          bar: 0,
          beat: 0,
          energy: 0,
          intensity: 0.5,
          chord: [],
          symbol: "",
          root: Number.NaN,
          notes: 0,
        };
    return { ...s, mode: this.prefs.mode, moment: this.moment, context: this.context, preview: this.preview };
  }
  levels() {
    return this.engine?.levels() ?? null;
  }
  analyser() {
    return this.engine?.analyser ?? null;
  }
}

/** The moments, for the panel's assignments. */
export const MOMENT_LIST = MOMENTS;
