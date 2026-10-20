// The title's pictures (PLAN-TITRE-AAA E3), made by the game itself: the four ways to play — an astronaut on the
// Moon's limb with the full Earth low, the F-35B over the Alps at sunset, the Ranger in low Earth orbit, Gargantua's
// close pass — and the hangar's turntables (each craft seen from 36 sides, the sky black). A headless Chrome on the
// dev server (`bun run dev` first; E2E_URL for another): "preview" takes the live view (quick, to frame), "final"
// the offline render, converged (__bh.render → snapshots/). Then `python3 scripts/build-title-art.py` makes
// assets/title/ from them.
//
//   bun scripts/title-art.ts [preview|final] [foot,plane,ship,free,turn-ranger,turn-lander,turn-endurance]
import { App, stopServer } from "../tests/e2e/lib/app";

process.env.E2E_URL ??= "http://localhost:3000/";
const mode = process.argv[2] === "final" ? "final" : "preview";
const only = (process.argv[3] ?? "foot,plane,ship,free").split(",");
const W = 1600,
  H = 1200;

interface Shot {
  name: string;
  /** set-up run in the page (the game frozen: __bh.step moves it) */
  js: string;
  /** a preset rendered instead of the view as set up */
  preset?: string;
  /** settings for the render */
  patch?: Record<string, unknown>;
  /** the live view, converged (the offline render takes its camera from the settings, not the walk's) */
  live?: boolean;
  spp?: number;
}

/** the frames stepped, the view settled */
const STEP = (n: number) => `for (let i = 0; i < ${n}; i++) __bh.step(1 / 30);`;
/** the camera about the craft flown, at yaw / pitch [°] and dist [m] */
const AROUND = (yaw: number, pitch: number, dist: number) => `
  __bh.settings.shipMount = "around";
  for (let i = 0; i < 60; i++) { Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: ${pitch}, dist: ${dist} }); __bh.step(1 / 30); }`;

const SHOTS: Record<string, Shot> = {
  // on the Moon's eastern limb 1.8 days after a new Moon: the Earth nearly full and low in the west, the Sun just
  // risen in the east, behind the camera
  foot: {
    name: "title-foot",
    js: `
      __bh.game.setDate("2026-08-14T12:00:00Z");
      __bh.settings.vessel = "lander";
      ${STEP(5)}
      __bh.game.walk("moon", 0.4, 87.5);
      ${STEP(60)}
      const ch = __bh.camera.character;
      const aim = () => {
        const t = __bh.camera.nowTime();
        const e = ch.skyAzEl(__bh.ourState("earth", t).pos);
        const p = ch.place();
        ch.yaw += ((((e.az - p.viewDeg) % 360) + 540) % 360 - 180) * Math.PI / 180;
        return e;
      };
      aim();
      // (away from the Lander, towards the Earth: ~40 m running — the camera behind then clear of the craft)
      ch.move(1, 0, 10, true);
      ${STEP(300)}
      ch.move(0, 0, 0);
      ${STEP(30)}
      const e = aim();
      ch.yaw += Number(${JSON.stringify(process.env.FOOT_YAW ?? "0")}) * Math.PI / 180;
      ch.pitch = Number(${JSON.stringify(process.env.FOOT_PITCH ?? "0.03")});
      ch.distance = Number(${JSON.stringify(process.env.FOOT_DIST ?? "7")});
      ${STEP(30)}
      const sun = ch.skyAzEl(__bh.ourState("sun", __bh.camera.nowTime()).pos);
      window.__artNote = "Earth az " + e.az.toFixed(0) + "° el " + e.el.toFixed(1) + "°, Sun az " + sun.az.toFixed(0) + "° el " + sun.el.toFixed(1) + "°";`,
    patch: { fov: Number(process.env.FOOT_FOV ?? 28) },
    live: true,
  },
  // over the Alps at sunset, a quarter view of the F-35B, the range behind
  plane: {
    name: "title-plane",
    js: `
      __bh.game.setDate("2026-06-21T18:55:00Z");
      __bh.settings.vessel = "f35";
      ${STEP(5)}
      __bh.game.flyAt(45.9, 7.05, 3200, 250, 230);
      ${STEP(10)}
      ${AROUND(Number(process.env.PLANE_YAW ?? 240), Number(process.env.PLANE_PITCH ?? 8), 17)}`,
    patch: { fov: 42 },
  },
  // the Ranger in low orbit, the Earth's limb and its terminator below
  ship: {
    name: "title-ship",
    js: `
      __bh.game.setDate("2026-03-20T17:30:00Z");
      __bh.settings.vessel = "ranger";
      ${STEP(5)}
      __bh.game.orbit("earth", { altKm: 420, inc: 51.6 });
      ${STEP(10)}
      ${AROUND(230, 10, 22)}`,
    patch: { fov: 48 },
  },
  // Gargantua, the film's close pass
  free: {
    name: "title-free",
    js: "",
    preset: "Interstellar: along the disk (the film's close pass)",
    patch: { lensFlare: 0.3, ship: false },
    spp: 128,
  },
};

/** the hangar: each craft in low orbit over the subsolar point (the Sun overhead: its top lit from every side) — the Earth below lighting it from under (the
 *  shadow side never black), its horizon level in every view —, the camera round it in 36 steps of 10° */
const DIST: Record<string, number> = { ranger: 24, lander: 40, endurance: 120 };
const TURN_ONLY = process.env.TURN_ONLY?.split(",").map(Number);
function turntable(v: string): Shot[] {
  return Array.from({ length: 36 }, (_, k) => k)
    .filter((k) => !TURN_ONLY || TURN_ONLY.includes(k))
    .map((k, i) => ({
      name: `turn-${v}-${String(k).padStart(2, "0")}`,
      js: `
        ${i === 0 ? `__bh.game.setDate("2026-06-21T11:00:00Z"); __bh.settings.vessel = ${JSON.stringify(v)}; ${STEP(5)} __bh.game.orbitOver("earth", 22, 14, { altKm: 450 }); ${STEP(10)}` : ""}
        ${AROUND(k * 10, 12, DIST[v] ?? 30)}`,
      patch: { fov: 40 },
      spp: 48,
    }));
}

// (a run cut short — the dev server's hot reload restarts the page when a source changes —: the views already
// rendered kept, FRESH=1 to make them again; a craft's first view always made, it places the craft)
const done = (n: string) => mode === "final" && !process.env.FRESH && Bun.file(`snapshots/${n}.png`).size > 0;
const list: Shot[] = only
  .flatMap((k) => (k.startsWith("turn-") ? turntable(k.slice(5)) : SHOTS[k] ? [SHOTS[k]] : []))
  .filter((s) => !done(s.name) || /-00$/.test(s.name));
const app = await App.boot({
  width: mode === "final" ? W : 1200,
  height: mode === "final" ? H : 900,
  hash: "scene=game:artemis",
  tiles: true,
  telemetry: false,
});
try {
  await app.waitFor("__bh.camera.piloting", 120_000);
  for (const s of list) {
    // (the shot's settings first: the views placed by the steps take them — the walk's camera copies the lens then)
    await app.js(
      `(async () => { window.__artNote = null; __bh.freeze(true); Object.assign(__bh.settings, ${JSON.stringify(s.patch ?? {})}); ${s.js}; return true; })()`,
    );
    // (the ground's tiles round the place, the craft's maps: a while at the first view of a place)
    if (!s.name.startsWith("turn-") || /-0?0$/.test(s.name) || s === list.find((x) => x.name.startsWith(s.name.slice(0, -3))))
      await Bun.sleep(s.name === "title-plane" ? 20_000 : 8000);
    const note = await app.js<string | null>("window.__artNote ?? null");
    if (mode === "preview" || s.live) {
      // (the render's settings on the live view too: the lens, the sky)
      await app.js(`(Object.assign(__bh.settings, ${JSON.stringify(s.patch ?? {})}), __bh.touch(), true)`);
      await app.js(
        `(__bh.settings.showFps = false, document.body.classList.add("hide-ui"), document.querySelectorAll("canvas.fl-hud, #overlay, .fps").forEach((e) => (e.style.visibility = "hidden")), true)`,
      );
      for (let i = 0; i < 4; i++) await app.js("(__bh.touch(), new Promise((r) => requestAnimationFrame(r)))");
      // (not left to converge: the still view's refinement draws the walker unlit — seen on 2026-10-18; the live
      // frames are clean enough at this size)
      await Bun.sleep(1500);
      const file = `snapshots/${s.name}${mode === "final" ? "" : "-preview"}.png`;
      await app.shot(file);
      console.log(`${file}${note ? ` — ${note}` : ""}`);
    } else {
      const r = await app.js<string>(
        `__bh.render(${JSON.stringify(s.name)}, ${JSON.stringify(s.preset ?? null)}, ${JSON.stringify(s.patch ?? {})}, { width: ${s.name.startsWith("turn-") ? 512 : W}, height: ${s.name.startsWith("turn-") ? 512 : H}, spp: ${s.spp ?? 96} })`,
      );
      console.log(`${r}${note ? ` — ${note}` : ""}`);
    }
  }
} finally {
  app.close();
  stopServer();
}
