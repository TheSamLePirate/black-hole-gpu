// The pause menu (PLAN-TITRE-AAA E8): Escape when nothing is open. A full-height column on the left over the scene
// held still — not a box in the middle —, its first level short (resume, save, load, release the controls when
// something is engaged, capture ›, world ›, sky ›, play together, change mode ›, settings ›, the title), the
// rest in drawers: a second column beside, opened by Enter, → or a click, closed by ←, Escape or B. On the right,
// the context: where one is, the mission and its objectives (or the flight's figures), the time played, the last
// save, a tip of the mode. In a network room the common clock does not stop: the game goes on behind the menu,
// and it says so. Going back to the title asks first when more than five minutes went unsaved. Screens by
// ui/menu/router.ts (the focus in two dimensions, the controller's every button), as the title's.

import { downloadGpuDiagnostic } from "../gpu-diagnostics";
import { autosave, slots } from "../game/save";
import type { GameTools } from "../game/tools";
import { tr, type Text } from "../i18n";
import { button, el, h } from "./kit";
import type { MenuAction } from "./menu/actions";
import { glyph, onInputChange, watchInput } from "./menu/glyphs";
import { type MenuScreen, MenuRouter } from "./menu/router";
import { agoWords, DRAWERS, type DrawerId, OBJ_MARK, type PauseContext, playedText, tipOf, titleNeedsConfirm } from "./pausemenu";
import type { ModeId } from "./title/activities";

const T = {
  title: { fr: "Pause", en: "Paused" },
  goesOn: { fr: "Le jeu continue", en: "The game goes on" },
  goesOnText: {
    fr: "En salle {0}, l'horloge commune ne s'arrête pas.",
    en: "In room {0}, the common clock does not stop.",
  },
  resume: { fr: "Reprendre", en: "Resume" },
  save: { fr: "Sauvegarder", en: "Save game" },
  load: { fr: "Charger", en: "Load game" },
  release: { fr: "Rendre les commandes", en: "Release the controls" },
  releaseHint: { fr: "Coupe l'autopilote, le maintien, la mission (⌫)", en: "Stops the autopilot, the hold, the mission (⌫)" },
  network: { fr: "Jouer ensemble", en: "Play together" },
  networkHint: { fr: "2 à 4 joueurs, un spectateur", en: "2 to 4 players, a spectator" },
  title2: { fr: "Retour au titre", en: "Back to the title" },
  back: { fr: "Retour", en: "Back" },
  choose: { fr: "Choisir", en: "Choose" },
  open: { fr: "Ouvrir", en: "Open" },
  name: { fr: "Nom de la sauvegarde", en: "Save name" },
  saveNew: { fr: "Sauvegarder", en: "Save" },
  overwrite: { fr: "Écraser", en: "Overwrite" },
  loadIt: { fr: "Charger", en: "Load" },
  delete: { fr: "Supprimer", en: "Delete" },
  confirmDelete: { fr: "Supprimer ?", en: "Delete?" },
  auto: { fr: "Sauvegarde automatique", en: "Autosave" },
  none: { fr: "Aucune sauvegarde pour l'instant.", en: "No saved game yet." },
  saved: { fr: "Sauvegardé", en: "Saved" },
  mission: { fr: "Mission", en: "Mission" },
  played: { fr: "Temps de jeu", en: "Played" },
  savedAgo: { fr: "sauvé {0}", en: "saved {0}" },
  notSaved: { fr: "pas encore sauvé", en: "not saved yet" },
  tip: { fr: "Astuce", en: "Tip" },
  leaveTitle: { fr: "Retour au titre ?", en: "Back to the title?" },
  leaveText: {
    fr: "La dernière sauvegarde date {0} : ce qui a été joué depuis serait perdu.",
    en: "The last save was {0}: what was played since would be lost.",
  },
  leaveNone: { fr: "Rien n'a encore été sauvegardé de cette partie.", en: "Nothing of this game has been saved yet." },
  saveLeave: { fr: "Sauvegarder, puis le titre", en: "Save, then the title" },
  leave: { fr: "Le titre sans sauvegarder", en: "The title without saving" },
  stay: { fr: "Rester", en: "Stay" },
} satisfies Record<string, Text>;

export interface PauseDeps {
  tools: GameTools;
  /** the simulation held (true) or running again */
  hold(on: boolean): void;
  /** an autopilot, a hold or a mission engaged — and their release */
  engaged(): boolean;
  release(): void;
  /** where one is, the mission, the time played, the last save, the room (ui/pausemenu.ts) */
  context(): PauseContext;
  settings(): void;
  /** the Lab: every control (ui/panel.ts) */
  lab(): void;
  help(): void;
  /** the controls screen (its back: this menu again) */
  controls(): void;
  photo(): void;
  /** the offline capture of the view now (saved once converged), and the render dialog */
  capture(): void;
  render(): void;
  /** the Atlas (ui/atlas.ts) */
  atlas(): void;
  /** the sky's events from here (ui/skyevents.ts) */
  skyEvents(): void;
  /** a multiple exposure (ui/multiexposure.ts): from the view framed, when there is one */
  multiExposure?(): void;
  /** the observatory (ui/observe.ts): what to see from the Earth's ground, and when */
  observe?(): void;
  /** playing together (ui/netpanel.ts), and whether its menu is shown (Settings › Network) */
  network?(): void;
  networkShown?(): boolean;
  /** the room one is in, said in the item's hint (its code, how many) — none: out of a room */
  networkState?(): string | null;
  /** placing the ship (ui/placepanel.ts) */
  place(): void;
  /** the date and time (ui/timepanel.ts) */
  time(): void;
  /** the weather (ui/weatherpanel.ts) */
  weather(): void;
  /** the eclipse calculator (ui/eclipses.ts) */
  eclipses?(): void;
  /** a way to play's launch screen (the title's), over the game — its back: this menu again */
  modes(id: ModeId): void;
  titleScreen(): void;
  toast(text: string): void;
}

const fill = (s: string, ...a: string[]) => a.reduce((x, v, i) => x.replace(`{${i}}`, v), s);

export class PauseMenu {
  private root: HTMLElement | null = null;
  private router: MenuRouter | null = null;
  private ctxEl: HTMLElement | null = null;
  private unInput: (() => void) | null = null;
  /** in a room: the simulation not held */
  private live = false;
  private tipN = Math.floor(Math.random() * 100);
  private ctx: PauseContext | null = null;

  constructor(private d: PauseDeps) {}

  get isOpen() {
    return !!this.root;
  }
  /** the screen shown ("pause", "pause:save", "pause:load", "pause:leave"), null when closed */
  get screen(): string | null {
    return this.router?.current ?? null;
  }

  open() {
    if (this.root) return;
    watchInput();
    this.ctx = this.d.context();
    this.live = !!this.ctx.room;
    if (!this.live) this.d.hold(true);
    this.tipN++;
    const host = h("div", { class: "pz-host" });
    this.ctxEl = h("aside", { class: "pz-context", "aria-live": "polite", "data-testid": "pause-context" });
    this.root = h(
      "div",
      {
        class: `pz-root${this.live ? " live" : ""}`,
        role: "dialog",
        "aria-modal": "true",
        "aria-label": tr(T.title),
        "data-testid": "pause",
      },
      host,
      this.ctxEl,
    );
    document.body.append(this.root);
    document.body.classList.add("paused");
    // (its screens change at once: a tool's menu, its keys pressed in a row)
    this.router = new MenuRouter(host, { onEmpty: () => this.close(), cut: true });
    this.router.push(this.mainScreen());
    this.fillContext();
    // (the prompts follow the device: redrawn in place)
    this.unInput = onInputChange(() => {
      for (const e of this.root?.querySelectorAll<HTMLElement & { refill?: () => void }>(".m-prompts") ?? []) e.refill?.();
    });
  }

  close() {
    if (!this.root) return;
    // (its router emptied calls this again: the menu already gone by then)
    const root = this.root;
    this.root = this.ctxEl = null;
    this.unInput?.();
    this.unInput = null;
    const r = this.router;
    this.router = null;
    r?.close(true);
    root.remove();
    document.body.classList.remove("paused");
    if (!this.live) this.d.hold(false);
  }

  /** Leaves the menu for one of the game's surfaces (it opens over the paused scene). */
  private leaveFor(fn: () => void) {
    this.close();
    fn();
  }

  // ------------------------------------------------------------------ the context column

  private fillContext() {
    const c = this.ctx!;
    const kids: (Node | null)[] = [];
    if (c.room)
      kids.push(
        h(
          "div",
          { class: "pz-live", "data-testid": "pause-live" },
          el("b", "", tr(T.goesOn)),
          el("span", "", fill(tr(T.goesOnText), c.room)),
        ),
      );
    kids.push(el("p", "pz-where", c.line));
    if (c.mission)
      kids.push(
        h(
          "section",
          { class: "pz-mission", "data-testid": "pause-mission" },
          h("p", { class: "pz-mission-head" }, el("span", "pz-k", tr(T.mission)), el("b", "", c.mission.title)),
          h(
            "ul",
            { class: "pz-objs" },
            ...c.mission.objectives.map((o) =>
              h("li", { class: `pz-obj ${o.state}` }, el("i", "", OBJ_MARK[o.state]), el("span", "", o.text)),
            ),
          ),
        ),
      );
    else if (c.figures.length)
      kids.push(h("dl", { class: "pz-figs" }, ...c.figures.map(([k, v]) => h("div", {}, el("dt", "", k), el("dd", "", v)))));
    kids.push(
      el(
        "p",
        "pz-meta",
        `${tr(T.played)} ${playedText(c.played)} · ${c.savedAt !== null ? fill(tr(T.savedAgo), agoWords(Date.now() - c.savedAt)) : tr(T.notSaved)}`,
      ),
      h("p", { class: "pz-tip" }, el("span", "pz-k", tr(T.tip)), tr(tipOf(c.tips, this.tipN))),
    );
    this.ctxEl!.replaceChildren(...kids.filter((k): k is Node => !!k));
  }

  // ------------------------------------------------------------------ screens

  private prompts(list: [MenuAction, Text][]) {
    const ps = h("div", { class: "m-prompts" }) as HTMLElement & { refill?: () => void };
    ps.refill = () =>
      ps.replaceChildren(
        ...list.flatMap(([a, label]) => {
          const g = glyph(a);
          return g ? [h("span", { class: "m-prompt" }, el("span", "m-glyph", g), tr(label))] : [];
        }),
      );
    ps.refill();
    return h("footer", { class: "pz-foot" }, ps);
  }

  private head(title: string, line?: string) {
    return h(
      "header",
      { class: "pz-head" },
      h("h2", { class: "pz-title" }, title, this.live ? el("span", "pz-badge", tr(T.goesOn)) : null),
      line ? el("p", "pz-line", line) : null,
    );
  }

  /** An item of a list: its title, its line, a key on its right; a drawer's: › */
  private item(testid: string, title: string, o: { hint?: string; key?: string; drawer?: boolean; first?: boolean } = {}) {
    const b = h(
      "button",
      {
        class: `m-item tt-act pz-item${o.drawer ? " pz-has-drawer" : ""}`,
        type: "button",
        "data-testid": testid,
        "data-focus-id": testid,
        ...(o.first ? { "data-autofocus": "" } : {}),
      },
      h(
        "span",
        { class: "tt-act-row" },
        el("span", "", title),
        o.key ? el("em", "tt-act-mark", o.key) : o.drawer ? el("em", "pz-chev", "›") : null,
      ),
      o.hint ? el("small", "", o.hint) : null,
    );
    return b;
  }

  private mainScreen(): MenuScreen {
    let drawer: DrawerId | null = null;
    let drawerEl: HTMLElement | null = null;
    let groupBtn: (id: DrawerId) => HTMLElement | null = () => null;
    const hide = () => {
      drawer = null;
      if (drawerEl) {
        drawerEl.hidden = true;
        drawerEl.replaceChildren();
      }
      for (const b of this.root?.querySelectorAll(".pz-has-drawer.open") ?? []) b.classList.remove("open");
    };
    return {
      id: "pause",
      build: () => {
        drawer = null;
        const d = this.d;
        const page = h("div", { class: "tt-page pz-page" });
        const list = h("nav", { class: "pz-list", "aria-label": tr(T.title) });
        drawerEl = h("nav", { class: "pz-drawer", hidden: "" });
        const actions: Record<string, (() => void) | undefined> = {
          capture: () => this.leaveFor(d.capture),
          render: () => this.leaveFor(d.render),
          photo: () => this.leaveFor(d.photo),
          multi: d.multiExposure ? () => this.leaveFor(() => d.multiExposure?.()) : undefined,
          atlas: () => this.leaveFor(d.atlas),
          place: () => this.leaveFor(d.place),
          time: () => this.leaveFor(d.time),
          weather: () => this.leaveFor(d.weather),
          sky: () => this.leaveFor(d.skyEvents),
          observe: d.observe ? () => this.leaveFor(() => d.observe?.()) : undefined,
          eclipses: d.eclipses ? () => this.leaveFor(() => d.eclipses?.()) : undefined,
          "mode-foot": () => this.leaveFor(() => d.modes("foot")),
          "mode-plane": () => this.leaveFor(() => d.modes("plane")),
          "mode-ship": () => this.leaveFor(() => d.modes("ship")),
          "mode-free": () => this.leaveFor(() => d.modes("free")),
          settings: () => this.leaveFor(d.settings),
          lab: () => this.leaveFor(d.lab),
          controls: () => this.leaveFor(d.controls),
          "graphics-diagnostic": () => void downloadGpuDiagnostic(),
        };
        /** a drawer shown beside (into: the focus on its first entry) */
        const show = (id: DrawerId, into: boolean) => {
          if (drawer !== id) {
            drawer = id;
            const D = DRAWERS[id];
            drawerEl!.replaceChildren(
              h("p", { class: "pz-crumb" }, el("span", "", tr(T.title)), el("i", "", "›"), el("b", "", tr(D.title))),
              ...D.items
                .filter((x) => actions[x.id])
                .map((x) => {
                  const b = this.item(`pause-${x.id}`, tr(x.title), { hint: x.hint ? tr(x.hint) : undefined });
                  b.addEventListener("click", () => actions[x.id]!());
                  // (← back to the group)
                  b.addEventListener("keydown", (e) => {
                    if (e.key !== "ArrowLeft") return;
                    e.preventDefault();
                    e.stopPropagation();
                    groupBtn(id)?.focus();
                  });
                  return b;
                }),
            );
            drawerEl!.hidden = false;
            drawerEl!.dataset.drawer = id;
            for (const b of list.querySelectorAll(".pz-has-drawer")) b.classList.toggle("open", (b as HTMLElement).dataset.drawer === id);
          }
          if (into) drawerEl!.querySelector<HTMLElement>("button")?.focus();
        };
        const add = (b: HTMLElement, go: () => void, id?: DrawerId) => {
          if (id) {
            b.dataset.drawer = id;
            b.addEventListener("click", () => show(id, true));
            b.addEventListener("keydown", (e) => {
              if (e.key !== "ArrowRight") return;
              e.preventDefault();
              e.stopPropagation();
              show(id, true);
            });
            b.addEventListener("focus", () => show(id, false));
            b.addEventListener("pointerenter", () => show(id, false));
          } else {
            b.addEventListener("click", go);
            b.addEventListener("focus", hide);
          }
          list.append(b);
        };
        const group = (id: DrawerId) =>
          add(this.item(`pause-group-${id}`, tr(DRAWERS[id].title), { hint: tr(DRAWERS[id].hint), drawer: true }), () => {}, id);
        groupBtn = (id) => list.querySelector<HTMLElement>(`[data-drawer="${id}"]`);
        add(this.item("pause-resume", tr(T.resume), { first: true }), () => this.close());
        add(this.item("pause-save", tr(T.save), { key: "F5" }), () => this.router?.push(this.saveScreen()));
        add(this.item("pause-load", tr(T.load), { key: "F9" }), () => this.router?.push(this.loadScreen()));
        if (d.engaged())
          add(this.item("pause-release", tr(T.release), { hint: tr(T.releaseHint) }), () => {
            d.release();
            this.close();
          });
        list.append(el("hr", "pz-sep", ""));
        group("capture");
        group("world");
        group("sky");
        if (d.network && (d.networkShown?.() ?? true))
          add(this.item("pause-network", tr(T.network), { hint: d.networkState?.() ?? tr(T.networkHint) }), () =>
            this.leaveFor(() => d.network?.()),
          );
        group("modes");
        list.append(el("hr", "pz-sep", ""));
        group("settings");
        add(this.item("pause-title", tr(T.title2)), () => {
          const c = this.d.context();
          if (titleNeedsConfirm(c, Date.now())) this.router?.push(this.leaveScreen(c.savedAt));
          else this.leaveFor(d.titleScreen);
        });
        page.append(
          this.head(tr(T.title), this.ctx?.line),
          h("div", { class: "pz-cols" }, list, drawerEl),
          this.prompts([
            ["confirm", T.choose],
            ["back", T.resume],
          ]),
        );
        return page;
      },
      // (Escape in a drawer: back to its group — out of the menu only from the first column)
      back: () => {
        if (drawer && drawerEl?.contains(document.activeElement)) {
          const id = drawer;
          groupBtn(id)?.focus();
          return false;
        }
        return true;
      },
    };
  }

  private saveScreen(): MenuScreen {
    return {
      id: "pause:save",
      build: () => {
        const name = h("input", {
          class: "tt-search pz-input",
          type: "text",
          "aria-label": tr(T.name),
          placeholder: tr(T.name),
          maxlength: "60",
          "data-autofocus": "",
        }) as HTMLInputElement;
        const doSave = (nm: string) => {
          try {
            const saved = this.d.tools.save(nm);
            this.d.toast(`${tr(T.saved)} — ${saved}`);
            this.ctx = this.d.context();
            this.fillContext();
            this.router?.back();
          } catch (e) {
            this.d.toast((e as Error).message);
          }
        };
        name.addEventListener("keydown", (e) => e.key === "Enter" && doSave(name.value));
        const go = button({ label: tr(T.saveNew), kind: "primary", testid: "pause-save-new", onClick: () => doSave(name.value) });
        go.classList.add("m-item", "tt-launch", "pz-go");
        const list = h("div", { class: "pz-saves" });
        for (const g of slots.list()) {
          const b = button({ label: tr(T.overwrite), testid: "pause-overwrite", onClick: () => doSave(g.name) });
          b.classList.add("pz-mini");
          list.append(this.saveRow(g.name, g.summary, g.savedAt, [b]));
        }
        return h(
          "div",
          { class: "tt-page pz-page" },
          this.head(tr(T.save)),
          h("div", { class: "pz-sub" }, h("div", { class: "pz-row" }, name, go), list),
          this.prompts([["back", T.back]]),
        );
      },
    };
  }

  private loadScreen(): MenuScreen {
    return {
      id: "pause:load",
      build: () => {
        const list = h("div", { class: "pz-saves" });
        const load = (nm: string) => {
          try {
            this.d.toast(this.d.tools.load(nm));
            this.close();
          } catch (e) {
            this.d.toast((e as Error).message);
          }
        };
        const auto = autosave.get();
        if (auto) {
          const b = button({ label: tr(T.loadIt), kind: "primary", testid: "pause-load-auto", onClick: () => load("autosave") });
          b.classList.add("pz-mini");
          b.dataset.autofocus = "";
          list.append(this.saveRow(tr(T.auto), auto.summary, auto.savedAt, [b]));
        }
        for (const g of slots.list()) {
          const del = button({ label: tr(T.delete), kind: "danger" });
          del.classList.add("pz-mini");
          // (a destructive action: confirmed by a second press)
          del.addEventListener("click", () => {
            if (del.dataset.armed) {
              this.d.tools.deleteSave(g.name);
              this.router?.refresh();
            } else {
              del.dataset.armed = "1";
              del.querySelector("span")!.textContent = tr(T.confirmDelete);
            }
          });
          const l = button({ label: tr(T.loadIt), onClick: () => load(g.name) });
          l.classList.add("pz-mini");
          list.append(this.saveRow(g.name, g.summary, g.savedAt, [l, del]));
        }
        if (!list.children.length) list.append(el("p", "tt-empty", tr(T.none)));
        return h(
          "div",
          { class: "tt-page pz-page" },
          this.head(tr(T.load)),
          h("div", { class: "pz-sub" }, list),
          this.prompts([["back", T.back]]),
        );
      },
    };
  }

  /** Back to the title, more than five minutes unsaved: save first, leave anyway, or stay. */
  private leaveScreen(savedAt: number | null): MenuScreen {
    return {
      id: "pause:leave",
      build: () => {
        const text = savedAt !== null ? fill(tr(T.leaveText), agoWords(Date.now() - savedAt)) : tr(T.leaveNone);
        const save = this.item("pause-leave-save", tr(T.saveLeave), { first: true });
        save.classList.add("tt-launch");
        save.addEventListener("click", () => {
          try {
            this.d.toast(`${tr(T.saved)} — ${this.d.tools.save("")}`);
          } catch (e) {
            this.d.toast((e as Error).message);
          }
          this.leaveFor(this.d.titleScreen);
        });
        const go = this.item("pause-leave-go", tr(T.leave));
        go.addEventListener("click", () => this.leaveFor(this.d.titleScreen));
        const stay = this.item("pause-leave-stay", tr(T.stay));
        stay.addEventListener("click", () => this.router?.back());
        return h(
          "div",
          { class: "tt-page pz-page" },
          this.head(tr(T.leaveTitle)),
          h("div", { class: "pz-sub" }, el("p", "pz-text", text), h("nav", { class: "pz-list" }, save, go, stay)),
          this.prompts([
            ["confirm", T.choose],
            ["back", T.back],
          ]),
        );
      },
    };
  }

  private saveRow(name: string, summary: string, savedAt: number, actions: HTMLElement[]) {
    return h(
      "div",
      { class: "pz-save" },
      h("div", { class: "pz-save-text" }, el("b", "", name), el("span", "", summary), el("small", "", new Date(savedAt).toLocaleString())),
      h("div", { class: "pz-save-acts" }, ...actions),
    );
  }
}
