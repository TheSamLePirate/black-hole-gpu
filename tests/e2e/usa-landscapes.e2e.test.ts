import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// American landscapes (RECHERCHE-DONNEES lot D; Sam, 6 Nov 2026 « des e2e de beaux paysages USA, ville + campagne + littoral »):
// Manhattan from over the Hudson, the Napa Valley's vineyards, Big Sur's coast — each with the USA's data (Mapterhorn's 3DEP
// relief, the National Map's imagery brought to EOX's colours by its table per channel, usa-colour.ts) and with the orthophotos
// off (EOX alone): the two shots side by side, the ground's mean colour in each (the lower half of the image) — the imagery's
// colours matched to the rest of the Earth's: their means within 25 levels a channel.
// (E2E_SHOTS=<dir>: usa-<place>-ortho / -eox.)
// Duration: ~4 min here.
// Done when: each place shot both ways, the source "usa", the means close, no lost craft, no console error.

const PLACES = [
  { name: "manhattan", fly: [40.69, -74.035, 650, 150, 25], date: "2026-06-15T22:30:00Z" },
  { name: "napa", fly: [38.36, -122.33, 500, 140, 330], date: "2026-06-15T19:00:00Z" },
  { name: "bigsur", fly: [36.27, -121.86, 450, 140, 150], date: "2026-06-15T23:30:00Z" },
] as const;

describe.skipIf(!E2E)("American landscapes: city, countryside, coast", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: true, f35AutoProtect: false }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const loaded = () =>
    app
      .waitFor(
        `(() => { const t = __bh.renderer.earthTiles, s = __bh.renderer.earthScenery.stats(); return t.pending === 0 && t.orthoPending === 0 && !s.pending; })()`,
        120_000,
      )
      .catch(() => console.log("  (still loading after 120 s)"));
  const shoot = async (name: string, fly: readonly number[], date: string) => {
    await app.js(`(() => { __bh.game.setDate("${date}"); return 1; })()`);
    await Bun.sleep(800);
    await app.js(`(() => { __bh.freeze(false); __bh.game.flyAt(${fly.join(", ")}); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(__bh.freeze(true), 1)`);
    await loaded();
    await app.js(
      `(() => { Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, motionBlur: 0 }); __bh.renderer.rasterFellBack = false; return 1; })()`,
    );
    await app.settled();
    await Bun.sleep(3000);
    const file = `${shots ?? "remote-results/usa-landscapes"}/usa-${name}.png`;
    await Bun.$`mkdir -p ${file.slice(0, file.lastIndexOf("/"))}`;
    await app.shot(file);
    await app.js(
      `(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true, earthRasterScale: 0.75, motionBlur: 0.5 }); return 1; })()`,
    );
    return file;
  };
  // (the image's lower half's mean colour: the ground under the chase view — the craft's few pixels in it)
  const groundMean = async (file: string) => {
    const out =
      await Bun.$`python3 -I -c ${"import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB'); w,h=im.size\nc=im.crop((0,int(h*0.62),w,int(h*0.95))).resize((64,32)); px=list(c.getdata())\nprint(*[round(sum(p[i] for p in px)/len(px),1) for i in range(3)])"} ${file}`.text();
    return out.trim().split(" ").map(Number);
  };

  test("Manhattan, Napa, Big Sur: the USA's imagery against EOX's alone — their colours matched", async () => {
    const report: Record<string, unknown> = {};
    for (const p of PLACES) {
      await app.js(`(() => { __bh.settings.earthOrtho = true; return 1; })()`);
      const a = await shoot(`${p.name}-ortho`, p.fly, p.date);
      const national = await app.js<string | null>(`__bh.renderer.earthTiles.nationalAt`);
      const ortho = await app.js<number>(`__bh.renderer.earthTiles.orthoFinest`);
      await app.js(`(() => { __bh.settings.earthOrtho = false; return 1; })()`);
      const b = await shoot(`${p.name}-eox`, p.fly, p.date);
      const ma = await groundMean(a),
        mb = await groundMean(b);
      report[p.name] = { national, ortho, ortho_mean: ma, eox_mean: mb };
      console.log(`  ${p.name}: source ${national}, orthophotos to z ${ortho}, ground mean ortho ${ma.join("/")} · EOX ${mb.join("/")}`);
      expect(national).toBe("usa");
      expect(ortho).toBeGreaterThanOrEqual(15);
      for (let c = 0; c < 3; c++) expect(Math.abs(ma[c]! - mb[c]!)).toBeLessThan(25);
    }
    await Bun.write(`${shots ?? "remote-results/usa-landscapes"}/means.json`, JSON.stringify(report, null, 1));
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
