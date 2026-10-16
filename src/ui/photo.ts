// Photo mode: the view alone — the interface hidden, the time held (the image refines), the camera
// free — and one bar for what a photograph needs: the exposure, the lens, the depth of field, the
// bloom, the time, a PNG now or an offline render at any size; and for a film (PLAN-MODES-AAA M8): the shot
// (live, a take, the camera moves, the director's cameras), its length and rate, a draft to test it in seconds or
// the final, its progress. Escape leaves it as it found the scene.

import { t, tf, tr, type Text } from "../i18n";
import type { Shot } from "../photo/videoplan";
import type { VideoState } from "../renderdialog";
import type { Settings } from "../settings";
import { onEscape } from "./keys";
import { button, el, h, kbd } from "./kit";

const T = {
  title: { fr: "Mode photo", en: "Photo mode" },
  exposure: { fr: "Exposition", en: "Exposure" },
  lens: { fr: "Champ", en: "Field" },
  dof: { fr: "Profondeur de champ", en: "Depth of field" },
  bloom: { fr: "Éclat", en: "Bloom" },
  time: { fr: "Temps", en: "Time" },
  run: { fr: "En marche", en: "Running" },
  held: { fr: "Figé", en: "Held" },
  png: { fr: "PNG", en: "PNG" },
  render: { fr: "Rendu…", en: "Render…" },
  multi: { fr: "Surimpression…", en: "Multiple exposure…" },
  hide: { fr: "masquer la barre", en: "hide the bar" },
  leave: { fr: "quitter", en: "leave" },
  back: { fr: "Retour au jeu", en: "Back to the game" },
  show: { fr: "Afficher la barre", en: "Show the bar" },
  video: { fr: "Vidéo", en: "Video" },
  shot: { fr: "Plan", en: "Shot" },
  seconds: { fr: "Durée (s)", en: "Length (s)" },
  fps: { fr: "Images par seconde", en: "Frames per second" },
  draft: { fr: "Brouillon", en: "Draft" },
  draftTip: {
    fr: "640×360, 4 échantillons : le plan et son rythme en quelques secondes, avant le rendu final",
    en: "640×360, 4 samples: the shot and its timing in seconds, before the final render",
  },
  final: { fr: "Rendu vidéo", en: "Render video" },
  stop: { fr: "Arrêter", en: "Stop" },
} satisfies Record<string, Text>;

export interface PhotoDeps {
  settings: Settings;
  /** the camera free (the ship left), the time held — returns how to put them back */
  enter(): () => void;
  /** a setting changed (the image redone, the panel synced) */
  changed(keys: (keyof Settings)[]): void;
  setFov(deg: number): void;
  playPause(on: boolean): void;
  png(): void;
  render(): void;
  /** the multiple exposure's dialog (PLAN-CIEL C8) */
  multi?(): void;
  /** a video (renderdialog.ts): its shots, started (why not, or null), stopped, its state */
  video?: {
    shots(): { id: Shot; label: string; available: boolean }[];
    start(o: { shot: Shot; seconds: number; fps: number; draft: boolean }): string | null;
    stop(): void;
    state(): VideoState | null;
  };
  toast?(x: string): void;
}

export class PhotoMode {
  private bar: HTMLElement | null = null;
  /** the bar hidden (H): a small button to bring it back — a touch screen has no H */
  private peek: HTMLButtonElement | null = null;
  private restore: (() => void) | null = null;
  private unEscape: (() => void) | null = null;
  /** the video's progress read four times a second while the bar is open */
  private tick = 0;
  private onKey = (e: KeyboardEvent) => {
    // (H: the bar out of the picture, and back)
    if (e.key.toLowerCase() === "h" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.hideBar(!this.bar?.classList.contains("ph-hidden"));
    }
  };

  /** once, after it closed (the replay's photo — ui/replay.ts) */
  onClosed: (() => void) | null = null;

  constructor(private d: PhotoDeps) {}

  private hideBar(hidden: boolean) {
    this.bar?.classList.toggle("ph-hidden", hidden);
    if (this.peek) this.peek.hidden = !hidden;
  }

  get isOpen() {
    return !!this.bar;
  }

  open() {
    if (this.bar) return;
    this.restore = this.d.enter();
    document.body.classList.add("photo");
    const s = this.d.settings;
    const slider = (
      label: Text,
      min: number,
      max: number,
      step: number,
      get: () => number,
      set: (v: number) => void,
      fmt: (v: number) => string,
    ) => {
      const input = h("input", { type: "range", min: String(min), max: String(max), step: String(step), "aria-label": tr(label) });
      input.value = String(get());
      const out = el("output", "ph-val", fmt(get()));
      input.addEventListener("input", () => {
        set(Number(input.value));
        out.textContent = fmt(Number(input.value));
      });
      return h("label", { class: "ph-ctl" }, el("span", "ph-lab", tr(label)), input, out);
    };
    const toggle = (label: Text, key: "dof" | "animate") => {
      const b = button({ label: tr(label), on: !!s[key], testid: `photo-${key}` });
      b.addEventListener("click", () => {
        if (key === "animate") this.d.playPause(!s.animate);
        else {
          s.dof = !s.dof;
          this.d.changed(["dof"]);
        }
        b.classList.toggle("on", !!s[key]);
      });
      return b;
    };
    // (the lens as a focal length on a 24 mm-high frame, logarithmic: 8 mm to 2 400 mm)
    const fovToMm = (fov: number) => 12 / Math.tan((fov * Math.PI) / 360);
    const mmToFov = (mm: number) => (360 / Math.PI) * Math.atan(12 / mm);
    this.bar = h(
      "div",
      { class: "ph-bar k-frame", role: "toolbar", "aria-label": tr(T.title), "data-testid": "photo" },
      h("span", { class: "k-title ph-title" }, tr(T.title)),
      slider(
        T.exposure,
        -6,
        6,
        0.05,
        () => s.exposure,
        (v) => {
          s.exposure = v;
          this.d.changed(["exposure"]);
        },
        (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} EV`,
      ),
      slider(
        T.lens,
        Math.log(8),
        Math.log(2400),
        0.01,
        () => Math.log(fovToMm(s.fov)),
        (v) => this.d.setFov(mmToFov(Math.exp(v))),
        (v) => `${Math.round(Math.exp(v))} mm`,
      ),
      slider(
        T.bloom,
        0,
        0.5,
        0.005,
        () => s.bloom,
        (v) => {
          s.bloom = v;
          this.d.changed(["bloom"]);
        },
        (v) => v.toFixed(2),
      ),
      toggle(T.dof, "dof"),
      toggle(T.time, "animate"),
      button({ label: tr(T.png), testid: "photo-png", onClick: () => this.d.png() }),
      button({ label: tr(T.multi), testid: "photo-multi", onClick: () => this.d.multi?.() }),
      button({ label: tr(T.render), kind: "primary", testid: "photo-render", onClick: () => this.d.render() }),
      h("span", { class: "ph-keys" }, kbd("H"), ` ${tr(T.hide)} · `, kbd(t("Esc")), ` ${tr(T.leave)}`),
      // (the way back, in plain sight: Escape is not on every keyboard, nor on a tablet)
      button({ label: tr(T.back), icon: "close", testid: "photo-back", onClick: () => this.close() }),
      ...(this.d.video ? [this.videoRow(this.d.video)] : []),
    );
    this.peek = h(
      "button",
      { class: "ph-peek", type: "button", "data-testid": "photo-peek", "aria-label": tr(T.show) },
      tr(T.show),
    ) as HTMLButtonElement;
    this.peek.hidden = true;
    this.peek.addEventListener("click", () => this.hideBar(false));
    document.body.append(this.bar, this.peek);
    this.unEscape = onEscape(() => this.close());
    addEventListener("keydown", this.onKey, true);
  }

  /** The bar's film row: the shot, its length and rate, a draft or the final; its progress while it renders. */
  private videoRow(v: NonNullable<PhotoDeps["video"]>) {
    const shot = h("select", { class: "ph-sel", "aria-label": tr(T.shot), "data-testid": "photo-shot" }) as HTMLSelectElement;
    const fillShots = () => {
      const keep = shot.value;
      shot.replaceChildren(...v.shots().map((x) => h("option", { value: x.id, disabled: !x.available }, x.label) as HTMLOptionElement));
      shot.value = [...shot.options].find((o) => o.value === keep && !o.disabled)?.value ?? "orbit";
    };
    fillShots();
    shot.addEventListener("focus", fillShots);
    const secs = h("input", {
      class: "ph-num",
      type: "number",
      min: "1",
      max: "600",
      step: "1",
      value: "10",
      "aria-label": tr(T.seconds),
      "data-testid": "photo-seconds",
    }) as HTMLInputElement;
    const fps = h("select", { class: "ph-sel", "aria-label": tr(T.fps), "data-testid": "photo-fps" }) as HTMLSelectElement;
    fps.append(...["24", "30", "60"].map((x) => h("option", { value: x }, `${x} fps`)));
    const start = (draft: boolean) => {
      const why = v.start({
        shot: shot.value as Shot,
        seconds: Math.min(600, Math.max(1, Number(secs.value) || 10)),
        fps: Number(fps.value),
        draft,
      });
      if (why) this.d.toast?.(why);
      sync();
    };
    const draftBtn = button({ label: tr(T.draft), title: tr(T.draftTip), testid: "photo-draft", onClick: () => start(true) });
    const finalBtn = button({ label: tr(T.final), kind: "primary", testid: "photo-video", onClick: () => start(false) });
    const prog = el("span", "ph-prog");
    prog.dataset.testid = "photo-video-progress";
    const bar = el("i", "");
    const meter = h("span", { class: "ph-meter" }, bar);
    const stopBtn = button({ label: tr(T.stop), testid: "photo-video-stop", onClick: () => v.stop() });
    const sync = () => {
      const st = v.state();
      for (const x of [shot, secs, fps]) x.disabled = !!st;
      // (rendering: its progress and Stop where its buttons were)
      draftBtn.hidden = finalBtn.hidden = !!st;
      stopBtn.hidden = meter.hidden = !st;
      prog.textContent = st
        ? `${st.draft ? `${tr(T.draft)} · ` : ""}${tf("frame {0} / {1}", Math.min(st.frame + 1, st.frames || 1), st.frames || "…")}${Number.isFinite(st.etaS) ? ` · ${tf("about {0} s left", Math.ceil(st.etaS))}` : ""}`
        : "";
      bar.style.width = st && st.frames ? `${((st.frame / st.frames) * 100).toFixed(1)}%` : "0";
    };
    sync();
    clearInterval(this.tick);
    this.tick = window.setInterval(sync, 250);
    return h(
      "div",
      { class: "ph-video", role: "group", "aria-label": tr(T.video) },
      el("span", "ph-lab", tr(T.video)),
      shot,
      h("label", { class: "ph-ctl" }, el("span", "ph-lab", tr(T.seconds)), secs),
      fps,
      draftBtn,
      finalBtn,
      meter,
      prog,
      stopBtn,
    );
  }

  close() {
    if (!this.bar) return;
    clearInterval(this.tick);
    removeEventListener("keydown", this.onKey, true);
    this.unEscape?.();
    this.unEscape = null;
    this.bar.remove();
    this.bar = null;
    this.peek?.remove();
    this.peek = null;
    document.body.classList.remove("photo");
    this.restore?.();
    this.restore = null;
    const after = this.onClosed;
    this.onClosed = null;
    after?.();
  }
}
