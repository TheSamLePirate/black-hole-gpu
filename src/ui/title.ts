// The title screen, at every launch (unless a link names a scene, a save or the benchmark): the
// scene behind it — the flight saved last, already loaded, so Continue only lifts the screen — the
// time held, the HUD hidden; the game's entries in the HUD's language, a console's up / down / enter.

import { lang, setLang, tr, type Text } from "../i18n";
import { button, el, h, kbd } from "./kit";

const T = {
  tagline: { fr: "Un vol à travers l'espace-temps de Kerr — jusqu'à Gargantua", en: "A flight through Kerr spacetime — on to Gargantua" },
  continue: { fr: "Continuer", en: "Continue" },
  missions: { fr: "Missions", en: "Missions" },
  missionsHint: { fr: "Le voyage, Artemis, le trou de ver, Gargantua", en: "The journey, Artemis, the wormhole, Gargantua" },
  explore: { fr: "Explorer", en: "Explore" },
  exploreHint: {
    fr: "79 scènes : la Terre, le système solaire, les trous noirs",
    en: "79 scenes: the Earth, the solar system, the black holes",
  },
  photo: { fr: "Mode photo", en: "Photo mode" },
  photoHint: { fr: "La vue seule, le rendu hors ligne", en: "The view alone, the offline render" },
  settings: { fr: "Réglages", en: "Settings" },
  bench: { fr: "Kerr Bench — mesurer cette machine", en: "Kerr Bench — measure this machine" },
  menu: { fr: "Menu principal", en: "Main menu" },
  keys: { fr: "choisir", en: "choose" },
} satisfies Record<string, Text>;

export interface TitleDeps {
  /** the saved flight behind the screen, in a line (null: none — no Continue) */
  saved(): string | null;
  /** the simulation held (true) or running again */
  hold(on: boolean): void;
  missions(): void;
  explore(): void;
  photo(): void;
  settings(): void;
  bench(): void;
  /** the build's version (the footer) */
  version(): string;
}

export class TitleScreen {
  private root: HTMLElement | null = null;

  constructor(private d: TitleDeps) {}

  get isOpen() {
    return !!this.root;
  }

  open() {
    if (this.root) return;
    this.d.hold(true);
    document.body.classList.add("title-open");
    const saved = this.d.saved();
    const item = (label: string, hint: string, fn: () => void, testid: string) => {
      const b = button({ label, testid, onClick: () => this.leave(fn) });
      b.classList.add("ts-item");
      if (hint) b.append(el("small", "ts-hint", hint));
      return b;
    };
    const list = h(
      "nav",
      { class: "ts-list", "aria-label": tr(T.menu) },
      saved ? item(tr(T.continue), saved, () => {}, "title-continue") : null,
      item(tr(T.missions), tr(T.missionsHint), this.d.missions, "title-missions"),
      item(tr(T.explore), tr(T.exploreHint), this.d.explore, "title-explore"),
      item(tr(T.photo), tr(T.photoHint), this.d.photo, "title-photo"),
      item(tr(T.settings), "", this.d.settings, "title-settings"),
    );
    list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      e.stopPropagation();
      const items = [...list.querySelectorAll<HTMLButtonElement>("button")];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    });
    const langs = h(
      "div",
      { class: "ts-lang", role: "group", "aria-label": "Langue · Language" },
      ...(["fr", "en"] as const).map((l) =>
        button({
          label: l.toUpperCase(),
          on: lang === l,
          title: l === "fr" ? "Français" : "English",
          onClick: () => {
            if (lang === l) return;
            setLang(l);
            location.reload();
          },
        }),
      ),
    );
    this.root = h(
      "div",
      { class: "ts-root", role: "dialog", "aria-modal": "true", "aria-label": "KERR", "data-testid": "title" },
      h(
        "div",
        { class: "ts-panel" },
        h("h1", { class: "ts-logo" }, "KERR"),
        el("p", "ts-tagline", tr(T.tagline)),
        list,
        h("p", { class: "ts-keys" }, kbd("↑"), kbd("↓"), " ", kbd("Enter"), ` ${tr(T.keys)}`),
      ),
      h(
        "footer",
        { class: "ts-foot" },
        h("a", { class: "ts-bench", href: "#bench", onclick: (e: Event) => (e.preventDefault(), this.leave(this.d.bench)) }, tr(T.bench)),
        langs,
        el("span", "ts-version", this.d.version()),
      ),
    );
    document.body.append(this.root);
    list.querySelector<HTMLButtonElement>("button")?.focus();
  }

  /** The keyboard's focus on the first entry (again: the loading screen, lifting, takes it). */
  focusFirst() {
    this.root?.querySelector<HTMLButtonElement>(".ts-list button")?.focus();
  }

  /** Lifts the screen, then goes where the entry said. */
  private leave(fn: () => void) {
    this.close();
    fn();
  }

  close() {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    document.body.classList.remove("title-open");
    this.d.hold(false);
  }
}
