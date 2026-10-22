// The A320's progress captures (docs/PLAN-A320.md): a headless Chrome on the app (tests/e2e/lib/app.ts), the A320
// lined up on a runway, the camera about it at set places, its rig's properties forced as asked (FlightGear's paths:
// __bh.renderer.a320Force), the interface hidden; one PNG a view. The simulation frozen: each view a still frame.
//
//   bun scripts/a320-shots.ts [out-dir] [views.json]     (views: [{ name, mount, yaw, pitch, dist, props?, livery? }])
//
// Without a views file: the default tour below. SITE (a runway's airport) and DATE choose where and when.
import { App, stopServer } from "../tests/e2e/lib/app";

interface View {
  name: string;
  /** a mount (mounts.ts) or "around": the outside view at yaw / pitch [°] and dist [m] */
  mount: string;
  yaw?: number;
  pitch?: number;
  dist?: number;
  /** the rig's properties held (FlightGear's paths) */
  props?: Record<string, number>;
  livery?: string;
  look?: [number, number];
  fov?: number;
  /** a script run before the frames are stepped */
  js?: string;
  frames?: number;
  log?: string;
}

const out = process.argv[2] ?? "a320-shots";
const P = (o: Record<string, number>) => o;
const gear = (g: number, doors = g > 0 && g < 1 ? 1 : 0) =>
  P({
    "gear/gear[0]/position-norm": g,
    "gear/gear[1]/position-norm": g,
    "gear/gear[2]/position-norm": g,
    "systems/hydraulic/gear/door-left": doors,
    "systems/hydraulic/gear/door-right": doors,
    "systems/hydraulic/gear/door-nose": doors,
  });
const views: View[] = process.argv[3]
  ? await Bun.file(process.argv[3]).json()
  : [
      { name: "quarter", mount: "around", yaw: 140, pitch: 6, dist: 46 },
      { name: "rear", mount: "around", yaw: 30, pitch: 8, dist: 44 },
      { name: "side", mount: "around", yaw: 90, pitch: 2, dist: 48 },
      { name: "gear-transit", mount: "around", yaw: 120, pitch: -4, dist: 24, props: gear(0.5) },
      {
        name: "landing-config",
        mount: "around",
        yaw: 150,
        pitch: 22,
        dist: 34,
        props: P({
          "sim/multiplay/generic/float[11]": 1,
          "sim/multiplay/generic/float[12]": 35 / 40,
          "systems/fcs/spoiler-l1/final-deg": 50,
          "systems/fcs/spoiler-l2/final-deg": 50,
          "systems/fcs/spoiler-l3/final-deg": 50,
          "systems/fcs/spoiler-l4/final-deg": 50,
          "systems/fcs/spoiler-l5/final-deg": 50,
          "systems/fcs/spoiler-r1/final-deg": 50,
          "systems/fcs/spoiler-r2/final-deg": 50,
          "systems/fcs/spoiler-r3/final-deg": 50,
          "systems/fcs/spoiler-r4/final-deg": 50,
          "systems/fcs/spoiler-r5/final-deg": 50,
          "engines/engine[0]/reverser-pos-norm": 1,
          "engines/engine[1]/reverser-pos-norm": 1,
        }),
      },
      { name: "swiss", mount: "around", yaw: 140, pitch: 6, dist: 46, livery: "SWR" },
    ];
const site = process.env.SITE ?? "Paris – Le Bourget";
const date = process.env.DATE ?? "2026-06-21T16:30";

const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true, telemetry: false });
try {
  await app.waitFor("__bh.camera.piloting", 120_000);
  console.log(
    await app.js(`(() => {
    __bh.freeze(true);
    __bh.game.setDate(${JSON.stringify(date)});
    __bh.settings.vessel = "a320";
    for (let i = 0; i < 5; i++) __bh.step(1 / 30);
    __bh.game.lineUp(${JSON.stringify(site)});
    for (let i = 0; i < 5; i++) __bh.step(1 / 30);
    return __bh.game.status().label;
  })()`),
  );
  // (the ground's relief and imagery round the runway, the A320's maps)
  await Bun.sleep(15_000);
  await app.waitFor(`!document.body.innerText.includes("Compiling the ray tracer")`, 240_000).catch(() => {});
  for (const v of views) {
    await app.js(`(async () => {
      const s = __bh.settings, c = __bh.camera;
      s.a320Livery = ${JSON.stringify(v.livery ?? "kerr")};
      __bh.renderer.ship.setA320Livery(s.a320Livery);
      s.shipMount = ${JSON.stringify(v.mount)};
      ${v.fov ? `s.fov = ${v.fov};` : ""}
      ${v.look ? `s.shipLookYaw = ${v.look[0]}; s.shipLookPitch = ${v.look[1]};` : ""}
      { ${v.js ?? ""} }
      __bh.renderer.a320Force = ${JSON.stringify(v.props ?? {})};
      for (let i = 0; i < ${v.frames ?? 90}; i++) {
        if (${JSON.stringify(v.mount)} === "around") Object.assign(c.outside, { yaw: ${v.yaw ?? 0}, pitch: ${v.pitch ?? 10}, dist: ${v.dist ?? 40} });
        __bh.step(1 / 30);
      }
      document.body.classList.toggle("hide-ui", !window.__keepHud);
      document.querySelectorAll("canvas.fl-hud").forEach((e) => (e.style.visibility = window.__keepHud ? "visible" : "hidden"));
      for (let i = 0; i < 6; i++) { __bh.touch(); await new Promise((r) => requestAnimationFrame(r)); }
      return true;
    })()`);
    // (a livery changed: its maps transcoded and written)
    await Bun.sleep(v.livery ? 5000 : 1500);
    await app.js(`(async () => { for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((r) => requestAnimationFrame(r)); } })()`);
    await app.shot(`${out}/${v.name}.png`);
    console.log(`${out}/${v.name}.png${v.log ? ` — ${v.log}: ${JSON.stringify(await app.js(v.log))}` : ""}`);
  }
} finally {
  app.close();
  stopServer();
}
