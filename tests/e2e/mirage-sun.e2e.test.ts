import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// R6a-ciel — the mirages drawn (trace.wgsl mirageTrue, airBend, earthNear, shadeWater: a sky pixel looks where its ray truly
// goes; the raster's sea leaves the escaping rays' pixels to the tracer). Off Biarritz, 21 June 2026, the F-35 at 30 m over the
// Atlantic facing the setting Sun, at the minute its centre is ~0.45° under the geometric horizon (MS_ALT, MS_SUN); the telescope on the Sun
// (its centre where the plain air shows it), a 2° field; frozen, the exposure locked at the plain air's, the map's clouds off (a far bank cut the Sun's top). A shot under
// the layered model's air (renderer.mirageProfile "off"), a warm sea (the Sun's Etruscan vase), an inversion (a duct).
// MS_OUT: the shots (remote-results/mirage-sun). The green flash (R6a-ciel, each colour its own table): MS_FOV the field [°],
// MS_EV the exposure that many stops over the plain air's (negative: darker — the disc not saturated), MS_AB each mirage shot again in one colour
// (renderer.mirageOneColour: the plain air's dispersion) — and each shot's top rim measured: the colour of the Sun's topmost rows
// at the frame's middle.
// Duration: ~3 min on this Mac.
// Done when: the three shots taken, each profile's tables published, no GPU error.
const OUT = process.env.MS_OUT ?? "remote-results/mirage-sun";
// (the eye's height [m] and the Sun's true height [°]: 30 m and −0.45° — the warm sea's fold doubles −0.62…−0.39° there: the vase)
const ALT = Number(process.env.MS_ALT ?? 30);
const SUN = Number(process.env.MS_SUN ?? -0.45);
const FOV = Number(process.env.MS_FOV ?? 2);
const EV = Number(process.env.MS_EV ?? 0);
// (the Sun's top rim: in the frame's middle tenth, from the first row where the reddest pixel passes 40 % of the window's
// reddest, the next rows' mean colour — linear, 0–1 — and their green over red)
const rim = (img: { width: number; height: number; channels: number; data: Uint8Array }) => {
  const { width: W, height: H, channels: C, data } = img;
  const x0 = Math.floor(0.45 * W),
    x1 = Math.ceil(0.55 * W);
  let peak = 0;
  for (let y = Math.floor(0.15 * H); y < 0.85 * H; y++) for (let x = x0; x < x1; x++) peak = Math.max(peak, data[(y * W + x) * C]!);
  let top = -1;
  for (let y = Math.floor(0.15 * H); y < 0.85 * H && top < 0; y++)
    for (let x = x0; x < x1; x++) if (data[(y * W + x) * C]! > 0.4 * peak) top = y;
  const lin = (v: number) => (v / 255) ** 2.2;
  const rows: number[][] = [];
  for (let y = Math.max(top - 3, 0); y < top + 6; y++) {
    const m = [0, 0, 0];
    for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) m[c]! += lin(data[(y * W + x) * C + c]!) / (x1 - x0);
    rows.push(m.map((v) => +v.toFixed(4)));
  }
  return { top, rows, gr: rows.map((m) => +(m[1]! / Math.max(m[0]!, 1e-6)).toFixed(3)) };
};
afterAll(stopServer);
test.skipIf(!E2E)(
  "R6a-ciel: the setting Sun over a warm sea and an inversion, through the mirages' tables",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", weather: "fair", lensFlare: 0, bloom: 0.05 }); __bh.game.set("earthClouds", 0); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      // (the minute the Sun's centre is nearest its asked true height)
      const at = await app.js<{ iso: string; az: number; alt: number }>(`(() => {
        let ms = Date.parse("2026-06-21T19:40:00Z"), best = null;
        __bh.game.flyAt(43.5, -1.75, ${ALT}, 300, 140);
        for (let i = 0; i < 60; i++, ms += 60000) {
          __bh.game.setDate(new Date(ms).toISOString());
          const s = __bh.camera.skyInfo().sun;
          if (!best || Math.abs(s.altDeg - (${SUN})) < Math.abs(best.alt - (${SUN}))) best = { iso: new Date(ms).toISOString(), az: s.azDeg, alt: s.altDeg };
        }
        return best; })()`);
      console.log(`  the Sun at ${at.alt.toFixed(3)}° true, azimuth ${at.az.toFixed(1)}°, at ${at.iso}`);
      out.sun = at;
      await app.js(
        `(() => { __bh.game.setDate("${at.iso}"); __bh.game.flyAt(43.5, -1.75, ${ALT}, ${at.az}, 140); __bh.settings.shipMount = "cockpit"; __bh.settings.target = "sun"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await Bun.sleep(1500);
      // (the telescope on the Sun — its centre where the plain air shows it —, a 2° field)
      if (!(await app.js<boolean>(`__bh.settings.lookAt`))) await app.press("KeyC");
      await Bun.sleep(800);
      await app.press("KeyY");
      await app.js(`(__bh.camera.setFov(${FOV}), 1)`);
      await app.waitFor(`Math.abs(__bh.settings.fov - ${FOV}) < 0.01`, 30_000);
      await app.js(`(() => { __bh.game.setDate("${at.iso}"); __bh.freeze(true); return 1; })()`);
      let locked = false;
      const shots = process.env.MS_AB
        ? (["off", "warmSea", "warmSea-one", "inversion", "inversion-one"] as const)
        : (["off", "warmSea", "inversion"] as const);
      for (const shot of shots) {
        const k = shot.replace("-one", "") as "off" | "warmSea" | "inversion";
        await app.js(
          `(() => { __bh.renderer.mirageProfile = "${k}"; __bh.renderer.mirageOneColour = ${shot.endsWith("-one")}; __bh.touch(); return 1; })()`,
        );
        if (k !== "off") await app.waitFor(`__bh.renderer.mirageNow.startsWith("${k}@")`, 30_000);
        await app.settled(120_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 90; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
        if (!locked) {
          await app.js(
            `(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV + ${EV}; return 1; })()`,
          );
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 30; i++) { __bh.touch(); await f(); } return 1; })()`,
          );
          locked = true;
        }
        const file = `${OUT}/${shot}.png`;
        await app.shot(file);
        const r = rim(readPng(new Uint8Array(await Bun.file(file).arrayBuffer())));
        out[shot] = { tables: await app.js(`__bh.renderer.mirageNow`), rim: r };
        console.log(
          `  ${shot}: shot (tables ${(out[shot] as { tables: string }).tables || "none"}); top rim at ${r.top}, green/red ${r.gr.join(" ")}`,
        );
      }
      await app.js(
        `(() => { __bh.renderer.mirageProfile = "off"; __bh.renderer.mirageOneColour = false; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/mirage.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  6 * 60_000,
);
