// The controls screen (from the pause menu): every key the player may set, by group — flying held,
// flying, the time, the camera and the scene, the free camera, the system —, each with its key now. A
// click, then a key: set (a key another binding of the same context had swaps with it, said so);
// Escape while listening cancels. The full help sheet and a reset to the defaults are a click away.

import { tr, type Text } from "../i18n";
import { keyLabel, rebind, remappables, resetBindings, type Remappable } from "../input/bindings";
import { onEscape } from "./keys";
import { button, el, h } from "./kit";

const T = {
  title: { fr: "Commandes", en: "Controls" },
  listen: { fr: "Appuyez sur une touche… (Échap : annuler)", en: "Press a key… (Esc: cancel)" },
  swapped: { fr: "prend l'ancienne touche", en: "takes the old key" },
  reset: { fr: "Tout réinitialiser", en: "Reset all" },
  help: { fr: "Aide complète", en: "Full help" },
  back: { fr: "Retour", en: "Back" },
  pads: { fr: "Manettes et HOTAS…", en: "Controllers and HOTAS…" },
  custom: { fr: "modifié", en: "changed" },
  pad: {
    fr: "Manette : stick gauche tangage et lacet · LB RB roulis · RT LT gaz · A SAS · X/Y pro/rétrograde · Start pause",
    en: "Pad: left stick pitch and yaw · LB RB roll · RT LT throttle · A SAS · X/Y pro/retrograde · Start pause",
  },
} satisfies Record<string, Text>;

const GROUPS: [Remappable["group"], Text][] = [
  ["fly-held", { fr: "Pilotage — tenu", en: "Flying — held" }],
  ["fly", { fr: "Pilotage — actions", en: "Flying — actions" }],
  ["time", { fr: "Temps", en: "Time" }],
  ["scene", { fr: "Caméra et scène", en: "Camera and scene" }],
  ["free", { fr: "Caméra libre", en: "Free camera" }],
  ["system", { fr: "Système", en: "System" }],
];

export interface ControlsDeps {
  help(): void;
  /** the controllers screen (ui/pads-screen.ts) */
  pads(): void;
  /** gone back (to the pause menu) */
  back(): void;
  toast(text: string): void;
}

export class ControlsScreen {
  private root: HTMLElement | null = null;
  private body!: HTMLElement;
  private unEscape: (() => void) | null = null;
  private listening: { id: string; chip: HTMLButtonElement; usesCode: boolean } | null = null;

  constructor(private d: ControlsDeps) {}

  get isOpen() {
    return !!this.root;
  }

  open() {
    if (this.root) return;
    this.body = h("div", { class: "cs-body" });
    const frame = h(
      "div",
      { class: "k-frame cs", role: "dialog", "aria-modal": "true", "aria-label": tr(T.title), "data-testid": "controls" },
      h("h2", { class: "k-title cs-title" }, tr(T.title)),
      this.body,
      el("p", "cs-pad", tr(T.pad)),
      h(
        "div",
        { class: "cs-acts" },
        button({
          label: tr(T.pads),
          testid: "controls-pads",
          onClick: () => {
            this.close(false);
            this.d.pads();
          },
        }),
        button({ label: tr(T.help), onClick: () => this.d.help() }),
        button({
          label: tr(T.reset),
          kind: "danger",
          testid: "controls-reset",
          onClick: () => {
            resetBindings();
            this.render();
          },
        }),
        button({ label: tr(T.back), testid: "controls-back", onClick: () => this.close(true) }),
      ),
    );
    this.root = h("div", { class: "k-modal" }, frame);
    document.body.append(this.root);
    this.unEscape = onEscape(() => this.close(true));
    addEventListener("keydown", this.onKey, true);
    this.render();
  }

  private render() {
    const all = remappables();
    this.body.replaceChildren(
      ...GROUPS.map(([g, title]) => {
        const rows = all.filter((r) => r.group === g);
        if (!rows.length) return el("span");
        return h(
          "section",
          { class: "cs-group" },
          h("h3", { class: "k-label" }, tr(title)),
          ...rows.map((r) => {
            const chip = button({ label: this.label(r), testid: `bind-${r.id}` });
            chip.classList.add("cs-key");
            const changed = (r.now.code ?? r.now.key) !== (r.def.code ?? r.def.key);
            chip.classList.toggle("on", changed);
            chip.addEventListener("click", () => this.listen(r, chip));
            return h(
              "div",
              { class: "cs-row" },
              el("span", "cs-name", tr(r.label)),
              changed ? el("small", "cs-custom", tr(T.custom)) : null,
              chip,
            );
          }),
        );
      }),
    );
  }

  private label(r: Remappable) {
    return `${r.shift ? "⇧" : ""}${keyLabel(r.now)}`;
  }

  private listen(r: Remappable, chip: HTMLButtonElement) {
    this.listening = { id: r.id, chip, usesCode: !!r.def.code };
    chip.querySelector("span")!.textContent = tr(T.listen);
    chip.classList.add("listening");
  }

  /** While listening: the next key is the binding's (taken before anything else sees it). */
  private onKey = (e: KeyboardEvent) => {
    if (!this.listening) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // (a lone modifier is a key too — the throttle's Shift —, but not for a character binding)
    const L = this.listening;
    this.listening = null;
    if (e.key === "Escape") return this.render();
    const swapped = rebind(L.id, L.usesCode ? { code: e.code } : { key: e.key.length === 1 ? e.key.toLowerCase() : e.key });
    if (swapped) this.d.toast(`${tr(swapped)} ${tr(T.swapped)}`);
    this.render();
  };

  close(back: boolean) {
    if (!this.root) return;
    removeEventListener("keydown", this.onKey, true);
    this.listening = null;
    this.unEscape?.();
    this.unEscape = null;
    this.root.remove();
    this.root = null;
    if (back) this.d.back();
  }
}
