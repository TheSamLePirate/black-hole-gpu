// The loading screen: an animated black hole (CSS only — it keeps turning while the main thread is
// busy compiling the tracer), the start's stages with their progress, tips; lifted once the first
// image is on screen and the assets the scene needs are in (or on "Enter now"). Afterwards, assets
// loaded on demand show in a small pill.

import { loading, type Stage } from "../loading";
import { t } from "../i18n";
import { SplashGame } from "./splash-game";

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
  private game: SplashGame;
  private resolveLifted!: () => void;
  /** resolved when the loading screen has gone (messages wait for it) */
  readonly gone = new Promise<void>((r) => (this.resolveLifted = r));

  constructor(private root: HTMLElement) {
    this.game = new SplashGame(root);
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
    this.game.start();
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
      // (the launch kernel's compile — minutes, cold — is waited for: the menu opens on a scene that starts at once)
      const limit = loading.isActive("bg-prewarm") ? 600_000 : MAX_WAIT;
      if (!waiting || now - this.imageAt > limit) {
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
    this.game.stop();
    this.root.classList.add("done");
    this.pill.start();
    new SceneVeil().start();
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
      if (s.background) continue;
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
    const active = loading.pending;
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

/**
 * A scene whose tracer still compiles and nothing else can draw it: the last image stays on the screen, which looks
 * like a hang. A veil over it says so — only when the wait is not a blink (the stage up for a third of a second).
 */
class SceneVeil {
  private root = el("div", "scene-veil");
  private label = el("span", "sv-label");
  private note = el("small", "sv-note");
  private bar = el("i", "");
  private timer = 0;
  private raf = 0;
  private step = -1;

  /** what the wait says as it goes (by the fraction the bar shows): the screen is never the same for long */
  private static readonly STEPS: [number, string][] = [
    [0, t("Loading the scene…")],
    [0.2, t("Tracing the light's paths…")],
    [0.45, t("Bending space around the hole…")],
    [0.7, t("Compiling the ray tracer for your graphics card…")],
    [0.88, t("Almost there…")],
  ];

  start() {
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    this.note.textContent = t("The first time takes a while (up to a few minutes); the next ones reuse the browser's cache.");
    const track = el("span", "sv-bar");
    track.append(this.bar);
    // (the loading screen's own sky and black hole, CSS only: they keep turning while the scene compiles)
    const sky = el("div", "ld-sky");
    sky.setAttribute("aria-hidden", "true");
    sky.append(el("i", ""), el("i", ""));
    const hole = el("div", "ld-hole");
    hole.setAttribute("aria-hidden", "true");
    const part = (cls: string, inner: boolean) => {
      const d = el("div", cls);
      if (inner) d.append(el("i", ""));
      return d;
    };
    hole.append(part("ld-glow", false), part("ld-halo", true), part("ld-disk", true), part("ld-shadow", false), part("ld-disk front", true));
    this.root.append(sky, this.warp, hole, this.label, track, this.note);
    document.body.append(this.root);
    loading.on(() => this.update());
  }

  // ---- the flight: stars streaming past towards the camera (a canvas, drawn while the veil is up and while it leaves)
  private warp = el("canvas", "sv-warp");
  private stars = Array.from({ length: 240 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }));
  private speed = 0.25;
  private flyRaf = 0;
  private flyAt = 0;
  /** the leave's jump: the stars rush past while the veil fades */
  private jump = false;

  private fly = (now: number) => {
    this.flyRaf = 0;
    const dt = Math.min((now - (this.flyAt || now)) / 1000, 0.05);
    this.flyAt = now;
    const cv = this.warp;
    const w = (cv.width = cv.clientWidth);
    const h = (cv.height = cv.clientHeight);
    const g = cv.getContext("2d");
    if (!g || !w || !h) return;
    const s = loading.list().find((x) => x.id === "scene-tracer");
    const f = s && s.state === "active" ? loading.fracOf(s) : 1;
    // (the cruise quickens with the progress; the jump at the end quickens it much more)
    const target = this.jump ? 2.6 : 0.22 + 0.4 * f;
    this.speed += (target - this.speed) * Math.min(dt * 2.5, 1);
    const cx = w / 2;
    const cy = h * 0.4;
    const k = Math.max(w, h) * 0.55;
    g.lineCap = "round";
    for (const st of this.stars) {
      const before = st.z + this.speed * dt * 2.2;
      st.z -= this.speed * dt;
      if (st.z <= 0.03) {
        st.x = Math.random() * 2 - 1;
        st.y = Math.random() * 2 - 1;
        st.z = 1;
        continue;
      }
      const x1 = cx + (st.x / st.z) * k * 0.3;
      const y1 = cy + (st.y / st.z) * k * 0.3;
      const x0 = cx + (st.x / before) * k * 0.3;
      const y0 = cy + (st.y / before) * k * 0.3;
      if (x1 < -50 || x1 > w + 50 || y1 < -50 || y1 > h + 50) {
        st.z = 1;
        continue;
      }
      const near = 1 - st.z;
      g.strokeStyle = `rgba(${st.x > 0 ? "255,236,210" : "205,224,255"},${(0.15 + 0.85 * near).toFixed(2)})`;
      g.lineWidth = 0.6 + 2 * near;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    // (the hole grows as the scene gets ready: the flight brings it nearer)
    this.root.style.setProperty("--sv-k", (0.62 + 0.45 * f).toFixed(3));
    if (this.root.classList.contains("show") || this.jump) this.flyRaf = requestAnimationFrame(this.fly);
  };

  private startFlight() {
    this.jump = false;
    this.speed = 0.22;
    this.flyAt = 0;
    if (!this.flyRaf) this.flyRaf = requestAnimationFrame(this.fly);
  }

  /** the scene is ready: the rush, while the veil fades; then still */
  private endFlight() {
    this.jump = true;
    if (!this.flyRaf) this.flyRaf = requestAnimationFrame(this.fly);
    setTimeout(() => (this.jump = false), 1200);
  }

  private frame = () => {
    this.raf = 0;
    const s = loading.list().find((x) => x.id === "scene-tracer");
    if (!s || s.state !== "active" || !this.root.classList.contains("show")) return;
    const f = loading.fracOf(s);
    this.bar.style.transform = `scaleX(${f.toFixed(3)})`;
    let step = 0;
    SceneVeil.STEPS.forEach(([at], i) => f >= at && (step = i));
    if (step !== this.step) {
      this.step = step;
      this.label.textContent = SceneVeil.STEPS[step]![1];
      // (restart the fade-in)
      this.label.classList.remove("in");
      void this.label.offsetWidth;
      this.label.classList.add("in");
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private update() {
    const waiting = loading.isActive("scene-tracer");
    if (waiting && !this.timer && !this.root.classList.contains("show")) this.timer = window.setTimeout(() => this.show(), 350);
    if (!waiting) {
      clearTimeout(this.timer);
      this.timer = 0;
      if (this.root.classList.contains("show")) this.endFlight();
      this.root.classList.remove("show");
    }
  }

  private show() {
    this.timer = 0;
    if (!loading.isActive("scene-tracer")) return;
    this.step = -1;
    this.root.classList.add("show");
    this.startFlight();
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }
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
    const show = loading.pending.length + loading.background.length > 0;
    if (show === this.on && !show) return;
    this.on = show;
    this.root.classList.toggle("show", show);
    if (show && !this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = () => {
    this.raf = 0;
    const pending = [...loading.pending, ...loading.background];
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
