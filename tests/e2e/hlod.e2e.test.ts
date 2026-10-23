import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The far silhouettes over France (docs/ANALYSE-IGN-LIDAR.md I6, src/system/earth-tiles.ts addOverground): on the far levels
// (z 11 … 13) the IGN's surface less its ground — Paris's towers, its roofs, the woods' tops —, the highest of each texel's
// samples kept (settings.earthIgnSilhouettes). From 20 km north-east of the Tour Montparnasse, low over the fields of Gonesse in
// the cockpit, the evening sun behind Paris, held,
// in the raster pipeline: the ground the game draws under three towers against the LiDAR's own surface there (a source apart:
// its top within 60 m), the ground its physics stands on there still bare; the GPU's passes on / off / on / off — their medians, at one pixel in two and in four shaded —, the
// same pixels; a held view of each, and through a 6° field.
// (E2E_SHOTS=<dir>: hlod-paris-on / -off, -on-tele / -off-tele.)
// Duration: ~14 min on kerr-mini.
// Done when: with the silhouettes the towers' tops within a quarter of their overground of the LiDAR's (without: 150 m and
// more under), the earth's passes measured on and off, under an eighth more with them.

const TOWERS = [
  { name: "Tour Montparnasse", lat: 48.8421, lon: 2.3219 },
  { name: "Tour First", lat: 48.8958, lon: 2.2389 },
  { name: "Tour Eiffel", lat: 48.8583, lon: 2.2945 },
];
// (the eye: 20 km from the Tour Montparnasse on a bearing of 40°, heading 220° back at it)
const D = Math.PI / 180;
const EYE = {
  lat: TOWERS[0]!.lat + (20 / 111.2) * Math.cos(40 * D),
  lon: TOWERS[0]!.lon + (20 / (111.2 * Math.cos(TOWERS[0]!.lat * D))) * Math.sin(40 * D),
};

describe.skipIf(!E2E)("the far silhouettes", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: true, earthIgnSilhouettes: true, f35AutoProtect: false }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const lost = () => app.js<string | null>(`document.querySelector(".craft-lost .cl-why")?.textContent ?? null`);
  const loaded = (what: string) =>
    app
      .waitFor(`(() => { const t = __bh.renderer.earthTiles; return t.pending === 0 && t.orthoPending === 0; })()`, 180_000)
      .catch(async () =>
        console.log(
          `  (${what}: still loading after 180 s — ${await app.js<string>(`JSON.stringify({ tiles: __bh.renderer.earthTiles.pending, ortho: __bh.renderer.earthTiles.orthoPending })`)})`,
        ),
      );
  // (the game's ground under each tower — its top within 60 m, over the sea: less the geoid — against the LiDAR's surface's
  // top there, asked of the WMS-R over the same 120 m square)
  const towers = () =>
    app.js<{ name: string; game: number; bare: number; lidar: number; ground: number }[]>(`(async () => {
      const D = Math.PI / 180, R = 6378137, out = [];
      for (const t of ${JSON.stringify(TOWERS)}) {
        const dLat = 60 / 111200, dLon = 60 / (111200 * Math.cos(t.lat * D));
        let game = -1e9, bare = -1e9;
        for (let j = -12; j <= 12; j++) for (let i = -12; i <= 12; i++) {
          const la = t.lat + (j / 12) * dLat, lo = t.lon + (i / 12) * dLon;
          const q = [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];
          game = Math.max(game, __bh.renderer.earthTiles.heightAt(q, 1, true).h);
          bare = Math.max(bare, __bh.sys.groundAt(la, lo) - __bh.sys.geoid(la, lo));
        }
        const X = R * t.lon * D, Y = R * Math.log(Math.tan(Math.PI / 4 + (t.lat * D) / 2)), h = 60 / Math.cos(t.lat * D);
        let lidar = NaN, ground = NaN;
        for (let attempt = 0; attempt < 4 && Number.isNaN(lidar); attempt++) {
          const r = await fetch("https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G&STYLES=&CRS=EPSG:3857&BBOX=" + [X - h, Y - h, X + h, Y + h].join(",") + "&WIDTH=160&HEIGHT=160&FORMAT=image/x-bil;bits=32");
          if (r.ok) { const v = Array.from(new Float32Array(await r.arrayBuffer())).filter((e) => e > -100 && e < 2000); lidar = Math.max(...v); ground = Math.min(...v); }
          else await new Promise((q) => setTimeout(q, 1000 * 2 ** attempt));
        }
        out.push({ name: t.name, game, bare, lidar, ground });
      }
      return out;
    })()`);
  // (the GPU's passes over 40 frames drawn, the view held and the pixels pinned: the scale, the shading's rate)
  const PINNED = `{ dynamicResolution: false, earthRasterShading: "half", earthRasterScale: 0.75, motionBlur: 0.5 }`;
  const passes = async (what: string, rate: "half" | "quarter") => {
    await app.js(
      `(() => { Object.assign(__bh.settings, ${PINNED}, { earthRasterShading: "${rate}" }); __bh.renderer.rasterFellBack = false; return 1; })()`,
    );
    await app.settled();
    await Bun.sleep(3000);
    const r = await app.js<{
      n: number;
      trace: number;
      shade: number;
      vis: number;
      cache: number;
      all: number;
      pipe: string;
    }>(`(async () => {
      const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
      r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
      for (let i = 0; i < 20; i++) await frame();
      r.prof.reset();
      let done = 0, last = r.lastDoneAt, n = 0; const runs = { trace: [], shade: [], vis: [], cache: [], all: [] };
      while (done < 40) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++;
        const tb = r.prof.table(), get = (l) => tb.find((p) => p.label === l)?.last ?? 0;
        if (!tb.length) continue;
        n++; runs.trace.push(get("trace")); runs.shade.push(get("earth shade (raster)")); runs.vis.push(get("terrain raster visibility"));
        runs.cache.push(get("terrain surface cache")); runs.all.push(tb.reduce((s, p) => s + p.last, 0)); } }
      const med = (v) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : 0);
      return { n, trace: med(runs.trace), shade: med(runs.shade), vis: med(runs.vis), cache: med(runs.cache), all: med(runs.all), pipe: r.earthPipelineNow(__bh.settings) };
    })()`);
    console.log(
      `  ${what} (${rate}): trace ${r.trace.toFixed(2)} ms, raster shading ${r.shade.toFixed(2)} ms, visibility ${r.vis.toFixed(2)} ms, surface cache ${r.cache.toFixed(2)} ms, all passes ${r.all.toFixed(2)} ms (${r.n} frames, ${r.pipe})`,
    );
    expect(r.pipe).toBe("raster");
    expect(r.n).toBeGreaterThanOrEqual(20);
    return r;
  };
  const shot = async (name: string) => {
    if (!shots) return;
    await app.js(
      `(() => { Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, motionBlur: 0 }); __bh.renderer.rasterFellBack = false; return 1; })()`,
    );
    await app.settled();
    await Bun.sleep(3000);
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/hlod-paris-${name}.png`);
    // (and through a 6° field: the skyline at 20 km, a tower some 80 px high)
    // (the look lowered by the craft's pitch: the horizon in the field's middle)
    await app.js(
      `(() => { window.__fov = __bh.settings.fov; __bh.settings.fov = 6; __bh.camera.setLook(0, -((__bh.camera.attitudeNow().pitch ?? 0) * 180) / Math.PI); return 1; })()`,
    );
    await app.settled();
    await Bun.sleep(3000);
    await app.shot(`${shots}/hlod-paris-${name}-tele.png`);
    await app.js(
      `(() => { __bh.settings.fov = window.__fov; __bh.camera.setLook(0, 0); Object.assign(__bh.settings, ${PINNED}); return 1; })()`,
    );
  };
  const toggle = async (on: boolean) => {
    await app.js(`(() => { __bh.settings.earthIgnSilhouettes = ${on}; return 1; })()`);
    await Bun.sleep(1500);
    await loaded(on ? "with the silhouettes" : "without");
  };

  test("20 km from Paris: its towers on the horizon, their tops the LiDAR's; the passes as without", async () => {
    // (the date set, a second for the clock to take it, then the jump — never in the same tick)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T16:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    // (the cockpit, low over the fields north-east of Paris, heading for it; held there: the tiles stream in all the same)
    await app.js(`(() => { __bh.game.flyAt(${EYE.lat}, ${EYE.lon}, 100, 220, 120); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(__bh.freeze(true), 1)`);
    await loaded("with the silhouettes");
    // (level, the horizon in the view: no fly-up — the Auto-GCAS off, its 45 m and more of margin taken at 100 m over the fields)
    const pitch = await app.js<number>(`((__bh.camera.attitudeNow().pitch ?? 0) * 180) / Math.PI`);
    console.log(`  pitch ${pitch.toFixed(1)}°`);
    expect(Math.abs(pitch)).toBeLessThan(10);
    console.log(
      `  view: ${await app.js<string>(`__bh.settings.shipMount`)} at ${EYE.lat.toFixed(4)}, ${EYE.lon.toFixed(4)}, 20 km from the Tour Montparnasse`,
    );
    const on = await towers();
    for (const t of on)
      console.log(
        `  with: ${t.name} — drawn ${t.game.toFixed(0)} m, the physics' ground ${t.bare.toFixed(0)} m, the LiDAR ${t.lidar.toFixed(0)} m`,
      );
    const a = [await passes("with the silhouettes", "half"), await passes("with the silhouettes", "quarter")];
    await shot("on");
    await toggle(false);
    const off = await towers();
    for (const t of off)
      console.log(
        `  without: ${t.name} — drawn ${t.game.toFixed(0)} m, the physics' ground ${t.bare.toFixed(0)} m, the LiDAR ${t.lidar.toFixed(0)} m`,
      );
    const b = [await passes("without", "half"), await passes("without", "quarter")];
    await shot("off");
    await toggle(true);
    const c = [await passes("with them again", "half"), await passes("with them again", "quarter")];
    await toggle(false);
    const d = [await passes("without again", "half"), await passes("without again", "quarter")];
    // (the passes the silhouettes touch: the trace's march, the raster's shading and visibility — the rest the same work)
    type Passes = Awaited<ReturnType<typeof passes>>;
    const earth = (r: Passes) => r.trace + r.shade + r.vis;
    const costs = [0, 1].map((k) => {
      const on2 = (earth(a[k]!) + earth(c[k]!)) / 2,
        off2 = (earth(b[k]!) + earth(d[k]!)) / 2;
      console.log(
        `  the silhouettes' cost at ${k ? "one in four" : "one in two"}: ${(on2 - off2).toFixed(2)} ms on the earth's passes, ${((100 * (on2 - off2)) / off2).toFixed(1)} % (on ${earth(a[k]!).toFixed(2)} / ${earth(c[k]!).toFixed(2)}, off ${earth(b[k]!).toFixed(2)} / ${earth(d[k]!).toFixed(2)})`,
      );
      return { cost: on2 - off2, off: off2 };
    });
    await app.js(`(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true }); return 1; })()`);
    expect(await lost()).toBeNull();
    // (Montparnasse and First: their tops on the horizon within 30 m; without, the bare ground's 150 m and more under)
    for (const k of [0, 1]) {
      expect(Math.abs(on[k]!.game - on[k]!.lidar)).toBeLessThan(0.25 * (on[k]!.lidar - on[k]!.ground));
      expect(off[k]!.lidar - off[k]!.game).toBeGreaterThan(150);
      // (the physics' ground — contacts, the Auto-GCAS's terrain — bare either way: the tower not a hill to it)
      expect(on[k]!.lidar - on[k]!.bare).toBeGreaterThan(150);
    }
    // (the lattice's top: within 100 m — a 50 m texel's highest sample)
    expect(on[2]!.lidar - on[2]!.game).toBeLessThan(100);
    for (const k of costs) expect(k.cost).toBeLessThan(0.125 * k.off);
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
