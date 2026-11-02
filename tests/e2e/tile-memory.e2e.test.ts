import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { type Pixels, readPng } from "./lib/png";

// T10 — the tiles' memory (docs/PLAN-REFRACTION-HORIZONS.md): the Earth's tiles' texture at the very far reach (the default)
// packs its 4-tile levels by quadrants — 7 layers of 2048² where there were 13. Views: Paris from 300 m (the IGN's relief to
// z 17 and its orthophotos: the packed levels), Chamonix at noon, the Alps from 30 km (the coarse levels), the Moon's
// Triesnecker from 4 km (its own tiles, whose params changed with the Earth's). Each: the texture's bytes read from the GPU
// texture itself (either side of an A/B), the levels drawn, a shot without the interface. Then the reach switched to normal and
// back: the peak while two textures live (EarthTiles.peakBytes; absent before T10).
// As an A/B (scripts/ab-e2e.ts, A B B A) the last run compares the shots: A against B within A against A (the noise).
// Done when: every view's tiles are in (two at most still coming after 60 s), no GPU error,
// and the images match as A matches A. Shots and figures in remote-results/tile-memory. Duration: ~3 min (this Mac).
const OUT = "remote-results/tile-memory";
const SIDE = process.env.AB_SIDE ?? "",
  RUN = process.env.AB_RUN ?? "";
const TAG = SIDE ? `${SIDE}${RUN}` : "solo";
afterAll(stopServer);
const EARTH = [
  { name: "paris-300m", at: [48.857, 2.3, 300, 60, 120], date: "2026-07-10T09:30:00Z" },
  { name: "chamonix-noon", at: [45.9, 6.85, 450, 90, 120], date: "2026-07-10T11:30:00Z" },
  { name: "alps-30km", at: [45.9, 6.85, 30000, 90, 200], date: "2026-07-10T11:30:00Z" },
];
/** the share of pixels whose colour moved by more than a step */
const differ = (a: Pixels, b: Pixels) => {
  let n = 0;
  for (let i = 0; i < a.data.length; i += a.channels)
    if (Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!) > 24) n++;
  return n / (a.width * a.height);
};
const MEM = `(() => { const t = __bh.renderer.earthTiles, x = t.texture;
  return { w: x.width, layers: x.depthOrArrayLayers, bytes: x.width * x.height * x.depthOrArrayLayers * 8, peak: t.peakBytes ?? null,
    finest: t.finest, ortho: t.orthoFinest, pending: t.pending, orthoPending: t.orthoPending, gpuErrors: __bh.renderer.gpuErrors }; })()`;

test.skipIf(!E2E)(
  "the tiles' memory: the 4-tile levels by quadrants, the same images",
  async () => {
    mkdirSync(`${OUT}/${TAG}`, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const frames = (n: number) =>
      app.js(
        `new Promise((r) => { let k = 0; const f = () => { __bh.touch(); if (++k < ${n}) requestAnimationFrame(f); else r(1); }; f(); })`,
      );
    const shot = async (name: string) => {
      await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
      await frames(4);
      const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
      await Bun.write(`${OUT}/${TAG}/${name}.png`, Buffer.from(data, "base64"));
    };
    const out: Record<string, unknown> = {};
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, detailReach: "veryFar", dynamicResolution: false, motionBlur: 0, dof: false }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
    for (const v of EARTH) {
      const place = `__bh.game.flyAt(${v.at.join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
      await app.js(`(() => { __bh.game.setDate(${JSON.stringify(v.date)}); ${place} __bh.freeze(true); return 1; })()`);
      const fine = v.at[2]! > 5000 ? 10 : 14;
      const tiles = await app
        .waitFor(
          `(() => { const t = __bh.renderer.earthTiles; return t.pending <= 2 && t.orthoPending <= 2 && t.finest >= ${fine}; })()`,
          60_000,
        )
        .then(
          () => true,
          () => false,
        );
      const m0 = await app.js<Record<string, number>>(MEM);
      if (!tiles) console.log(`  ${v.name}: tiles not all in after 60 s — ${JSON.stringify(m0)}`);
      await app.js(`(() => { ${place} return 1; })()`);
      await app.settled();
      await frames(90);
      await shot(v.name);
      const m = await app.js<Record<string, number>>(MEM);
      out[v.name] = { ...m, tiles };
      console.log(`  ${v.name}: ${JSON.stringify(m)}`);
    }
    // (the reach switched to normal and back: the texture made twice, the old one alive until the work with it is done)
    const reach = await app.js<
      Record<string, unknown>
    >(`(async () => { const s = __bh.settings, frame = () => new Promise((q) => requestAnimationFrame(() => q(1)));
      const t = __bh.renderer.earthTiles; s.detailReach = "normal"; for (let i = 0; i < 20; i++) { __bh.touch(); await frame(); }
      const normal = { layers: t.texture.depthOrArrayLayers, bytes: t.texture.width ** 2 * t.texture.depthOrArrayLayers * 8 };
      s.detailReach = "veryFar"; for (let i = 0; i < 20; i++) { __bh.touch(); await frame(); }
      return { normal, veryFar: { layers: t.texture.depthOrArrayLayers, bytes: t.texture.width ** 2 * t.texture.depthOrArrayLayers * 8 }, peak: t.peakBytes ?? null, gpuErrors: __bh.renderer.gpuErrors }; })()`);
    console.log(`  reach normal → very far: ${JSON.stringify(reach)}`);
    out.reach = reach;
    expect(reach.gpuErrors).toBe(0);
    // (the Moon: its tiles through the same binding and params)
    await app.js(
      `(() => { __bh.presets.t10moon = { ...__bh.presets["Mars: from orbit"], target: "moon", fov: 60, ship: false, pose: { at: [3.45, 3.6], body: "moon", altKm: 4, look: "moon", off: [0, 66] } }; __bh.game.preset("t10moon"); Object.assign(__bh.settings, { animate: false, dynamicResolution: false, dof: false, motionBlur: 0 }); return 1; })()`,
    );
    const moon = await app.waitFor(`(() => { const m = __bh.renderer.moonTiles; return m.drawn && m.pending === 0; })()`, 60_000).then(
      () => true,
      () => false,
    );
    await app.settled();
    await frames(120);
    await shot("moon-triesnecker");
    const ms = await app.js<Record<string, unknown>>(
      `(() => { const m = __bh.renderer.moonTiles; return { drawn: m.drawn, loaded: m.loaded, failed: m.failed, gpuErrors: __bh.renderer.gpuErrors }; })()`,
    );
    console.log(`  moon: ${JSON.stringify(ms)}`);
    out.moon = { ...ms, ready: moon };
    expect(moon).toBe(true);
    expect(ms.gpuErrors).toBe(0);
    writeFileSync(`${OUT}/${TAG}/tile-memory.json`, JSON.stringify(out, null, 1));
    app.close();
    // (every view's tiles in — two at most still coming: a slow one on the mini's network —, no GPU error)
    for (const v of EARTH) {
      const r = out[v.name] as { tiles: boolean; gpuErrors: number };
      expect(r.tiles, `${v.name}: its tiles not in within 60 s`).toBe(true);
      expect(r.gpuErrors).toBe(0);
    }
    // (the A/B's last run: the shots compared — A against A, B against B, A against B —, each run's tiles still pending noted: a
    // last tile come in one run and not another is another relief, not another build — the best A/B pair within 3 × the
    // larger same-build one)
    if (RUN === "4") {
      const names = [...EARTH.map((v) => v.name), "moon-triesnecker"];
      const read = (t: string, n: string) => (existsSync(`${OUT}/${t}/${n}.png`) ? readPng(readFileSync(`${OUT}/${t}/${n}.png`)) : null);
      const pending = (t: string, n: string) =>
        existsSync(`${OUT}/${t}/tile-memory.json`)
          ? ((JSON.parse(readFileSync(`${OUT}/${t}/tile-memory.json`, "utf8")) as Record<string, { pending?: number }>)[n]?.pending ?? null)
          : null;
      const cmp: Record<string, Record<string, number | null>> = {};
      for (const n of names) {
        const shots = Object.fromEntries(["A1", "B2", "B3", "A4"].map((t) => [t, read(t, n)]));
        const c: Record<string, number | null> = {};
        for (const t of ["A1", "B2", "B3", "A4"]) c[`pending ${t}`] = pending(t, n);
        for (const [a, b] of [
          ["A1", "A4"],
          ["B2", "B3"],
          ["A1", "B2"],
          ["A4", "B3"],
        ] as const)
          if (shots[a] && shots[b]) c[`${a}/${b}`] = differ(shots[a]!, shots[b]!);
        cmp[n] = c;
        console.log(`  ${n}: ${JSON.stringify(c)}`);
        const same = Math.max(c["A1/A4"] ?? 0, c["B2/B3"] ?? 0),
          ab = Math.min(c["A1/B2"] ?? 1, c["A4/B3"] ?? 1);
        expect(ab).toBeLessThan(Math.max(3 * same, 0.002));
      }
      writeFileSync(`${OUT}/compare.json`, JSON.stringify(cmp, null, 1));
    }
  },
  10 * 60_000,
);
