// Photo mode: the view alone — the interface hidden, the time held (the image refines), the camera
// free — and one bar for what a photograph needs: the exposure, the lens, the depth of field, the
// bloom, the time, a PNG now or an offline render at any size. Escape leaves it as it found the scene.

import { t, tr, type Text } from "../i18n";
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
  hide: { fr: "masquer la barre", en: "hide the bar" },
  leave: { fr: "quitter", en: "leave" },
  back: { fr: "Retour au jeu", en: "Back to the game" },
  show: { fr: "Afficher la barre", en: "Show the bar" },
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
}

export class PhotoMode {
  private bar: HTMLElement | null = null;
  /** the bar hidden (H): a small button to bring it back — a touch screen has no H */
  private peek: HTMLButtonElement | null = null;
  private restore: (() => void) | null = null;
  private unEscape: (() => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    // (H: the bar out of the picture, and back)
    if (e.key.toLowerCase() === "h" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.hideBar(!this.bar?.classList.contains("ph-hidden"));
    }
  };

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
      button({ label: tr(T.render), kind: "primary", testid: "photo-render", onClick: () => this.d.render() }),
      h("span", { class: "ph-keys" }, kbd("H"), ` ${tr(T.hide)} · `, kbd(t("Esc")), ` ${tr(T.leave)}`),
      // (the way back, in plain sight: Escape is not on every keyboard, nor on a tablet)
      button({ label: tr(T.back), icon: "close", testid: "photo-back", onClick: () => this.close() }),
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

  close() {
    if (!this.bar) return;
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
  }
}
