import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// (25 Nov 2026) traffic-free-camera's followed ship in San Francisco Bay — a fishing boat of the sea's own life, 76 m behind it at
// ~18 m over the water, 2067-01-01 15:00 UTC (dawn there), no craft, as that test boots (its tiles not asked: « Relief … failed ») —:
// buildings drawn upside down in the sky above the far shore (the chase view 17 m over Brisbane Lagoon stood under the coarse relief
// drawn without the fine tiles: the town's ground and houses seen from beneath — fixed by aboveEarthGround, subjectcam.ts), and dark
// patches floating on the water. The same view held still, its
// image and, over its upper half, what the visibility drew there (renderer.surfaceAt: kind, distances); then the same image with parts
// left out, each in turn, to find the owner. SSS_TILES=1: the relief's tiles asked.
// Steps: 1 boot · 2 no craft, the free camera over the bay · 3 a ship followed · 4 the images and the probes.
// Duration: ~3 min here.
// The probe's witnesses (25 Nov 2026, this Mac): the chase view's height over the ground there without the fix −27.5 m (no tiles) and
// −19.1 m (the tiles in: the view 76 m behind the boat over the lagoon's shore, 35 m above the sea) — it fails; with the fix +2.5 m;
// the overview 1.2 km up over its ground (asserted here: > 500 m).
// Done when: the view stands over the ground drawn there (sys.heightOverGround > 0) — its upside-down world gone.

const OUT = process.env.SSS_OUT ?? "remote-results/sf-ship-sky";
const BAY = { lat: 37.6, lon: -122.3, altM: 1200, heading: 290, pitch: -6 };
const fmtS = `(v) => v.toFixed(1) + " m/s"`;

describe.skipIf(!E2E)("San Francisco Bay: a followed ship, the sky over the far shore", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({
      width: 1600,
      height: 1000,
      hash: "scene=game:artemis",
      ...(process.env.SSS_TILES === "1" ? { tiles: true } : {}),
    });
    app.steps(["no craft, the free camera over the bay", "a ship followed", "the images and the probes"]);
    await app.js(
      `(() => { Object.assign(__bh.settings, { traffic: true, seaLife: true, autosave: false, trafficDelay: 60 }); return 1; })()`,
    );
  }, 420_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the sky above the far shore: what draws there", async () => {
    await app.step("no craft, the free camera over the bay");
    await app.js(
      `(() => { if (${JSON.stringify(process.env.SSS_NOCLAMP === "1")}) globalThis.__noClamp = true; __bh.settings.ship = false; __bh.refresh(); return 1; })()`,
    );
    await app.waitFor("!__bh.camera.piloting && !__bh.camera.spectating", 20_000);
    const why = await app.js<string | null>(
      `(() => __bh.viewAt(${BAY.lat}, ${BAY.lon}, { altM: ${BAY.altM}, heading: ${BAY.heading}, pitch: ${BAY.pitch}, fov: 60 }) ?? null)()`,
    );
    expect(why).toBeNull();
    await app.waitFor("__bh.camera.seaNow().length >= 1", 45_000);
    // (the probe's negative witness: the overview 1.2 km up stands over its ground)
    const over = await app.js<number>(`__bh.sys.heightOverGround("earth", __bh.sys.homePosition(), __bh.sim.time)`);
    console.log(`  the overview over its ground: ${over.toFixed(0)} m`);
    expect(over).toBeGreaterThan(500);
    await app.stepDone("caméra libre sur la baie");

    await app.step("a ship followed");
    const sid = await app.js<string | null>(`(() => {
      const ov = __bh.camera.seaOverlay(${fmtS}, __bh.camera.viewController()), sog = new Map(__bh.camera.seaNow().map((c) => ["ais:" + c.id, c.sog]));
      const m = ov.find((x) => (sog.get(x.id) ?? 0) > 0.8) ?? ov[0]; return m ? m.id.slice(4) : null; })()`);
    if (!sid) throw new Error("no ship to follow");
    await app.js(`(() => { const vc = __bh.camera.viewController();
      __bh.settings.target = vc.s.target = "ais:${sid}"; __bh.settings.subjectView = vc.s.subjectView = "chase";
      vc.subject.yaw = vc.subject.pitch = 0; return 1; })()`);
    await app.waitFor(
      `(() => { const m = __bh.camera.seaOverlay(${fmtS}, __bh.camera.viewController()).find((x) => x.id === "ais:${sid}"); return !!m && m.dist < 2000; })()`,
      30_000,
    );
    await app.settled(60_000);
    if (process.env.SSS_TILES === "1")
      await app.dataSettled("the bay", { maxMs: 60_000 }).catch((e) => console.log(`  ${String(e).slice(0, 160)}`));
    const pose = await app.js<{
      clearance: number;
    }>(`(() => { const g = __bh.camera.viewController().geoNow(); const t = __bh.renderer.earthTiles;
      return { lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5), alt: +g.alt.toFixed(1), pending: t.pending, finest: t.finest,
        failed: t.failed ?? t.failedCount ?? null, ship: "${sid}",
        clearance: +__bh.sys.heightOverGround("earth", __bh.sys.homePosition(), __bh.sim.time).toFixed(2),
        groundAt: +__bh.sys.groundAt(g.lat, g.lon).toFixed(2), geoid: +__bh.sys.geoid(g.lat, g.lon).toFixed(2),
        contact: t.contactAt ? t.contactAt(g.lat, g.lon) : null }; })()`);
    console.log(`  the view: ${JSON.stringify(pose)}`);
    await app.stepDone(`navire ${sid} suivi`);

    await app.step("the images and the probes");
    const frames = `for (let i = 0; i < 60; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }`;
    await app.js(`(async () => { __bh.freeze(true); ${frames} return 1; })()`);
    await app.shot(`${OUT}/a-as-is.png`);
    // (the upper half's identity: a grid of 8 × 5 points over it)
    const grid = await app.js<
      { x: number; y: number; kind: string; object: number; ground: number; nearest: number; level: number }[]
    >(`(async () => {
      const out = []; for (let j = 0; j < 5; j++) for (let i = 0; i < 8; i++) { const x = (i + 0.5) / 8, y = 0.08 + j * 0.07;
        const s = await __bh.renderer.surfaceAt(x, y); out.push({ x: +x.toFixed(3), y: +y.toFixed(3), kind: s?.kind ?? "null", object: s?.object ?? -1,
          ground: s ? +s.ground.toFixed(1) : -1, nearest: s ? +s.nearest.toFixed(1) : -1, level: s?.level ?? -9 }); }
      return out; })()`);
    const kinds: Record<string, number> = {};
    for (const g of grid) kinds[g.kind] = (kinds[g.kind] ?? 0) + 1;
    console.log(`  the upper half's surfaces (40 points): ${JSON.stringify(kinds)}`);
    console.log(`  points: ${JSON.stringify(grid.filter((g) => g.kind !== "none").slice(0, 16))}`);
    // (the parts left out in turn — each image against the first: its pixels changed in the upper half)
    const parts: [string, string, string][] = [
      ["b-no-scenery", "__bh.settings.earthScenery = 'off'; __bh.refresh();", "__bh.settings.earthScenery = 'high'; __bh.refresh();"],
      ["c-no-lift", "__bh.renderer.liftOn = false;", "__bh.renderer.liftOn = true;"],
      ["d-no-rings", "__bh.renderer.rasterRingsOn = false;", "__bh.renderer.rasterRingsOn = true;"],
      ["e-no-cloud-shadows", "__bh.renderer.cloudShadowOn = false;", "__bh.renderer.cloudShadowOn = true;"],
      ["f-no-tree-shadows", "__bh.renderer.treeShadowOn = false;", "__bh.renderer.treeShadowOn = true;"],
      ["g-no-relief-shadows", "__bh.renderer.sunShadowOn = false;", "__bh.renderer.sunShadowOn = true;"],
    ];
    const A = readPng(new Uint8Array(await Bun.file(`${OUT}/a-as-is.png`).arrayBuffer()));
    const changed = (P: typeof A) => {
      let n = 0;
      for (let y = 60; y < A.height; y++)
        for (let x = 0; x < A.width; x++) {
          const i = y * A.width + x;
          let m = 0;
          for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(A.data[i * A.channels + c]! - P.data[i * P.channels + c]!));
          if (m > 40) n++;
        }
      return n;
    };
    for (const [name, off, on] of parts) {
      await app.js(`(async () => { ${off} ${frames} return 1; })()`);
      await app.settled(60_000);
      await app.js(`(async () => { ${frames} return 1; })()`);
      await app.shot(`${OUT}/${name}.png`);
      const P = readPng(new Uint8Array(await Bun.file(`${OUT}/${name}.png`).arrayBuffer()));
      console.log(`  ${name}: pixels changed ${changed(P)}`);
      await app.js(`(async () => { ${on} ${frames} return 1; })()`);
      await app.settled(60_000);
    }
    // (the view over the ground it is drawn over — its height over the contact ground there, sys.heightOverGround: under it, the
    // ground's underside and what stands on it seen from beneath, upside down)
    await app.stepDone(`la vue à ${pose.clearance} m au-dessus du sol`, pose.clearance > 0);
    expect(pose.clearance).toBeGreaterThan(0);
  }, 400_000);
});
