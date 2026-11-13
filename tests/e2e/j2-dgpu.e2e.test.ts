import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";

// PLAN-J2 — the levers' GPU cost on J0's frozen view, interleaved fast against the machine's thermal drift (an estimate while kerr-mini
// is away; not the plan's ΔGPU on J0 in flight). J0's scene (the F-35's cockpit, 500 m over the Rade d'Hyères), frozen and settled;
// for each lever of LEVERS (J2DG_LEVERS: edgeFoot, singleHistory, earthRateOne, disocclusion) ROUNDS (J2DG_ROUNDS, 6) rounds of off, on —
// the order swapped every other round (A B B A …) —, each 20 images to settle then 60 measured (renderer.lastGpuMs, the passes of the
// profiler); per lever the mean of the rounds' differences of their p50, its spread (the rounds' own), and the passes that moved.
// J2DG_OUT (remote-results/j2-dgpu). The thermal state before and after.
// Duration: ~4 min (boot and tiles ~2, ~25 s a lever).
// Done when: every lever measured, no GPU error.

const OUT = process.env.J2DG_OUT ?? "remote-results/j2-dgpu";
const ROUNDS = Number(process.env.J2DG_ROUNDS ?? 6);
const LEVERS: Record<string, [string, string]> = {
  edgeFoot: ["__bh.renderer.earthTiles.edgeFoot = true;", "__bh.renderer.earthTiles.edgeFoot = false;"],
  singleHistory: ["__bh.renderer.singleHistory = true;", "__bh.renderer.singleHistory = false;"],
  earthRateOne: ["__bh.renderer.earthRateOne = true;", "__bh.renderer.earthRateOne = false;"],
  disocclusion: ["__bh.renderer.disocclusionOn = true;", "__bh.renderer.disocclusionOn = false;"],
};
const WANT = (process.env.J2DG_LEVERS ?? Object.keys(LEVERS).join(",")).split(",");
afterAll(stopServer);

const thermal = async () => (await $`bun scripts/thermal.ts status`.quiet().nothrow()).stdout.toString().split("\n")[0]?.trim();

/** in the page: 20 images to settle, then 60 measured — the GPU's p50 and the profiler's passes */
const MEASURE = `(async () => {
  const R = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
  for (let i = 0; i < 20; i++) { __bh.touch(); await f(); }
  R.prof.enabled = true; R.prof.every = 1; R.prof.reset();
  const v = [];
  for (let i = 0; i < 60; i++) { __bh.touch(); await f(); if (R.lastGpuMs > 0) v.push(R.lastGpuMs); }
  v.sort((a, b) => a - b);
  const T = R.prof.table();
  return { p50: v[Math.floor(v.length / 2)] ?? null, n: v.length, passes: Object.fromEntries(T.map((x) => [x.label, +x.ms.toFixed(3)])) }; })()`;

test.skipIf(!E2E)(
  "J2: the levers' GPU cost on J0's frozen view, interleaved",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const out: Record<string, unknown> = { thermalBefore: await thermal() };
    const app = await App.boot({ width: 1440, height: 810, lang: "fr", hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const [lat, lon, agl, hdg, v] = J0_SCENE.start;
      await app.js(`(async () => { __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${v});
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
        for (let i = 0; i < 40; i++) await new Promise((q) => requestAnimationFrame(q)); __bh.freeze(true); return 1; })()`);
      await app.settled(180_000);
      await app.dataSettled("J2 dgpu: J0", { maxMs: 60_000 }).catch((e) => console.log(`  (data not settled: ${String(e).slice(0, 120)})`));
      // (every lever off first: each measured against the others off)
      await app.js(
        `(() => { ${Object.values(LEVERS)
          .map(([, off]) => off)
          .join(" ")} return 1; })()`,
      );
      for (const name of WANT) {
        const lever = LEVERS[name];
        if (!lever) throw new Error(`J2DG_LEVERS: ${name} unknown`);
        const rounds: { off: number | null; on: number | null; passesOff: Record<string, number>; passesOn: Record<string, number> }[] = [];
        for (let r = 0; r < ROUNDS; r++) {
          const order: ("off" | "on")[] = r % 2 === 0 ? ["off", "on"] : ["on", "off"];
          const row: Record<string, unknown> = {};
          for (const side of order) {
            await app.js(`(() => { ${side === "on" ? lever[0] : lever[1]} return 1; })()`);
            const m = await app.js<{ p50: number | null; passes: Record<string, number> }>(MEASURE);
            row[side] = m.p50;
            row[side === "on" ? "passesOn" : "passesOff"] = m.passes;
          }
          rounds.push(row as (typeof rounds)[number]);
        }
        await app.js(`(() => { ${lever[1]} return 1; })()`);
        const d = rounds.filter((x) => x.on != null && x.off != null).map((x) => x.on! - x.off!);
        const mean = d.reduce((a, b) => a + b, 0) / Math.max(d.length, 1);
        const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(d.length - 1, 1));
        const offP50 = rounds.map((x) => x.off).filter((x): x is number => x != null);
        // (the passes that moved: their mean on − off over the rounds, over 0.05 ms)
        const keys = new Set(rounds.flatMap((x) => [...Object.keys(x.passesOn ?? {}), ...Object.keys(x.passesOff ?? {})]));
        const moved: Record<string, number> = {};
        for (const k of keys) {
          const dd = rounds.map((x) => (x.passesOn?.[k] ?? 0) - (x.passesOff?.[k] ?? 0));
          const m = dd.reduce((a, b) => a + b, 0) / dd.length;
          if (Math.abs(m) > 0.05) moved[k] = +m.toFixed(3);
        }
        out[name] = {
          deltaMs: +mean.toFixed(3),
          sdMs: +sd.toFixed(3),
          rounds: d.map((x) => +x.toFixed(2)),
          offP50: offP50.map((x) => +x.toFixed(1)),
          moved,
        };
        console.log(`  ${name}: ${JSON.stringify(out[name])}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      app.close();
    }
    out.thermalAfter = await thermal();
    await Bun.write(`${OUT}/dgpu.json`, JSON.stringify(out, null, 1));
    console.log(`  thermal: ${out.thermalBefore} → ${out.thermalAfter}`);
    expect(out.gpuErrors).toBe(0);
  },
  600_000,
);
