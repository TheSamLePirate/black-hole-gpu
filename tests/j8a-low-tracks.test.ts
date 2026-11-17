import { describe, expect, test } from "bun:test";
import { bdtopoUrl } from "../src/system/bdtopo";
import { cellOrigin, readHeader, readRecord, toCell } from "../src/system/building-cells";
import { prepareBdtopoCell } from "../src/system/cell-prep";
import { J8A_LOW_TRACKS } from "../src/system/j8a-tracks";
import { cellsAlong } from "../src/system/zone-cells";
import { earthDataDir, readKept } from "./e2e/lib/earth-cache";

// PLAN-J8 A6 criterion 8 — the low flight's tracks (src/system/j8a-tracks.ts J8A_LOW_TRACKS) clear the town: every BD TOPO building within
// 150 m of a leg (its top: the source's ground over the sea, its eave and its roof — the cells prepared with no geoid: heights over the
// sea, as the tracks') under the leg's lower end by 15 m or more; and the track goes down to ~50 m over the ground somewhere. From the
// e2e's Earth data on disk (skipped without it). Masts, cranes and spires the BD TOPO does not give are not checked.

const CLEAR_M = 15;

for (const T of J8A_LOW_TRACKS) {
  const tiles = cellsAlong(
    T.points.map((p) => [p[0], p[1]] as [number, number]),
    200,
  );
  const kept = tiles.map((t) => ({ t, k: readKept(earthDataDir(), bdtopoUrl(t.x, t.y), null) }));
  describe.skipIf(kept.some((c) => !c.k))(`${T.name} (the BD TOPO on the e2e's disk)`, () => {
    test("every building within 150 m of a leg cleared by 15 m; the lowest point ~50 m over the ground", () => {
      const recs: { o: { lat: number; lon: number }; e: number; n: number; g: number; top: number }[] = [];
      for (const { t, k } of kept) {
        const buf = prepareBdtopoCell(k!.body, t.x, t.y, () => 0).buf;
        const h = readHeader(buf);
        if (!h) continue;
        const o = cellOrigin(t.x, t.y);
        for (let i = 0; i < h.count; i++) {
          const r = readRecord(buf, i);
          recs.push({ o, e: r.east, n: r.north, g: r.ground, top: r.ground + r.eave + r.roof });
        }
      }
      expect(recs.length).toBeGreaterThan(1000);
      let lowestAgl = Infinity;
      for (let k = 0; k + 1 < T.points.length; k++) {
        const a = T.points[k]!,
          b = T.points[k + 1]!;
        const floor = Math.min(a[2], b[2]);
        const L = Math.hypot((b[0] - a[0]) * 111_320, (b[1] - a[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180));
        const n = Math.max(1, Math.ceil(L / 20));
        let top = -Infinity;
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          const lat = a[0] + (b[0] - a[0]) * f,
            lon = a[1] + (b[1] - a[1]) * f,
            alt = a[2] + (b[2] - a[2]) * f;
          let ground = -Infinity;
          for (const r of recs) {
            const c = toCell({ lat, lon }, r.o.lat, r.o.lon);
            const d = Math.hypot(c.east + r.e, c.north + r.n);
            if (d < 150) top = Math.max(top, r.top);
            if (d < 60) ground = Math.max(ground, r.g);
          }
          if (Number.isFinite(ground)) lowestAgl = Math.min(lowestAgl, alt - ground);
        }
        console.log(`  ${T.name} leg ${k + 1}: ${L.toFixed(0)} m, from ${a[2]} to ${b[2]} m, highest top within 150 m ${top.toFixed(0)} m`);
        expect(floor - top).toBeGreaterThanOrEqual(CLEAR_M);
      }
      console.log(`  ${T.name}: the lowest over the buildings' ground ${lowestAgl.toFixed(0)} m`);
      expect(lowestAgl).toBeLessThan(65);
      expect(lowestAgl).toBeGreaterThan(30);
    });
  });
}
