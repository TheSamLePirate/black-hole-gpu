// The pause menu: Escape when nothing is open stops the time and offers the game's own — resume, save,
// load, hand the controls back (the autopilot, the hold, the mission: ⌫ does it without the menu), the
// settings, the controls, the title screen. Its sub-pages (save, load) go back with Escape.

import { tr, type Text } from "../i18n";
import { autosave, slots } from "../game/save";
import type { GameTools } from "../game/tools";
import { onEscape } from "./keys";
import { button, el, h, kbd } from "./kit";

const T = {
  title: { fr: "Pause", en: "Paused" },
  resume: { fr: "Reprendre", en: "Resume" },
  save: { fr: "Sauvegarder", en: "Save game" },
  load: { fr: "Charger", en: "Load game" },
  release: { fr: "Rendre les commandes", en: "Release the controls" },
  releaseHint: { fr: "coupe l'autopilote, le maintien, la mission", en: "stops the autopilot, the hold, the mission" },
  settings: { fr: "Réglages", en: "Settings" },
  controls: { fr: "Commandes", en: "Controls" },
  title2: { fr: "Écran titre", en: "Title screen" },
  back: { fr: "Retour", en: "Back" },
  name: { fr: "Nom de la sauvegarde", en: "Save name" },
  saveNew: { fr: "Sauvegarder", en: "Save" },
  overwrite: { fr: "Écraser", en: "Overwrite" },
  loadIt: { fr: "Charger", en: "Load" },
  delete: { fr: "Supprimer", en: "Delete" },
  confirmDelete: { fr: "Supprimer ?", en: "Delete?" },
  auto: { fr: "Sauvegarde automatique", en: "Autosave" },
  none: { fr: "Aucune sauvegarde pour l'instant.", en: "No saved game yet." },
  saved: { fr: "Sauvegardé", en: "Saved" },
  quick: { fr: "F5 sauvegarde rapide · F9 chargement rapide", en: "F5 quick save · F9 quick load" },
} satisfies Record<string, Text>;

export interface PauseDeps {
  tools: GameTools;
  /** the simulation held (true) or running again */
  hold(on: boolean): void;
  /** an autopilot, a hold or a mission engaged — and their release */
  engaged(): boolean;
  release(): void;
  settings(): void;
  help(): void;
  titleScreen(): void;
  toast(text: string): void;
}

export class PauseMenu {
  private root: HTMLElement | null = null;
  private frame: HTMLElement | null = null;
  private unEscape: (() => void) | null = null;
  private unSub: (() => void) | null = null;

  constructor(private d: PauseDeps) {}

  get isOpen() {
    return !!this.root;
  }

  open() {
    if (this.root) return;
    this.d.hold(true);
    this.frame = h("div", { class: "k-frame pm", role: "dialog", "aria-modal": "true", "aria-label": tr(T.title), "data-testid": "pause" });
    this.root = h("div", { class: "k-modal pm-scrim" }, this.frame);
    this.root.addEventListener("click", (e) => e.target === this.root && this.close());
    document.body.append(this.root);
    document.body.classList.add("paused");
    this.unEscape = onEscape(() => this.close());
    this.main();
  }

  close() {
    if (!this.root) return;
    this.unSub?.();
    this.unSub = null;
    this.unEscape?.();
    this.unEscape = null;
    this.root.remove();
    this.root = this.frame = null;
    document.body.classList.remove("paused");
    this.d.hold(false);
  }

  /** Leaves the menu for one of the game's surfaces (it opens over the paused scene). */
  private leaveFor(fn: () => void) {
    this.close();
    fn();
  }

  private page(title: string, ...kids: (Node | null)[]) {
    this.frame!.replaceChildren(h("h2", { class: "k-title pm-title" }, title), ...kids.filter((k): k is Node => !!k));
    this.frame!.querySelector<HTMLElement>("button, input")?.focus();
  }

  private item(label: string, onClick: () => void, o: { hint?: string; testid?: string; kind?: "primary" | "danger" } = {}) {
    const b = button({ label, kind: o.kind, testid: o.testid, onClick });
    b.classList.add("pm-item");
    if (o.hint) b.append(el("small", "pm-hint", o.hint));
    return b;
  }

  private main() {
    this.unSub?.();
    this.unSub = null;
    const list = h(
      "nav",
      { class: "pm-list", "aria-label": tr(T.title) },
      this.item(tr(T.resume), () => this.close(), { testid: "pause-resume" }),
      this.item(tr(T.save), () => this.savePage(), { testid: "pause-save" }),
      this.item(tr(T.load), () => this.loadPage(), { testid: "pause-load" }),
      this.d.engaged()
        ? this.item(
            tr(T.release),
            () => {
              this.d.release();
              this.close();
            },
            { hint: `⌫ — ${tr(T.releaseHint)}`, testid: "pause-release" },
          )
        : null,
      this.item(tr(T.settings), () => this.leaveFor(this.d.settings), { testid: "pause-settings" }),
      this.item(tr(T.controls), () => this.leaveFor(this.d.help), { testid: "pause-controls" }),
      this.item(tr(T.title2), () => this.leaveFor(this.d.titleScreen), { testid: "pause-title" }),
    );
    // (↑ ↓ move between the items, as on a console)
    list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      e.stopPropagation();
      const items = [...list.querySelectorAll<HTMLButtonElement>("button")];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    });
    this.page(tr(T.title), list, h("p", { class: "pm-foot" }, kbd("Esc"), ` ${tr(T.resume)} · `, tr(T.quick)));
  }

  /** A sub-page: Escape goes back to the main page (not out of the menu). */
  private sub() {
    this.unSub?.();
    this.unSub = onEscape(() => this.main());
  }

  private savePage() {
    this.sub();
    const name = h("input", { class: "pm-input", type: "text", "aria-label": tr(T.name), placeholder: tr(T.name), maxlength: "60" });
    const doSave = (nm: string) => {
      try {
        const saved = this.d.tools.save(nm);
        this.d.toast(`${tr(T.saved)} — ${saved}`);
        this.main();
      } catch (e) {
        this.d.toast((e as Error).message);
      }
    };
    name.addEventListener("keydown", (e) => e.key === "Enter" && doSave(name.value));
    const list = h("div", { class: "pm-saves" });
    for (const g of slots.list())
      list.append(
        this.saveRow(g.name, g.summary, g.savedAt, [
          button({ label: tr(T.overwrite), testid: "pause-overwrite", onClick: () => doSave(g.name) }),
        ]),
      );
    this.page(
      tr(T.save),
      h(
        "div",
        { class: "pm-row" },
        name,
        button({ label: tr(T.saveNew), kind: "primary", testid: "pause-save-new", onClick: () => doSave(name.value) }),
      ),
      list,
      button({ label: tr(T.back), onClick: () => this.main() }),
    );
  }

  private loadPage() {
    this.sub();
    const list = h("div", { class: "pm-saves" });
    const load = (nm: string) => {
      try {
        this.d.toast(this.d.tools.load(nm));
        this.close();
      } catch (e) {
        this.d.toast((e as Error).message);
      }
    };
    const auto = autosave.get();
    if (auto)
      list.append(
        this.saveRow(tr(T.auto), auto.summary, auto.savedAt, [
          button({ label: tr(T.loadIt), kind: "primary", testid: "pause-load-auto", onClick: () => load("autosave") }),
        ]),
      );
    for (const g of slots.list()) {
      const del = button({ label: tr(T.delete), kind: "danger" });
      // (a destructive action: confirmed by a second press)
      del.addEventListener("click", () => {
        if (del.dataset.armed) {
          this.d.tools.deleteSave(g.name);
          this.loadPage();
        } else {
          del.dataset.armed = "1";
          del.querySelector("span")!.textContent = tr(T.confirmDelete);
        }
      });
      list.append(this.saveRow(g.name, g.summary, g.savedAt, [button({ label: tr(T.loadIt), onClick: () => load(g.name) }), del]));
    }
    if (!list.children.length) list.append(el("p", "pm-empty", tr(T.none)));
    this.page(tr(T.load), list, button({ label: tr(T.back), onClick: () => this.main() }));
  }

  private saveRow(name: string, summary: string, savedAt: number, actions: HTMLElement[]) {
    return h(
      "div",
      { class: "pm-save" },
      h("div", { class: "pm-save-text" }, el("b", "", name), el("span", "", summary), el("small", "", new Date(savedAt).toLocaleString())),
      h("div", { class: "pm-save-acts" }, ...actions),
    );
  }
}
