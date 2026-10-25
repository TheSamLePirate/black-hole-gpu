import { afterAll, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The total eclipse of 12 August 2026 from over Burgos in the raster (TERRE-UNREAL U8): the sky's discs drawn by main's
// layers z ≥ 1 — the Moon's and the Sun's rectangles overlapping (the first layer's the pixel), the Sun's out to 4 radii
// for its corona —, the Moon's limb's relief (limbAt: Baily's beads, the diamond ring). The F-35 at 1 500 m heading for the
// low Sun on its autopilot, the stabilised telescope on the Sun. The second and third contacts found by bisection on the
// clock (the discs' own sizes and centres, renderer.skyDiscs); six moments — the partial phase, the diamond ring 4 s before
// C2, the chromosphere 2 s after it, mid-totality, C3 + 1 s, the partial phase after — each at three fields (20°, 1.6°,
// 0.5°): a shot, its centre 1:1 (eclipse-<moment>-<field>.png), the frame rate.
// Figures in $OUT/eclipse.json. Duration: ~10 min on this Mac's headless Chrome cold, ~5 warm.
// Done when: every moment shot at its three fields.

const OUT = process.env.AB_OUT ?? "remote-results";
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthRasterShading: "every", earthRasterScale: 1, dynamicResolution: false, autoGear: false, f35AutoProtect: false, telescopeSpot: true }`;
const FIELDS = [20, 1.6, 0.5];

afterAll(stopServer);

test.skipIf(!E2E)(
  "the 2026 eclipse over Burgos in the raster: crescent, diamond ring, chromosphere, corona",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
    const at = async (iso: string) => {
      await app.js(`(() => { __bh.game.setDate("${iso}"); return 1; })()`);
      // (two frames: the discs' places from the new clock)
      await app.js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`);
    };
    // (the Moon's centre from the Sun's, less the radii's difference, in the Sun's radii: ≤ 0 total; skyDiscs' Sun r × 4 in
    // an eclipse — main.ts skyDiscsNow)
    const depth = () =>
      app.js<number>(`(() => { const ds = __bh.renderer.skyDiscs, m = ds.find((d) => d.moon), s = ds.find((d) => !d.moon);
        if (!m || !s) return 99; const asp = innerWidth / innerHeight, rs = s.r / 4;
        return (Math.hypot((m.x - s.x) * asp, m.y - s.y) - (m.r - rs)) / rs; })()`);
    // (round the image's centre — the Sun's —, or `limb`: round the point of the Sun's limb the Moon leaves last, from the
    // Moon's centre through the Sun's — where the beads and the chromosphere show)
    const crop = (half: number, limb = false) =>
      app.js<string>(`(async () => {
        const cv = document.querySelector("canvas");
        for (;;) {
          const b = await new Promise((r) => requestAnimationFrame(() => r(createImageBitmap(cv))));
          let cx = b.width / 2, cy = b.height / 2;
          const ds = __bh.renderer.skyDiscs, mo = ds.find((d) => d.moon), su = ds.find((d) => !d.moon);
          if (${limb} && mo && su) {
            const asp = b.width / b.height, dx = (su.x - mo.x) * asp, dy = su.y - mo.y, l = Math.hypot(dx, dy) || 1, rs = su.r / 4;
            const ux = (0.5 + 0.5 * su.x) * b.width + (dx / l) * rs * 0.5 * b.height, uy = (0.5 - 0.5 * su.y) * b.height - (dy / l) * rs * 0.5 * b.height;
            cx = Math.min(Math.max(ux, ${half}), b.width - ${half}); cy = Math.min(Math.max(uy, ${half}), b.height - ${half});
          }
          const o = new OffscreenCanvas(2 * ${half}, 2 * ${half}), g = o.getContext("2d");
          g.drawImage(b, Math.round(cx - ${half}), Math.round(cy - ${half}), 2 * ${half}, 2 * ${half}, 0, 0, 2 * ${half}, 2 * ${half});
          if (g.getImageData(${half}, ${half}, 1, 1).data[3] === 0) continue;
          const u8 = new Uint8Array(await (await o.convertToBlob({ type: "image/png" })).arrayBuffer());
          let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
          return btoa(s);
        } })()`);
    const perf = async () => {
      const f0 = await app.js<number>(`__bh.renderer.completedFrames`);
      await Bun.sleep(3000);
      return app.js<Record<string, unknown>>(`(() => { const r = __bh.renderer;
        return { fps: +((r.completedFrames - ${f0}) / 3).toFixed(1), gpuMs: +[...r.completedDurations].slice(-30).sort((a, b) => a - b)[15]?.toFixed(1),
          discs: r.discsDrawn, fov: +__bh.settings.fov.toFixed(3), ev: +r.ev(__bh.settings).toFixed(2), compiling: r.compilingNow.join(" | ") }; })()`);
    };
    const fly = () =>
      app.js(`(() => { __bh.game.flyAt(42.34, -3.7, 1500, 285, 140); __bh.settings.shipMount = "cockpit";
        __bh.settings.target = "sun"; return 1; })()`);

    await at("2026-08-12T18:20:00Z");
    await fly();
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera;
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      if (c.jetModes.spd !== null) c.jetModes.spd = 140; return 1; })()`);
    await app
      .waitFor(`__bh.renderer.rasterLiteActive && __bh.renderer.variantQueue.pending === 0`, 600_000)
      .catch(() => console.warn("  raster kernels not all in"));
    if (!(await app.js<boolean>(`__bh.settings.lookAt`))) await app.press("KeyC");
    await Bun.sleep(1500);
    await app.press("KeyY");
    await app.js(`(__bh.camera.setFov(1.6), 1)`);
    await Bun.sleep(3000);

    // (the contacts: the clock bisected between a partial and a total moment, to the second)
    const base = Date.parse("2026-08-12T18:00:00Z");
    const iso = (s: number) => new Date(base + s * 1000).toISOString();
    const bisect = async (lo: number, hi: number, totalAtHi: boolean) => {
      while (hi - lo > 1) {
        const mid = Math.round((lo + hi) / 2);
        await at(iso(mid));
        const total = (await depth()) <= 0;
        if (total === totalAtHi) hi = mid;
        else lo = mid;
      }
      return hi;
    };
    // (a moment of totality first: 10 s steps from 18:27)
    let inTotal = 27 * 60;
    for (; inTotal < 32 * 60; inTotal += 10) {
      await at(iso(inTotal));
      if ((await depth()) <= 0) break;
    }
    console.log(`  total at ${iso(inTotal)}`);
    const c2 = await bisect(inTotal - 10, inTotal, true);
    const c3 = (await bisect(inTotal, 34 * 60, false)) - 1;
    console.log(`  C2 ${iso(c2)}, C3 ${iso(c3)} (totality ${c3 - c2} s)`);
    const moments: [string, number][] = [
      ["partial", 20 * 60],
      ["diamond", c2 - 4],
      ["chromosphere", c2 + 2],
      ["total", Math.round((c2 + c3) / 2)],
      ["c3", c3 + 1],
      ["after", 36 * 60],
    ];
    const results: Record<string, unknown>[] = [];
    for (const [name, sec] of moments) {
      await at(iso(sec));
      await fly();
      await Bun.sleep(600);
      // (the clock stopped at the moment: the same disc each field)
      // (timeSpeed is in M a second: the real time's own kept to be given back)
      const speed = await app.js<number>(`(() => { const v = __bh.settings.timeSpeed; __bh.settings.timeSpeed = 0; return v; })()`);
      for (const f of FIELDS) {
        await app.js(`(__bh.camera.setFov(${f}), 1)`);
        await Bun.sleep(4500);
        const p = await perf();
        const tag = `${name}-${String(f).replace(".", "_")}`;
        await app.shot(`${OUT}/eclipse-${tag}.png`);
        writeFileSync(`${OUT}/eclipse-${tag}-crop.png`, Buffer.from(await crop(160, f < 1), "base64"));
        console.log(`  ${name} ${iso(sec)} ${f}°: ${JSON.stringify(p)}`);
        results.push({ name, at: iso(sec), field: f, ...p });
      }
      await app.js(`(__bh.settings.timeSpeed = ${speed}, 1)`);
    }
    writeFileSync(`${OUT}/eclipse.json`, JSON.stringify({ c2: iso(c2), c3: iso(c3), results }, null, 1));
  },
  1_800_000,
);
