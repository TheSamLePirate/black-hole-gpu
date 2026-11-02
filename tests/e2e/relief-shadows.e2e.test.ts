import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { type Pixels, readPng } from "./lib/png";

// T6 — the relief's shadow cascades (docs/PLAN-REFRACTION-HORIZONS.md): over Chamonix from the F-35's cockpit, no clouds, the
// raster pipeline, each view drawn with the cascades and the contact shadows, without the contact shadows (liteSkip 16384),
// and without the map (renderer.sunShadowOn false). Done when: in a low Sun (5–7°) the cascades shade over 1 % of the image
// (the crests over the valley, the gullies), at noon under 0.2 % (no acne); in 8 s of flight they are drawn again on under a
// third of the frames (kept while the Sun, their grid-snapped centres and the heights stay), and a kept map — the view
// stepped 10 m — reads as one drawn again (no shadow sliding). The passes' costs logged ("terrain from the Sun", "earth lite").
// Shots and figures in remote-results/relief-shadows. Duration: ~4 min (this Mac).
const OUT = "remote-results/relief-shadows";
afterAll(stopServer);
const VIEWS = [
  { name: "east-noon", at: [45.9, 6.85, 450, 90, 120], date: "2026-07-10T11:30:00Z", low: false },
  { name: "east-1845", at: [45.9, 6.85, 450, 90, 120], date: "2026-07-10T18:45:00Z", low: true },
  { name: "north-1830", at: [45.88, 6.83, 900, 30, 120], date: "2026-07-10T18:30:00Z", low: true },
];
const darker = (a: Pixels, b: Pixels, by = 8) => {
  let n = 0;
  for (let i = 0; i < a.data.length; i += a.channels) {
    const la = 0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!;
    const lb = 0.2126 * b.data[i]! + 0.7152 * b.data[i + 1]! + 0.0722 * b.data[i + 2]!;
    if (la - lb > by) n++;
  }
  return n / (a.width * a.height);
};
const differ = (a: Pixels, b: Pixels) => {
  let n = 0;
  for (let i = 0; i < a.data.length; i += a.channels)
    if (Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) > 24) n++;
  return n / (a.width * a.height);
};

test.skipIf(!E2E)(
  "the relief's shadow cascades: the low Sun's shadows, no acne at noon, kept in flight, read where drawn",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const settle = (n = 60) =>
      app.js(
        `new Promise((r) => { let k = 0; const f = () => { __bh.touch(); if (++k < ${n}) requestAnimationFrame(f); else r(1); }; f(); })`,
      );
    const grab = async (file: string) => {
      const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      const b = Buffer.from(data, "base64");
      await Bun.write(file, b);
      return readPng(b);
    };
    const out: Record<string, unknown> = {};
    const place = (v: (typeof VIEWS)[number], dLat = 0, dLon = 0) =>
      `__bh.game.flyAt(${v.at[0]! + dLat}, ${v.at[1]! + dLon}, ${v.at.slice(2).join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
    for (const v of VIEWS) {
      await app.load("scene=game:artemis");
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.setDate(${JSON.stringify(v.date)}); return 1; })()`);
      await app.js(`(() => { ${place(v)} __bh.freeze(true); return 1; })()`);
      const tiles = await app.waitFor(`__bh.renderer.earthTiles.pending === 0 && __bh.renderer.earthTiles.finest >= 14`, 60_000).then(
        () => true,
        () => false,
      );
      if (!tiles) console.log(`  ${v.name}: tiles still pending after 60 s — measured all the same`);
      await app.js(`(() => { ${place(v)} return 1; })()`);
      await app.settled();
      const shots: Record<string, Pixels> = {};
      const cost: Record<string, unknown> = {};
      for (const [tag, set] of [
        ["on", "r.sunShadowOn = true; r.liteSkip = 0;"],
        ["nocontact", "r.sunShadowOn = true; r.liteSkip = 16384;"],
        ["off", "r.sunShadowOn = false; r.liteSkip = 16384;"],
      ] as const) {
        await app.js(`(() => { const r = __bh.renderer; ${set} __bh.touch(); return 1; })()`);
        cost[tag] =
          await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => q(null)));
          for (let i = 0; i < 40; i++) { __bh.touch(); await frame(); }
          __bh.game.perf(); r.prof.enabled = true; const t0 = performance.now();
          while (performance.now() - t0 < 3000) { __bh.touch(); await frame(); }
          const p = __bh.game.perf(); r.prof.enabled = false;
          const pick = (re) => +p.gpu.filter((x) => re.test(x.pass)).reduce((a, x) => a + x.ms, 0).toFixed(2);
          return { frame: +p.gpuFrameMs.toFixed(1), sun: pick(/terrain from the Sun/), lite: pick(/earth lite/) }; })()`);
        await settle(30);
        shots[tag] = await grab(`${OUT}/${v.name}-${tag}.png`);
      }
      const cascades = darker(shots.off!, shots.nocontact!),
        contact = darker(shots.nocontact!, shots.on!);
      out[v.name] = { cascades, contact, cost };
      console.log(
        `  ${v.name}: the cascades shade ${(cascades * 100).toFixed(2)} %, the contact shadows ${(contact * 100).toFixed(3)} % — ${JSON.stringify(cost)}`,
      );
      if (v.low) expect(cascades).toBeGreaterThan(0.01);
      else expect(cascades).toBeLessThan(0.002);
    }
    // (in flight: how often drawn again; then frozen, stepped 10 m: a kept map against one drawn now, and against itself — the noise)
    const v = VIEWS[2]!;
    await app.js(
      `(() => { const r = __bh.renderer; r.sunShadowOn = true; r.liteSkip = 0; __bh.freeze(false); const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); return 1; })()`,
    );
    const fly = await app.js<{
      frames: number;
      drawn: number;
      kept: number;
    }>(`(async () => { const tr = __bh.renderer.terrainRaster; const f0 = tr.sunFrames, s0 = tr.sunSkipped, t0 = performance.now(); let n = 0;
      while (performance.now() - t0 < 8000) { await new Promise((q) => requestAnimationFrame(() => q(1))); n++; }
      return { frames: n, drawn: tr.sunFrames - f0, kept: tr.sunSkipped - s0 }; })()`);
    console.log(`  flight 8 s: drawn on ${fly.drawn} of ${fly.drawn + fly.kept} frames`);
    const d = 10 / 111200;
    await app.js(
      `(() => { __bh.freeze(true); ${place(v, d * Math.cos(Math.PI / 6), (d * Math.sin(Math.PI / 6)) / Math.cos((v.at[0]! * Math.PI) / 180))} return 1; })()`,
    );
    await settle(90);
    const k0 = await grab(`${OUT}/stepped-kept-0.png`);
    await settle(90);
    const drewOnStep = await app.js<boolean>(`(() => __bh.renderer.terrainRaster.sunDrewNow)()`);
    const k1 = await grab(`${OUT}/stepped-kept.png`);
    await app.js(`(() => { __bh.renderer.terrainRaster.sunKey = ""; __bh.touch(); return 1; })()`);
    await settle(90);
    const redrawn = await grab(`${OUT}/stepped-redrawn.png`);
    const noise = differ(k0, k1),
      kept = differ(k1, redrawn);
    console.log(
      `  stepped 10 m: kept vs drawn again ${(kept * 100).toFixed(3)} % of the pixels, kept vs kept ${(noise * 100).toFixed(3)} % (the last frame drew: ${drewOnStep})`,
    );
    out.flight = { ...fly, kept, noise, drewOnStep };
    writeFileSync(`${OUT}/relief-shadows.json`, JSON.stringify(out, null, 1));
    expect(fly.drawn / Math.max(fly.drawn + fly.kept, 1)).toBeLessThan(1 / 3);
    expect(kept).toBeLessThan(Math.max(2 * noise, 0.005));
    app.close();
  },
  10 * 60_000,
);
