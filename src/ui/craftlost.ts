// The craft lost to the air (flightair.ts: its shield or hull burnt through, a load past its structure):
// the time stopped, why, and the ways on — back to the moment before the entry, on without damage,
// the scene again. Shown as the telemetry would: the signal lost, the last words frozen on a screen.
import { tr } from "../i18n";

const T = {
  code: { fr: "TÉLÉMÉTRIE · SIGNAL PERDU", en: "TELEMETRY · SIGNAL LOST" },
  title: { fr: "VAISSEAU PERDU", en: "CRAFT LOST" },
  resume: { fr: "Reprendre avant la rentrée", en: "Resume before the entry" },
  undamaged: { fr: "Continuer sans dégâts", en: "Go on without damage" },
  restart: { fr: "Recommencer la scène", en: "Restart the scene" },
};

export interface CraftLostActions {
  /** back to the last point before the air (null: none kept) */
  resume: (() => void) | null;
  /** on, the damage off */
  undamaged: () => void;
  /** the scene from its start */
  restart: (() => void) | null;
}

export class CraftLost {
  private root: HTMLDivElement | null = null;

  get shown() {
    return !!this.root;
  }

  show(why: string, a: CraftLostActions) {
    this.hide();
    const r = document.createElement("div");
    r.className = "craft-lost";
    const box = document.createElement("div");
    box.className = "cl-box";
    const code = document.createElement("div");
    code.className = "cl-code";
    code.textContent = tr(T.code);
    const h = document.createElement("div");
    h.className = "cl-title";
    h.textContent = tr(T.title);
    const p = document.createElement("div");
    p.className = "cl-why";
    p.textContent = why;
    const row = document.createElement("div");
    row.className = "cl-row";
    const btn = (label: string, fn: (() => void) | null, main = false) => {
      if (!fn) return;
      const b = document.createElement("button");
      b.textContent = label;
      if (main) b.className = "cl-main";
      b.onclick = () => {
        this.hide();
        fn();
      };
      row.append(b);
    };
    btn(tr(T.resume), a.resume, true);
    btn(tr(T.undamaged), a.undamaged);
    btn(tr(T.restart), a.restart);
    box.append(code, h, p, row);
    r.append(box);
    document.body.append(r);
    this.root = r;
  }

  hide() {
    this.root?.remove();
    this.root = null;
  }
}
