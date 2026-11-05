import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// R4 (contract C0-3) — the ground seen lifted by the air (system/refraction-lift.ts; renderer.liftOn, off until every consumer
// lifts): the raster's relief projected lifted (terrain-raster.ts terrainVs), its points read back unlifted (trace.wgsl
// rasterPoint), the tracer's march over the lifted ground (R4a). From over Lausanne (1 500 m) the Mont-Blanc ~78 km south-south-east (RL_LAT, RL_LON, RL_HDG, RL_PITCH),
// the free camera (__bh.viewAt: its heading and pitch absolute), a 3° field, frozen, the exposure locked, no bloom: shots in the raster without the lift, with it, the traced pipeline with it,
// the raster without again; in each the skyline (the first row per column, from the top, darker than the sky by a fifth) —
// its rise with the lift [px] against Λ/d from the table.
// RL_OUT: the shots (remote-results/refraction-lift).
// Duration: ~4 min on this Mac.
// Done when: the four shots taken, the skyline's rise logged against the table's, no GPU error.
const OUT = process.env.RL_OUT ?? "remote-results/refraction-lift";
const FOV = Number(process.env.RL_FOV ?? 3);
const PITCH = Number(process.env.RL_PITCH ?? 2.0);
// (the eye: over Lausanne, 1 500 m, facing the Mont-Blanc ~78 km to the south-south-east)
const LAT = Number(process.env.RL_LAT ?? 46.52);
const LON = Number(process.env.RL_LON ?? 6.63);
const HDG = Number(process.env.RL_HDG ?? 165);
afterAll(stopServer);
test.skipIf(!E2E)(
  "R4: the far relief lifted by the air — raster and tracer alike",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, bloom: 0, lensFlare: 0, earthPipeline: "raster", weather: "fair" }); __bh.game.set("earthClouds", 0); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T09:00:00Z";
      // (the free camera placed and aimed — its heading and pitch the view's own, not the craft's attitude —; the field set
      // while the world runs, frozen after)
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.viewAt(${LAT}, ${LON}, { altM: 1500, heading: ${HDG}, pitch: ${PITCH}, fov: ${FOV} }); __bh.camera.setFov(${FOV}); document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.waitFor(`Math.abs(__bh.settings.fov - ${FOV}) < 0.01`, 30_000);
      await Bun.sleep(400);
      await app.js(`(() => { __bh.game.setDate("${iso}"); __bh.freeze(true); return 1; })()`);
      const frames = (n: number) =>
        app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${n}; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
      await app.settled(120_000);
      await frames(150);
      await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
      const skylines: Record<string, number[]> = {};
      for (const [k, lift, pipe] of [
        ["off", false, "raster"],
        ["on", true, "raster"],
        ["on-trace", true, "trace"],
        ["off2", false, "raster"],
      ] as const) {
        await app.js(`(() => { __bh.renderer.liftOn = ${lift}; __bh.settings.earthPipeline = "${pipe}"; __bh.touch(); return 1; })()`);
        if (lift) await app.waitFor(`__bh.renderer.liftNow !== ""`, 30_000);
        else await app.waitFor(`__bh.renderer.liftNow === ""`, 30_000);
        await app.settled(120_000);
        await frames(120);
        const file = `${OUT}/${k}.png`;
        await app.shot(file);
        const img = readPng(new Uint8Array(await Bun.file(file).arrayBuffer()));
        const { width: W, height: H, channels: C, data } = img;
        const lum = (x: number, y: number) => {
          const o = (y * W + x) * C;
          return 0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!;
        };
        // (the skyline: per column, the first row from the frame's top fifth where the image falls under 0.8 of the sky 6 rows
        // above it and stays under for 3 rows)
        const line: number[] = [];
        for (let x = Math.floor(0.1 * W); x < 0.9 * W; x += 4) {
          let row = -1;
          for (let y = Math.floor(0.2 * H); y < 0.9 * H - 3 && row < 0; y++) {
            const sky = lum(x, y - 6);
            if (lum(x, y) < 0.8 * sky && lum(x, y + 1) < 0.8 * sky && lum(x, y + 2) < 0.8 * sky) row = y;
          }
          line.push(row);
        }
        skylines[k] = line;
        const now = await app.js<{ pipe: string; liftNow: string; mount: string }>(
          `({ pipe: __bh.renderer.earthPipelineNow(__bh.settings), liftNow: __bh.renderer.liftNow, mount: __bh.settings.shipMount + (__bh.settings.ship ? '' : ' (free camera)') })`,
        );
        out[k] = now;
        console.log(`  ${k}: shot (${now.pipe}, lift table ${now.liftNow || "none"}, ${now.mount})`);
      }
      // (the rise: the median over the columns found in both of the row's fall, with the lift against without)
      const rise = (a: string, b: string) => {
        const d: number[] = [];
        skylines[a]!.forEach((r, i) => {
          const s = skylines[b]![i]!;
          if (r >= 0 && s >= 0) d.push(s - r);
        });
        d.sort((x, y) => x - y);
        return { columns: d.length, median: d[Math.floor(d.length / 2)] ?? Number.NaN };
      };
      out.rise = { raster: rise("on", "off"), trace: rise("on-trace", "off"), noise: rise("off2", "off") };
      // (the table's: Λ/d at 160 km for the eye at 1 500 m, in pixels of this field)
      const pxPerRad = (await app.js<number>(`__bh.renderer.ctx?.canvas?.height ?? innerHeight`)) / ((FOV * Math.PI) / 180);
      out.pxPerRad = pxPerRad;
      console.log(
        `  the skyline's rise [px, median]: raster ${JSON.stringify((out.rise as { raster: unknown }).raster)}, trace ${JSON.stringify((out.rise as { trace: unknown }).trace)}, noise ${JSON.stringify((out.rise as { noise: unknown }).noise)}`,
      );
      // (RL_COST: the frame's GPU time and the raster passes', without the lift and with it, alternated — 2 s each, raster)
      if (process.env.RL_COST) {
        for (const lift of [false, true, false, true]) {
          await app.js(`(() => { __bh.renderer.liftOn = ${lift}; __bh.settings.earthPipeline = "raster"; __bh.touch(); return 1; })()`);
          await app.waitFor(lift ? `__bh.renderer.liftNow !== ""` : `__bh.renderer.liftNow === ""`, 30_000);
          await app.settled(120_000);
          await frames(60);
          const m = await app.js<{ total: number; top: [string, number][] }>(`(async () => {
            const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
            r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
            while (performance.now() - t0 < 2000) { __bh.touch(); await f(); }
            const rows = r.prof.table(); const total = +r.prof.frameMs.toFixed(2); r.prof.enabled = false;
            return { total, top: rows.sort((a, b) => b.ms - a.ms).slice(0, 6).map((p) => [p.label, +p.ms.toFixed(3)]) }; })()`);
          (out.cost ??= [] as unknown[]) as unknown[];
          (out.cost as unknown[]).push({ lift, ...m });
          console.log(`  cost, lift ${lift}: GPU ${m.total} ms — ${m.top.map(([l, v]) => `${l} ${v}`).join(", ")}`);
        }
      }
      await app.js(
        `(() => { __bh.renderer.liftOn = false; __bh.settings.earthPipeline = "raster"; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/lift.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
