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
import { type Activity, MODES, MORE, type Mode, type TitleGame, VESSELS, type VesselChoice } from "./activities";
import { MODE_ART, TURNTABLES, turntable } from "./art";
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
    this.router = new MenuRouter(this.root);
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
          this.router?.push(m.id === "plane" ? this.planeScreen() : m.id === "ship" ? this.shipScreen() : this.modeScreen(m));
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

  /** A list of entries and, beside it, the one focused shown large (a craft's: its turntable). */
  private listPage(id: string, title: string, art: string | undefined, items: Activity[], extra?: HTMLElement): HTMLElement {
    const page = h("div", { class: "tt-page tt-list", "data-mode": id });
    const preview = h("aside", { class: "tt-preview" });
    const pImg = h("img", { class: "tt-preview-art", src: art ?? "", alt: "" }) as HTMLImageElement;
    pImg.style.viewTransitionName = "tt-art";
    const pTitle = el("h3", "tt-preview-title", title);
    const pText = el("p", "tt-preview-text", "");
    const frame = h("div", { class: "tt-preview-frame" }, pImg);
    const crafts = items.some((a) => a.craft);
    this.turn = crafts ? turntable(TURNTABLES[this.vessel]) : null;
    if (this.turn) frame.append(this.turn);
    preview.append(frame, pTitle, pText);
    const show = (a: Activity | null, craft = !!a?.craft) => {
      const src = (a?.art && SCENE_THUMBS[a.art]) || art;
      if (src && pImg.getAttribute("src") !== src) pImg.src = src;
      frame.classList.toggle("turning", craft && !!this.turn);
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

  private modeScreen(m: Mode): MenuScreen {
    return {
      id: `mode:${m.id}`,
      build: () => {
        let chips: HTMLElement | undefined;
        if (m.vessels) {
          chips = h("div", { class: "tt-vessels", role: "group", "aria-label": tr(T.vessel) });
          for (const v of VESSELS) {
            const b = button({ label: v.title, on: this.vessel === v.id, testid: `title-vessel-${v.id}`, title: tr(v.hint) });
            b.classList.add("tt-vessel");
            b.dataset.focusId = `vessel-${v.id}`;
            b.addEventListener("click", () => {
              this.vessel = v.id;
              for (const c of chips!.querySelectorAll<HTMLElement>(".tt-vessel")) c.classList.toggle("on", c === b);
              this.turn?.set(TURNTABLES[v.id]);
            });
            chips.append(b);
          }
        }
        const page = this.listPage(m.id, tr(m.title), MODE_ART[m.id].wide, m.activities, chips);
        // (a craft's chip focused: its turntable, its name and what it is)
        for (const v of VESSELS) {
          const b = page.querySelector<HTMLElement>(`[data-testid=title-vessel-${v.id}]`);
          const showV = () => {
            page.querySelector(".tt-preview-frame")?.classList.add("turning");
            page.querySelector(".tt-preview-title")!.textContent = v.title;
            page.querySelector(".tt-preview-text")!.textContent = tr(v.hint);
          };
          b?.addEventListener("focus", showV);
          b?.addEventListener("pointerenter", showV);
        }
        return page;
      },
      // (the shoulder buttons: the craft before, after)
      action: (a) => {
        if (!m.vessels || (a !== "tabPrev" && a !== "tabNext")) return false;
        const i = VESSELS.findIndex((v) => v.id === this.vessel);
        this.vessel = VESSELS[(i + (a === "tabNext" ? 1 : VESSELS.length - 1)) % VESSELS.length]!.id;
        this.router?.refresh();
        return true;
      },
    };
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

  private moreScreen(): MenuScreen {
    return {
      id: "more",
      build: () => {
        const items: Activity[] = [
          { id: "more-load", title: T.load, hint: T.loadHint, opens: true, run: () => {} },
          ...MORE.filter((a) => a.id !== "more-network" || !this.game || this.game.networkShown()),
        ];
        const page = this.listPage("more", tr(T.more), MODE_ART.free.wide, items);
        // (Load: a screen of its own, not a launch)
        page.querySelector<HTMLElement>("[data-testid=title-act-more-load]")?.addEventListener(
          "click",
          (e) => {
            e.stopImmediatePropagation();
            this.router?.push(this.loadScreen());
          },
          true,
        );
        return page;
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
