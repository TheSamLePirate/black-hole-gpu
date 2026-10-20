// The way into the game (PLAN-TITRE-AAA E10): LAUNCH slides the menu out and fades to black (400 ms); the launch
// runs under the black; if the scene's ray tracer compiles, a scene loading screen holds it — the launch's
// picture, the orb, the stage, a tip of the mode —; then a fade from the black and the HUD lights up, element by
// element (600 ms). The veil says where it stands (data-phase) for the tests. Under reduced motion: no slide, the
// fades short.

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

export class GameEntry {
  private veil: HTMLElement | null = null;
  private tipN = Math.floor(Math.random() * 100);

  get busy() {
    return !!this.veil;
  }

  /** The launch run under a fade to black, a loading screen while its scene compiles, a fade back and the HUD. */
  async play(show: EntryShow, launch: () => void): Promise<void> {
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
    // (the scene's tracer, if it compiles, says so within a few frames)
    await frames(4);
    await sleep(60);
    if (!err && tracing()) await this.loadingScreen(veil, show);
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

  /** The scene loading screen, while the tracer compiles (at most 90 s): its picture, the orb, the stage, a tip. */
  private async loadingScreen(veil: HTMLElement, show: EntryShow) {
    veil.dataset.phase = "loading";
    const canvas = h("canvas", { class: "en-orb", width: "192", height: "192" }) as HTMLCanvasElement;
    const stage = el("p", "en-stage", tr(T.compiling));
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
      if (p) stage.textContent = `${p.label} · ${Math.floor(100 * loading.fracOf(p, now))} %`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    // (seen at least 700 ms: no flash)
    const until = performance.now() + 90_000;
    await sleep(700);
    while (tracing() && performance.now() < until) await sleep(100);
    cancelAnimationFrame(raf);
  }
}
