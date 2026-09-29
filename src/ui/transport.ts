// The transport bar: the scene's time in every mode — run / pause, the warp along its ladder (a menu to
// jump to any rung), real time, the clock (a date in the game's world), and the take recorder (the
// live view recorded, rendered afterwards as a video). One widget: over the toolbar without the ship,
// in the mission bar while flying (the flight HUD gives it its slot).

import type { Settings } from "../settings";
import { fmtClock, fmtFactor, fmtWarp, realTimeSpeed, secondsPerM, warpFactor, warpLadder } from "../clock";

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
}

const ICON = {
  play: '<path d="M8 5.5v13l10.5-6.5z" class="f"/>',
  pause: '<rect x="7" y="5.5" width="3.6" height="13" rx="1" class="f"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1" class="f"/>',
  slower: '<path d="M11.5 7l-5 5 5 5M18 7l-5 5 5 5"/>',
  faster: '<path d="M12.5 7l5 5-5 5M6 7l5 5-5 5"/>',
  rec: '<circle cx="12" cy="12" r="5.2" class="f"/>',
};

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export class TransportBar {
  readonly el = h("div", "tp");
  private play = h("button", "tp-btn tp-play");
  private warpBtn = h("button", "tp-warp");
  private warpMain = h("b");
  private warpSub = h("small");
  private rtBtn = h("button", "tp-btn tp-rt", "1×");
  private clock = h("div", "tp-clock");
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
    btn(this.play, ICON.play, "Run / pause time — every mode (paused: the image refines)", "Space", () => d.playPause());
    const slower = btn(h("button", "tp-btn"), ICON.slower, "Slower time", ",", () => d.warp(-1));
    const faster = btn(h("button", "tp-btn"), ICON.faster, "Faster time", ".", () => d.warp(1));
    btn(this.rtBtn, "", "Real time: a second per second", "/", () => d.realTime());
    this.warpBtn.append(this.warpMain, this.warpSub);
    this.warpBtn.dataset.tip = "Time warp — a click: every rung";
    this.warpBtn.onclick = () => this.toggleMenu();
    this.clock.append(this.clockMain, this.clockSub);
    btn(this.rec, ICON.rec, "Record a take: what you do, live — then Render › Video renders it at full quality", "", () => d.record());
    this.rec.append(this.recTime);
    this.menu.hidden = true;
    this.el.append(this.play, slower, this.warpBtn, faster, this.rtBtn, h("i", "tp-sep"), this.clock, h("i", "tp-sep"), this.rec);
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
      b.append(h("b", "", Math.abs(x - 1) < 1e-6 ? "×1 real time" : fmtFactor(x)), h("small", "", `${+w.toPrecision(3)} M/s${w > 500 ? " · rails" : ""}`));
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
    const t = this.d.time();
    const rec = this.d.recording();
    const note = this.d.railsNote();
    const clock = fmtClock(s, t);
    const key = [s.animate, s.timeSpeed, s.massSolar, clock.main, clock.sub, rec.on, Math.floor(rec.seconds), note].join();
    if (!force && key === this.last) return;
    this.last = key;
    this.play.innerHTML = svg(s.animate ? ICON.pause : ICON.play);
    this.play.classList.toggle("paused", !s.animate);
    this.el.classList.toggle("paused", !s.animate);
    const x = warpFactor(s);
    this.warpMain.textContent = s.animate ? fmtWarp(s) : `❚❚ ${fmtWarp(s, false)}`;
    this.warpSub.textContent = note ? `rails ↓ ${note}` : s.timeSpeed > 500 ? "on rails" : `${+s.timeSpeed.toPrecision(3)} M/s`;
    this.warpBtn.classList.toggle("held", !!note);
    this.rtBtn.classList.toggle("on", Math.abs(x - 1) < 1e-6);
    this.clockMain.textContent = clock.main;
    this.clockSub.textContent = clock.sub;
    this.clock.title = `Scene time ${t.toFixed(3)} M · 1 M = ${secondsPerM(s).toPrecision(4)} s`;
    this.rec.classList.toggle("on", rec.on);
    this.recTime.textContent = rec.on || rec.frames ? `${rec.seconds.toFixed(1)} s` : "REC";
  }
}
