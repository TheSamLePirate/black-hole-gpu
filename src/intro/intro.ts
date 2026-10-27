// The intro (PLAN-TITRE-AAA E1), in place of the old loading screen: its sequence plays in CSS from the page's first
// paint (index.html, intro.css) — black, the studio, the name, the logo —; this starts its Worker (the background,
// the orb: src/intro/worker.ts), follows the boot's stages (the orb's state, the stage, the percentage, the detail
// on a click), lets a key, a click or a touch pass the sequence, hands the name over to the title's logo when the
// sequence ends, and lifts it all onto the live scene once its first image and the assets it needs (its sky) are in
// — or on "Enter now". Afterwards, assets loaded on demand show in a small pill.

import { t, tf } from "../i18n";
import { loading, type Stage } from "../loading";
import { store } from "../util/storage";
import { drawOrb, type OrbState, orbStateFor } from "./orb";
import { IntroPainter } from "./painter";
import type { IntroMessage } from "./worker";

/** the sequence's lengths [ms] (intro.css: the full one's last move ends at 6.8 s, the short one's at 1.6 s) */
export const FULL_MS = 6500;
export const SHORT_MS = 1500;
/** after the first image: at most this long for the remaining assets [ms] */
const MAX_WAIT = 12000;
/** the orb's size in CSS pixels (intro.css .in-orb) */
const ORB_PX = 64;
/** the mark kept once the full intro was seen, and the build it was seen in */
const SEEN = "kerr.intro.seen";
const SEEN_BUILD = "kerr.intro.build";

const fmtMB = (b: number) => (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The build now (version.json's): a mark seen in another build is cleared — the next start plays it whole. */
export function introBuild(build: string) {
  const before = store.get(SEEN_BUILD);
  if (before && before !== build) store.remove(SEEN);
  store.set(SEEN_BUILD, build);
}

export class Intro {
  private root: HTMLElement;
  private stageEl: HTMLElement;
  private pctEl: HTMLElement;
  private steps: HTMLElement;
  private orbBtn: HTMLButtonElement;
  private enter: HTMLButtonElement;
  private note: HTMLElement;
  private rows = new Map<string, { li: HTMLElement; info: HTMLElement }>();
  private shown = 0;
  private imageAt = 0;
  private lifted = false;
  private ended = false;
  private docked = false;
  private skipWanted = false;
  private orb: OrbState | null = null;
  private worker: Worker | null = null;
  private painter: IntroPainter | null = null;
  private pill = new AssetPill();
  private resolveGone!: () => void;
  private resolvePlayed!: () => void;
  /** resolved when the intro has gone (messages wait for it) */
  readonly gone = new Promise<void>((r) => (this.resolveGone = r));
  /** resolved when the sequence has played (or was passed): the title may show */
  readonly played = new Promise<void>((r) => (this.resolvePlayed = r));
  /** what drew the background: the Worker's word ("webgl2", "2d", "none"), "page" when drawn here, null: not yet */
  private bgMode: string | null = null;

  /** Where it stands (__bh.intro(): the tests). */
  status() {
    return {
      bg: this.bgMode,
      orb: this.orb,
      ended: this.ended,
      skipped: this.root.classList.contains("skip"),
      docked: this.docked,
      lifted: this.lifted,
      short: document.documentElement.classList.contains("intro-short"),
    };
  }

  /** where the name and the emblem glide at the sequence's end (the title's), or null: no title open */
  dockTo: () => { name: HTMLElement | null; mark: HTMLElement | null } | null = () => null;

  constructor(root: HTMLElement) {
    this.root = root;
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s);
    if (!q(".in-bg")) {
      // (no intro — a hot reload after it was lifted: nothing to show)
      this.stageEl = this.pctEl = this.steps = this.note = document.createElement("div");
      this.orbBtn = this.enter = document.createElement("button");
      this.lifted = this.ended = this.docked = true;
      this.resolvePlayed();
      this.resolveGone();
      this.pill.start();
      return;
    }
    this.stageEl = q(".ld-stage")!;
    this.pctEl = q(".ld-pct")!;
    this.steps = q(".in-steps")!;
    this.orbBtn = q<HTMLButtonElement>(".in-orb-btn")!;
    this.enter = q<HTMLButtonElement>(".in-enter")!;
    this.note = q(".in-note")!;
    document.body.classList.add("intro-play");
    this.startPainter(q<HTMLCanvasElement>(".in-bg")!, q<HTMLCanvasElement>(".in-orb")!);
    const html = document.documentElement.classList;
    setTimeout(() => this.endSequence(), html.contains("intro-still") ? 0 : html.contains("intro-short") ? SHORT_MS : FULL_MS);
    // (passing it: any key, a click, a touch — taken here, not given to the title under it)
    addEventListener("keydown", this.onKey, true);
    root.addEventListener("pointerdown", () => this.skip());
    this.orbBtn.onclick = (e) => {
      e.stopPropagation();
      const open = this.steps.hidden;
      this.steps.hidden = !open;
      this.orbBtn.setAttribute("aria-expanded", String(open));
    };
    this.orbBtn.title = t("The loading's detail");
    this.enter.onclick = (e) => {
      e.stopPropagation();
      this.wantLift();
    };
    // (during a slow compile one can queue entry: acted on at the first image — never a black page over an
    // unwired HUD, plan §2.1-D)
    setTimeout(() => {
      if (this.lifted || this.imageAt) return;
      this.enter.textContent = t("Enter when the first image is ready");
      this.enter.hidden = false;
    }, 9000);
    loading.on(() => this.renderSteps());
    requestAnimationFrame(this.tick);
  }

  /** The background and the orb: in a Worker on OffscreenCanvas, else in the page. */
  private startPainter(bg: HTMLCanvasElement, orb: HTMLCanvasElement) {
    const size = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 };
    const offscreen = typeof bg.transferControlToOffscreen === "function" && typeof Worker === "function";
    if (offscreen) {
      try {
        const w = new Worker(new URL("intro-worker.js", location.href), { type: "module" });
        const ob = bg.transferControlToOffscreen();
        const oo = orb.transferControlToOffscreen();
        const init: IntroMessage = { type: "init", bg: ob, orb: oo, ...size, orbPx: ORB_PX };
        w.postMessage(init, [ob, oo]);
        w.onerror = (e) => console.warn("The intro's Worker failed — its background stays black:", e.message);
        w.onmessage = (e: MessageEvent<{ type: string; mode?: string }>) => {
          if (e.data.type === "ready") this.bgMode = this.root.dataset.bg = e.data.mode ?? "none";
        };
        this.worker = w;
      } catch (e) {
        console.warn("The intro's Worker could not start:", e);
      }
    } else {
      this.painter = new IntroPainter({ bg, orb, ...size, orbPx: ORB_PX });
      this.painter.run();
      this.bgMode = this.root.dataset.bg = `page ${this.painter.mode}`;
    }
    addEventListener("resize", this.onResize);
  }

  private onResize = () => {
    const m: IntroMessage = { type: "size", w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 };
    this.worker?.postMessage(m);
    this.painter?.size(m.w, m.h, m.dpr);
  };

  private setOrb(state: OrbState | null) {
    if (state === this.orb) return;
    this.orb = state;
    // (on the element too: the tests read it before __bh is there)
    this.root.dataset.orb = state ?? "";
    const m: IntroMessage = { type: "orb", state };
    this.worker?.postMessage(m);
    this.painter?.setOrb(state);
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.ended || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.skip();
  };

  /** The sequence passed: its end state at once. */
  skip() {
    if (this.ended) return;
    this.root.classList.add("skip");
    this.endSequence();
  }

  private endSequence() {
    if (this.ended) return;
    this.ended = true;
    removeEventListener("keydown", this.onKey, true);
    if (!document.documentElement.classList.contains("intro-still")) store.set(SEEN, "1");
    document.body.classList.remove("intro-play");
    this.dock();
    this.resolvePlayed();
  }

  /**
   * The name handed over to the title's logo (it glides there; the logo, the line and the foot go): at the
   * sequence's end, or when the title opens after it. Nothing while the sequence plays, or with no title open.
   */
  dock() {
    if (!this.ended || this.docked || this.lifted) return;
    const target = this.dockTo();
    if (!target?.name) return;
    this.docked = true;
    document.body.classList.add("intro-docking");
    this.root.classList.add("docking");
    // (each glides and scales onto its place: the same type, the same picture — they match there)
    const glide = (from: HTMLElement | null, to: HTMLElement | null) => {
      if (!from || !to) return;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      if (!a.width) return;
      from.style.transformOrigin = "0 0";
      from.style.transition = "transform 0.9s cubic-bezier(0.16, 1, 0.3, 1)";
      from.style.transform = `translate(${(b.left - a.left).toFixed(1)}px, ${(b.top - a.top).toFixed(1)}px) scale(${(b.width / a.width).toFixed(4)})`;
    };
    glide(this.root.querySelector<HTMLElement>(".in-name"), target.name);
    glide(this.root.querySelector<HTMLElement>(".in-mark"), target.mark);
    setTimeout(() => {
      this.root.classList.add("docked");
      this.root.dataset.docked = "1";
      document.body.classList.remove("intro-docking");
    }, 900);
  }

  /** A launch chosen on the title before the game is there: said under the orb until it runs (null: no more). */
  launching(label: string | null) {
    if (this.lifted) return;
    this.note.textContent = label ? tf("Launching: {0} — as soon as the game is ready", label) : "";
    this.note.hidden = !label;
  }

  /** "Enter now" (or before the first image: as soon as it is there). */
  private wantLift() {
    if (this.imageAt) return this.lift();
    this.skipWanted = true;
    this.enter.disabled = true;
    this.enter.textContent = t("Entering as soon as the first image is ready…");
  }

  /** No first image after 3 min (main.ts): the graphics card is still compiling the tracer — said under the orb.
   *  No reload offered: a compile cut short is not cached, a reload would start it over. */
  slowStart() {
    if (this.lifted || this.imageAt) return;
    this.note.textContent = t(
      "Still compiling the ray tracer for this graphics card. The first time can take several minutes (Windows especially); the next starts reuse the browser's cache.",
    );
    this.note.hidden = false;
    this.enter.hidden = false;
  }

  /** The first image is on screen. */
  firstImage() {
    if (this.imageAt) return;
    this.imageAt = performance.now();
    this.enter.disabled = false;
    this.enter.textContent = t("Enter now");
    loading.done("pipelines");
    if (this.skipWanted) this.lift();
  }

  private tick = () => {
    if (this.lifted) return;
    const now = performance.now();
    const p = loading.progress(now);
    // (never backwards — a stage registered late lowers the true fraction)
    this.shown = Math.max(this.shown, Math.min(p, this.imageAt ? 1 : 0.97));
    const pct = Math.floor(this.shown * 100);
    this.pctEl.textContent = `${pct} %`;
    this.root.setAttribute("aria-valuenow", String(pct));
    this.renderInfo(now);
    if (this.imageAt) {
      const waiting = loading.pending.length > 0;
      this.enter.hidden = !waiting;
      // (in once the sequence has played, the image is there and its assets — its sky — too)
      if (this.ended && (!waiting || now - this.imageAt > MAX_WAIT)) {
        this.pctEl.textContent = "100 %";
        this.lift();
        return;
      }
    }
    requestAnimationFrame(this.tick);
  };

  private lift() {
    if (this.lifted) return;
    this.lifted = true;
    if (!this.ended) this.skip();
    removeEventListener("resize", this.onResize);
    this.root.classList.add("done");
    this.setOrb(null);
    this.pill.start();
    setTimeout(() => this.resolveGone(), 700);
    setTimeout(() => {
      const stop: IntroMessage = { type: "stop" };
      this.worker?.postMessage(stop);
      this.worker = null;
      this.painter?.stop();
      this.painter = null;
      this.root.remove();
    }, 1300);
  }

  private renderSteps() {
    if (this.lifted) return;
    const list = loading.list();
    for (const s of list) {
      let row = this.rows.get(s.id);
      if (!row) {
        const li = el("li", "in-step");
        li.append(el("b", ""), el("span", "", s.label));
        const info = el("small", "");
        li.append(info);
        this.steps.append(li);
        row = { li, info };
        this.rows.set(s.id, row);
      }
      row.li.dataset.state = s.state;
      if (s.state === "failed") row.li.title = s.error ?? "";
    }
    const active = list.filter((s) => s.state === "active");
    // (the heaviest stage still running names the wait)
    const lead = [...active].sort((a, b) => b.weight - a.weight)[0];
    this.stageEl.textContent = lead ? `${lead.label}…` : this.imageAt ? t("Ready") : t("Almost there…");
    this.setOrb(
      orbStateFor(
        active.map((s) => s.id),
        !!this.imageAt,
      ),
    );
  }

  private renderInfo(now: number) {
    if (this.steps.hidden) return;
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
  return loading.describe(s, now);
}

/** Assets loaded on demand, after the start: a small pill with their progress — the loading orb at its head
 *  (PLAN-TITRE-AAA E10: the intro's orb, its state from the stages: a compile solving, a download searching). */
class AssetPill {
  private root = el("div", "asset-pill");
  private label = el("span", "ap-label");
  private bar = el("i", "");
  private orb = document.createElement("canvas");
  private orbCtx: CanvasRenderingContext2D | null = null;
  private on = false;
  private raf = 0;
  private t0 = performance.now();

  constructor() {
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    const track = el("span", "ap-bar");
    track.append(this.bar);
    this.orb.className = "ap-orb";
    this.orb.width = this.orb.height = 40;
    this.orbCtx = this.orb.getContext("2d");
    this.root.append(this.orb, this.label, track);
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
    if (this.orbCtx) {
      this.orbCtx.clearRect(0, 0, 40, 40);
      drawOrb(
        this.orbCtx,
        orbStateFor(
          pending.map((x) => x.id),
          false,
        ),
        0,
        0,
        40,
        (now - this.t0) / 1000,
      );
    }
    this.label.textContent = `${s.label} · ${info(s, now)}`;
    this.bar.style.transform = `scaleX(${loading.fracOf(s, now).toFixed(3)})`;
    this.raf = requestAnimationFrame(this.frame);
  };
}
