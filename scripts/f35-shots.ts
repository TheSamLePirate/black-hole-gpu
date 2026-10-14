// The F-35's progress captures (docs/PLAN-F35.md): a headless Chrome on the app (tests/e2e/lib/app.ts), the F-35
// lined up on a runway, the camera about it at set places, its parts posed as asked, the interface hidden; one PNG a
// view. The simulation frozen: each view is a still frame (__bh.step, then __bh.touch).
//
//   bun scripts/f35-shots.ts [out-dir] [views.json]      (views: [{ name, mount, yaw, pitch, dist, pose?, date? }])
//
// Without a views file: the default tour below (quarter, rear, the surfaces deflected, the cockpit).
import { App, stopServer } from "../tests/e2e/lib/app";

interface View {
  name: string;
  /** a mount (mounts.ts) or "around": the outside view at yaw / pitch [°] and dist [m] */
  mount: string;
  yaw?: number;
  pitch?: number;
  dist?: number;
  /** F35Pose fields to force (angles in degrees for the surfaces) */
  pose?: Record<string, unknown>;
  /** the look turned on the mount [°] */
  look?: [number, number];
  fov?: number;
  /** a script run before the frames are stepped (the throttle, the afterburner…) */
  js?: string;
  /** frames stepped before the capture (default 90) */
  frames?: number;
}

const out = process.argv[2] ?? "f35-shots";
const views: View[] = process.argv[3]
  ? await Bun.file(process.argv[3]).json()
  : [
      { name: "quarter", mount: "around", yaw: 140, pitch: 6, dist: 16 },
      { name: "rear", mount: "around", yaw: 25, pitch: 5, dist: 13 },
      {
        name: "surfaces",
        mount: "around",
        yaw: 130,
        pitch: 28,
        dist: 17,
        pose: { stab: [15, -15], flaperon: [20, -20], lef: [25, 25], rudder: [20, 20], canopy: 1, petals: 1 },
      },
      { name: "cockpit", mount: "cockpit", fov: 70 },
    ];
const site = process.env.SITE ?? "Edwards";
const date = process.env.DATE ?? "2067-06-21T17:30";

const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true, telemetry: false });
try {
  await app.waitFor("__bh.camera.piloting", 120_000);
  await app.js(`(() => {
    __bh.freeze(true);
    __bh.game.setDate(${JSON.stringify(date)});
    __bh.settings.vessel = "f35";
    for (let i = 0; i < 5; i++) __bh.step(1 / 30);
    __bh.game.lineUp(${JSON.stringify(site)});
    for (let i = 0; i < 5; i++) __bh.step(1 / 30);
    return __bh.game.status().label;
  })()`);
  // (the ground's relief and imagery round the runway, the F-35's maps)
  await Bun.sleep(15_000);
  // (the ray tracer compiled for the scene — a changed shader takes a minute or so)
  await app.waitFor(`!document.body.innerText.includes("Compiling the ray tracer")`, 240_000).catch(() => {});
  for (const v of views) {
    await app.js(`(async () => {
      const s = __bh.settings, c = __bh.camera;
      s.shipMount = ${JSON.stringify(v.mount)};
      ${v.fov ? `s.fov = ${v.fov};` : ""}
      ${v.look ? `s.shipLookYaw = ${v.look[0]}; s.shipLookPitch = ${v.look[1]};` : ""}
      { ${v.js ?? ""} }
      for (let i = 0; i < ${v.frames ?? 90}; i++) {
        if (${JSON.stringify(v.mount)} === "around") Object.assign(c.outside, { yaw: ${v.yaw ?? 0}, pitch: ${v.pitch ?? 10}, dist: ${v.dist ?? 18} });
        __bh.step(1 / 30);
      }
      const D = Math.PI / 180, f = ${JSON.stringify(v.pose ?? {})};
      const deg = (a) => Array.isArray(a) ? a.map((x) => x * D) : a;
      const p = {};
      for (const k of ["stab", "flaperon", "lef", "rudder"]) if (f[k]) p[k] = deg(f[k]);
      for (const k of ["canopy", "petals", "gear", "stovl", "nozzle", "fan"]) if (f[k] !== undefined) p[k] = f[k];
      __bh.renderer.jetForce = p;
      // (the interface hidden — but the flight's HUD kept when a view asks for it: window.__keepHud)
      document.body.classList.toggle("hide-ui", !window.__keepHud);
      document.querySelectorAll("canvas.fl-hud").forEach((e) => (e.style.visibility = window.__keepHud ? "visible" : "hidden"));
      for (let i = 0; i < 6; i++) { __bh.touch(); await new Promise((r) => requestAnimationFrame(r)); }
      // (the flight's HUD is drawn by the running loop: let it run a moment)
      if (window.__keepHud) { __bh.freeze(false); await new Promise((r) => setTimeout(r, 1200)); __bh.freeze(true); }
      return true;
    })()`);
    await Bun.sleep(1500);
    await app.shot(`${out}/${v.name}.png`);
    console.log(`${out}/${v.name}.png`);
  }
} finally {
  app.close();
  stopServer();
}
