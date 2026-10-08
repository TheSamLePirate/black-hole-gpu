// The controllers screen (PLAN-HOTAS H4, from the controls screen): every device plugged in — its axes and
// buttons live —, its profile (a known model's, a generic one, the player's own); each command's source set
// by detection (click, then move the axis or press the button: the biggest move wins), each axis's dead zone,
// curve (drawn) and inversion; a calibration (move every axis to its stops); back to the known profile. A
// change makes the profile the player's own, kept in the browser for that model.

import { tr, type Text } from "../i18n";
import {
  ABSOLUTE,
  AXIS_TARGETS,
  type AxisTarget,
  absolute,
  type Binding,
  centred,
  type DeviceSnapshot,
  detect,
  type Profile,
  type Shape,
  SHAPE_DEFAULT,
  type Source,
} from "../input/axes";
import { remappables } from "../input/bindings";
import { forgetProfile, type PadControls, saveProfile, snapshotDevices, storedProfiles } from "../input/devices";
import type { KeyAction } from "../input/keymap";
import { standardTemplate } from "../input/profiles";
import { sharedPad } from "../gamepad";
import { onEscape } from "./keys";
import { button, el, h } from "./kit";

const T = {
  title: { fr: "Manettes", en: "Controllers" },
  none: {
    fr: "Aucune manette ni HOTAS : branchez-en un, puis pressez un bouton (le navigateur ne les montre qu'après).",
    en: "No controller or HOTAS: plug one in, then press a button (the browser shows them only then).",
  },
  builtin: { fr: "mapping intégré", en: "built-in mapping" },
  own: { fr: "mon profil", en: "my profile" },
  known: { fr: "profil connu", en: "known profile" },
  noProfile: { fr: "aucun profil", en: "no profile" },
  customise: { fr: "Personnaliser", en: "Customise" },
  reset: { fr: "Profil d'origine", en: "Original profile" },
  calibrate: { fr: "Calibrer", en: "Calibrate" },
  calibrating: { fr: "Bougez chaque axe jusqu'à ses butées… (cliquez pour finir)", en: "Move every axis to its stops… (click to finish)" },
  add: { fr: "Ajouter une commande…", en: "Add a command…" },
  listen: { fr: "Bougez l'axe ou pressez le bouton… (Échap)", en: "Move the axis or press the button… (Esc)" },
  invert: { fr: "inv.", en: "inv." },
  dead: { fr: "zone morte", en: "dead zone" },
  curve: { fr: "courbe", en: "curve" },
  back: { fr: "Retour", en: "Back" },
  axes: { fr: "Axes", en: "Axes" },
  buttons: { fr: "Boutons", en: "Buttons" },
  builtinHelp: {
    fr: "Manette standard : stick gauche tangage et lacet, LB RB roulis, RT LT gaz, A SAS ; « Personnaliser » en fait un profil modifiable.",
    en: "Standard pad: left stick pitch and yaw, LB RB roll, RT LT throttle, A SAS; “Customise” makes it an editable profile.",
  },
} satisfies Record<string, Text>;

export const AXIS_LABELS: Record<AxisTarget, Text> = {
  pitch: { fr: "Tangage", en: "Pitch" },
  roll: { fr: "Roulis", en: "Roll" },
  yaw: { fr: "Lacet", en: "Yaw" },
  throttle: { fr: "Gaz (levier)", en: "Throttle (lever)" },
  rcsX: { fr: "RCS gauche–droite", en: "RCS left–right" },
  rcsY: { fr: "RCS bas–haut", en: "RCS down–up" },
  rcsZ: { fr: "RCS arrière–avant", en: "RCS back–forward" },
  lookX: { fr: "Regard gauche–droite", en: "Look left–right" },
  lookY: { fr: "Regard bas–haut", en: "Look down–up" },
  brakeL: { fr: "Frein gauche", en: "Left brake" },
  brakeR: { fr: "Frein droit", en: "Right brake" },
};

/** a source as the screen writes it */
export function sourceLabel(s: Source): string {
  if (s.kind === "button") return tr({ fr: `bouton ${s.index + 1}`, en: `button ${s.index + 1}` });
  if (s.kind === "hat") return tr({ fr: `chapeau ${s.index} ${s.dir}`, en: `hat ${s.index} ${s.dir}` });
  return `${tr({ fr: "axe", en: "axis" })} ${s.index}${s.half ? (s.half > 0 ? " +" : " −") : ""}`;
}

/** the commands a button may fire: the keymap's actions and the held flight keys (their labels) */
function buttonCommands(): { key: string; label: string; make: (src: Source) => Binding }[] {
  return remappables()
    .filter((r) => r.group !== "free")
    .map((r) => {
      if (r.id.startsWith("held:")) {
        const held = r.id.slice(5) as never;
        return { key: r.id, label: tr(r.label), make: (src: Source) => ({ held, source: src }) };
      }
      const [, action, arg] = r.id.split(":");
      return {
        key: r.id,
        label: tr(r.label),
        make: (src: Source) => ({ action: action as KeyAction, ...(arg ? { arg } : {}), source: src }),
      };
    });
}

export interface PadsDeps {
  pads: PadControls;
  back(): void;
  toast(text: string): void;
}

export class PadsScreen {
  private root: HTMLElement | null = null;
  private list!: HTMLElement;
  private editor!: HTMLElement;
  private live!: HTMLElement;
  private unEscape: (() => void) | null = null;
  private raf = 0;
  private selected: string | null = null;
  /** listening for a source: the binding's index (−1: a new one, its maker), the device's rest */
  private listening: {
    index: number;
    make?: (s: Source) => Binding;
    rest: DeviceSnapshot;
    seen: { lo: number[]; hi: number[] };
    until: number;
  } | null = null;
  /** calibrating: each axis's extremes */
  private calib: { lo: number[]; hi: number[] } | null = null;
  private shownModels = "";

  constructor(private d: PadsDeps) {}

  get isOpen() {
    return !!this.root;
  }

  open() {
    if (this.root) return;
    this.list = h("div", { class: "ps-list", "data-testid": "pads-list" });
    this.editor = h("div", { class: "ps-editor", "data-testid": "pads-editor" });
    this.live = h("div", { class: "ps-live" });
    const frame = h(
      "div",
      { class: "k-frame ps", role: "dialog", "aria-modal": "true", "aria-label": tr(T.title), "data-testid": "pads" },
      h("h2", { class: "k-title cs-title" }, tr(T.title)),
      h("div", { class: "ps-body" }, this.list, h("div", { class: "ps-side" }, this.live, this.editor)),
      h("div", { class: "cs-acts" }, button({ label: tr(T.back), testid: "pads-back", onClick: () => this.close(true) })),
    );
    this.root = h("div", { class: "k-modal" }, frame);
    document.body.append(this.root);
    this.unEscape = onEscape(() => {
      if (this.listening) {
        this.listening = null;
        this.render();
      } else this.close(true);
    });
    this.shownModels = "";
    // (nothing flown from the devices while they are being set)
    this.d.pads.suspended = true;
    this.tick();
  }

  close(back: boolean) {
    if (!this.root) return;
    cancelAnimationFrame(this.raf);
    this.listening = null;
    this.calib = null;
    this.unEscape?.();
    this.unEscape = null;
    this.root.remove();
    this.root = null;
    this.d.pads.suspended = false;
    if (back) this.d.back();
  }

  private devices(): DeviceSnapshot[] {
    return snapshotDevices(sharedPad().list());
  }

  /** the selected device's profile now: the player's, a known one, the standard pad's built-in (null) */
  private profile(dev: DeviceSnapshot): { p: Profile | null; own: boolean } {
    const own = storedProfiles().get(dev.model);
    if (own) return { p: own, own: true };
    return { p: this.d.pads.presetFor(dev), own: false };
  }

  /** The profile edited: the player's own from now on (a known one copied first). */
  private edit(dev: DeviceSnapshot, f: (p: Profile) => void) {
    const cur = this.profile(dev).p ?? standardTemplate(dev);
    const p: Profile = JSON.parse(JSON.stringify(cur));
    p.name = dev.name;
    f(p);
    saveProfile(p);
    this.d.pads.reload();
    this.render();
  }

  /** Each frame while open: the devices (re-listed when they change), the live readings, the detection. */
  private tick = () => {
    if (!this.root) return;
    const devs = this.devices();
    const models = devs.map((d) => d.model).join("|");
    if (models !== this.shownModels) {
      this.shownModels = models;
      if (!this.selected || !devs.some((d) => d.model === this.selected)) this.selected = devs[0]?.model ?? null;
      this.render();
    }
    const dev = devs.find((d) => d.model === this.selected) ?? null;
    if (dev) {
      this.drawLive(dev);
      if (this.calib)
        dev.axes.forEach((v, i) => {
          this.calib!.lo[i] = Math.min(this.calib!.lo[i] ?? v, v);
          this.calib!.hi[i] = Math.max(this.calib!.hi[i] ?? v, v);
        });
      const L = this.listening;
      if (L) {
        const src = detect(L.rest, dev, L.seen);
        if (src) {
          this.listening = null;
          this.edit(dev, (p) => {
            if (L.index < 0 && L.make) p.bindings.push(L.make(src));
            else if (p.bindings[L.index]) p.bindings[L.index]!.source = src;
          });
        } else if (performance.now() > L.until) {
          this.listening = null;
          this.render();
        }
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** The live readings: each axis a bar (its centre marked), each button a light. */
  private drawLive(dev: DeviceSnapshot) {
    let axes = this.live.querySelector<HTMLElement>(".ps-axes");
    if (!axes || axes.childElementCount !== dev.axes.length) {
      this.live.replaceChildren(
        el("div", "k-label", tr(T.axes)),
        (axes = h(
          "div",
          { class: "ps-axes" },
          ...dev.axes.map((_, i) =>
            h("div", { class: "ps-axis", title: `${i}` }, el("span", "ps-axis-n", `${i}`), h("i", { class: "ps-bar" }, el("b"))),
          ),
        )),
        el("div", "k-label", tr(T.buttons)),
        h("div", { class: "ps-btns" }, ...dev.buttons.map((_, i) => el("span", "ps-btn", `${i + 1}`))),
      );
    }
    dev.axes.forEach((v, i) => {
      const b = axes!.children[i]?.querySelector("b") as HTMLElement | null;
      if (b) {
        const x = Math.min(Math.max(v, -1), 1);
        b.style.left = `${50 + Math.min(x, 0) * 50}%`;
        b.style.width = `${Math.abs(x) * 50}%`;
      }
    });
    const btns = this.live.querySelector(".ps-btns")!;
    dev.buttons.forEach((v, i) => btns.children[i]?.classList.toggle("on", v > 0.5));
  }

  private render() {
    if (!this.root) return;
    const devs = this.devices();
    this.list.replaceChildren(
      ...(devs.length
        ? devs.map((dv) => {
            const { p, own } = this.profile(dv);
            const tag = own ? tr(T.own) : p ? tr(T.known) : dv.standard ? tr(T.builtin) : tr(T.noProfile);
            const b = h(
              "button",
              { class: `ps-dev${dv.model === this.selected ? " on" : ""}`, type: "button", "data-testid": `pads-dev-${dv.model}` },
              el("b", "", dv.name),
              el("small", "", `${dv.model} · ${p?.name && !own ? p.name : tag}`),
            );
            b.addEventListener("click", () => {
              this.selected = dv.model;
              this.render();
            });
            return b;
          })
        : [el("p", "ps-none", tr(T.none))]),
    );
    const dev = devs.find((d) => d.model === this.selected);
    if (!dev) return this.editor.replaceChildren();
    const { p, own } = this.profile(dev);
    const head = h("div", { class: "ps-head" }, el("b", "", p?.name ?? dev.name));
    if (!p && dev.standard) {
      head.append(button({ label: tr(T.customise), testid: "pads-customise", onClick: () => this.edit(dev, () => {}) }));
      this.editor.replaceChildren(head, el("p", "ps-none", tr(T.builtinHelp)));
      return;
    }
    if (own) {
      head.append(
        button({
          label: tr(T.reset),
          testid: "pads-reset",
          onClick: () => {
            forgetProfile(dev.model);
            this.d.pads.reload();
            this.render();
          },
        }),
      );
    }
    const cal = button({
      label: tr(this.calib ? T.calibrating : T.calibrate),
      testid: "pads-calibrate",
      onClick: () => this.toggleCalib(dev),
    });
    head.append(cal);
    const rows = (p?.bindings ?? []).map((b, i) => this.row(dev, b, i));
    this.editor.replaceChildren(head, h("div", { class: "ps-rows" }, ...rows), this.adder(dev));
  }

  private toggleCalib(dev: DeviceSnapshot) {
    if (!this.calib) {
      this.calib = { lo: [], hi: [] };
      this.render();
      return;
    }
    const c = this.calib;
    this.calib = null;
    // (each axis bound: its travel from the extremes reached — a stop moved less than half its travel left alone)
    this.edit(dev, (p) => {
      for (const b of p.bindings) {
        if (!("target" in b) || b.source.kind !== "axis") continue;
        const i = b.source.index;
        const lo = c.lo[i],
          hi = c.hi[i];
        if (lo === undefined || hi === undefined || hi - lo < 1) continue;
        b.shape = { ...(b.shape ?? SHAPE_DEFAULT), min: lo, max: hi };
      }
    });
  }

  /** A binding's row: its command, its source (a click: detect anew), its shape for an axis, removal. */
  private row(dev: DeviceSnapshot, b: Binding, i: number) {
    const name =
      "target" in b
        ? tr(AXIS_LABELS[b.target])
        : ((
            buttonCommands().find((c) => c.key === ("held" in b ? `held:${b.held}` : "")) ??
            buttonCommands().find((c) => "action" in b && c.key.split(":")[1] === b.action && (c.key.split(":")[2] ?? "") === (b.arg ?? ""))
          )?.label ?? ("action" in b ? b.action : ""));
    const listening = this.listening?.index === i;
    const src = button({ label: listening ? tr(T.listen) : sourceLabel(b.source), testid: `pads-src-${i}` });
    src.classList.add("cs-key");
    src.classList.toggle("listening", listening);
    src.addEventListener("click", () => this.listen(dev, i));
    const del = button({ label: "✕", testid: `pads-del-${i}`, onClick: () => this.edit(dev, (p) => p.bindings.splice(i, 1)) });
    const row = h("div", { class: "ps-row" }, el("span", "cs-name", name), src);
    if ("target" in b && b.source.kind === "axis") {
      const s = b.shape ?? SHAPE_DEFAULT;
      const set = (f: (s: Shape) => void) =>
        this.edit(dev, (p) => {
          const q = p.bindings[i] as { shape?: Shape };
          q.shape = { ...(q.shape ?? SHAPE_DEFAULT) };
          f(q.shape);
        });
      const inv = h("label", { class: "ps-inv" }, h("input", { type: "checkbox", "data-testid": `pads-inv-${i}` }), tr(T.invert));
      const cb = inv.querySelector("input")!;
      cb.checked = s.invert;
      cb.addEventListener("change", () => set((q) => (q.invert = cb.checked)));
      const slider = (key: "dead" | "curve", max: number, label: Text) => {
        const r = h("input", {
          type: "range",
          min: "0",
          max: String(max),
          step: "0.01",
          title: tr(label),
          "data-testid": `pads-${key}-${i}`,
        });
        r.value = String(s[key]);
        r.addEventListener("change", () => set((q) => (q[key] = Number(r.value))));
        return h("label", { class: "ps-sl" }, el("small", "", tr(label)), r);
      };
      row.append(inv, slider("dead", 0.4, T.dead), slider("curve", 1, T.curve), this.curve(b.target, s));
    }
    row.append(del);
    return row;
  }

  /** the axis's response drawn: the command against the travel */
  private curve(target: AxisTarget, s: Shape) {
    const W = 64,
      H = 40;
    const abs = ABSOLUTE.has(target);
    let d = "";
    for (let k = 0; k <= 40; k++) {
      const x = -1 + k / 20;
      const y = abs ? absolute(x, { ...s, min: undefined, max: undefined }) * 2 - 1 : centred(x, { ...s, min: undefined, max: undefined });
      d += `${k ? "L" : "M"}${(((x + 1) / 2) * W).toFixed(1)},${((1 - (y + 1) / 2) * H).toFixed(1)}`;
    }
    const box = h("span", { class: "ps-curve" });
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><path d="M0,${H / 2} H${W} M${W / 2},0 V${H}" class="ps-grid"/><path d="${d}" class="ps-line"/></svg>`;
    return box;
  }

  /** The adder: a command chosen (an axis target, an action, a held key), then its source detected. */
  private adder(dev: DeviceSnapshot) {
    const sel = h("select", { class: "ps-add", "data-testid": "pads-add" }) as HTMLSelectElement;
    sel.append(h("option", { value: "" }, tr(T.add)));
    const gAx = h("optgroup", { label: tr(T.axes) });
    for (const t of AXIS_TARGETS) gAx.append(h("option", { value: `axis:${t}` }, tr(AXIS_LABELS[t])));
    const gB = h("optgroup", { label: tr(T.buttons) });
    for (const c of buttonCommands()) gB.append(h("option", { value: c.key }, c.label));
    sel.append(gAx, gB);
    sel.addEventListener("change", () => {
      const v = sel.value;
      if (!v) return;
      const make = v.startsWith("axis:")
        ? (src: Source): Binding => ({ target: v.slice(5) as AxisTarget, source: src })
        : buttonCommands().find((c) => c.key === v)!.make;
      this.listen(dev, -1, make);
    });
    return sel;
  }

  /** Listening for a source (10 s at most): the device's rest now, its moves from it. */
  private listen(dev: DeviceSnapshot, index: number, make?: (s: Source) => Binding) {
    this.listening = { index, make, rest: dev, seen: { lo: [], hi: [] }, until: performance.now() + 10_000 };
    this.render();
    if (index < 0) this.editor.append(el("p", "ps-listen", tr(T.listen)));
  }
}
