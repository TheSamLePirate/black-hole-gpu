import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { gpuTimes, showView } from "./lib/bridge-views";

// (26 Nov 2026, Sam's decision of 25 Nov — tests/detail-survey.test.ts) The procedural relief's finest layer faded where a survey holds
// the ground, the contact and the GPU by one rule. Over four places — a Paris street (IGN LiDAR), Mont Faron's wooded flank, the slopes
// above Chamonix, and the Toubkal massif (Morocco: the global data's alone, where nothing must change) —: an oblique image of each, and
// straight-down looks at three points of each where the ground the image draws (the visibility's ground distance under the image's
// centre: surfaceAt) is set against the contact's (sys.groundAt) — they must agree; in Paris a cross-section of the contact across the
// street, flat on its carriageway to the centimetre. Run on two builds (before and after the change) for the images' A/B, twice on
// one for their A/A. DS_OUT the folder.
// Duration: ~6 min on this Mac (the Earth data on disk).
// Done when: every straight-down look agrees within 0.1 m + 1.5 × the slope (the raster's mesh on steep ground), and the Paris
// carriageway's cross-section spans under 0.05 m.

// (as an A/B — scripts/ab-commit.ts + ab-e2e.ts, AB_SIDE A the build before —: a folder a run, the before side's span not asserted)
const SIDE = process.env.AB_SIDE ? `-${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : "";
const OUT = process.env.DS_OUT ?? `remote-results/detail-survey${SIDE}`;
const BEFORE = process.env.DS_BEFORE === "1" || process.env.AB_SIDE === "A";
const D = Math.PI / 180;
type Site = { key: string; at: [number, number]; look: [number, number]; holds: string };
const SITES: Site[] = [
  { key: "paris-street", at: [48.863487, 2.334983], look: [48.86362, 2.33468], holds: "sc.cellRoads > 0" },
  { key: "faron", at: [43.1365, 5.9305], look: [43.1405, 5.9405], holds: "true" },
  { key: "chamonix", at: [45.9305, 6.8545], look: [45.918, 6.872], holds: "true" },
  { key: "toubkal", at: [31.0712, -7.9095], look: [31.06, -7.92], holds: "true" },
];

describe.skipIf(!E2E)("the finest procedural relief over surveyed ground: contact and image agree, the global data's unchanged", () => {
  let app: App;
  const results: Record<string, unknown> = {};
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: true });
  }, 180_000);
  afterAll(() => {
    writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
    app?.close();
    stopServer();
  });

  for (const s of SITES)
    test(`${s.key}: its image, the ground drawn under three straight-down looks against the contact's`, async () => {
      await app.scenario(`${s.key} : image oblique, sol dessiné contre sol du contact`);
      // (the oblique image: 30 m over the place, looking 0.5–1.5 km off)
      const v = await showView(app, { key: s.key, at: s.at, aglM: 30, look: s.look, holds: s.holds });
      await app.shot(`${OUT}/${s.key}-oblique.png`);
      const gpu = await gpuTimes(app);
      // (three points: the place, 6 m and 15 m east of it — on the Paris street: its axis, its pavement, the block beyond)
      const looks: { east: number; contact: number; drawn: number; diff: number; slope: number; kind: string }[] = [];
      for (const east of [0, 6, 15]) {
        const lat = s.at[0],
          lon = s.at[1] + east / (111320 * Math.cos(lat * D));
        const agl = 25;
        const r = await app.js<{
          contact: number;
          slope: number;
          altM: number;
          d: number;
          kind: string;
          why: string | null;
        }>(`(async () => {
          const g = __bh.sys.groundAt(${lat}, ${lon}), altM = g + ${agl};
          // (the contact's slope there: its gradient over ±1 m east and north)
          const kx = 111320 * Math.cos(${lat} * ${D}), ky = 111132, G = (dn, de) => __bh.sys.groundAt(${lat} + dn / ky, ${lon} + de / kx);
          const slope = Math.hypot((G(0, 1) - G(0, -1)) / 2, (G(1, 0) - G(-1, 0)) / 2);
          const why = __bh.viewAt(${lat}, ${lon}, { altM, heading: 0, pitch: -90, fov: 30 });
          const vc = __bh.camera.viewController(); if (!why) { vc.s.fov = 30; vc.fovTarget = null; }
          for (let i = 0; i < 40; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
          const sf = await __bh.renderer.surfaceAt(0.5, 0.5);
          return { contact: g, slope, altM, d: sf?.ground ?? -1, kind: sf?.kind ?? "null", why };
        })()`);
        if (r.why) throw new Error(`${s.key}: the straight-down view refused — ${r.why}`);
        const drawn = r.altM - r.d;
        looks.push({
          east,
          contact: +r.contact.toFixed(3),
          drawn: +drawn.toFixed(3),
          diff: +(drawn - r.contact).toFixed(3),
          slope: +r.slope.toFixed(3),
          kind: r.kind,
        });
        if (east === 0) await app.shot(`${OUT}/${s.key}-down.png`);
      }
      // (Paris: the contact across the street — its carriageway ±3 m about the axis, 0.5 m apart)
      let section: number[][] | null = null;
      if (s.key === "paris-street")
        section = await app.js<number[][]>(`(() => {
          const a = ${JSON.stringify(s.at)}, b = ${JSON.stringify(s.look)}, kx = 111320 * Math.cos(a[0] * ${D}), ky = 111132;
          const e = (b[1] - a[1]) * kx, n = (b[0] - a[0]) * ky, L = Math.hypot(e, n), ue = e / L, un = n / L;
          const out = [];
          for (let o = -6; o <= 6; o += 0.5) {
            const pe = ue * 10 + un * o, pn = un * 10 - ue * o;
            out.push([o, +__bh.sys.groundAt(a[0] + pn / ky, a[1] + pe / kx).toFixed(3)]);
          }
          return out; })()`);
      const carriage = section ? section.filter(([o]) => Math.abs(o!) <= 3).map(([, h]) => h!) : [];
      const span = carriage.length ? Math.max(...carriage) - Math.min(...carriage) : null;
      results[s.key] = { view: v, gpu, looks, section, carriageSpan: span };
      console.log(
        `  ${s.key}: GPU p50 ${gpu.p50} ms; looks ${JSON.stringify(looks)}${section ? `; cross-section ${JSON.stringify(section)}; carriageway's span ${span?.toFixed(3)} m` : ""}`,
      );
      // (the tolerance: 0.1 m on level ground, growing with the slope — the raster's mesh between its vertices against the contact's
      // bicubic: 26 Nov, the Toubkal's global-data ground, untouched by the change, 0.1–0.6 m apart on 35 % slopes)
      const tol = (l: (typeof looks)[number]) => 0.1 + 1.5 * l.slope;
      await app.stepDone(
        `${s.key} : écart sol dessiné / contact max ${Math.max(...looks.map((l) => Math.abs(l.diff))).toFixed(3)} m${span !== null ? ` · chaussée ${span.toFixed(3)} m` : ""}`,
        looks.every((l) => Math.abs(l.diff) < tol(l)),
      );
      for (const l of looks) expect(l.kind).not.toBe("none");
      for (const l of looks) expect(Math.abs(l.diff)).toBeLessThan(tol(l));
      if (span !== null && !BEFORE) expect(span).toBeLessThan(0.05);
    }, 400_000);
});
