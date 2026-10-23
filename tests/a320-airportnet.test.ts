import { describe, expect, test } from "bun:test";
import {
  arrivalRoute,
  buildNet,
  departureRoute,
  headingOf,
  holdingPoint,
  local,
  type OsmEl,
  pushbackPath,
  standOf,
  standPlace,
} from "../src/game/airportnet";
import { tileElements } from "../src/game/airportfetch";
import { taxiCue } from "../src/game/taxiguide";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";

// An airport's ground network (docs/PLAN-A320.md, A14 — src/game/airportnet.ts) from OpenStreetMap's elements
// (tests/fixtures: Overpass's answers of 2026-10-22, © OpenStreetMap contributors, ODbL — Paris-Le Bourget whole,
// Paris-CDG's terminal 2): the graph in one piece, the stands and their headings in, a route from a stand to a
// runway's holding point by its taxiways, a free stand after landing, the pushback's path, the stand's place on WGS84;
// the vector tiles' lines joined into a graph; the taxi's guidance along a route.

const load = async (f: string) => ((await Bun.file(`tests/fixtures/${f}.json`).json()) as { elements: OsmEl[] }).elements;
const D = Math.PI / 180;

describe("airport ground network", () => {
  test("Paris-CDG T2: the stands, a route out to 08L/26R, a stand after landing", async () => {
    const N = buildNet(await load("osm-lfpg-t2"));
    console.log(
      `  CDG T2: ${N.nodes.size} nodes, ${N.edges.length} edges, ${N.stands.length} stands, runways ${N.runways.map((r) => r.ref).join(" ")}`,
    );
    expect(N.stands.length).toBeGreaterThan(150);
    // (each stand's heading in: away from its junction — the nose towards the terminal)
    let ok = 0;
    for (const s of N.stands) {
      const J = N.nodes.get(s.node)!;
      const [x, y] = local(J, s.lat, s.lon);
      if (Math.hypot(x, y) < 3) continue;
      const d = Math.abs(((headingOf(x, y) - s.hdg + 540) % 360) - 180);
      if (d < 70) ok++;
    }
    expect(ok / N.stands.length).toBeGreaterThan(0.85);
    // (C07 → the runway's eastern take-off: its holding point, a route by named taxiways)
    const s = standOf(N, "C07")!;
    expect(s).not.toBeNull();
    const R = N.runways.find((r) => r.ref.includes("08L"))!;
    const west = R.a.lon < R.b.lon ? R.a : R.b;
    const east = west === R.a ? R.b : R.a;
    const end = { lat: west.lat, lon: west.lon, hdg: headingOf(...local(west, east.lat, east.lon)) };
    const hp = holdingPoint(N, end)!;
    expect(hp).not.toBeNull();
    const r = departureRoute(N, s.node, end)!;
    console.log(
      `  C07 → 08L: ${r.len.toFixed(0)} m via ${r.via.join(", ")}${r.crosses.length ? `, crossing ${r.crosses.join(", ")}` : ""}`,
    );
    expect(r.via.length).toBeGreaterThan(1);
    expect(r.len).toBeGreaterThan(300);
    expect(r.len).toBeLessThan(6000);
    // (landed, at the runway's middle: a stand, the route there ending on its stop)
    const a = arrivalRoute(N, { lat: (R.a.lat + R.b.lat) / 2, lon: (R.a.lon + R.b.lon) / 2 })!;
    expect(a).not.toBeNull();
    expect(a.route.pts.at(-1)).toEqual({ lat: a.stand.lat, lon: a.stand.lon });
    console.log(`  landed → stand ${a.stand.ref}: ${a.route.len.toFixed(0)} m via ${a.route.via.join(", ")}`);
  });

  test("Paris-Le Bourget: one graph, its routes, its two parking positions", async () => {
    const N = buildNet(await load("osm-lfpb"));
    // (the network in one piece)
    const seen = new Set<number>();
    const first = N.adj.keys().next().value!;
    const st = [first];
    seen.add(first);
    while (st.length) for (const { to } of N.adj.get(st.pop()!)!) if (!seen.has(to)) seen.add(to), st.push(to);
    expect(seen.size).toBe(N.adj.size);
    expect(N.stands.length).toBe(2);
    expect(N.runways.map((r) => r.ref)).toContain("09/27");
  });

  test("the pushback's path: back along the stand's axis, round onto the taxiway; the nose then along it", async () => {
    const N = buildNet(await load("osm-lfpg-t2"));
    const s = standOf(N, "C07")!;
    const P = pushbackPath(s, N);
    const start = standPlace(s, 13.65);
    expect(P.pts[0]!.lat).toBeCloseTo(start.lat, 9);
    // (the first leg straight back: opposite the heading in)
    const [x, y] = local(P.pts[0]!, P.pts[2]!.lat, P.pts[2]!.lon);
    const back = Math.abs(((headingOf(x, y) - (s.hdg + 180) + 540) % 360) - 180);
    expect(back).toBeLessThan(5);
    // (at its end the nose across the stand's axis — turned onto the taxiway)
    const turned = Math.abs(((P.hdgEnd - s.hdg + 540) % 360) - 180);
    console.log(`  C07: ${P.pts.length} points, the nose from ${s.hdg.toFixed(0)}° to ${P.hdgEnd.toFixed(0)}°`);
    expect(turned).toBeGreaterThan(45);
  });

  test("the stand's place on the WGS84: the reference point 13.65 m behind the stop, on the heading in", async () => {
    const N = buildNet(await load("osm-lfpg-t2"));
    const s = standOf(N, "C07")!;
    const p = standPlace(s, 13.65);
    const a = geodeticToCart(WGS84_A, WGS84_F, s.lat * D, s.lon * D, 0);
    const b = geodeticToCart(WGS84_A, WGS84_F, p.lat * D, p.lon * D, 0);
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(Math.abs(d - 13.65)).toBeLessThan(0.05);
    const [x, y] = local(p, s.lat, s.lon);
    expect(Math.abs(((headingOf(x, y) - s.hdg + 540) % 360) - 180)).toBeLessThan(0.5);
  });

  test("the vector tiles' lines: their vertices within 3 m joined into one graph", () => {
    const at = (e: number, n: number) => ({ lat: 49 + n / 111_132.95, lon: 2.5 + e / (111_319.49 * Math.cos(49 * D)) });
    const els = tileElements(
      [
        { cls: "taxiway", ref: "A", pts: [at(0, 0), at(100, 0), at(200, 0)] },
        // (cut at a tile's edge: its end 1.5 m off A's vertex)
        { cls: "taxiway", ref: "B", pts: [at(100.8, 1.2), at(100, 150)] },
      ],
      [{ ref: "12", ...at(130, 160) }],
    );
    const N = buildNet(els, undefined, "tiles");
    expect(N.nodes.size).toBe(4);
    expect(N.stands.length).toBe(1);
    expect(N.stands[0]!.ref).toBe("12");
  });

  test("the taxi's guidance: the leg rolled, the next turn, the speed to roll at, the end", async () => {
    const N = buildNet(await load("osm-lfpg-t2"));
    const s = standOf(N, "C07")!;
    const R = N.runways.find((r) => r.ref.includes("08L"))!;
    const west = R.a.lon < R.b.lon ? R.a : R.b;
    const east = west === R.a ? R.b : R.a;
    const r = departureRoute(N, s.node, { lat: west.lat, lon: west.lon, hdg: headingOf(...local(west, east.lat, east.lon)) })!;
    let i = 0,
      turns = 0,
      slow = 0,
      last = Infinity;
    // (rolled along the route's points, a metre to the right)
    for (const p of r.pts) {
      const c = taxiCue(r, p, i);
      expect(c.i).toBeGreaterThanOrEqual(i);
      expect(c.toEnd).toBeLessThanOrEqual(last + 1);
      i = c.i;
      last = c.toEnd;
      if (c.next) turns++;
      if (c.adviseKt === 10) slow++;
    }
    const end = taxiCue(r, r.pts.at(-1)!, i);
    expect(end.done).toBeTrue();
    expect(end.adviseKt).toBe(0);
    expect(turns).toBeGreaterThan(0);
    expect(slow).toBeGreaterThan(0);
  });
});
