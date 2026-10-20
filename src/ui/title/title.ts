// The title screen (PLAN-TITRE-AAA E2): built at the page's start, before the graphics — usable while the game
// loads. The emblem and the name (the intro's, glided here), Continue, the four ways to play as cards, More… and
// Settings; a mode's screen lists what to launch in it. A launch chosen before the game is there is kept and run
// as soon as it is (attach(): before the first image — its scene then the only one compiled), the intro saying it
// meanwhile. Screens by ui/menu/router.ts (the focus in two dimensions, Escape / B back, the controller's every
// button), prompts by the device used last.

import markUrl from "../../../assets/title/kerr-mark.webp";
import { lang, setLang, tr, type Text } from "../../i18n";
import { autosave, type GameSave, slots } from "../../game/save";
import { button, el, h } from "../kit";
import type { MenuAction } from "../menu/actions";
import { glyph, onInputChange, watchInput } from "../menu/glyphs";
import { type MenuScreen, MenuRouter } from "../menu/router";
import { SCENE_THUMBS } from "../scene-thumbs";
import { type Activity, MODES, type ModeId, MORE, type Mode, type TitleGame, type VesselChoice } from "./activities";
import { geocode, parseCoords } from "../../game/geocode";
import { MODE_ART, TURNTABLES, turntable, WORLD_MAPS } from "./art";
import {
  type FootChoice,
  type FootPlace,
  footLine,
  HOUR_OF,
  keepFoot,
  kindName,
  lastFoot,
  mapPoint,
  placeCoords,
  placesOf,
  WORLDS,
  type World,
} from "./foot";
import { FREE_TABS, type FreeTab, freeScenes, sceneSlug } from "./free";
import {
  challengeItems,
  combatItems,
  cycle,
  FIELDS,
  FIGURE_HOWS,
  type FigureHow,
  type FlightChoice,
  FUELS,
  flightLine,
  HOURS,
  keepFlight,
  LESSON_HOWS,
  type LessonHow,
  lastFlight,
  lessonItems,
  type PlaneItem,
  STARTS,
  WEATHERS,
} from "./plane";
import { CREDITS, whoOf } from "./credits";
import { CRAFT, launchShip, type ShipItem, sheetLines, shipItems } from "./ship";

/** By plane's tabs (E4) */
type PlaneTab = "free" | "combat" | "school" | "challenges";
const PLANE_TABS: { id: PlaneTab; label: Text }[] = [
  { id: "free", label: { fr: "Vol libre", en: "Free flight" } },
  { id: "combat", label: { fr: "Combat", en: "Combat" } },
  { id: "school", label: { fr: "École de vol", en: "Flight school" } },
  { id: "challenges", label: { fr: "Défis", en: "Challenges" } },
];
const P = {
  field: { fr: "Aérodrome", en: "Airfield" },
  start: { fr: "Départ", en: "Start" },
  hour: { fr: "Heure", en: "Hour" },
  weather: { fr: "Météo", en: "Weather" },
  fuel: { fr: "Carburant", en: "Fuel" },
  fly: { fr: "Lancer le vol", en: "Fly" },
  flyHint: { fr: "Le F-35B, là et comme réglé", en: "The F-35B, there and as set" },
  how: { fr: "Comment", en: "How" },
  tab: { fr: "Onglet", en: "Tab" },
  search: { fr: "Chercher un aérodrome (OACI, nom)", en: "Find an airfield (ICAO, name)" },
  fieldTitle: { fr: "L'aérodrome", en: "The airfield" },
  freeText: {
    fr: "Le F-35B à l'aérodrome choisi, aligné sur sa piste en service, en finale ou en croisière, à l'heure de son propre jour, sous la météo choisie.",
    en: "The F-35B at the airfield chosen, lined up on its runway in use, on final or cruising, at the hour of its own day, under the weather chosen.",
  },
} satisfies Record<string, Text>;

/** On foot's and the free camera's words (E6) */
const F = {
  world: { fr: "Monde", en: "World" },
  place: { fr: "Lieu", en: "Place" },
  hour: { fr: "Heure", en: "Hour" },
  weather: { fr: "Météo", en: "Weather" },
  go: { fr: "Marcher", en: "Walk" },
  goHint: { fr: "Le vaisseau posé à côté, l'astronaute dehors", en: "The ship set down beside, the astronaut outside" },
  atlas: { fr: "Choisir sur l'Atlas…", en: "Choose on the Atlas…" },
  atlasHint: { fr: "La carte du monde : n'importe où, n'importe quelle adresse", en: "The world's map: anywhere, any address" },
  search: { fr: "Un lieu, une adresse, des coordonnées…", en: "A place, an address, coordinates…" },
  searchOff: { fr: "Un lieu, des coordonnées…", en: "A place, coordinates…" },
  placeTitle: { fr: "Le lieu", en: "The place" },
  addresses: { fr: "Adresses", en: "Addresses" },
  searching: { fr: "Recherche des adresses…", en: "Searching the addresses…" },
  noAddress: { fr: "Aucune adresse trouvée", en: "No address found" },
  point: { fr: "Ces coordonnées", en: "These coordinates" },
  view: { fr: "Voir", en: "View" },
  tab: { fr: "Onglet", en: "Tab" },
} satisfies Record<string, Text>;

/** More…'s and the credits' words (E7) */
const M = {
  play: { fr: "Jouer", en: "Play" },
  make: { fr: "Créer", en: "Create" },
  together: { fr: "Ensemble", en: "Together" },
  learn: { fr: "Apprendre", en: "Learn" },
  measure: { fr: "Mesurer", en: "Measure" },
  game: { fr: "Le jeu", en: "The game" },
  howTo: { fr: "Comment jouer", en: "How to play" },
  howToHint: { fr: "Le guide, mode par mode (une page à part)", en: "The guide, mode by mode (a page of its own)" },
  discover: { fr: "Découvrir", en: "Discover" },
  discoverHint: {
    fr: "La physique derrière les images : Kerr, le disque, le trou de ver",
    en: "The physics behind the pictures: Kerr, the disk, the wormhole",
  },
  credits: { fr: "Crédits", en: "Credits" },
  creditsHint: { fr: "Qui a fait le jeu, et tout ce sur quoi il repose", en: "Who made the game, and everything it is built on" },
  language: { fr: "Langue", en: "Language" },
  languageHint: { fr: "La page se recharge dans l'autre langue", en: "The page reloads in the other language" },
  benchTitle: { fr: "Kerr Bench", en: "Kerr Bench" },
  benchText: {
    fr: "La page va se recharger pour mesurer cette machine : le tracé de rayons à chaque profondeur, puis les mondes, les vaisseaux, la météo et les vols. La partie en cours est sauvegardée.",
    en: "The page will reload to measure this machine: the ray tracer at each depth, then the worlds, the craft, the weather and the flights. The game in progress is saved.",
  },
  benchGo: { fr: "Lancer la mesure", en: "Start measuring" },
  cancel: { fr: "Annuler", en: "Cancel" },
  thanks: { fr: "Merci d'avoir joué", en: "Thank you for playing" },
  skip: { fr: "Passer", en: "Skip" },
} satisfies Record<string, Text>;

/** By ship's words (E5) */
const S = {
  where: { fr: "Destinations", en: "Destinations" },
  missions: { fr: "Missions", en: "Missions" },
  scenes: { fr: "Scènes", en: "Scenes" },
  more: { fr: "Ailleurs", en: "Elsewhere" },
  craft: { fr: "Vaisseau", en: "Craft" },
} satisfies Record<string, Text>;

const T = {
  tagline: { fr: "Un vol à travers l'espace-temps de Kerr — jusqu'à Gargantua", en: "A flight through Kerr spacetime — on to Gargantua" },
  continue: { fr: "Continuer", en: "Continue" },
  more: { fr: "Plus…", en: "More…" },
  settings: { fr: "Réglages", en: "Settings" },
  load: { fr: "Charger une partie", en: "Load a game" },
  loadHint: { fr: "La sauvegarde automatique et les vôtres", en: "The autosave and your own" },
  auto: { fr: "Sauvegarde automatique", en: "Autosave" },
  none: { fr: "Aucune sauvegarde pour l'instant.", en: "No saved game yet." },
  choose: { fr: "Choisir", en: "Choose" },
  launch: { fr: "Lancer", en: "Launch" },
  back: { fr: "Retour", en: "Back" },
  vessel: { fr: "Vaisseau", en: "Craft" },
  menu: { fr: "Menu principal", en: "Main menu" },
  ago: { fr: "il y a {0}", en: "{0} ago" },
  now: { fr: "à l'instant", en: "just now" },
  lead: { fr: "La partie en cours", en: "The game in progress" },
} satisfies Record<string, Text>;

/** how long ago, in a few words */
export function agoText(ms: number, l = lang): string {
  const s = Math.max(0, ms / 1000);
  const fr = l === "fr";
  if (s < 60) return fr ? T.now.fr : T.now.en;
  const v =
    s < 3600
      ? `${Math.round(s / 60)} min`
      : s < 86400
        ? `${Math.round(s / 3600)} h`
        : fr
          ? `${Math.round(s / 86400)} j`
          : `${Math.round(s / 86400)} d`;
  return (fr ? T.ago.fr : T.ago.en).replace("{0}", v);
}

export interface TitleDeps {
  /** the build's version (the foot) */
  version(): string;
  /** the simulation held (true) or running again — once the game is there */
  hold(on: boolean): void;
  /** a launch chosen before the game is there: said meanwhile (null: none any more) */
  waiting(label: string | null): void;
  /** the game in progress, in a line (null: none started yet) */
  current(): string | null;
}

export class TitleScreen {
  private root: HTMLElement | null = null;
  private router: MenuRouter | null = null;
  private game: TitleGame | null = null;
  /** a launch chosen before the game was there */
  private queued: { a: Activity; vessel: VesselChoice } | null = null;
  /** a game launched or continued from here (Continue then resumes the game left) */
  private started = false;
  private vessel: VesselChoice = "ranger";
  /** the mode chosen last (its card's picture grows into its screen) */
  private lastMode: Mode | null = null;
  private unInput: (() => void) | null = null;

  constructor(private d: TitleDeps) {}

  get isOpen() {
    return !!this.root;
  }
  /** what was chosen while the game loaded, not yet run */
  get pending() {
    return this.queued?.a ?? null;
  }

  open() {
    if (this.root) return;
    watchInput();
    if (this.game) this.d.hold(true);
    document.body.classList.add("title-open");
    this.root = h("div", { class: "tt-root", role: "dialog", "aria-modal": "true", "aria-label": "KERR", "data-testid": "title" });
    document.body.append(this.root);
    // (a mode's screen opened alone — the pause's Change mode ›: its back closes the title, then goes back there)
    this.router = new MenuRouter(this.root, {
      onEmpty: () => {
        const back = this.onBack;
        this.onBack = null;
        this.close();
        back?.();
      },
    });
    this.router.push(this.mainScreen());
    // (the prompts follow the device: a screen redrawn when it changes)
    // (the prompts follow the device: redrawn in place — never the whole page: a page rebuilt between a press and its
    // release, the first click after a key, swallowed the click)
    this.unInput = onInputChange(() => {
      for (const e of this.root?.querySelectorAll<HTMLElement & { refill?: () => void }>(".m-prompts") ?? []) e.refill?.();
    });
  }

  close() {
    if (!this.root) return;
    this.onBack = null;
    this.unInput?.();
    this.unInput = null;
    const r = this.router;
    this.router = null;
    r?.close();
    this.root.remove();
    this.root = null;
    document.body.classList.remove("title-open");
    if (this.game) this.d.hold(false);
  }

  /** where the back of a mode's screen opened alone goes (the pause) */
  private onBack: (() => void) | null = null;

  /** A way to play's launch screen alone, over the game (the pause's Change mode ›): its back closes the title,
   *  then `back` (the pause again). */
  openMode(id: ModeId, back?: () => void) {
    this.open();
    this.onBack = back ?? null;
    const m = MODES.find((x) => x.id === id)!;
    this.lastMode = m;
    this.router?.replace(
      id === "plane" ? this.planeScreen() : id === "ship" ? this.shipScreen() : id === "foot" ? this.footScreen() : this.freeScreen(),
    );
  }

  /** The keyboard's focus on the screen's first item (again: the intro, lifting, may have taken it). */
  focusFirst() {
    if (!this.root || this.root.contains(document.activeElement)) return;
    this.root.querySelector<HTMLElement>("[data-autofocus], button")?.focus({ preventScroll: true });
  }

  /** The game is there: what was chosen meanwhile is run now. */
  attach(game: TitleGame) {
    this.game = game;
    if (this.root) this.d.hold(true);
    const q = this.queued;
    this.queued = null;
    if (q) {
      this.d.waiting(null);
      this.run(q.a, q.vessel);
    }
  }

  /** An entry chosen: run now, or kept for when the game is there (the screen goes; the intro says it). */
  private choose(a: Activity) {
    if (!this.game) {
      this.queued = { a, vessel: this.vessel };
      this.close();
      this.d.waiting(tr(a.title));
      return;
    }
    this.run(a, this.vessel);
  }

  private run(a: Activity, vessel: VesselChoice) {
    const g = this.game!;
    this.started = true;
    this.close();
    try {
      a.run(g, { vessel });
    } catch (e) {
      g.toast((e as Error).message);
    }
  }

  // ------------------------------------------------------------------ screens

  private mainScreen(): MenuScreen {
    return {
      id: "title",
      build: () => this.buildMain(),
      // (Escape on the title: nothing — the pause is not under it)
      back: () => false,
    };
  }

  /** the line saying the game to continue (null: nothing to continue) */
  private continueInfo(): { line: string; when: string; art?: string } | null {
    if (this.started) {
      const c = this.d.current();
      return c ? { line: c, when: tr(T.lead), art: SCENE_THUMBS[FALLBACK_ART] } : null;
    }
    const s: GameSave | null = autosave.get();
    if (!s) return null;
    return {
      line: s.summary,
      when: agoText(Date.now() - s.savedAt),
      art: (s.scene && SCENE_THUMBS[s.scene]) || SCENE_THUMBS[FALLBACK_ART],
    };
  }

  private buildMain(): HTMLElement {
    const page = h("div", { class: "tt-page tt-main" });
    const brand = h(
      "header",
      { class: "tt-brand" },
      h("img", { class: "tt-mark", src: markUrl, alt: "" }),
      h("h1", { class: "tt-name", "aria-label": "KERR" }, "KERR"),
      el("p", "tt-tag", tr(T.tagline)),
    );
    const cont = this.continueInfo();
    const contBtn = cont
      ? h(
          "button",
          { class: "tt-continue", type: "button", "data-testid": "title-continue", "data-focus-id": "continue", "data-autofocus": "" },
          h("span", { class: "tt-cont-art", style: cont.art ? `background-image:url("${cont.art}")` : "" }),
          h(
            "span",
            { class: "tt-cont-text" },
            el("b", "", tr(T.continue)),
            el("span", "tt-cont-line", cont.line),
            el("small", "", cont.when),
          ),
        )
      : null;
    contBtn?.addEventListener("click", () => this.choose(CONTINUE));
    const cards = h(
      "nav",
      { class: "tt-modes", "aria-label": tr(T.menu) },
      ...MODES.map((m, i) => {
        const img = h("img", { class: "tt-card-art", src: MODE_ART[m.id].card, alt: "", loading: "eager" }) as HTMLImageElement;
        if (this.lastMode === m) img.style.viewTransitionName = "tt-art";
        const b = h(
          "button",
          {
            class: "tt-card",
            type: "button",
            "data-testid": `title-mode-${m.id}`,
            "data-focus-id": m.id,
            ...(!cont && i === 0 ? { "data-autofocus": "" } : {}),
          },
          img,
          h("span", { class: "tt-card-shade" }),
          h("span", { class: "tt-card-text" }, el("b", "", tr(m.title)), el("small", "", tr(m.pitch))),
        );
        b.addEventListener("click", () => {
          this.lastMode = m;
          img.style.viewTransitionName = "tt-art";
          this.router?.push(
            m.id === "plane"
              ? this.planeScreen()
              : m.id === "ship"
                ? this.shipScreen()
                : m.id === "foot"
                  ? this.footScreen()
                  : this.freeScreen(),
          );
        });
        return b;
      }),
    );
    const links = h(
      "div",
      { class: "tt-links" },
      this.link(tr(T.more), "title-more", () => this.router?.push(this.moreScreen())),
      this.link(tr(T.settings), "title-settings", () =>
        this.choose({ id: "settings", title: T.settings, hint: T.settings, opens: true, run: (g) => g.settings() }),
      ),
    );
    page.append(brand, h("div", { class: "tt-menu" }, contBtn, cards, links), this.foot([["confirm", T.choose]], false));
    return page;
  }

  private link(label: string, testid: string, fn: () => void) {
    const b = button({ label, testid, onClick: fn });
    b.classList.add("m-item", "tt-link");
    return b;
  }

  private foot(prompts: [MenuAction, Text][], back = true) {
    const lp = h(
      "div",
      { class: "tt-lang", role: "group", "aria-label": "Langue · Language" },
      ...(["fr", "en"] as const).map((l) => {
        const b = button({
          label: l.toUpperCase(),
          on: lang === l,
          title: l === "fr" ? "Français" : "English",
          onClick: () => {
            if (lang === l) return;
            setLang(l);
            location.reload();
          },
        });
        b.dataset.navSkip = "";
        return b;
      }),
    );
    const ps = h("div", { class: "m-prompts" }) as HTMLElement & { refill?: () => void };
    ps.refill = () =>
      ps.replaceChildren(
        ...[...prompts, ...(back ? ([["back", T.back]] as [MenuAction, Text][]) : [])].flatMap(([a, label]) => {
          const g = glyph(a);
          return g ? [h("span", { class: "m-prompt" }, el("span", "m-glyph", g), tr(label))] : [];
        }),
      );
    ps.refill();
    return h("footer", { class: "tt-foot" }, el("span", "tt-credit", "© SamLePirate"), lp, ps, el("span", "tt-version", this.d.version()));
  }

  /** a screen's head: the emblem small, the way here */
  private crumb(title: string) {
    return h(
      "header",
      { class: "tt-crumb" },
      h("img", { class: "tt-crumb-mark", src: markUrl, alt: "" }),
      el("span", "tt-crumb-name", "KERR"),
      el("span", "tt-crumb-sep", "›"),
      el("h2", "tt-crumb-title", title),
    );
  }

  /** the craft's turntable on the page shown (by ship), when there is one */
  private turn: (HTMLElement & { set(url: string): void }) | null = null;

  /** A list of entries and, beside it, the one focused shown large. */
  private listPage(id: string, title: string, art: string | undefined, items: Activity[], extra?: HTMLElement): HTMLElement {
    const page = h("div", { class: "tt-page tt-list", "data-mode": id });
    const preview = h("aside", { class: "tt-preview" });
    const pImg = h("img", { class: "tt-preview-art", src: art ?? "", alt: "" }) as HTMLImageElement;
    pImg.style.viewTransitionName = "tt-art";
    const pTitle = el("h3", "tt-preview-title", title);
    const pText = el("p", "tt-preview-text", "");
    const frame = h("div", { class: "tt-preview-frame" }, pImg);
    preview.append(frame, pTitle, pText);
    const show = (a: Activity | null) => {
      const src = (a?.art && SCENE_THUMBS[a.art]) || art;
      if (src && pImg.getAttribute("src") !== src) pImg.src = src;
      pTitle.textContent = a ? tr(a.title) : title;
      pText.textContent = a ? tr(a.hint) : "";
    };
    const list = h("nav", { class: "tt-acts", "aria-label": title });
    items.forEach((a, i) => {
      const b = h(
        "button",
        {
          class: "m-item tt-act",
          type: "button",
          "data-testid": `title-act-${a.id}`,
          "data-focus-id": a.id,
          ...(i === 0 ? { "data-autofocus": "" } : {}),
        },
        el("span", "", tr(a.title)),
        el("small", "", tr(a.hint)),
      );
      b.addEventListener("click", () => this.choose(a));
      b.addEventListener("focus", () => show(a));
      b.addEventListener("pointerenter", () => show(a));
      list.append(b);
    });
    show(items[0] ?? null);
    page.append(
      this.crumb(title),
      h("div", { class: "tt-list-body" }, h("div", { class: "tt-list-side" }, extra ?? null, list), preview),
      this.foot([["confirm", T.launch]]),
    );
    return page;
  }

  // ------------------------------------------------------------------ on foot (E6)

  private foot0: FootChoice = lastFoot();

  /** On foot: the world (a tab: LB / RB, Q / E), the place on it, the hour of its day, the weather (the Earth's). */
  private footScreen(): MenuScreen {
    return {
      id: "mode:foot",
      build: () => this.buildFoot(),
      action: (a) => {
        if (a !== "tabPrev" && a !== "tabNext") return false;
        const i = WORLDS.findIndex((w) => w.id === this.foot0.world);
        this.foot0.world = WORLDS[(i + (a === "tabNext" ? 1 : WORLDS.length - 1)) % WORLDS.length]!.id;
        keepFoot(this.foot0);
        this.router?.refresh();
        return true;
      },
    };
  }

  private buildFoot(): HTMLElement {
    const c = this.foot0;
    const mode = MODES.find((x) => x.id === "foot")!;
    const page = h("div", { class: "tt-page tt-list tt-plane tt-walk", "data-mode": "foot", "data-world": c.world });
    const tabs = h(
      "div",
      { class: "tt-tabs", role: "tablist", "aria-label": tr(F.world), "data-nav-skip": "" },
      ...WORLDS.map((w) => {
        const b = button({ label: tr(w.name), on: c.world === w.id, testid: `title-world-${w.id}`, title: tr(w.hint) });
        b.classList.add("tt-tab");
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(c.world === w.id));
        b.addEventListener("click", () => {
          c.world = w.id;
          keepFoot(c);
          this.router?.refresh();
        });
        return b;
      }),
    );
    // the preview: the world's planisphere, the place marked on it; its name, why go there, where it is, the line
    const map = h("img", { class: "tt-preview-art tt-map-art", src: WORLD_MAPS[c.world], alt: "" });
    const pin = h("span", { class: "tt-map-pin", "aria-hidden": "true" });
    const frame = h("div", { class: "tt-preview-frame tt-map", "data-testid": "title-foot-map" }, map, pin);
    const pTitle = el("h3", "tt-preview-title", "");
    const pKind = el("p", "tt-preview-kind", "");
    const pText = el("p", "tt-preview-text", "");
    const pMark = el("p", "tt-preview-mark", "");
    const preview = h("aside", { class: "tt-preview" }, frame, pTitle, pKind, pText, pMark);
    const show = () => {
      const p = c.place[c.world];
      const m = mapPoint(p);
      pin.style.left = `${(m.x * 100).toFixed(2)}%`;
      pin.style.top = `${(m.y * 100).toFixed(2)}%`;
      pTitle.textContent = tr(p.name);
      pKind.textContent = [kindName(p), placeCoords(p)].filter(Boolean).join(" · ");
      pText.textContent = p.about ? tr(p.about) : "";
      pMark.textContent = footLine(c);
    };
    const changed = () => {
      keepFoot(c);
      show();
    };
    const pick = <T>(xs: { id: T; label: Text }[], id: T) => tr(xs.find((x) => x.id === id)?.label ?? xs[0]!.label);
    const places = () => placesOf(c.world).map((x) => x.place);
    const side = h("div", { class: "tt-list-side" });
    side.append(
      this.selector(
        tr(F.place),
        "title-foot-place",
        () => tr(c.place[c.world].name),
        (d) => {
          const xs = places();
          c.place[c.world] = cycle(xs, xs.find((x) => x.id === c.place[c.world].id) ?? xs[0]!, d);
        },
        changed,
        () => this.router?.push(this.placePicker()),
      ),
      this.selector(
        tr(F.hour),
        "title-foot-hour",
        () => pick(HOURS, c.hour),
        (d) => (c.hour = cycle(HOURS, HOURS.find((x) => x.id === c.hour)!, d).id),
        changed,
      ),
    );
    if (c.world === "earth")
      side.append(
        this.selector(
          tr(F.weather),
          "title-foot-weather",
          () => pick(WEATHERS, c.weather),
          (d) => (c.weather = cycle(WEATHERS, WEATHERS.find((x) => x.id === c.weather)!, d).id),
          changed,
        ),
      );
    const go = h(
      "button",
      { class: "m-item tt-launch", type: "button", "data-testid": "title-foot-go", "data-focus-id": "go", "data-autofocus": "" },
      el("span", "", tr(F.go)),
      el("small", "", tr(F.goHint)),
    );
    go.addEventListener("click", () => {
      const p = c.place[c.world];
      const s = { world: c.world, lat: p.lat, lon: p.lon, hour: c.hour === "now" ? null : HOUR_OF[c.hour], weather: c.weather };
      this.choose({ id: "foot-walk", title: p.name, hint: F.goHint, run: (g) => g.stroll(s) });
    });
    const atlas = h(
      "button",
      { class: "m-item tt-act", type: "button", "data-testid": "title-foot-atlas", "data-focus-id": "atlas" },
      el("span", "", tr(F.atlas)),
      el("small", "", tr(F.atlasHint)),
    );
    atlas.addEventListener("click", () => this.choose(mode.activities.find((a) => a.id === "foot-atlas")!));
    side.append(go, atlas);
    page.append(
      this.crumb(tr(mode.title)),
      tabs,
      h("div", { class: "tt-list-body" }, side, preview),
      this.foot([
        ["confirm", T.launch],
        ["tabNext", F.world],
      ]),
    );
    show();
    return page;
  }

  /** The places of the world chosen: its destinations by kind, a search (a name, coordinates — and on the Earth an
   *  address, asked of the address service as one types). */
  private placePicker(): MenuScreen {
    const c = this.foot0;
    const world: World = c.world;
    let asked: AbortController | null = null;
    let timer = 0;
    return {
      id: "foot:place",
      build: () => {
        const page = h("div", { class: "tt-page tt-list tt-picker" });
        const ph = tr(world === "earth" ? F.search : F.searchOff);
        const input = h("input", {
          class: "tt-search",
          type: "search",
          placeholder: ph,
          "aria-label": ph,
          "data-testid": "title-place-search",
          "data-autofocus": "",
        }) as HTMLInputElement;
        const list = h("nav", { class: "tt-acts tt-fields", "aria-label": tr(F.placeTitle) });
        const status = el("p", "tt-empty", "");
        const entry = (p: FootPlace, sub: string, testid: string) => {
          const b = h(
            "button",
            { class: "m-item tt-act", type: "button", "data-testid": testid, "data-focus-id": `place-${p.id}` },
            el("span", "", tr(p.name)),
            el("small", "", sub),
          );
          if (p.id === c.place[world].id) b.classList.add("on");
          b.addEventListener("click", () => {
            c.place[world] = p;
            keepFoot(c);
            this.router?.back();
          });
          return b;
        };
        const fill = () => {
          const q = input.value.trim();
          const rows: HTMLElement[] = [];
          const at = parseCoords(q);
          if (at)
            rows.push(
              entry(
                { id: `pt:${at.lat.toFixed(4)},${at.lon.toFixed(4)}`, name: F.point, lat: at.lat, lon: at.lon, kind: "point" },
                placeCoords({ id: "", name: F.point, ...at }),
                "title-place-point",
              ),
            );
          for (const x of placesOf(world, q).slice(0, 80)) {
            if (x.group) rows.push(el("h4", "tt-group", x.group));
            rows.push(entry(x.place, tr(x.place.about ?? { fr: "", en: "" }), `title-place-${x.place.id}`));
          }
          list.replaceChildren(...rows);
          status.textContent = "";
          // (the Earth's addresses: asked once the typing pauses — the newer search supersedes the older)
          asked?.abort();
          clearTimeout(timer);
          if (world !== "earth" || at || q.length < 3) return;
          status.textContent = tr(F.searching);
          timer = window.setTimeout(() => {
            const ctl = new AbortController();
            asked = ctl;
            const near = { lat: c.place[world].lat, lon: c.place[world].lon };
            void geocode(q, { lang, near, signal: ctl.signal })
              .then((found) => {
                if (ctl.signal.aborted || !page.isConnected) return;
                status.textContent = found.length ? "" : tr(F.noAddress);
                if (!found.length) return;
                list.append(
                  el("h4", "tt-group", tr(F.addresses)),
                  ...found.map((g, i) =>
                    entry(
                      {
                        id: `addr:${g.lat.toFixed(4)},${g.lon.toFixed(4)}`,
                        name: { fr: g.name, en: g.name },
                        lat: g.lat,
                        lon: g.lon,
                        kind: "address",
                        about: { fr: g.detail, en: g.detail },
                      },
                      g.detail,
                      `title-place-address-${i}`,
                    ),
                  ),
                );
              })
              .catch(() => {
                if (!ctl.signal.aborted && page.isConnected) status.textContent = tr(F.noAddress);
              });
          }, 450);
        };
        input.addEventListener("input", fill);
        input.addEventListener("keydown", (e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            list.querySelector<HTMLElement>("button")?.focus();
          } else if (e.key === "Enter") {
            e.preventDefault();
            list.querySelector<HTMLElement>("button")?.click();
          }
        });
        fill();
        page.append(
          this.crumb(`${tr(WORLDS.find((w) => w.id === world)!.name)} · ${tr(F.placeTitle)}`),
          h("div", { class: "tt-list-side tt-picker-body" }, input, status, list),
          this.foot([["confirm", T.choose]]),
        );
        return page;
      },
      // (gone: the address asked meanwhile dropped)
      leave: () => {
        clearTimeout(timer);
        asked?.abort();
      },
    };
  }

  // ------------------------------------------------------------------ the free camera (E6)

  private freeTab: FreeTab = "gargantua";

  /** The free camera: the gallery full screen — a tab per kind (LB / RB, Q / E), the scenes as pictures, the one
   *  focused large behind them. */
  private freeScreen(): MenuScreen {
    return {
      id: "mode:free",
      build: () => this.buildFree(),
      action: (a) => {
        if (a !== "tabPrev" && a !== "tabNext") return false;
        const i = FREE_TABS.findIndex((x) => x.id === this.freeTab);
        this.freeTab = FREE_TABS[(i + (a === "tabNext" ? 1 : FREE_TABS.length - 1)) % FREE_TABS.length]!.id;
        this.router?.refresh();
        return true;
      },
    };
  }

  private buildFree(): HTMLElement {
    const mode = MODES.find((x) => x.id === "free")!;
    const page = h("div", { class: "tt-page tt-free", "data-mode": "free", "data-tab": this.freeTab });
    const bg = h("img", { class: "tt-free-bg", src: MODE_ART.free.wide, alt: "" }) as HTMLImageElement;
    bg.style.viewTransitionName = "tt-art";
    const tabs = h(
      "div",
      { class: "tt-tabs", role: "tablist", "data-nav-skip": "" },
      ...FREE_TABS.map((x) => {
        const b = button({ label: tr(x.label), on: this.freeTab === x.id, testid: `title-free-tab-${x.id}`, title: tr(x.hint) });
        b.classList.add("tt-tab");
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(this.freeTab === x.id));
        b.addEventListener("click", () => {
          this.freeTab = x.id;
          this.router?.refresh();
        });
        return b;
      }),
    );
    const cTitle = el("h3", "tt-preview-title", "");
    const cText = el("p", "tt-preview-text", "");
    const caption = h("div", { class: "tt-free-caption", "aria-live": "polite" }, cTitle, cText);
    const grid = h("nav", { class: "tt-free-grid", "aria-label": tr(FREE_TABS.find((x) => x.id === this.freeTab)!.label) });
    const scenes = freeScenes(this.freeTab);
    const show = (x: (typeof scenes)[number]) => {
      if (x.art && bg.getAttribute("src") !== x.art) bg.src = x.art;
      cTitle.textContent = x.title;
      cText.textContent = x.text;
    };
    scenes.forEach((x, i) => {
      const b = h(
        "button",
        {
          class: "m-item tt-scene",
          type: "button",
          "data-testid": `title-free-${sceneSlug(x.name)}`,
          "data-focus-id": x.name,
          ...(i === 0 ? { "data-autofocus": "" } : {}),
        },
        x.art ? h("img", { src: x.art, alt: "", loading: "lazy" }) : h("span", { class: "tt-scene-none" }),
        el("span", "tt-scene-title", x.title),
      );
      b.addEventListener("focus", () => show(x));
      b.addEventListener("pointerenter", () => show(x));
      b.addEventListener("click", () =>
        this.choose({
          id: `free:${x.name}`,
          title: { fr: x.title, en: x.title },
          hint: { fr: x.text, en: x.text },
          art: x.name,
          run: (g) => g.freeScene(x.name),
        }),
      );
      grid.append(b);
    });
    if (scenes[0]) show(scenes[0]);
    page.append(
      bg,
      h("div", { class: "tt-free-veil" }),
      this.crumb(tr(mode.title)),
      tabs,
      caption,
      grid,
      this.foot([
        ["confirm", F.view],
        ["tabNext", F.tab],
      ]),
    );
    return page;
  }

  // ------------------------------------------------------------------ by ship (E5)

  /** By ship: the hangar — a tab per craft (LB / RB, Q / E), its sheet, its turntable —, the destinations it can
   *  reach (a ground closed to one that never lands: shown, with why), its missions and scenes, the rest. */
  private shipScreen(): MenuScreen {
    return {
      id: "mode:ship",
      build: () => this.buildShip(),
      action: (a) => {
        if (a !== "tabPrev" && a !== "tabNext") return false;
        const i = CRAFT.findIndex((c) => c.id === this.vessel);
        this.vessel = CRAFT[(i + (a === "tabNext" ? 1 : CRAFT.length - 1)) % CRAFT.length]!.id;
        this.router?.refresh();
        return true;
      },
    };
  }

  private buildShip(): HTMLElement {
    const mode = MODES.find((x) => x.id === "ship")!;
    const craft = CRAFT.find((c) => c.id === this.vessel)!;
    const page = h("div", { class: "tt-page tt-list tt-plane tt-ship", "data-mode": "ship", "data-vessel": craft.id });
    const tabs = h(
      "div",
      { class: "tt-tabs", role: "tablist", "aria-label": tr(S.craft), "data-nav-skip": "" },
      ...CRAFT.map((c) => {
        const b = button({ label: c.name, on: this.vessel === c.id, testid: `title-vessel-${c.id}` });
        b.classList.add("tt-tab");
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(this.vessel === c.id));
        b.addEventListener("click", () => {
          this.vessel = c.id;
          this.router?.refresh();
        });
        return b;
      }),
    );
    // the craft's sheet: what it is for, its figures
    const sheet = h(
      "section",
      { class: "tt-sheet", "data-testid": "title-ship-sheet", "aria-label": craft.name },
      el("p", "tt-sheet-role", tr(craft.role)),
      h(
        "dl",
        { class: "tt-sheet-figs" },
        ...sheetLines(craft).map(([k, v]) => h("div", { class: "tt-sheet-fig" }, el("dt", "", k), el("dd", "", v))),
      ),
    );
    // the preview: the turntable (a destination: flown in this craft) or the scene's picture (a mission)
    const wide = MODE_ART.ship.wide;
    const pImg = h("img", { class: "tt-preview-art", src: wide, alt: "" }) as HTMLImageElement;
    pImg.style.viewTransitionName = "tt-art";
    this.turn = turntable(TURNTABLES[this.vessel]);
    const frame = h("div", { class: "tt-preview-frame" }, pImg, this.turn, el("span", "tt-craft-name", craft.name));
    const pTitle = el("h3", "tt-preview-title", "");
    const pText = el("p", "tt-preview-text", "");
    const pMark = el("p", "tt-preview-mark", "");
    const preview = h("aside", { class: "tt-preview" }, frame, pTitle, pText, pMark);
    const show = (title: string, text: string, o: { art?: string; turning: boolean; mark?: string; locked?: boolean }) => {
      const src = (o.art && SCENE_THUMBS[o.art]) || wide;
      if (pImg.getAttribute("src") !== src) pImg.src = src;
      frame.classList.toggle("turning", o.turning);
      pTitle.textContent = title;
      pText.textContent = text;
      pMark.textContent = o.mark ?? "";
      pMark.classList.toggle("locked", !!o.locked);
    };
    const list = h("nav", { class: "tt-acts", "aria-label": tr(mode.title) });
    const entry = (
      testid: string,
      focusId: string,
      title: string,
      text: string,
      mark: string | null,
      focus: () => void,
      go: () => void,
      first = false,
    ) => {
      const b = h(
        "button",
        {
          class: "m-item tt-act",
          type: "button",
          "data-testid": testid,
          "data-focus-id": focusId,
          ...(first ? { "data-autofocus": "" } : {}),
        },
        h("span", { class: "tt-act-row" }, el("span", "", title), mark ? el("em", "tt-act-mark", mark) : null),
        el("small", "", text),
      );
      b.addEventListener("focus", focus);
      b.addEventListener("pointerenter", focus);
      b.addEventListener("click", go);
      list.append(b);
      return b;
    };
    const slug = (id: string) =>
      id
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-$/, "");
    const item = (x: ShipItem, first: boolean) => {
      const focus = () =>
        show(tr(x.title), tr(x.brief ?? x.text), {
          art: x.art,
          turning: !!x.go,
          mark: x.locked ? tr(x.locked) : x.mark ? tr(x.mark) : "",
          locked: !!x.locked,
        });
      const b = entry(
        `title-ship-${slug(x.id)}`,
        x.id,
        tr(x.title),
        tr(x.text),
        x.locked ? "✕" : x.mark ? tr(x.mark) : null,
        focus,
        () => {
          if (x.locked) return focus();
          this.choose({ id: x.id, title: x.title, hint: x.text, art: x.art, craft: !!x.go, run: (g, o) => launchShip(g, x, o.vessel) });
        },
        first,
      );
      if (x.locked) {
        b.classList.add("locked");
        b.setAttribute("aria-disabled", "true");
      }
    };
    const { destinations, missions } = shipItems(this.vessel);
    list.append(el("h4", "tt-group", tr(S.where)));
    destinations.forEach((x, i) => item(x, i === 0));
    list.append(el("h4", "tt-group", tr(this.vessel === "ranger" ? S.missions : S.scenes)));
    for (const x of missions) item(x, false);
    // (the rest: the craft placed anywhere; every mission's briefing)
    list.append(el("h4", "tt-group", tr(S.more)));
    for (const a of mode.activities.filter((x) => x.opens)) {
      const focus = () => show(tr(a.title), tr(a.hint), { turning: !!a.craft });
      entry(`title-act-${a.id}`, a.id, tr(a.title), tr(a.hint), null, focus, () => this.choose(a));
    }
    const side = h("div", { class: "tt-list-side" }, sheet, list);
    page.append(
      this.crumb(tr(mode.title)),
      tabs,
      h("div", { class: "tt-list-body" }, side, preview),
      this.foot([
        ["confirm", T.launch],
        ["tabNext", S.craft],
      ]),
    );
    const d0 = destinations[0]!;
    show(tr(d0.title), tr(d0.text), { art: d0.art, turning: true });
    return page;
  }

  // ------------------------------------------------------------------ by plane (E4)

  private planeTab: PlaneTab = "free";
  private flightChoice: FlightChoice = lastFlight();
  private lessonHow: LessonHow = "guided";
  private figureHow: FigureHow = "fly";

  /** By plane: four tabs (LB / RB, Q / E) — a free flight set up, the combat, the school, the challenges. */
  private planeScreen(): MenuScreen {
    return {
      id: "mode:plane",
      build: () => this.buildPlane(),
      action: (a) => {
        if (a !== "tabPrev" && a !== "tabNext") return false;
        const i = PLANE_TABS.findIndex((x) => x.id === this.planeTab);
        this.planeTab = PLANE_TABS[(i + (a === "tabNext" ? 1 : PLANE_TABS.length - 1)) % PLANE_TABS.length]!.id;
        this.router?.refresh();
        return true;
      },
    };
  }

  private buildPlane(): HTMLElement {
    const page = h("div", { class: "tt-page tt-list tt-plane", "data-mode": "plane", "data-tab": this.planeTab });
    const tabs = h(
      "div",
      { class: "tt-tabs", role: "tablist", "data-nav-skip": "" },
      ...PLANE_TABS.map((x) => {
        const b = button({ label: tr(x.label), on: this.planeTab === x.id, testid: `title-tab-${x.id}` });
        b.classList.add("tt-tab");
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(this.planeTab === x.id));
        b.addEventListener("click", () => {
          this.planeTab = x.id;
          this.router?.refresh();
        });
        return b;
      }),
    );
    // the preview: the picture, the title, the text, a mark
    const pImg = h("img", { class: "tt-preview-art", src: MODE_ART.plane.wide, alt: "" }) as HTMLImageElement;
    pImg.style.viewTransitionName = "tt-art";
    const pTitle = el("h3", "tt-preview-title", "");
    const pText = el("p", "tt-preview-text", "");
    const pMark = el("p", "tt-preview-mark", "");
    const preview = h("aside", { class: "tt-preview" }, h("div", { class: "tt-preview-frame" }, pImg), pTitle, pText, pMark);
    const show = (title: string, text: string, mark = "") => {
      pTitle.textContent = title;
      pText.textContent = text;
      pMark.textContent = mark;
    };
    const side = h("div", { class: "tt-list-side" });
    if (this.planeTab === "free") this.planeFree(side, show);
    else this.planeList(side, show);
    page.append(
      this.crumb(tr(MODES.find((x) => x.id === "plane")!.title)),
      tabs,
      h("div", { class: "tt-list-body" }, side, preview),
      this.foot([
        ["confirm", { fr: "Lancer", en: "Launch" }],
        ["tabNext", P.tab],
      ]),
    );
    return page;
  }

  /** A setting's row: its name, its value between ◂ ▸ — ← → (the D-pad) change it, a click the next, Enter its own
   *  (the airfield: its list). */
  private selector(label: string, testid: string, value: () => string, step: (d: number) => void, changed: () => void, enter?: () => void) {
    const val = el("b", "", "");
    const b = h(
      "button",
      { class: "m-item tt-sel", type: "button", role: "slider", "aria-label": label, "data-testid": testid, "data-focus-id": testid },
      el("span", "tt-sel-label", label),
      h("span", { class: "tt-sel-val" }, el("i", "", "◂"), val, el("i", "", "▸")),
    );
    const render = () => {
      val.textContent = value();
      b.setAttribute("aria-valuetext", value());
    };
    const go = (d: number) => {
      step(d);
      render();
      changed();
    };
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      go(e.key === "ArrowRight" ? 1 : -1);
    });
    b.addEventListener("click", (e) => {
      if (enter) return enter();
      // (a click on the value's left part: back)
      const r = b.getBoundingClientRect();
      go(e.clientX > 0 && e.clientX < r.left + r.width * 0.55 ? -1 : 1);
    });
    render();
    return b;
  }

  private planeFree(side: HTMLElement, show: (title: string, text: string, mark?: string) => void) {
    const c = this.flightChoice;
    const pick = <T>(xs: { id: T; label: Text }[], id: T) => tr(xs.find((x) => x.id === id)?.label ?? xs[0]!.label);
    const changed = () => {
      keepFlight(c);
      show(tr(PLANE_TABS[0]!.label), tr(P.freeText), flightLine(c));
    };
    const field = () => FIELDS.find((f) => f.id === c.field);
    side.append(
      this.selector(
        tr(P.field),
        "title-flight-field",
        () => (field() ? `${field()!.icao ? `${field()!.icao} · ` : ""}${field()!.name}` : c.field),
        (d) => (c.field = cycle(FIELDS, field() ?? FIELDS[0]!, d).id),
        changed,
        () => this.router?.push(this.fieldPicker()),
      ),
      this.selector(
        tr(P.start),
        "title-flight-start",
        () => pick(STARTS, c.start),
        (d) => (c.start = cycle(STARTS, STARTS.find((x) => x.id === c.start)!, d).id),
        changed,
      ),
      this.selector(
        tr(P.hour),
        "title-flight-hour",
        () => pick(HOURS, c.hour),
        (d) => (c.hour = cycle(HOURS, HOURS.find((x) => x.id === c.hour)!, d).id),
        changed,
      ),
      this.selector(
        tr(P.weather),
        "title-flight-weather",
        () => pick(WEATHERS, c.weather),
        (d) => (c.weather = cycle(WEATHERS, WEATHERS.find((x) => x.id === c.weather)!, d).id),
        changed,
      ),
      this.selector(
        tr(P.fuel),
        "title-flight-fuel",
        () => `${Math.round(c.fuel * 100)} %`,
        (d) => (c.fuel = cycle(FUELS, c.fuel, d)),
        changed,
      ),
    );
    const fly = h(
      "button",
      { class: "m-item tt-launch", type: "button", "data-testid": "title-flight-fly", "data-focus-id": "fly", "data-autofocus": "" },
      el("span", "", tr(P.fly)),
      el("small", "", tr(P.flyHint)),
    );
    fly.addEventListener("click", () => this.choose({ id: "plane-flight", title: P.fly, hint: P.flyHint, run: (g) => g.flight({ ...c }) }));
    side.append(fly);
    changed();
  }

  /** Combat, the school, the challenges: a list (in groups), each entry launched as it says. */
  private planeList(side: HTMLElement, show: (title: string, text: string, mark?: string) => void) {
    const tab = this.planeTab;
    const items: PlaneItem[] = tab === "combat" ? combatItems() : tab === "school" ? lessonItems() : challengeItems();
    if (tab === "school")
      side.append(
        this.selector(
          tr(P.how),
          "title-lesson-how",
          () => tr(LESSON_HOWS.find((x) => x.id === this.lessonHow)!.label),
          (d) => (this.lessonHow = cycle(LESSON_HOWS, LESSON_HOWS.find((x) => x.id === this.lessonHow)!, d).id),
          () => {},
        ),
      );
    if (tab === "challenges")
      side.append(
        this.selector(
          tr(P.how),
          "title-figure-how",
          () => tr(FIGURE_HOWS.find((x) => x.id === this.figureHow)!.label),
          (d) => (this.figureHow = cycle(FIGURE_HOWS, FIGURE_HOWS.find((x) => x.id === this.figureHow)!, d).id),
          () => {},
        ),
      );
    const list = h("nav", { class: "tt-acts", "aria-label": tr(PLANE_TABS.find((x) => x.id === tab)!.label) });
    items.forEach((it, i) => {
      if (it.group) list.append(el("h4", "tt-group", it.group));
      const b = h(
        "button",
        {
          class: "m-item tt-act",
          type: "button",
          "data-testid": `title-plane-${it.id.replace(":", "-")}`,
          "data-focus-id": it.id,
          ...(i === 0 ? { "data-autofocus": "" } : {}),
        },
        h("span", { class: "tt-act-row" }, el("span", "", it.title), it.mark ? el("em", "tt-act-mark", it.mark) : null),
        el("small", "", it.text),
      );
      const focus = () => show(it.title, it.text, it.mark ?? "");
      b.addEventListener("focus", focus);
      b.addEventListener("pointerenter", focus);
      b.addEventListener("click", () => {
        const [kind, id] = it.id.split(":") as [string, string];
        const title = { fr: it.title, en: it.title };
        this.choose({
          id: it.id,
          title,
          hint: { fr: it.text, en: it.text },
          opens: kind === "mission",
          run: (g) =>
            kind === "mission"
              ? g.mission(id)
              : kind === "fight"
                ? g.fight(id)
                : kind === "lesson"
                  ? g.lesson(id, this.lessonHow)
                  : kind === "challenge"
                    ? g.challenge(id)
                    : g.figure(id, this.figureHow),
        });
      });
      list.append(b);
    });
    side.append(list);
    if (items[0]) show(items[0].title, items[0].text, items[0].mark ?? "");
  }

  /** The airfields, found by a few letters (ICAO or name), chosen by Enter or a click. */
  private fieldPicker(): MenuScreen {
    return {
      id: "plane:field",
      build: () => {
        const page = h("div", { class: "tt-page tt-list tt-picker" });
        const input = h("input", {
          class: "tt-search",
          type: "search",
          placeholder: tr(P.search),
          "aria-label": tr(P.search),
          "data-testid": "title-field-search",
          "data-autofocus": "",
        }) as HTMLInputElement;
        const list = h("nav", { class: "tt-acts tt-fields", "aria-label": tr(P.fieldTitle) });
        const fill = () => {
          const q = input.value.trim().toLowerCase();
          list.replaceChildren(
            ...FIELDS.filter((f) => !q || f.name.toLowerCase().includes(q) || (f.icao ?? "").toLowerCase().startsWith(q))
              .slice(0, 60)
              .map((f) => {
                const b = h(
                  "button",
                  { class: "m-item tt-act", type: "button", "data-testid": `title-field-${f.id}`, "data-focus-id": `field-${f.id}` },
                  el("span", "", f.name),
                  el("small", "", f.icao ?? ""),
                );
                if (f.id === this.flightChoice.field) b.classList.add("on");
                b.addEventListener("click", () => {
                  this.flightChoice.field = f.id;
                  keepFlight(this.flightChoice);
                  this.router?.back();
                });
                return b;
              }),
          );
        };
        input.addEventListener("input", fill);
        // (↓ from the search: into the list; Enter: the first found)
        input.addEventListener("keydown", (e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            list.querySelector<HTMLElement>("button")?.focus();
          } else if (e.key === "Enter") {
            e.preventDefault();
            list.querySelector<HTMLElement>("button")?.click();
          }
        });
        fill();
        page.append(
          this.crumb(tr(P.fieldTitle)),
          h("div", { class: "tt-list-side tt-picker-body" }, input, list),
          this.foot([["confirm", { fr: "Choisir", en: "Choose" }]]),
        );
        return page;
      },
    };
  }

  /** More…: the rest of the game, in groups — play (every scene, load a game), create (photos, missions), together,
   *  learn (how to play, discover, the controls), measure (the Kerr Bench, confirmed: the page reloads), the game
   *  (the credits, the language). */
  private moreScreen(): MenuScreen {
    return { id: "more", build: () => this.buildMore() };
  }

  private buildMore(): HTMLElement {
    const page = h("div", { class: "tt-page tt-list tt-plane tt-more", "data-mode": "more" });
    const a = (id: string) => MORE.find((x) => x.id === id)!;
    const docs = (file: string) => () => window.open(new URL(`docs/${file}`, location.href).href, "_blank", "noopener");
    type Row = { id: string; title: Text; hint: Text; art: string; go: () => void };
    const run =
      (x: Activity): (() => void) =>
      () =>
        this.choose(x);
    const thumb = (scene: string) => SCENE_THUMBS[scene] ?? MODE_ART.free.wide;
    const groups: [Text, Row[]][] = [
      [
        M.play,
        [
          { ...a("more-scenes"), art: thumb("Interstellar: along the disk (the film's close pass)"), go: run(a("more-scenes")) },
          {
            id: "more-load",
            title: T.load,
            hint: T.loadHint,
            art: thumb("Gargantua under the distant galaxy"),
            go: () => this.router?.push(this.loadScreen()),
          },
        ],
      ],
      [
        M.make,
        [
          { ...a("more-photo"), art: thumb("Earth: Mont Blanc from the Lac Blanc"), go: run(a("more-photo")) },
          { ...a("more-editor"), art: MODE_ART.plane.wide, go: run(a("more-editor")) },
        ],
      ],
      [
        M.together,
        !this.game || this.game.networkShown() ? [{ ...a("more-network"), art: MODE_ART.ship.wide, go: run(a("more-network")) }] : [],
      ],
      [
        M.learn,
        [
          { id: "more-howto", title: M.howTo, hint: M.howToHint, art: MODE_ART.foot.wide, go: docs("comment-jouer.html") },
          {
            id: "more-discover",
            title: M.discover,
            hint: M.discoverHint,
            art: thumb("Kerr a=0.94, near edge-on"),
            go: docs("decouvrir.html"),
          },
          { ...a("more-controls"), art: MODE_ART.plane.wide, go: run(a("more-controls")) },
        ],
      ],
      [M.measure, [{ ...a("more-bench"), art: MODE_ART.free.wide, go: () => this.router?.push(this.benchScreen()) }]],
      [
        M.game,
        [{ id: "more-credits", title: M.credits, hint: M.creditsHint, art: markUrl, go: () => this.router?.push(this.creditsScreen()) }],
      ],
    ];
    const pImg = h("img", { class: "tt-preview-art", src: MODE_ART.free.wide, alt: "" }) as HTMLImageElement;
    pImg.style.viewTransitionName = "tt-art";
    const pTitle = el("h3", "tt-preview-title", "");
    const pText = el("p", "tt-preview-text", "");
    const frame = h("div", { class: "tt-preview-frame" }, pImg);
    const preview = h("aside", { class: "tt-preview" }, frame, pTitle, pText);
    const show = (r: Pick<Row, "title" | "hint" | "art">) => {
      if (pImg.getAttribute("src") !== r.art) pImg.src = r.art;
      frame.classList.toggle("tt-mark-frame", r.art === markUrl);
      pTitle.textContent = tr(r.title);
      pText.textContent = tr(r.hint);
    };
    const list = h("nav", { class: "tt-acts", "aria-label": tr(T.more) });
    let first = true;
    for (const [g, rows] of groups) {
      if (!rows.length) continue;
      list.append(el("h4", "tt-group", tr(g)));
      for (const r of rows) {
        const b = h(
          "button",
          {
            class: "m-item tt-act",
            type: "button",
            "data-testid": `title-act-${r.id}`,
            "data-focus-id": r.id,
            ...(first ? { "data-autofocus": "" } : {}),
          },
          el("span", "", tr(r.title)),
          el("small", "", tr(r.hint)),
        );
        first = false;
        b.addEventListener("focus", () => show(r));
        b.addEventListener("pointerenter", () => show(r));
        b.addEventListener("click", r.go);
        list.append(b);
      }
    }
    // (the language: a row of its own — the page reloads in the other one)
    const langs = [
      { id: "fr" as const, label: { fr: "Français", en: "Français" } },
      { id: "en" as const, label: { fr: "English", en: "English" } },
    ];
    const langRow = this.selector(
      tr(M.language),
      "title-more-language",
      () => tr(langs.find((x) => x.id === lang)!.label),
      () => {
        setLang(lang === "fr" ? "en" : "fr");
        location.reload();
      },
      () => {},
    );
    const showLang = () => show({ title: M.language, hint: M.languageHint, art: markUrl });
    langRow.addEventListener("focus", showLang);
    langRow.addEventListener("pointerenter", showLang);
    list.append(langRow);
    show(groups[0]![1][0]!);
    page.append(
      this.crumb(tr(T.more)),
      h("div", { class: "tt-list-body" }, h("div", { class: "tt-list-side" }, list), preview),
      this.foot([["confirm", T.choose]]),
    );
    return page;
  }

  /** The Kerr Bench confirmed: the page reloads for it. */
  private benchScreen(): MenuScreen {
    return {
      id: "more:bench",
      build: () => {
        const go = button({ label: tr(M.benchGo), kind: "primary", testid: "title-bench-go" });
        go.classList.add("m-item", "tt-launch");
        go.dataset.autofocus = "";
        go.addEventListener("click", () => this.choose(MORE.find((x) => x.id === "more-bench")!));
        const no = button({ label: tr(M.cancel), testid: "title-bench-cancel", onClick: () => this.router?.back() });
        no.classList.add("m-item", "tt-act");
        return h(
          "div",
          { class: "tt-page tt-list tt-confirm", "data-mode": "bench" },
          this.crumb(tr(M.benchTitle)),
          h(
            "div",
            { class: "tt-confirm-body" },
            el("p", "tt-preview-text", tr(M.benchText)),
            h("div", { class: "tt-confirm-acts" }, go, no),
          ),
          this.foot([["confirm", T.choose]]),
        );
      },
    };
  }

  /** The credits: a slow roll — the emblem, who made the game, then every work it is built on, by kind; ↑ ↓, the
   *  wheel or a drag take it over (it goes on by itself after a few seconds), Escape / B leave. */
  private creditsScreen(): MenuScreen {
    return {
      id: "credits",
      build: () => {
        const roll = h("div", {
          class: "tt-roll",
          tabindex: "0",
          "data-testid": "title-credits",
          "data-autofocus": "",
          "aria-label": tr(M.credits),
        });
        const inner = h("div", { class: "tt-roll-inner" });
        inner.append(
          h("img", { class: "tt-roll-mark", src: markUrl, alt: "" }),
          el("p", "tt-roll-name", "KERR"),
          el("p", "tt-roll-tag", tr(T.tagline)),
        );
        for (const sec of CREDITS) {
          const s = h(
            "section",
            { class: `tt-roll-sec tt-roll-${sec.id}`, "data-section": sec.id },
            el("h4", "tt-roll-title", tr(sec.title)),
          );
          for (const c of sec.items)
            s.append(
              h(
                "div",
                { class: "tt-roll-item" },
                el("p", "tt-roll-what", tr(c.what)),
                el("p", "tt-roll-who", whoOf(c)),
                c.licence ? el("p", "tt-roll-lic", c.licence) : null,
              ),
            );
          inner.append(s);
        }
        inner.append(h("img", { class: "tt-roll-mark tt-roll-end", src: markUrl, alt: "" }), el("p", "tt-roll-thanks", tr(M.thanks)));
        roll.append(inner);
        // (by itself: ~38 px a second; a hand on it holds it 3 s; the reduced motion: still)
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
        let heldUntil = 0;
        let pos = 0;
        let last = performance.now();
        const hold = () => {
          heldUntil = performance.now() + 3000;
        };
        roll.addEventListener("wheel", hold, { passive: true });
        roll.addEventListener("pointerdown", hold);
        roll.addEventListener("keydown", (e) => {
          const d =
            e.key === "ArrowDown"
              ? 60
              : e.key === "ArrowUp"
                ? -60
                : e.key === "PageDown" || e.key === " "
                  ? roll.clientHeight * 0.8
                  : e.key === "PageUp"
                    ? -roll.clientHeight * 0.8
                    : 0;
          if (!d) return;
          e.preventDefault();
          e.stopPropagation();
          hold();
          roll.scrollBy({ top: d, behavior: "smooth" });
        });
        const step = (now: number) => {
          if (!roll.isConnected) return;
          const dt = Math.min(now - last, 100) / 1000;
          last = now;
          if (now < heldUntil || still) pos = roll.scrollTop;
          else {
            pos += 38 * dt;
            roll.scrollTop = pos;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        return h("div", { class: "tt-page tt-credits", "data-mode": "credits" }, roll, this.foot([], true));
      },
    };
  }

  private loadScreen(): MenuScreen {
    return {
      id: "load",
      build: () => {
        const saves: { name: string; label: string; save: GameSave }[] = [];
        const auto = autosave.get();
        if (auto) saves.push({ name: "autosave", label: tr(T.auto), save: auto });
        for (const s of slots.list()) saves.push({ name: s.name, label: s.name, save: s });
        const items: Activity[] = saves.map((s) => ({
          id: `load-${s.name}`,
          title: { fr: s.label, en: s.label },
          hint: {
            fr: `${s.save.summary} · ${agoText(Date.now() - s.save.savedAt, "fr")}`,
            en: `${s.save.summary} · ${agoText(Date.now() - s.save.savedAt, "en")}`,
          },
          art: s.save.scene ?? undefined,
          run: (g) => g.toast(g.load(s.name)),
        }));
        const page = this.listPage("load", tr(T.load), SCENE_THUMBS["Gargantua under the distant galaxy"], items);
        if (!items.length) page.querySelector(".tt-acts")?.append(el("p", "tt-empty", tr(T.none)));
        return page;
      },
    };
  }
}

/** a saved game's picture when its scene has none */
const FALLBACK_ART = "Gargantua under the distant galaxy";

/** Continue: the game behind the screen. */
const CONTINUE: Activity = {
  id: "continue",
  title: { fr: "Continuer", en: "Continue" },
  hint: { fr: "", en: "" },
  run: (g) => g.resume(),
};
