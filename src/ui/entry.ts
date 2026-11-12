// The way into the game (PLAN-TITRE-AAA E10): LAUNCH slides the menu out and fades to black (400 ms); the launch
// runs under the black; if the scene's ray tracer compiles, a scene loading screen holds it — the launch's
// picture, the orb, the stage, a tip of the mode —; then a fade from the black and the HUD lights up, element by
// element (600 ms). The veil says where it stands (data-phase) for the tests. Under reduced motion: no slide, the
// fades short. CM3 (docs/PLAN-CHARGEMENT-MONDE.md): a launch low over the Earth also waits for its ground — the Earth's maps
// and the relief's coarse levels round the craft —, EARTH_WAIT_MS at most from the launch; past it the veil lifts as before and
// says so (lastWait, data-earth, a console warning).

import { drawOrb, orbStateFor } from "../intro/orb";
import { type Text, tr } from "../i18n";
import { loading } from "../loading";
import { el, h } from "./kit";
import { type TipSet, tipOf } from "./pausemenu";

export interface EntryShow {
  /** the launch's name, its picture (a URL), its mode's tips */
  title: string;
  art?: string;
  tips: TipSet;
}

const T = {
  tip: { fr: "Astuce", en: "Tip" },
  compiling: { fr: "Le tracé de rayons de cette scène se compile", en: "This scene's ray tracer is compiling" },
  ground: { fr: "Le sol du départ se charge", en: "The departure's ground is loading" },
  // (said once a compile has run a while: what it is, that it happens once — docs/PLAN-LEAN-TRACER-KERNELS.md P2)
  firstTime: {
    fr: "Première fois sur cet ordinateur : le tracé de rayons est compilé pour votre carte graphique, une seule fois — quelques minutes sur certains PC. Les lancements suivants seront rapides.",
    en: "First time on this computer: the ray tracer is being compiled for your graphics card, once — a few minutes on some PCs. Later launches will be fast.",
  },
} satisfies Record<string, Text>;

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frames = (n: number) =>
  new Promise<void>((r) => {
    const f = () => (--n <= 0 ? r() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  });

/** the scene's tracer compiling (renderer.ts's stage), the stages showing now */
const tracing = () => loading.isActive("scene-tracer");
/** CM3: the longest the veil waits for the departure's ground (the Earth's maps, the coarse relief) after the launch */
export const EARTH_WAIT_MS = 15_000;

/** CM3: what the last entry waited for — the departure's ground: "none" (not a launch low over the Earth), "ready", "timeout"
 *  (the veil lifted without it) —, and how long the veil held after the launch [ms] */
export type EntryWait = { earth: "none" | "ready" | "timeout"; ms: number };

export class GameEntry {
  private veil: HTMLElement | null = null;
  private tipN = Math.floor(Math.random() * 100);

  get busy() {
    return !!this.veil;
  }
  /** CM3: the last entry's wait (null: none yet) */
  lastWait: EntryWait | null = null;

  /** The launch run under a fade to black, a loading screen while its scene compiles — and, CM3, while the departure's ground
   *  comes (`earth`: true in, false not yet, null nothing to wait for; EARTH_WAIT_MS at most) —, a fade back and the HUD. */
  async play(show: EntryShow, launch: () => void, earth?: () => boolean | null): Promise<void> {
    if (this.veil) return launch();
    const quick = reduced();
    const veil = h("div", { class: "en-veil", "data-testid": "entry", "data-phase": "in", "aria-hidden": "true" });
    this.veil = veil;
    document.body.append(veil);
    void veil.offsetWidth;
    veil.classList.add("on");
    await sleep(quick ? 80 : 420);
    let err: unknown = null;
    try {
      launch();
    } catch (e) {
      err = e;
    }
    const t0 = performance.now();
    // (the scene's tracer, if it compiles, says so within a few frames — the craft's place known to the renderer by then)
    await frames(4);
    await sleep(60);
    const holding = () => tracing() || (earth?.() === false && performance.now() - t0 < EARTH_WAIT_MS);
    if (!err && holding()) await this.loadingScreen(veil, show, holding);
    const e = err ? null : (earth?.() ?? null);
    this.lastWait = { earth: e === null ? "none" : e ? "ready" : "timeout", ms: Math.round(performance.now() - t0) };
    veil.dataset.earth = this.lastWait.earth;
    if (e === false)
      console.warn(`Entry: the departure's ground not in after ${EARTH_WAIT_MS / 1000} s — the veil lifted without it (CM3)`);
    // (the new view drawn once before the black lifts)
    await frames(2);
    veil.dataset.phase = "out";
    veil.classList.add("out");
    document.body.classList.add("hud-boot");
    await sleep(quick ? 80 : 520);
    veil.remove();
    this.veil = null;
    setTimeout(() => document.body.classList.remove("hud-boot"), 700);
    if (err) throw err;
  }

  /** The scene loading screen, while the tracer compiles (at most 90 s) — or the departure's ground comes (CM3) —: its picture,
   *  the orb, the stage, a tip. */
  private async loadingScreen(veil: HTMLElement, show: EntryShow, holding: () => boolean) {
    veil.dataset.phase = "loading";
    const canvas = h("canvas", { class: "en-orb", width: "192", height: "192" }) as HTMLCanvasElement;
    const stage = el("p", "en-stage", tr(T.compiling));
    const first = el("p", "en-first", tr(T.firstTime));
    first.hidden = true;
    const card = h(
      "div",
      { class: "en-card", "data-testid": "entry-loading" },
      show.art ? h("img", { class: "en-art", src: show.art, alt: "" }) : null,
      h(
        "div",
        { class: "en-front" },
        el("h2", "en-title", show.title),
        canvas,
        stage,
        first,
        h("p", { class: "en-tip" }, el("span", "pz-k", tr(T.tip)), tr(tipOf(show.tips, this.tipN++))),
      ),
    );
    veil.append(card);
    const ctx = canvas.getContext("2d");
    const t0 = performance.now();
    let raf = 0;
    const draw = () => {
      const now = performance.now();
      const ids = loading.pending.map((s) => s.id);
      if (ctx) {
        ctx.clearRect(0, 0, 192, 192);
        drawOrb(ctx, orbStateFor(ids, false), 0, 0, 192, (now - t0) / 1000, Math.min(1, (now - t0) / 400));
      }
      const p = loading.pending.find((s) => s.id === "scene-tracer") ?? loading.pending[0];
      if (p) {
        const d = loading.describe(p, now);
        stage.textContent = d ? `${p.label} · ${d}` : p.label;
        // (a compile that runs past 12 s: not the browser's shader cache — said what it is, and that it is once)
        first.hidden = !(p.id === "scene-tracer" && now - p.startedAt > 12_000);
      } else if (!tracing()) {
        // (CM3: the tracer ready, the departure's relief still coming)
        stage.textContent = tr(T.ground);
        first.hidden = true;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    // (seen at least 700 ms: no flash)
    const until = performance.now() + 90_000;
    await sleep(700);
    while (holding() && performance.now() < until) await sleep(100);
    cancelAnimationFrame(raf);
  }
}
