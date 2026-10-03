// The mission selector: full screen, the missions listed on the left, the one chosen briefed on the
// right — its picture, what it is, the objectives, the keys — and LAUNCH. ↑ ↓ choose, Enter launches,
// Escape goes back.

import { tr, type Text } from "../i18n";
import { MISSIONS, type Mission } from "../game/missions";
import { SCENE_THUMBS } from "./scene-thumbs";
import { onEscape } from "./keys";
import { button, el, h, kbd } from "./kit";

const T = {
  title: { fr: "Missions", en: "Missions" },
  launch: { fr: "Lancer", en: "Launch" },
  back: { fr: "Retour", en: "Back" },
  objectives: { fr: "Objectifs", en: "Objectives" },
  keys: { fr: "Commandes", en: "Controls" },
  minutes: { fr: "min environ", en: "min or so" },
  difficulty: { fr: "Difficulté", en: "Difficulty" },
  hint: { fr: "choisir · lancer · retour", en: "choose · launch · back" },
} satisfies Record<string, Text>;

export interface MissionSelectDeps {
  /** starts the mission's scene */
  launch(scene: string): void;
  /** gone back without launching (the title screen comes back, or nothing) */
  back(): void;
}

export class MissionSelect {
  private root: HTMLElement | null = null;
  private unEscape: (() => void) | null = null;
  private brief!: HTMLElement;
  private chosen = 0;

  constructor(private d: MissionSelectDeps) {}

  get isOpen() {
    return !!this.root;
  }

  open() {
    if (this.root) return;
    const list = h("nav", { class: "ms-list", "aria-label": tr(T.title) });
    MISSIONS.forEach((m, i) => {
      const b = button({ label: tr(m.title), testid: `mission-${i}` });
      b.classList.add("ms-item");
      b.append(el("small", "ms-tag", tr(m.tagline)), el("span", "ms-pips", "◆".repeat(m.difficulty) + "◇".repeat(3 - m.difficulty)));
      b.addEventListener("focus", () => this.choose(i));
      b.addEventListener("click", () => (this.chosen === i ? this.launch() : this.choose(i)));
      list.append(b);
    });
    list.addEventListener("keydown", (e) => {
      // (Enter: the item focused, here — not left to the browser's activation of a focused button)
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "BUTTON") {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLButtonElement).click();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      e.stopPropagation();
      const items = [...list.querySelectorAll<HTMLButtonElement>("button")];
      items[(this.chosen + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    });
    this.brief = h("section", { class: "ms-brief", "aria-live": "polite" });
    this.root = h(
      "div",
      { class: "ms-root", role: "dialog", "aria-modal": "true", "aria-label": tr(T.title), "data-testid": "missions" },
      h(
        "div",
        { class: "ms-side" },
        h("h2", { class: "k-title ms-title" }, tr(T.title)),
        list,
        h("p", { class: "ms-keys" }, kbd("↑"), kbd("↓"), kbd("Enter"), kbd("Esc"), ` ${tr(T.hint)}`),
      ),
      this.brief,
    );
    document.body.append(this.root);
    document.body.classList.add("title-open"); // (the interface under it out of sight, as under the title)
    this.unEscape = onEscape(() => this.close(true));
    list.querySelector<HTMLButtonElement>("button")?.focus();
    this.choose(0);
  }

  private choose(i: number) {
    this.chosen = i;
    const m = MISSIONS[i]!;
    for (const [k, b] of [...(this.root?.querySelectorAll<HTMLElement>(".ms-item") ?? [])].entries()) b.classList.toggle("on", k === i);
    this.brief.replaceChildren(...this.briefing(m));
  }

  private briefing(m: Mission): Node[] {
    const src = SCENE_THUMBS[m.scene];
    return [
      h("div", { class: "ms-pic" }, src ? h("img", { src, alt: "" }) : null),
      h("h3", { class: "ms-name" }, tr(m.title)),
      h(
        "p",
        { class: "ms-meta" },
        `${tr(T.difficulty)} `,
        el("span", "ms-pips", "◆".repeat(m.difficulty) + "◇".repeat(3 - m.difficulty)),
        ` · ${m.minutes} ${tr(T.minutes)}`,
      ),
      el("p", "ms-text", tr(m.briefing)),
      h("h4", { class: "k-label" }, tr(T.objectives)),
      h("ol", { class: "ms-goals" }, ...m.objectives.map((o) => el("li", "", tr(o)))),
      h("h4", { class: "k-label" }, tr(T.keys)),
      h("dl", { class: "ms-ctl" }, ...m.keys.flatMap(([k, t]) => [h("dt", {}, kbd(k)), el("dd", "", tr(t))])),
      h(
        "div",
        { class: "ms-acts" },
        button({ label: tr(T.launch), kind: "primary", testid: "mission-launch", onClick: () => this.launch() }),
        button({ label: tr(T.back), onClick: () => this.close(true) }),
      ),
    ];
  }

  private launch() {
    const scene = MISSIONS[this.chosen]!.scene;
    this.close(false);
    this.d.launch(scene);
  }

  close(back: boolean) {
    if (!this.root) return;
    this.unEscape?.();
    this.unEscape = null;
    this.root.remove();
    this.root = null;
    document.body.classList.remove("title-open");
    if (back) this.d.back();
  }
}
