// The music panel: the score's console (audio/music.ts). What plays and why (the moment, the context, the
// theme, its section, bar and chord, the energy and the intensity), its spectrum and its band's meters; listen
// to any theme (the game's choice back after); the mode (the great moments only, adaptive, a playlist, off);
// the intensity (the flight's, or the player's); the variation (another melody); the mixer — a fader, a mute
// and a solo per section of the orchestra, the reverb, the delay, the master —; which theme
// for each moment and context; the crossfade, the playlist's length. Opened by the toolbar's Music button and
// the flight HUD's.

import type { Music, MusicMode } from "../audio/music";
import { DEFAULT_PREFS } from "../audio/music";
import { CONTEXTS, MOMENTS } from "../audio/score";
import { LAYERS, type Layer, THEME_BY_ID, THEMES } from "../audio/music/themes";
import type { Settings } from "../settings";
import { t } from "../i18n";
import { el as h } from "./kit";
import { onEscape } from "./keys";

const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
/** A chord's name from its notes (its lowest as the root — the voicing's), e.g. "Am9". */
export function chordName(notes: number[], root?: number): string {
  if (!notes.length) return "—";
  const r = root ?? notes[0]!;
  const pcs = new Set(notes.map((n) => (((n - r) % 12) + 12) % 12));
  const minor = pcs.has(3) && !pcs.has(4);
  const sus = !pcs.has(3) && !pcs.has(4) ? (pcs.has(5) ? "sus4" : pcs.has(2) ? "sus2" : "5") : "";
  const ext = pcs.has(10) || pcs.has(11) ? (pcs.has(2) ? "9" : "7") : pcs.has(2) && !sus ? "add9" : "";
  const maj7 = pcs.has(11) && !pcs.has(10) ? "maj" : "";
  return `${NOTE_NAMES[((r % 12) + 12) % 12]}${minor ? "m" : ""}${maj7}${ext}${sus}`;
}

const LAYER_NAME: Record<Layer, () => string> = {
  perc: () => t("Percussion"),
  bass: () => t("Basses"),
  strings: () => t("Strings"),
  ostinato: () => t("Ostinato"),
  brass: () => t("Brass"),
  melody: () => t("Melody"),
  keys: () => t("Harp, celesta"),
  organ: () => t("Organ"),
  choir: () => t("Choir"),
};
const CUE_NAME: Record<string, () => string> = {
  liftoff: () => t("Lift-off"),
  entry: () => t("Re-entry"),
  final: () => t("Final approach"),
  wormhole: () => t("Wormhole"),
  gargantua: () => t("Gargantua"),
  miller: () => t("Miller"),
  docking: () => t("Docking"),
  lowpass: () => t("Low pass"),
  orbit: () => t("In orbit"),
  deep: () => t("Deep space"),
  air: () => t("In the air"),
  ground: () => t("Landed"),
  onFoot: () => t("On foot"),
};
const MODES: [MusicMode | "off", () => string, () => string][] = [
  ["moments", () => t("Moments"), () => t("A theme at the flight's great moments; silence between")],
  ["adaptive", () => t("Adaptive"), () => t("A theme at every moment, and between them one by the flight's context")],
  ["playlist", () => t("Playlist"), () => t("The checked themes in turn, whatever the flight")],
  ["off", () => t("Off"), () => t("No music")],
];

const CSS = `
#music-pop { position: fixed; right: 16px; top: 64px; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 96px);
  overflow: auto; z-index: 60; border-radius: 14px; padding: 14px 16px 16px; color: #e8f2ff;
  background: var(--k-panel-bg, rgba(8, 14, 24, 0.92)); border: 1px solid rgba(160, 210, 255, 0.18);
  box-shadow: 0 18px 50px rgba(0,0,0,0.45); font: 13px/1.35 var(--k-font, system-ui, sans-serif); }
#music-pop[hidden] { display: none; }
#music-pop h3 { margin: 14px 0 8px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9cc4ec; font-weight: 700; }
#music-pop .mp-head { display: flex; align-items: center; gap: 10px; }
#music-pop .mp-head b { font-size: 16px; flex: 1; }
#music-pop button { background: rgba(30, 50, 80, 0.55); color: #e8f2ff; border: 1px solid rgba(160, 210, 255, 0.22); border-radius: 8px;
  padding: 5px 10px; cursor: pointer; font: inherit; }
#music-pop button:hover { border-color: rgba(160, 210, 255, 0.5); background: rgba(40, 70, 110, 0.6); }
#music-pop button.on { border-color: #ffb35c; color: #ffe6c6; background: rgba(255, 179, 92, 0.2); }
#music-pop .mp-now { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; padding: 10px 12px; border-radius: 10px;
  background: rgba(0, 0, 0, 0.25); }
#music-pop .mp-title { font-size: 18px; font-weight: 700; }
#music-pop .mp-mood { grid-column: 1 / -1; color: #a9c3dd; font-size: 12px; }
#music-pop .mp-meta { color: #cfe0f2; font-variant-numeric: tabular-nums; }
#music-pop canvas { width: 100%; height: 92px; display: block; border-radius: 8px; background: rgba(0,0,0,0.35); margin-top: 8px; }
#music-pop .mp-bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; }
#music-pop .mp-bar b { display: block; height: 100%; background: linear-gradient(90deg, #4fb3ff, #b07cff, #ff7a9a); }
#music-pop .mp-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; flex-wrap: wrap; }
#music-pop .mp-row label { min-width: 110px; color: #bcd3ea; }
#music-pop input[type=range] { flex: 1; min-width: 120px; accent-color: #6fc0ff; }
#music-pop .mp-seg { display: flex; gap: 4px; flex-wrap: wrap; }
#music-pop .mp-themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
#music-pop .mp-theme { text-align: left; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; position: relative; }
#music-pop .mp-theme small { color: #9fb7cf; font-size: 11px; }
#music-pop .mp-theme.playing { border-color: #6fc0ff; box-shadow: 0 0 0 1px #6fc0ff inset; }
#music-pop .mp-theme input { position: absolute; top: 8px; right: 8px; }
#music-pop .mp-mixer { display: grid; grid-template-columns: 112px 1fr 44px 28px 28px; gap: 6px 8px; align-items: center; }
#music-pop .mp-meter { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; grid-column: 2; margin-top: -4px; }
#music-pop .mp-meter b { display: block; height: 100%; background: linear-gradient(90deg, #3ddc84, #e8d34f 70%, #ff5a46); width: 0; }
#music-pop .mp-map { display: grid; grid-template-columns: 130px 1fr; gap: 6px 10px; align-items: center; }
#music-pop select { background: rgba(10, 20, 34, 0.9); color: #e8f2ff; border: 1px solid rgba(160, 210, 255, 0.25); border-radius: 6px; padding: 4px; font: inherit; }
#music-pop .mp-small { color: #9fb7cf; font-size: 12px; }
@media (max-width: 600px) { #music-pop { right: 8px; left: 8px; width: auto; top: 56px; } #music-pop .mp-mixer { grid-template-columns: 90px 1fr 36px 26px 26px; } }
`;

export interface MusicPanelDeps {
  music: Music;
  settings: Settings;
  /** the settings changed (the music on or off) */
  changed: (keys: (keyof Settings)[]) => void;
  /** the sound needs a gesture to start: asked when the panel plays */
  startSound: () => void;
}

export class MusicPanel {
  readonly el = h("div");
  private canvas = h("canvas") as HTMLCanvasElement;
  private nowEl = h("div", "mp-now");
  private meters = new Map<Layer, HTMLElement>();
  private themeBtns = new Map<string, HTMLElement>();
  private unEscape?: () => void;
  private raf = 0;
  private spec = new Uint8Array(1024);
  /** the spectrum's gradient, made again only when the canvas's height changes */
  private grad: CanvasGradient | null = null;
  private gradH = 0;

  constructor(private d: MusicPanelDeps) {
    if (!document.getElementById("music-pop-css")) {
      const st = document.createElement("style");
      st.id = "music-pop-css";
      st.textContent = CSS;
      document.head.append(st);
    }
    this.el.id = "music-pop";
    this.el.hidden = true;
    this.el.dataset.testid = "music-panel";
    document.body.append(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(open = this.el.hidden) {
    this.el.hidden = !open;
    this.unEscape?.();
    this.unEscape = open ? onEscape(() => this.toggle(false)) : undefined;
    cancelAnimationFrame(this.raf);
    if (open) {
      this.build();
      const tick = () => {
        this.live();
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
  }

  private save() {
    this.d.music.save();
  }

  /** The panel's controls, from the preferences. */
  private build() {
    const M = this.d.music,
      P = M.prefs,
      S = this.d.settings;
    this.el.replaceChildren();
    this.meters.clear();
    this.themeBtns.clear();
    const close = h("button", "", "✕") as HTMLButtonElement;
    close.title = t("Close (Esc)");
    close.onclick = () => this.toggle(false);
    const head = h("div", "mp-head");
    head.append(h("b", "", t("Music")), close);
    this.el.append(head, this.nowEl, this.canvas);

    // ---- the transport
    const tr = h("div", "mp-row");
    const prev = h("button", "", "⏮") as HTMLButtonElement;
    const play = h("button", "", M.preview ? "⏹" : "▶") as HTMLButtonElement;
    const next = h("button", "", "⏭") as HTMLButtonElement;
    const game = h("button", M.preview ? "" : "on", t("The game's choice")) as HTMLButtonElement;
    prev.title = t("Listen to the previous theme");
    next.title = t("Listen to the next theme");
    play.title = t("Listen to the theme shown · stop listening");
    game.title = t("Back to the theme the flight chooses");
    const shown = () => M.preview ?? M.state().theme ?? THEMES[0]!.id;
    const go = (dir: number) => {
      const i = THEMES.findIndex((x) => x.id === shown());
      this.listen(THEMES[(i + dir + THEMES.length) % THEMES.length]!.id);
    };
    prev.onclick = () => go(-1);
    next.onclick = () => go(1);
    play.onclick = () => (M.preview ? this.listen(null) : this.listen(shown()));
    game.onclick = () => this.listen(null);
    tr.append(prev, play, next, game);
    this.el.append(tr);

    // ---- the mode
    this.el.append(h("h3", "", t("Mode")));
    const seg = h("div", "mp-seg");
    const modeNow = S.music ? P.mode : "off";
    for (const [m, label, hint] of MODES) {
      const b = h("button", m === modeNow ? "on" : "", label()) as HTMLButtonElement;
      b.title = hint();
      b.onclick = () => {
        if (m === "off") S.music = false;
        else {
          S.music = true;
          P.mode = m;
        }
        this.d.changed(["music"]);
        this.save();
        this.build();
      };
      seg.append(b);
    }
    this.el.append(seg, h("div", "mp-small", MODES.find((x) => x[0] === modeNow)![2]()));

    // ---- the intensity, the variation, the volume
    this.el.append(h("h3", "", t("Intensity & variation")));
    const auto = h("button", P.intensity === null ? "on" : "", t("The flight's")) as HTMLButtonElement;
    auto.title = t("The intensity follows the flight: the engine, the plasma, the speed, the ground near, the load, an alarm");
    const intensity = this.slider(t("Intensity"), 0, 1, 0.01, P.intensity ?? 0.5, (v) => {
      P.intensity = v;
      auto.classList.remove("on");
      this.save();
    });
    auto.onclick = () => {
      P.intensity = P.intensity === null ? 0.5 : null;
      this.save();
      this.build();
    };
    intensity.append(auto);
    const vari = h("div", "mp-row");
    const vlab = h("label", "", t("Variation"));
    const vval = h("span", "mp-meta", `#${P.seed}`);
    const dice = h("button", "", t("Another melody")) as HTMLButtonElement;
    dice.title = t("Another variation of every theme: its melody ornamented otherwise, its piano's notes, its percussion's accents");
    dice.onclick = () => {
      P.seed = (P.seed + 1 + Math.floor(Math.random() * 97)) % 1000;
      vval.textContent = `#${P.seed}`;
      this.save();
    };
    const orig = h("button", "", t("Original")) as HTMLButtonElement;
    orig.onclick = () => {
      P.seed = 0;
      vval.textContent = "#0";
      this.save();
    };
    vari.append(vlab, vval, dice, orig);
    this.el.append(
      intensity,
      vari,
      this.slider(t("Music volume"), 0, 1, 0.01, S.soundMusic ?? 0.6, (v) => {
        S.soundMusic = v;
        this.d.changed(["soundMusic"]);
      }),
    );

    // ---- the themes
    this.el.append(h("h3", "", t("Themes")), h("div", "mp-small", t("Click: listen · the box: in the playlist")));
    const grid = h("div", "mp-themes");
    for (const th of THEMES) {
      const b = h("button", "mp-theme") as HTMLButtonElement;
      const name = SCALE_NAME[th.scale]?.() ?? th.scale;
      b.append(h("b", "", th.name), h("small", "", `${th.bpm} BPM · ${NOTE_NAMES[th.root % 12]} ${name}`), h("small", "", t(th.mood)));
      b.title = t(th.mood);
      const box = h("input") as HTMLInputElement;
      box.type = "checkbox";
      box.checked = P.playlist.includes(th.id);
      box.title = t("In the playlist");
      box.onclick = (e) => {
        e.stopPropagation();
        P.playlist = box.checked ? [...P.playlist, th.id] : P.playlist.filter((x) => x !== th.id);
        this.save();
      };
      b.append(box);
      b.onclick = () => this.listen(th.id);
      grid.append(b);
      this.themeBtns.set(th.id, b);
    }
    this.el.append(grid);

    // ---- the mixer
    this.el.append(h("h3", "", t("Mixer")));
    const mx = h("div", "mp-mixer");
    for (const l of LAYERS) {
      const r = h("input") as HTMLInputElement;
      r.type = "range";
      r.min = "0";
      r.max = "1.5";
      r.step = "0.01";
      r.value = String(P.mix[l]);
      const val = h("span", "mp-meta", `${Math.round(P.mix[l] * 100)}`);
      r.oninput = () => {
        P.mix[l] = Number(r.value);
        val.textContent = `${Math.round(P.mix[l] * 100)}`;
        this.save();
      };
      const mute = h("button", P.muted.includes(l) ? "on" : "", "M") as HTMLButtonElement;
      mute.title = t("Mute");
      mute.onclick = () => {
        P.muted = P.muted.includes(l) ? P.muted.filter((x) => x !== l) : [...P.muted, l];
        mute.classList.toggle("on", P.muted.includes(l));
        this.save();
      };
      // (the solo apart from the mutes: un-soloed, the player's mutes are as they were)
      const solo = h("button", P.solo === l ? "on" : "", "S") as HTMLButtonElement;
      solo.title = t("Solo");
      solo.onclick = () => {
        P.solo = P.solo === l ? null : l;
        this.save();
        this.build();
      };
      const meter = h("div", "mp-meter");
      meter.append(h("b"));
      this.meters.set(l, meter.firstChild as HTMLElement);
      mx.append(h("label", "", LAYER_NAME[l]()), r, val, mute, solo, h("span"), meter, h("span"), h("span"), h("span"));
    }
    this.el.append(mx);
    for (const [k, label, max] of [
      ["reverb", t("Reverb"), 2],
      ["delay", t("Delay"), 2],
      ["master", t("Master"), 1.5],
    ] as const)
      this.el.append(
        this.slider(label, 0, max, 0.01, P.mix[k], (v) => {
          P.mix[k] = v;
          this.save();
        }),
      );

    // ---- the assignments
    this.el.append(h("h3", "", t("Which theme, when")));
    const map = h("div", "mp-map");
    for (const cue of [...MOMENTS, ...CONTEXTS]) {
      const sel = h("select") as HTMLSelectElement;
      for (const th of THEMES) {
        const o = h("option", "", th.name) as HTMLOptionElement;
        o.value = th.id;
        sel.append(o);
      }
      sel.value = P.map[cue];
      sel.onchange = () => {
        P.map[cue] = sel.value;
        this.save();
      };
      map.append(h("label", "", `${CUE_NAME[cue]!()}${(CONTEXTS as readonly string[]).includes(cue) ? ` · ${t("adaptive")}` : ""}`), sel);
    }
    this.el.append(map);

    // ---- the transitions, the playlist, the defaults
    this.el.append(h("h3", "", t("Transitions")));
    this.el.append(
      this.slider(
        t("Crossfade"),
        0,
        10,
        0.1,
        P.fade,
        (v) => {
          P.fade = v;
          this.save();
        },
        "s",
      ),
      this.slider(
        t("Playlist: each theme"),
        30,
        600,
        10,
        P.playlistS,
        (v) => {
          P.playlistS = v;
          this.save();
        },
        "s",
      ),
    );
    const reset = h("button", "", t("Defaults")) as HTMLButtonElement;
    reset.title = t("The music's settings as they came: the mode, the themes, the mixer");
    reset.onclick = () => {
      M.prefs = DEFAULT_PREFS();
      this.save();
      this.build();
    };
    const row = h("div", "mp-row");
    row.append(reset);
    this.el.append(row);
  }

  private listen(id: string | null) {
    this.d.startSound();
    this.d.music.listen(id);
    this.build();
  }

  private slider(label: string, min: number, max: number, step: number, value: number, set: (v: number) => void, unit = "") {
    const row = h("div", "mp-row");
    const r = h("input") as HTMLInputElement;
    r.type = "range";
    r.min = String(min);
    r.max = String(max);
    r.step = String(step);
    r.value = String(value);
    const fmt = (v: number) => (unit ? `${v.toFixed(step < 1 ? 1 : 0)} ${unit}` : `${Math.round(v * 100)}`);
    const val = h("span", "mp-meta", fmt(value));
    r.oninput = () => {
      const v = Number(r.value);
      val.textContent = fmt(v);
      set(v);
    };
    row.append(h("label", "", label), r, val);
    return row;
  }

  /** The live part: what plays, the spectrum, the meters. */
  private live() {
    const M = this.d.music;
    const s = M.state();
    const th = s.theme ? THEME_BY_ID[s.theme] : null;
    const why = s.preview
      ? t("Listening")
      : s.moment
        ? CUE_NAME[s.moment]!()
        : s.context && s.mode === "adaptive"
          ? CUE_NAME[s.context]!()
          : s.mode === "playlist"
            ? t("Playlist")
            : t("Silence — no moment now");
    const key = `${s.theme}|${s.section}|${s.bar}|${Math.floor(s.beat)}|${why}|${s.chord.join()}|${Math.round(s.energy * 20)}|${Math.round(s.intensity * 20)}`;
    if (this.nowEl.dataset.key !== key) {
      this.nowEl.dataset.key = key;
      const energy = h("div", "mp-bar");
      energy.append(h("b"));
      (energy.firstChild as HTMLElement).style.width = `${Math.round(s.energy * 100)}%`;
      const inten = h("div", "mp-bar");
      inten.append(h("b"));
      (inten.firstChild as HTMLElement).style.width = `${Math.round(s.intensity * 100)}%`;
      this.nowEl.replaceChildren(
        h("div", "mp-title", th ? th.name : "—"),
        h("div", "mp-meta", why),
        h("div", "mp-mood", th ? t(th.mood) : t("Nothing plays. Click a theme to listen, or choose the adaptive mode.")),
        h(
          "div",
          "mp-meta",
          s.playing
            ? `${SECTION[s.section]?.() ?? s.section} · ${t("bar")} ${s.bar + 1} · ${Math.floor(s.beat) + 1}/${(s.theme && THEME_BY_ID[s.theme]?.beats) || 4}`
            : "",
        ),
        h(
          "div",
          "mp-meta",
          s.playing ? `${s.bpm} BPM · ${s.symbol || chordName(s.chord, Number.isFinite(s.root) ? s.root : undefined)}` : "",
        ),
        h("div", "mp-small", t("Energy")),
        energy,
        h("div", "mp-small", t("Intensity")),
        inten,
      );
      for (const [id, b] of this.themeBtns) b.classList.toggle("playing", id === s.theme);
    }
    // the spectrum: log-spaced bars, the sub's on the left
    const a = M.analyser();
    const c = this.canvas;
    const dpr = devicePixelRatio || 1;
    const W = Math.round(c.clientWidth * dpr),
      H = Math.round(c.clientHeight * dpr);
    if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, W, H);
    if (a) {
      if (this.spec.length !== a.frequencyBinCount) this.spec = new Uint8Array(a.frequencyBinCount);
      a.getByteFrequencyData(this.spec);
      const n = 64;
      const sr = a.context.sampleRate;
      if (!this.grad || this.gradH !== H) {
        this.grad = g.createLinearGradient(0, H, 0, 0);
        this.grad.addColorStop(0, "#2f7fd8");
        this.grad.addColorStop(0.6, "#9a6cff");
        this.grad.addColorStop(1, "#ff7a9a");
        this.gradH = H;
      }
      g.fillStyle = this.grad;
      for (let i = 0; i < n; i++) {
        const f0 = 30 * (16000 / 30) ** (i / n),
          f1 = 30 * (16000 / 30) ** ((i + 1) / n);
        const b0 = Math.floor((f0 / (sr / 2)) * this.spec.length),
          b1 = Math.max(b0 + 1, Math.floor((f1 / (sr / 2)) * this.spec.length));
        let m = 0;
        for (let b = b0; b < b1 && b < this.spec.length; b++) m = Math.max(m, this.spec[b]!);
        const hgt = (m / 255) * H;
        const x = (i / n) * W;
        g.fillRect(x + 1, H - hgt, W / n - 2, hgt);
      }
    }
    const lv = M.levels();
    if (lv) for (const [l, b] of this.meters) b.style.width = `${Math.max(0, Math.min(100, ((lv[l] + 60) / 60) * 100))}%`;
  }
}

const SCALE_NAME: Record<string, () => string> = {
  minor: () => t("minor"),
  dorian: () => t("Dorian"),
  phrygian: () => t("Phrygian"),
  lydian: () => t("Lydian"),
  major: () => t("major"),
  mixolydian: () => t("Mixolydian"),
  harmonicMinor: () => t("harmonic minor"),
};
const SECTION: Record<string, () => string> = {
  intro: () => t("Intro"),
  verse: () => t("Verse"),
  build: () => t("Build-up"),
  drop: () => t("Drop"),
  break: () => t("Break"),
  outro: () => t("Outro"),
};
