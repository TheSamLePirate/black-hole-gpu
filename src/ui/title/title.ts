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
    this.unInput = onInputChange(() => this.router?.refresh());
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
        const art = SCENE_THUMBS[m.art];
        const img = h("img", { class: "tt-card-art", src: art ?? "", alt: "", loading: "eager" }) as HTMLImageElement;
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
          this.router?.push(this.modeScreen(m));
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
    const ps = h("div", { class: "m-prompts" });
    for (const [a, label] of [...prompts, ...(back ? ([["back", T.back]] as [MenuAction, Text][]) : [])]) {
      const g = glyph(a);
      if (g) ps.append(h("span", { class: "m-prompt" }, el("span", "m-glyph", g), tr(label)));
    }
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

  /** A list of entries and, beside it, the one focused shown large. */
  private listPage(id: string, title: string, art: string | undefined, items: Activity[], extra?: HTMLElement): HTMLElement {
    const page = h("div", { class: "tt-page tt-list", "data-mode": id });
    const preview = h("aside", { class: "tt-preview" });
    const pImg = h("img", { class: "tt-preview-art", src: art ?? "", alt: "" }) as HTMLImageElement;
    pImg.style.viewTransitionName = "tt-art";
    const pTitle = el("h3", "tt-preview-title", title);
    const pText = el("p", "tt-preview-text", "");
    preview.append(h("div", { class: "tt-preview-frame" }, pImg), pTitle, pText);
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
            });
            chips.append(b);
          }
        }
        return this.listPage(m.id, tr(m.title), SCENE_THUMBS[m.art], m.activities, chips);
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

  private moreScreen(): MenuScreen {
    return {
      id: "more",
      build: () => {
        const items: Activity[] = [
          { id: "more-load", title: T.load, hint: T.loadHint, opens: true, run: () => {} },
          ...MORE.filter((a) => a.id !== "more-network" || !this.game || this.game.networkShown()),
        ];
        const page = this.listPage("more", tr(T.more), SCENE_THUMBS["Gargantua under the distant galaxy"], items);
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
