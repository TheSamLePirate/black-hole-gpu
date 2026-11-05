import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T7 — land showing in the sea while the world loads (Sam, 5 Nov 2026: « pendant le chargement on voit encore beaucoup de
// terre en mer »), around Toulon-Hyères (LFTH) by day. Two runs from a cold browser profile:
//   (1) the F-35 put at 400 m over the sea south of Giens, looking north at the peninsula and the airport, the world frozen
//       while the relief and the imagery stream in: every CL_EVERY ms a shot, the same with the water's cover drawn by kind
//       (liteSkip 512: red the sea, green a river, blue a lake — what is not coloured is land), and a probe of the tiles'
//       heights over a fan ahead (±40°, 300 m – 8 km): the cells over 0.5 m now that end at or under 0.5 m once all is in
//       are land shown in the sea;
//   (2) a flight: put east of Porquerolles heading west at 500 m, the world running, a shot pair every 3 s.
// Output: remote-results/coast-loading/ (CL_OUT): A-NN.png / A-NN-w.png, F-NN.png / F-NN-w.png, series.json.
// Done when: both series and the final shots taken, the probe's counts written, no GPU error. Duration: ~3 min.
const OUT = process.env.CL_OUT ?? "remote-results/coast-loading";
afterAll(stopServer);
const EVERY = Number(process.env.CL_EVERY ?? 2000);
const FOR = Number(process.env.CL_FOR ?? 28);
const FLY_FOR = Number(process.env.CL_FLY ?? 36);
// (13 h in Toulon, 5 November 2026)
const UTC = process.env.CL_UTC ?? "2026-11-05T12:00:00Z";
const A: [number, number, number, number] = [42.985, 6.15, 400, 355];
const F: [number, number, number, number] = [43.0, 6.33, 500, 275];

type Probe = { W: number; H: number; h: number[]; res: number[]; rem: number[] };
const probeJs = (lat0: number, lon0: number, hdg: number) => `(() => {
  const t = __bh.renderer.earthTiles, D = Math.PI / 180, W = 81, H = 48, h = [], res = [], rem = [];
  for (let j = 0; j < H; j++) { const d = 300 * Math.pow(8000 / 300, 1 - j / (H - 1));
    for (let i = 0; i < W; i++) { const b = (${hdg} - 40 + i) * D;
      const lat = ${lat0} + d * Math.cos(b) / 111320, lon = ${lon0} + d * Math.sin(b) / (111320 * Math.cos(${lat0} * D));
      const q = [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
      const s = t.heightAt(q, 30, false); h.push(+s.h.toFixed(1)); res.push(+s.res.toFixed(0)); rem.push(+s.rem.toFixed(2)); } }
  return { W, H, h, res, rem }; })()`;

test.skipIf(!E2E)(
  "T7: land in the sea while the world loads — Toulon-Hyères by day, put then flown",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { utc: UTC };
    const state = () =>
      app.js<Record<string, unknown>>(`(() => { const r = __bh.renderer, t = r.earthTiles;
        return { pending: t.pending, finest: t.finest, ortho: t.orthoPending, phase: r.lastPhase }; })()`);
    const pair = async (f: string) => {
      await app.js(`new Promise((q) => { __bh.touch(); requestAnimationFrame(() => requestAnimationFrame(() => q(1))); })`);
      const a = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      await Bun.write(`${f}.png`, Buffer.from(a.data, "base64"));
      await app.js(
        `new Promise((q) => { __bh.renderer.liteSkip = 512; __bh.touch(); requestAnimationFrame(() => requestAnimationFrame(() => q(1))); })`,
      );
      const b = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      await Bun.write(`${f}-w.png`, Buffer.from(b.data, "base64"));
      await app.js(`(() => { __bh.renderer.liteSkip = 0; __bh.touch(); return 1; })()`);
    };
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, f35AutoProtect: true, motionBlur: 0, dof: false }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      // (1) put, frozen, the loading filmed
      await app.js(`(() => { __bh.freeze(false); __bh.game.setDate(${JSON.stringify(UTC)}); __bh.game.set("weather", "fair");
        __bh.game.flyAt(${A[0]}, ${A[1]}, ${A[2]}, ${A[3]}, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`);
      await app.js(`new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, -5); __bh.freeze(true); q(1); }, 400))`);
      const series: Record<string, unknown>[] = [];
      const probes: Probe[] = [];
      const t0 = Date.now();
      for (let i = 0; Date.now() - t0 < FOR * 1000; i++) {
        const t = +((Date.now() - t0) / 1000).toFixed(1);
        await pair(`${OUT}/A-${String(i).padStart(2, "0")}`);
        probes.push(await app.js<Probe>(probeJs(A[0], A[1], A[3])));
        series.push({ i, t, ...(await state()) });
        await Bun.sleep(EVERY);
      }
      await app.settled(60_000).catch(() => console.log("  A: not settled in 60 s"));
      await app.js(
        `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 45) requestAnimationFrame(f); else q(1); }; f(); })`,
      );
      await pair(`${OUT}/A-final`);
      const fin = await app.js<Probe>(probeJs(A[0], A[1], A[3]));
      // (the cells of the sea at the end — at or under 0.5 m — and, at each step, those of them shown over 0.5 m: land in the sea)
      const sea = fin.h.map((v) => v <= 0.5);
      const nSea = sea.filter(Boolean).length;
      series.forEach((s, k) => {
        const p = probes[k]!;
        let ghost = 0,
          maxH = 0;
        const byRes: Record<string, number> = {};
        p.h.forEach((v, c) => {
          if (sea[c] && v > 0.5) {
            ghost++;
            maxH = Math.max(maxH, v);
            const r = p.res[c]! < 5 ? "ign" : p.res[c]! < 40 ? "fine" : p.res[c]! < 300 ? "mid" : "coarse";
            byRes[r] = (byRes[r] ?? 0) + 1;
          }
        });
        Object.assign(s, { ghost, ghostShare: +(ghost / Math.max(nSea, 1)).toFixed(3), maxH, byRes });
        console.log(
          `  A ${s.t}s: pending ${s.pending}, finest ${s.finest} — land in the sea ${ghost}/${nSea} (max ${maxH} m) ${JSON.stringify(byRes)}`,
        );
      });
      out.A = { at: A, nSea, series, final: await state() };
      await Bun.write(`${OUT}/A-probes.json`, JSON.stringify({ probes, fin }));

      // (2) a flight, the world running
      await app.js(
        `(() => { __bh.freeze(false); __bh.game.flyAt(${F[0]}, ${F[1]}, ${F[2]}, ${F[3]}, 150); __bh.settings.shipMount = "cockpit"; return 1; })()`,
      );
      await app.js(`new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, -5); q(1); }, 400))`);
      const fly: Record<string, unknown>[] = [];
      const t1 = Date.now();
      for (let i = 0; Date.now() - t1 < FLY_FOR * 1000; i++) {
        const t = +((Date.now() - t1) / 1000).toFixed(1);
        await pair(`${OUT}/F-${String(i).padStart(2, "0")}`);
        const pos = await app.js<number[]>(
          `(() => { const g = __bh.camera.geoNow(); return [+g.lat.toFixed(4), +g.lon.toFixed(4), Math.round(g.alt)]; })()`,
        );
        fly.push({ i, t, pos, ...(await state()) });
        console.log(`  F ${t}s: at ${pos} pending ${fly.at(-1)!.pending} finest ${fly.at(-1)!.finest}`);
        await Bun.sleep(3000);
      }
      out.F = { at: F, series: fly };
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.gpuMessages = app.cdp.errors.filter((e) => /WebGPU/i.test(e)).slice(0, 3);
    } finally {
      await Bun.write(`${OUT}/series.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
