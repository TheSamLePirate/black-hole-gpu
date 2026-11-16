import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
// PLAN-J7 J7-1 — the ground under a final in the mountains, before and after the approach funnel: OIFK 11 (Kerman, ringed by mountains:
// the procedural detail raised +75 to +205 m bumps 3–6 km before its threshold, the A320 flared on one — PROBLEMES). The relief the world
// map's (tiles off, as approach-sample). A/B between two builds in one Chrome (AB_A_URL, AB_B_URL — scripts/ab-commit.ts with AB_CMD), else
// the test's own server alone (the local solar noon of the field). Each side: the F-35 placed 6 km out on the final, OIFK's world runway brought in and measured; the ground
// as stood on (sys.groundAt — the gear's) along the extended axis every 200 m to 12 km and across it 4.6 km out; the views from the cockpit
// down the final and from behind, frozen. AG_FIELD/AG_RWY: another end (the Altiplano's SLCB 05). Asserted on this tree: the ground stood on
// along the axis from 3 to 18.2 km the data's alone (sys.groundBareAt: the detail off to the initial point, Sam's decision of 16 Nov 2026);
// at OIFK the axis 3–9.5 km within 25 m of a straight line, the funnel's core smooth; the ground beyond the funnel as before (A/B).
// Duration: ~3 min a side on kerr-mini.
// Done when: every side measured and shot, j7-approach-ground-<field><rwy>.json written.
afterAll(stopServer);
const OUT = process.env.AB_OUT ?? "remote-results/j7-approach-ground";
// (the field and runway end: OIFK 11 by default; AG_FIELD, AG_RWY another — the Altiplano's SLCB 05, the approaches' worst)
const FIELD = process.env.AG_FIELD ?? "OIFK";
const RWY = process.env.AG_RWY ?? "11";
const SIDES = [
  ["A", process.env.AB_A_URL],
  ["B", process.env.AB_B_URL],
].filter((s): s is [string, string] => !!s[1]);
type Side = {
  bare: [number, number | null][];
  side: string;
  axis: [number, number][];
  across: [number, number][];
  thr: { lat: number; lon: number; elev: number; crs: number };
};
test.skipIf(!E2E)(
  "J7-1: the ground under OIFK 11's final — no invented bump on the axis, no step at the funnel's edge",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: false });
    if (!SIDES.length) SIDES.push(["H", app.url]);
    const out: Side[] = [];
    try {
      for (const [side, url] of SIDES) {
        (app as unknown as { url: string }).url = url;
        await app.load("scene=game:artemis");
        await app.scenario(`${side === "A" ? "A (avant)" : side === "B" ? "B (après)" : side} · ${FIELD} ${RWY} : le sol sous la trouée`);
        await app.waitFor("__bh.camera.piloting", 120_000);
        await app.js(
          `(() => { Object.assign(__bh.settings, { vessel: "f35", damage: false, dof: false, motionBlur: 0, traffic: false }); return 1; })()`,
        );
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
        const thr = await app.js<{ lat: number; lon: number; elev: number; crs: number }>(`__bh.sys.approaches("${FIELD}").then((l) => {
          const a = l.find((x) => x.rwy === "${RWY}"); return { lat: a.thr.lat, lon: a.thr.lon, elev: a.thr.elev, crs: a.crs }; })`);
        const D = Math.PI / 180;
        const back = (x: number, c = 0) => {
          // (x m before the threshold on the final's axis, c m to its right — flat offsets over a few km)
          const h = thr.crs * D;
          const n = -x * Math.cos(h) - c * Math.sin(h),
            e = -x * Math.sin(h) + c * Math.cos(h);
          return [thr.lat + n / 111_132, thr.lon + e / (111_320 * Math.cos(thr.lat * D))] as const;
        };
        const [lat6, lon6] = back(6000);
        await app.js(`(() => { __bh.game.setDate(new Date(Date.UTC(2026, 6, 10, 12) - ${thr.lon} / 15 * 3600e3).toISOString()); __bh.game.flyAt(${lat6}, ${lon6}, 450, ${thr.crs}, 80); __bh.settings.shipMount = "cockpit";
          __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
        // (OIFK's world runway in and measured: its level and its funnel graded)
        await app.waitFor(`__bh.sys.runways().some((r) => r.world?.field === "${FIELD}" && (r.world.measured ?? 0) >= 2)`, 60_000);
        await app.js(
          `(() => { __bh.game.flyAt(${lat6}, ${lon6}, 450, ${thr.crs}, 80); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`,
        );
        await app.settled(180_000);
        const pts = (list: [number, number][]) => JSON.stringify(list.map(([x, c]) => back(x, c)));
        const axisX = Array.from({ length: 101 }, (_, k) => k * 200);
        const acrossC = Array.from({ length: 41 }, (_, k) => -1000 + k * 50);
        const ground = (list: [number, number][]) =>
          app.js<number[]>(`${pts(list)}.map(([la, lo]) => +__bh.sys.groundAt(la, lo).toFixed(1))`);
        const axis = await ground(axisX.map((x) => [x, 0]));
        // (the same ground without the detail — the data's alone: sys.groundBareAt)
        // (an older build — the A side — has no groundBareAt: null there, the criterion judged on this tree alone)
        const bareAxis = await app.js<(number | null)[]>(
          `${pts(axisX.map((x) => [x, 0]))}.map(([la, lo]) => (__bh.sys.groundBareAt ? +__bh.sys.groundBareAt(la, lo).toFixed(1) : null))`,
        );
        const across = await ground(acrossC.map((c) => [4600, c]));
        out.push({
          side,
          thr,
          axis: axisX.map((x, k) => [x, axis[k]!]),
          bare: axisX.map((x, k) => [x, bareAxis[k]!]),
          across: acrossC.map((c, k) => [c, across[k]!]),
        });
        await app.js(`(() => { __bh.freeze(true); return 1; })()`);
        await Bun.sleep(3000);
        await app.shot(`${OUT}/${FIELD}${RWY}-${side}-cockpit.png`);
        await app.js(
          `(() => { __bh.freeze(false); __bh.settings.shipMount = "around"; Object.assign(__bh.camera.outside, { yaw: 90, pitch: 25, dist: 3500 }); return 1; })()`,
        );
        await Bun.sleep(1500);
        await app.js(`(() => { __bh.freeze(true); return 1; })()`);
        await Bun.sleep(3000);
        await app.shot(`${OUT}/${FIELD}${RWY}-${side}-behind.png`);
        await app.js(`(() => { __bh.freeze(false); __bh.settings.shipMount = "cockpit"; return 1; })()`);
        console.log(
          `  ${side}: axis 3–10 km ${JSON.stringify(out.at(-1)!.axis.filter(([x]) => x >= 3000 && x <= 10000 && x % 1000 === 0))}`,
        );
      }
      await Bun.write(`${OUT}/j7-approach-ground-${FIELD}${RWY}.json`, JSON.stringify(out, null, 1));
      // (this tree's side — the last —: the axis's ground from 3 to 9.5 km smooth — no bump of the detail left —; across, 4.6 km out, the
      // funnel's core (±150 m) smooth, the ground beyond the funnel and its fade (|c| ≥ 500 m) the same as before — the data and the detail
      // untouched there —; the walls between measured, said, left to the board — PLAN-J7 §4 q. 3: the 300 m fade révisable on it)
      const me = out.at(-1)!;
      const smooth = (pts: [number, number][], lo: number, hi: number) => {
        const seg = pts.filter(([x]) => x >= lo && x <= hi);
        const [x0, h0] = seg[0]!,
          [x1, h1] = seg.at(-1)!;
        return Math.max(...seg.map(([x, h]) => Math.abs(h - (h0 + ((h1 - h0) * (x - x0)) / (x1 - x0)))));
      };
      const bump = smooth(me.axis, 3000, 9500);
      // (the funnel to the initial point — 18.5 km, Sam's decision of 16 Nov —: the ground stood on there the data's alone)
      const detailLeft = Math.max(
        ...me.axis.map(([x, h], k) => (x >= 3000 && x <= 18200 ? Math.abs(h - (me.bare[k]![1] ?? Number.NaN)) : 0)),
      );
      const core = smooth(me.across, -150, 150);
      let wall = 0;
      for (let k = 1; k < me.across.length; k++) wall = Math.max(wall, Math.abs(me.across[k]![1] - me.across[k - 1]![1]));
      const before = out.length > 1 ? out[0]! : null;
      const outside = before ? Math.max(...me.across.map(([c, h], k) => (Math.abs(c) >= 500 ? Math.abs(h - before.across[k]![1]) : 0))) : 0;
      console.log(
        `  ${me.side}: the axis 3–9.5 km off its line ${bump.toFixed(1)} m; the core ±150 m ${core.toFixed(1)} m; beyond the funnel vs before ${outside.toFixed(1)} m; the walls' steepest 50 m step ${wall.toFixed(1)} m`,
      );
      console.log(`  ${me.side}: the detail left on the axis 3–18.2 km: ${detailLeft.toFixed(1)} m`);
      expect(detailLeft).toBeLessThan(0.5);
      if (FIELD === "OIFK") expect(bump).toBeLessThan(25);
      expect(core).toBeLessThan(15);
      expect(outside).toBeLessThan(0.5);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  900_000,
);
