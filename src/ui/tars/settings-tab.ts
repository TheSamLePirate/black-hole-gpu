// TARS's settings, in his console (its "Settings" tab): his mind (OpenRouter, the model, the reflexes, the
// budget, his remarks, honesty, humour), his voice (on, its volume, the subtitles, what speaks — Deepgram's
// Aura-2, the robot, the system's —, which voice, its effect, a system voice's pace and pitch; tried at once),
// the radio's voices (mission control, the tower), his ear (what hears you, the Deepgram key, the model, the
// language, his key's way, the microphone — its level and a test, the words heard shown). Every control the
// settings' own (ui/schema.ts: the same values as the settings panel, set through it — its history, its
// keeping), drawn here in the console's look.

import { t, tf, tr, type Text } from "../../i18n";
import type { Settings } from "../../settings";
import { type ChoiceDef, type ControlDef, type NumberDef, SCHEMA_BY_KEY } from "../schema";
import { earKeyLine } from "../ear-key";

type Key = keyof Settings;

export interface SettingsTabHost {
  settings: Settings;
  /** a value set (through the settings panel: its history, its keeping, its effects) */
  set(key: Key, value: unknown): void;
  /** a line said in a voice now (his, the radio's) — what speaks it, said back */
  tryVoice(who: "tars" | "radio"): Promise<string>;
  /** what speaks now, in words (his voice, the radio's) */
  voiceNow(who: "tars" | "radio"): string;
  /** the microphones (their labels once the browser has been allowed one), the one chosen ("": the default) */
  mics(): Promise<{ id: string; label: string }[]>;
  mic(): string;
  setMic(id: string): void;
  /** a test of his ear: the level and the words as they come, until stopped or 6 s (its outcome said) */
  testEar(h: { level(v: number): void; words(text: string): void; done(note: string): void }): () => void;
}

/** The sections and their settings (the custom blocks between them by name). */
const SECTIONS: { title: Text; items: (Key | "ear-key" | "mic" | "try-tars" | "try-radio")[] }[] = [
  {
    title: { fr: "Son esprit", en: "His mind" },
    items: ["tarsOnline", "tarsModel", "tarsWake", "tarsBudget", "tarsRemarks", "tarsHonesty", "tarsHumour"],
  },
  {
    title: { fr: "Sa voix", en: "His voice" },
    items: [
      "voice",
      "soundVoice",
      "subtitles",
      "tarsVoiceEngine",
      "tarsVoiceFr",
      "tarsVoiceEn",
      "tarsVoiceEffect",
      "tarsSystemVoice",
      "tarsVoiceRate",
      "tarsVoicePitch",
      "try-tars",
    ],
  },
  { title: { fr: "La radio", en: "The radio" }, items: ["radioVoiceEngine", "radioVoiceFr", "radioVoiceEn", "try-radio"] },
  { title: { fr: "Son oreille", en: "His ear" }, items: ["tarsEar", "ear-key", "tarsEarModel", "tarsEarLang", "tarsTalkMode", "mic"] },
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** The tab's content: drawn once, its values and states updated (update()) without losing a field's focus. */
export class TarsSettingsTab {
  readonly el = el("div", "ts");
  private updaters: (() => void)[] = [];
  private stopTest: (() => void) | null = null;

  constructor(private host: SettingsTabHost) {
    this.draw();
  }

  /** Drawn again (a list changed: the system's voices). */
  draw() {
    this.updaters = [];
    this.el.replaceChildren();
    for (const sec of SECTIONS) {
      const box = el("section", "ts-sec");
      box.append(el("h4", "ts-title", tr(sec.title)));
      for (const it of sec.items) {
        if (it === "ear-key") box.append(Object.assign(earKeyLine({ testid: "ts-ear-key" }), { className: "ek ts-ek" }));
        else if (it === "mic") box.append(this.micBlock());
        else if (it === "try-tars" || it === "try-radio") box.append(this.tryBlock(it === "try-tars" ? "tars" : "radio"));
        else {
          const d = SCHEMA_BY_KEY.get(it);
          if (d) box.append(this.control(d));
        }
      }
      this.el.append(box);
    }
    this.update();
  }

  /** Every control read again from the settings (their values, enabled or not). */
  update() {
    for (const u of this.updaters) u();
  }

  /** Whatever it was doing stopped (the tab left: the ear's test). */
  leave() {
    this.stopTest?.();
    this.stopTest = null;
  }

  private control(d: ControlDef): HTMLElement {
    const s = this.host.settings;
    const row = el("div", `ts-row ts-${d.type}`);
    row.dataset.key = d.key;
    const label = el("span", "ts-label", t(d.label));
    if (d.help) label.title = t(d.help);
    row.append(label);
    let read: () => void = () => {};
    if (d.type === "toggle") {
      const sw = el("button", "ts-switch");
      sw.type = "button";
      sw.setAttribute("role", "switch");
      sw.dataset.testid = `ts-${d.key}`;
      sw.addEventListener("click", () => this.host.set(d.key, !s[d.key]));
      row.append(sw);
      read = () => sw.setAttribute("aria-checked", String(!!s[d.key]));
    } else if (d.type === "choice") {
      const c = d as ChoiceDef;
      if (c.style === "segmented" && c.options.length <= 4) {
        const seg = el("div", "ts-seg");
        const btns = c.options.map((o) => {
          const b = el("button", "", t(o.label));
          b.type = "button";
          if (o.hint) b.title = t(o.hint);
          b.dataset.testid = `ts-${d.key}-${o.value}`;
          b.addEventListener("click", () => this.host.set(d.key, o.value));
          seg.append(b);
          return [o.value, b] as const;
        });
        row.append(seg);
        read = () => {
          for (const [v, b] of btns) b.classList.toggle("on", s[d.key] === v);
        };
      } else {
        const sel = el("select", "ts-select");
        sel.dataset.testid = `ts-${d.key}`;
        // (the name in the list, its manner in the tip — a long hint cut the list's width)
        for (const o of c.options) {
          const opt = el("option", "", t(o.label));
          opt.value = String(o.value);
          if (o.hint) opt.title = t(o.hint);
          sel.append(opt);
        }
        sel.addEventListener("change", () => {
          const o = c.options.find((x) => String(x.value) === sel.value);
          if (o) this.host.set(d.key, o.value);
        });
        row.append(sel);
        read = () => {
          sel.value = String(s[d.key]);
          const o = c.options.find((x) => String(x.value) === sel.value);
          sel.title = o?.hint ? t(o.hint) : "";
        };
      }
    } else if (d.type === "number") {
      const n = d as NumberDef;
      const range = el("input", "ts-range");
      range.type = "range";
      range.min = String(n.min);
      range.max = String(n.max);
      range.step = String(n.step ?? (n.max - n.min) / 100);
      range.dataset.testid = `ts-${d.key}`;
      const out = el("output", "ts-val");
      const fmt = (v: number) => {
        const dec = Math.max(0, Math.min(3, -Math.floor(Math.log10(n.step ?? 0.01) + 1e-9)));
        return `${v.toLocaleString(tr({ fr: "fr-FR", en: "en-GB" }), { minimumFractionDigits: dec, maximumFractionDigits: dec })}${n.unit ? ` ${n.unit}` : n.max === 100 ? " %" : ""}`;
      };
      range.addEventListener("input", () => {
        out.textContent = fmt(Number(range.value));
        this.host.set(d.key, Number(range.value));
      });
      row.append(range, out);
      read = () => {
        range.value = String(s[d.key]);
        out.textContent = fmt(Number(s[d.key]));
      };
    }
    this.updaters.push(() => {
      read();
      const on = d.enabled ? d.enabled(s) : true;
      row.classList.toggle("off", !on);
      for (const x of row.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button"))
        x.disabled = !on;
      row.hidden = d.visible ? !d.visible(s) : false;
    });
    return row;
  }

  /** A voice tried: a line said now, what speaks it said under it. */
  private tryBlock(who: "tars" | "radio"): HTMLElement {
    const row = el("div", "ts-try");
    const b = el("button", "ts-btn", who === "tars" ? t("Try his voice") : t("Try the radio"));
    b.type = "button";
    b.dataset.testid = `ts-try-${who}`;
    const now = el("span", "ts-now");
    b.addEventListener("click", async () => {
      b.disabled = true;
      now.textContent = t("speaking…");
      now.textContent = await this.host.tryVoice(who).catch((e) => String(e));
      b.disabled = false;
    });
    row.append(b, now);
    this.updaters.push(() => {
      if (!b.disabled) now.textContent = this.host.voiceNow(who);
    });
    return row;
  }

  /** The microphone: which one, its level, a test of the ear (the words heard shown). */
  private micBlock(): HTMLElement {
    const box = el("div", "ts-mic");
    const row = el("div", "ts-row");
    row.append(el("span", "ts-label", t("Microphone")));
    const sel = el("select", "ts-select");
    sel.dataset.testid = "ts-mic";
    const fill = async () => {
      const list = await this.host.mics().catch(() => []);
      sel.replaceChildren();
      const d = el("option", "", t("The system's default"));
      d.value = "";
      sel.append(d);
      for (const m of list) {
        const o = el("option", "", m.label || tf("Microphone {0}", m.id.slice(0, 6)));
        o.value = m.id;
        sel.append(o);
      }
      sel.value = this.host.mic();
      if (sel.value !== this.host.mic()) sel.value = "";
    };
    sel.addEventListener("focus", () => void fill());
    sel.addEventListener("change", () => this.host.setMic(sel.value));
    void fill();
    row.append(sel);
    const test = el("div", "ts-test");
    const b = el("button", "ts-btn", t("Test the ear"));
    b.type = "button";
    b.dataset.testid = "ts-test-ear";
    const meter = el("span", "ts-level");
    const heard = el("span", "ts-heard");
    heard.dataset.testid = "ts-heard";
    b.addEventListener("click", () => {
      if (this.stopTest) {
        this.stopTest();
        return;
      }
      b.textContent = t("Stop");
      heard.textContent = t("Speak…");
      heard.classList.remove("note");
      this.stopTest = this.host.testEar({
        level: (v) => meter.style.setProperty("--f", String(Math.min(1, v))),
        words: (text) => {
          heard.textContent = text || t("Speak…");
        },
        done: (note) => {
          this.stopTest = null;
          b.textContent = t("Test the ear");
          meter.style.setProperty("--f", "0");
          if (note) {
            heard.textContent = note;
            heard.classList.add("note");
          }
          void fill();
        },
      });
    });
    test.append(b, meter, heard);
    box.append(row, test);
    return box;
  }
}
