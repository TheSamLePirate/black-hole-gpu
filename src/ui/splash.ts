// The loading screen: an animated black hole (CSS only — it keeps turning while the main thread is
// busy compiling the tracer), the start's stages with their progress, tips; lifted once the first
// image is on screen and the assets the scene needs are in (or on "Enter now"). Afterwards, assets
// loaded on demand show in a small pill.

import { loading, type Stage } from "../loading";
import { t } from "../i18n";

const TIPS = [
  t("Drag to orbit, wheel to zoom — click a body to target it, double-click to fly to it."),
  t("? lists every shortcut. The flight keys follow the keys' positions: ZQSD on AZERTY, WASD on QWERTY."),
  t("The Scenes button (bottom left): the black holes, the wormhole, the Gargantua system and the game's missions."),
  t("Escape pauses the game: save, load, the settings. F5 and F9: the quick save."),
  t("Flying: M the map, O the mission planner, U take off, ⇧G entry and landing on a runway."),
  t("Free camera: T the journey through the wormhole — Saturn, the throat, then Gargantua's side."),
  t("Every image is traced along Kerr geodesics: the disk, the stars and the planets are bent by the hole."),
  t("Your flight is saved as you go: it resumes where you left it."),
];
/** after the first image: at most this long for the remaining assets [ms] */
const MAX_WAIT = 12000;

const fmtMB = (b: number) => (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Splash {
  private bar: HTMLElement;
  private stageEl: HTMLElement;
  private pctEl: HTMLElement;
  private steps: HTMLElement;
  private skip: HTMLButtonElement;
  private tipEl: HTMLElement;
  private rows = new Map<string, { li: HTMLElement; info: HTMLElement }>();
  private shown = 0;
  private imageAt = 0;
  private lifted = false;
  private tip = 0;
  private tipTimer = 0;
  private pill = new AssetPill();
  private resolveLifted!: () => void;
  /** resolved when the loading screen has gone (messages wait for it) */
  readonly gone = new Promise<void>((r) => (this.resolveLifted = r));

  constructor(private root: HTMLElement) {
    if (!root.querySelector(".ld-bar")) {
      // (no loading screen — a hot reload after it was lifted: nothing to show)
      this.bar = this.stageEl = this.pctEl = this.steps = this.tipEl = document.createElement("div");
      this.skip = document.createElement("button");
      this.lifted = true;
      this.resolveLifted();
      this.pill.start();
      return;
    }
    this.bar = root.querySelector(".ld-bar i")!;
    this.stageEl = root.querySelector(".ld-stage")!;
    this.pctEl = root.querySelector(".ld-pct")!;
    this.steps = root.querySelector(".ld-steps")!;
    this.skip = root.querySelector(".ld-skip")!;
    this.tipEl = root.querySelector(".ld-tip")!;
    this.skip.onclick = () => this.wantSkip();
    this.tip = Math.floor(Math.random() * TIPS.length);
    this.showTip();
    this.tipTimer = window.setInterval(() => this.showTip(), 5200);
    // (during a slow compile the user can queue entry: without an image yet the click is
    // remembered and acted on at the first image — never a black page over an unwired HUD (plan §2.1-D))
    setTimeout(() => {
      if (this.lifted || this.imageAt) return;
      this.skip.textContent = t("Enter when the first image is ready");
      this.skip.hidden = false;
    }, 9000);
    loading.on(() => this.renderSteps());
    requestAnimationFrame(this.tick);
  }

  /** a skip asked for before the first image: acted on when it arrives */
  private skipWanted = false;

  /** Skip asked for before the first image (a slow compile): acknowledged, done at the first image. */
  private wantSkip() {
    if (this.imageAt) return this.lift();
    this.skipWanted = true;
    this.skip.disabled = true;
    this.skip.textContent = t("Entering as soon as the first image is ready…");
  }

  /** No first image after 3 min (main.ts): the graphics card is still compiling the tracer — said in place
   *  of the tips. No reload offered: a compile cut short is not cached, a reload would start it over. */
  slowStart() {
    if (this.lifted || this.imageAt) return;
    clearInterval(this.tipTimer);
    this.tipEl.textContent = t(
      "Still compiling the ray tracer for this graphics card. The first time can take several minutes (Windows especially); the next starts reuse the browser's cache.",
    );
    this.skip.hidden = false;
  }

  /** The first image is on screen. */
  firstImage() {
    if (this.imageAt) return;
    this.imageAt = performance.now();
    this.skip.disabled = false;
    this.skip.textContent = t("Enter now");
    loading.done("pipelines");
    // (a skip asked for during the compile: in now, the remaining assets under the pill)
    if (this.skipWanted) this.lift();
  }

  private tick = () => {
    if (this.lifted) return;
    const now = performance.now();
    const p = loading.progress(now);
    // (never backwards — a stage registered late lowers the true fraction)
    this.shown = Math.max(this.shown, Math.min(p, this.imageAt ? 1 : 0.97));
    this.bar.style.transform = `scaleX(${this.shown.toFixed(4)})`;
    const pct = Math.floor(this.shown * 100);
    this.pctEl.textContent = `${pct} %`;
    this.root.setAttribute("aria-valuenow", String(pct));
    this.renderInfo(now);
    if (this.imageAt) {
      const waiting = loading.pending.length > 0;
      this.skip.hidden = !waiting;
      if (!waiting || now - this.imageAt > MAX_WAIT) {
        // (a beat on the full bar, then in)
        this.bar.style.transform = "scaleX(1)";
        this.pctEl.textContent = "100 %";
        setTimeout(() => this.lift(), 280);
        this.lifted = true;
        return;
      }
    }
    requestAnimationFrame(this.tick);
  };

  private lift() {
    this.lifted = true;
    clearInterval(this.tipTimer);
    this.root.classList.add("done");
    this.pill.start();
    setTimeout(() => this.resolveLifted(), 700);
    setTimeout(() => this.root.remove(), 1100);
  }

  private showTip() {
    this.tipEl.classList.remove("in");
    // (restart the fade)
    void this.tipEl.offsetWidth;
    this.tipEl.textContent = TIPS[this.tip++ % TIPS.length]!;
    this.tipEl.classList.add("in");
  }

  private renderSteps() {
    if (this.lifted) return;
    for (const s of loading.list()) {
      let row = this.rows.get(s.id);
      if (!row) {
        const li = el("li", "ld-step");
        li.append(el("b", "ld-dot"), el("span", "ld-label", s.label));
        const info = el("small", "ld-info");
        li.append(info);
        this.steps.append(li);
        row = { li, info };
        this.rows.set(s.id, row);
      }
      row.li.dataset.state = s.state;
      if (s.state === "failed") row.li.title = s.error ?? "";
    }
    const active = loading.list().filter((s) => s.state === "active");
    // (the heaviest stage still running names the wait)
    const lead = active.sort((a, b) => b.weight - a.weight)[0];
    this.stageEl.textContent = lead ? `${lead.label}…` : this.imageAt ? t("Ready") : t("Almost there…");
  }

  private renderInfo(now: number) {
    for (const s of loading.list()) {
      const row = this.rows.get(s.id);
      if (row) row.info.textContent = info(s, now);
    }
  }
}

function info(s: Stage, now: number) {
  if (s.state === "failed") return t("unavailable");
  if (s.state === "done") return s.total ? `${fmtMB(s.total)} MB` : "✓";
  if (s.total) return `${fmtMB(s.loaded)} / ${fmtMB(s.total)} MB`;
  if (s.loaded) return `${fmtMB(s.loaded)} MB`;
  return `${Math.floor(100 * loading.fracOf(s, now))} %`;
}

/** Assets loaded on demand, after the start: a small pill with their progress. */
class AssetPill {
  private root = el("div", "asset-pill");
  private label = el("span", "ap-label");
  private bar = el("i", "");
  private on = false;
  private raf = 0;

  constructor() {
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    const track = el("span", "ap-bar");
    track.append(this.bar);
    this.root.append(el("b", "ap-spin"), this.label, track);
  }

  start() {
    document.body.append(this.root);
    loading.on(() => this.update());
    this.update();
  }

  private update() {
    const pending = loading.pending;
    const show = pending.length > 0;
    if (show === this.on && !show) return;
    this.on = show;
    this.root.classList.toggle("show", show);
    if (show && !this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = () => {
    this.raf = 0;
    const pending = loading.pending;
    if (!pending.length) {
      this.root.classList.remove("show");
      this.on = false;
      return;
    }
    const s = pending[0]!;
    const now = performance.now();
    this.label.textContent = `${s.label} · ${info(s, now)}`;
    this.bar.style.transform = `scaleX(${loading.fracOf(s, now).toFixed(3)})`;
    this.raf = requestAnimationFrame(this.frame);
  };
}
