import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { showView } from "./lib/bridge-views";

// (25 Nov 2026 — the runway's level after 9cf0849a, game/runway-grade.ts levelOver) Airports by the water: off a real runway's paved strip
// the level lifts only the ground the data say is land (0 … 0.3 m over the sea and up) — SFO's bay before 28L had been raised to the
// runway's 3.1 m out to 900 m. At LaGuardia, Boston Logan, Nice and Hong Kong: the ground as stood on and drawn (`__bh.sys.groundAt`,
// less the geoid: over the sea) on each runway's axis before and past its ends (50 … 900 m) and beside it (40 … 300 m off its edge, at a
// quarter, half and three quarters of it) and on the strip itself; an overview and an approach shot over the water. Run against an older
// server (scripts/ab-e2e.ts, AB_SIDE) for the before/after: the strip at its level both sides, the water past it at the sea's 0 after.
// Duration: ~2–3 min an airport (kerr-mini), its tiles cached.
// Done when: each airport's samples printed and shot; its strip at its level (±0.5 m), its runways brought in.
const OUT = `${process.env.WF_OUT ?? "remote-results/waterfront-runways"}${process.env.AB_SIDE ? `-${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : ""}`;
const ONLY = process.env.WF_ONLY?.split(",");
/** the field's centre; the landing end shot (its heading [°] ±25), the approach over the water */
type Field = { key: string; name: string; centre: [number, number]; shotHdg: number };
const ALL: Field[] = [
  { key: "lga", name: "LaGuardia (KLGA)", centre: [40.7769, -73.874], shotHdg: 224 },
  { key: "bos", name: "Boston Logan (KBOS)", centre: [42.3656, -71.0096], shotHdg: 330 },
  { key: "nce", name: "Nice (LFMN)", centre: [43.6584, 7.2159], shotHdg: 44 },
  { key: "hkg", name: "Hong Kong (VHHH)", centre: [22.308, 113.9185], shotHdg: 73 },
];
const FIELDS = ALL.filter((f) => !ONLY || ONLY.includes(f.key));

interface Rwy {
  hdg: number;
  len: number;
  hw: number;
  elev: number;
  field: string | null;
  measured: number | null;
  /** the threshold's place, the far end's */
  a: [number, number];
  b: [number, number];
  /** over the sea [m]: on its axis before the threshold (−d) and past the far end (L + d), d of `axisD`; beside it (`sideA` along ×
   *  `sideC` off the edge, right then left); on the strip (5 along) */
  before: number[];
  past: number[];
  right: number[][];
  left: number[][];
  strip: number[];
}
const axisD = [50, 150, 300, 600, 900];
const sideA = [0.25, 0.5, 0.75];
const sideC = [40, 150, 300];

// (in the page: the runways drawn within 6 km of the centre, each sampled — body-fixed to WGS84 geodetic, the ground over the sea)
const sampleJs = (centre: [number, number]) => `(() => {
  const D = Math.PI / 180, A = 6378137, F = 1 / 298.257223563, B = A * (1 - F), e2 = F * (2 - F), ep2 = (A * A - B * B) / (B * B);
  const geo = (q) => { const pr = Math.hypot(q[0], q[1]), th = Math.atan2(q[2] * A, pr * B);
    return [Math.atan2(q[2] + ep2 * B * Math.sin(th) ** 3, pr - e2 * A * Math.cos(th) ** 3) / D, Math.atan2(q[1], q[0]) / D]; };
  const msl = (q) => { const [la, lo] = geo(q); return +(__bh.sys.groundAt(la, lo) - __bh.sys.geoid(la, lo)).toFixed(2); };
  const c = ${JSON.stringify(centre)};
  const out = [];
  for (const r of __bh.sys.runways()) {
    const [la, lo] = geo(r.origin);
    if (Math.abs(la - c[0]) * 111 > 6 || Math.abs(lo - c[1]) * 111 * Math.cos(c[0] * D) > 6) continue;
    const up = r.p, east = [-up[1], up[0], 0].map((v, _, a) => v / Math.hypot(a[0], a[1]));
    const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const hdg = (Math.atan2(dot(r.along, east), dot(r.along, north)) / D + 360) % 360;
    const L = r.len, hw = r.halfWidth, at = (a, x) => r.origin.map((v, i) => v + r.along[i] * a + r.across[i] * x);
    out.push({
      hdg: +hdg.toFixed(1), len: Math.round(L), hw: +hw.toFixed(1), elev: +r.elev.toFixed(2), field: r.world?.field ?? null,
      measured: r.world ? (r.world.measured ?? 0) : null, a: geo(at(0, 0)), b: geo(at(L, 0)),
      before: ${JSON.stringify(axisD)}.map((d) => msl(at(-d, 0))), past: ${JSON.stringify(axisD)}.map((d) => msl(at(L + d, 0))),
      right: ${JSON.stringify(sideA)}.map((f) => ${JSON.stringify(sideC)}.map((x) => msl(at(f * L, hw + x)))),
      left: ${JSON.stringify(sideA)}.map((f) => ${JSON.stringify(sideC)}.map((x) => msl(at(f * L, -hw - x)))),
      strip: [0.05, 0.25, 0.5, 0.75, 0.95].map((f) => msl(at(f * L, 0))),
    });
  }
  return out;
})()`;

const offset = (p: [number, number], brgDeg: number, m: number): [number, number] => {
  const D = Math.PI / 180;
  return [p[0] + (m * Math.cos(brgDeg * D)) / 111132, p[1] + (m * Math.sin(brgDeg * D)) / (111320 * Math.cos(p[0] * D))];
};

describe.skipIf(!E2E)("waterfront runways: the water past and beside them stays water, the strip its level", () => {
  let app: App;
  const results: Record<string, unknown>[] = [];
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: true });
    app.steps(FIELDS.map((f) => f.name));
    app.estimate(150 * FIELDS.length);
  }, 180_000);
  afterAll(async () => {
    await Bun.write(`${OUT}/results.json`, JSON.stringify(results, null, 1));
    app?.close();
    stopServer();
  });

  for (const f of FIELDS)
    test(f.name, async () => {
      await app.step(f.name);
      // (an overview from 3 km south-west, 700 m up: the runways brought in near the eye, their level measured twice — waited, not slept)
      const over = offset(f.centre, 225, 3000);
      await showView(app, { key: `${f.key}-over`, at: over, aglM: 700, look: f.centre, holds: "true" });
      const brought = await app.waitOptional(
        `((n) => n.length > 0 && n.every((r) => r.measured === null || r.measured >= 2))(${sampleJs(f.centre)})`,
        60_000,
      );
      await app.shot(`${OUT}/${f.key}-overview.png`);
      const rws = await app.js<Rwy[]>(sampleJs(f.centre));
      for (const r of rws)
        console.log(
          `  ${f.key} rwy ${r.hdg}° ${r.len} m elev ${r.elev} (${r.field ?? "site"}, measured ${r.measured}) strip ${r.strip.join(" ")} · before ${r.before.join(" ")} · past ${r.past.join(" ")} · right ${r.right.map((x) => x.join("/")).join(" ")} · left ${r.left.map((x) => x.join("/")).join(" ")}`,
        );
      // (the approach to the end named, 1.5 km out on its axis, ~80 m over its threshold — a 3° slope —, aimed 300 m down the runway)
      const turn = (h: number) => Math.abs(((h - f.shotHdg + 540) % 360) - 180);
      const pick = rws
        .flatMap((r) => [
          { r, thr: r.a, hdg: r.hdg },
          { r, thr: r.b, hdg: (r.hdg + 180) % 360 },
        ])
        .filter((e) => turn(e.hdg) < 25)
        .sort((x, y) => y.r.len - x.r.len)[0];
      let shot: string | null = null;
      if (pick) {
        const thr = pick.thr as [number, number];
        const N = await app.js<number>(`__bh.sys.geoid(${thr[0]}, ${thr[1]})`);
        const v = await showView(app, {
          key: `${f.key}-approach`,
          at: offset(thr, pick.hdg + 180, 1500),
          altM: pick.r.elev + N + 82,
          look: offset(thr, pick.hdg, 300),
          lookAltM: pick.r.elev + N,
          holds: "true",
        });
        shot = `${OUT}/${f.key}-approach.png`;
        await app.shot(shot);
        console.log(`  ${f.key} approach ${pick.hdg.toFixed(0)}°: ready ${v.ready}, data ${v.dataOk}`);
      } else console.log(`  ${f.key}: no runway end within 25° of ${f.shotHdg}° — no approach shot`);
      results.push({ field: f.key, brought: brought !== null, runways: rws, shot });
      const strips = rws.map((r) => Math.max(...r.strip.map((h) => Math.abs(h - r.elev))));
      await app.stepDone(
        `${f.key}: ${rws.length} runways, strip off its level ≤ ${Math.max(0, ...strips).toFixed(2)} m, past the ends over the sea ${rws
          .map((r) => `${Math.min(...r.before)}/${Math.min(...r.past)}`)
          .join(" ")} m`,
        rws.length > 0 && strips.every((s) => s < 0.5),
      );
      expect(rws.length, `${f.key}: no runway brought in`).toBeGreaterThan(0);
      for (const [i, r] of rws.entries()) expect(strips[i]!, `${f.key} rwy ${r.hdg}°: the strip off its level ${r.elev}`).toBeLessThan(0.5);
    }, 360_000);
});
