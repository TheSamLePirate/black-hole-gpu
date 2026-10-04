// The transport bar: the scene's time in every mode — run / pause, the warp along its ladder (a menu to
// jump to any rung), real time, the clock (a date in the game's world), and the take recorder (the
// live view recorded, rendered afterwards as a video). One widget: over the toolbar without the ship,
// in the mission bar while flying (the flight HUD gives it its slot).

import type { Settings } from "../settings";
import { fmtClock, fmtFactor, fmtWarp, realTimeSpeed, secondsPerM, warpFactor, warpLadder } from "../clock";
import { el as h } from "./kit";
import { t, tf } from "../i18n";

export interface TransportDeps {
  settings: Settings;
  time(): number;
  playPause(): void;
  warp(dir: 1 | -1): void;
  setWarp(speed: number): void;
  realTime(): void;
  /** the take recorder: toggles it; its state */
  record(): void;
  recording(): { on: boolean; seconds: number; frames: number };
  /** why the rails hold the warp back ("" when they do not) */
  railsNote(): string;
  /** a manoeuvre's warp: "" no plan; "plan" a plan not executing; else as it runs (auto, the pilot's,
   *  the pilot's held down to the manoeuvre's) */
  nodeWarp(): "" | "plan" | "auto" | "manual" | "held";
  toggleAutoWarp(): void;
  /** the date and time (ui/timepanel.ts) */
  openTime(): void;
}

const ICON = {
  play: '<path d="M8 5.5v13l10.5-6.5z" class="f"/>',
  pause: '<rect x="7" y="5.5" width="3.6" height="13" rx="1" class="f"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1" class="f"/>',
  slower: '<path d="M11.5 7l-5 5 5 5M18 7l-5 5 5 5"/>',
  faster: '<path d="M12.5 7l5 5-5 5M6 7l5 5-5 5"/>',
  rec: '<circle cx="12" cy="12" r="5.2" class="f"/>',
  clock: '<circle cx="12" cy="12" r="7.5"/><path d="M12 7.5V12l3 2"/>',
};

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export class TransportBar {
  readonly el = h("div", "tp");
  private play = h("button", "tp-btn tp-play");
  private warpBtn = h("button", "tp-warp");
  private warpMain = h("b");
  private warpSub = h("small");
  private rtBtn = h("button", "tp-btn tp-rt", "1×");
  private autoBtn = h("button", "tp-btn tp-auto", "AUTO");
  private clock = h("button", "tp-clock");
  private timeBtn = h("button", "tp-btn tp-time");
  private clockMain = h("b");
  private clockSub = h("small");
  private rec = h("button", "tp-btn tp-rec");
  private recTime = h("span", "tp-rectime");
  private menu = h("div", "tp-menu");
  private last = "";

  constructor(private d: TransportDeps) {
    const btn = (b: HTMLElement, icon: string, tip: string, key: string, fn: () => void) => {
      b.innerHTML = icon ? svg(icon) : b.innerHTML;
      b.dataset.tip = tip;
      if (key) b.dataset.key = key;
      b.onclick = () => {
        fn();
        this.update(true);
      };
      return b;
    };
    btn(this.play, ICON.play, t("Run / pause time — every mode (paused: the image refines)"), t("Space"), () => d.playPause());
    const slower = btn(h("button", "tp-btn"), ICON.slower, t("Slower time"), ",", () => d.warp(-1));
    const faster = btn(h("button", "tp-btn"), ICON.faster, t("Faster time"), ".", () => d.warp(1));
    btn(this.rtBtn, "", t("Real time: a second per second"), "/", () => d.realTime());
    btn(
      this.autoBtn,
      "",
      t("Auto warp for manoeuvres: on, the autopilot sets the warp; off, you choose it live (never faster than the manoeuvre allows)"),
      "",
      () => d.toggleAutoWarp(),
    );
    this.warpBtn.append(this.warpMain, this.warpSub);
    this.warpBtn.dataset.tip = t("Time warp — a click: every rung");
    this.warpBtn.onclick = () => this.toggleMenu();
    this.clock.append(this.clockMain, this.clockSub);
    this.clock.dataset.tip = t("Date and time: now, the start of the scene, a date chosen");
    this.clock.onclick = () => d.openTime();
    this.clock.dataset.testid = "time-clock";
    btn(this.timeBtn, ICON.clock, t("Date and time: now, the start of the scene, a date chosen"), "", () => d.openTime());
    this.timeBtn.dataset.testid = "time-open";
    btn(this.rec, ICON.rec, t("Record a take: what you do, live — then Render › Video renders it at full quality"), "", () => d.record());
    this.rec.append(this.recTime);
    this.menu.hidden = true;
    this.el.append(
      this.play,
      slower,
      this.warpBtn,
      faster,
      this.rtBtn,
      this.autoBtn,
      h("i", "tp-sep"),
      this.clock,
      this.timeBtn,
      h("i", "tp-sep"),
      this.rec,
    );
    document.body.append(this.menu);
    addEventListener("pointerdown", (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node) && !this.warpBtn.contains(e.target as Node)) this.menu.hidden = true;
    });
  }

  /** Puts the bar in a container (compact: without the clock — the flight HUD shows its own). */
  mount(parent: HTMLElement, compact: boolean) {
    this.el.classList.toggle("compact", compact);
    if (this.el.parentElement !== parent) parent.append(this.el);
    this.update(true);
  }

  private toggleMenu() {
    const m = this.menu;
    m.hidden = !m.hidden;
    if (m.hidden) return;
    const s = this.d.settings;
    m.replaceChildren();
    const rt = realTimeSpeed(s);
    for (const w of [...warpLadder(s)].reverse()) {
      const b = h("button", "tp-mi");
      const x = w / rt;
      b.append(
        h("b", "", Math.abs(x - 1) < 1e-6 ? t("×1 real time") : fmtFactor(x)),
        h("small", "", `${+w.toPrecision(3)} M/s${w > 500 ? ` · ${t("rails")}` : ""}`),
      );
      b.classList.toggle("on", Math.abs(w - s.timeSpeed) <= 1e-6 * w);
      b.onclick = () => {
        this.d.setWarp(w);
        m.hidden = true;
        this.update(true);
      };
      m.append(b);
    }
    const r = this.warpBtn.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(innerWidth - 200, r.left + r.width / 2 - 95))}px`;
    const below = r.top < innerHeight / 2;
    m.style.top = below ? `${r.bottom + 8}px` : "";
    m.style.bottom = below ? "" : `${innerHeight - r.top + 8}px`;
    m.querySelector(".on")?.scrollIntoView({ block: "center" });
  }

  /** Refreshes the bar (cheap when nothing changed). */
  update(force = false) {
    const s = this.d.settings;
    const now = this.d.time();
    const rec = this.d.recording();
    const note = this.d.railsNote();
    const nw = this.d.nodeWarp();
    const clock = fmtClock(s, now);
    const key = [s.animate, s.timeSpeed, s.massSolar, clock.main, clock.sub, rec.on, Math.floor(rec.seconds), note, nw, s.autoWarp].join();
    if (!force && key === this.last) return;
    this.last = key;
    this.play.innerHTML = svg(s.animate ? ICON.pause : ICON.play);
    this.play.classList.toggle("paused", !s.animate);
    this.el.classList.toggle("paused", !s.animate);
    const x = warpFactor(s);
    this.warpMain.textContent = s.animate ? fmtWarp(s) : `❚❚ ${fmtWarp(s, false)}`;
    const man =
      nw === "auto" ? t("auto · manoeuvre") : nw === "held" ? t("max · manoeuvre") : nw === "manual" ? t("yours · manoeuvre") : "";
    this.warpSub.textContent =
      man || (note ? tf("rails ↓ {0}", note) : s.timeSpeed > 500 ? t("on rails") : `${+s.timeSpeed.toPrecision(3)} M/s`);
    this.warpBtn.classList.toggle("held", !!note || nw === "held");
    this.autoBtn.hidden = !nw;
    this.autoBtn.classList.toggle("on", s.autoWarp);
    this.rtBtn.classList.toggle("on", Math.abs(x - 1) < 1e-6);
    this.clockMain.textContent = clock.main;
    this.clockSub.textContent = clock.sub;
    this.clock.title = tf("Scene time {0} M · 1 M = {1} s", now.toFixed(3), secondsPerM(s).toPrecision(4));
    this.rec.classList.toggle("on", rec.on);
    this.recTime.textContent = rec.on || rec.frames ? `${rec.seconds.toFixed(1)} s` : "REC";
  }
}
