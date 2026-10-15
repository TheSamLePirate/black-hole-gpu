import { afterEach, describe, expect, test } from "bun:test";
import { SHIP_MESH, shipKindOf, shipLights, shipMotion, shipSize } from "../src/game/shiptypes";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import type { Ship, TrafficFeed } from "../src/traffic/feed";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The ships on the sea (docs/PLAN-AVIATION-AAA.md, T3; game/shiptypes.ts, controller/seatraffic.ts): each AIS type
// its mesh and size; their navigation lights where the rules put them; a small hull rolling more than a big one; a
// ship drawn a minute behind on its way, its bow on its heading, at the sea's level; one lying still where it lies;
// their wakes handed to the sea's shader.

afterEach(resetFlights);

const D = Math.PI / 180;

describe("the ships' kinds", () => {
  test("cargo, tanker, passenger, fishing, sailing, tug; unknown by its length; the AIS's size bounded", () => {
    expect(shipKindOf(71).mesh).toBe("cargo");
    expect(shipKindOf(84).mesh).toBe("tanker");
    expect(shipKindOf(60).mesh).toBe("ferry");
    expect(shipKindOf(30).mesh).toBe("trawler");
    expect(shipKindOf(36).mesh).toBe("sailboat");
    expect(shipKindOf(52).kind).toBe("tug");
    expect(shipKindOf(0, 250).mesh).toBe("cargo");
    expect(shipKindOf(0, 15).mesh).toBe("trawler");
    expect(shipSize(71, 366, 51)).toMatchObject({ len: 366, beam: 51 });
    // (no dimensions: its kind's; a beam out of reason: its kind's proportion)
    expect(shipSize(71, 0, 0).len).toBe(190);
    expect(shipSize(60, 200, 0).beam).toBeCloseTo((200 * 24) / 140, 6);
  });

  test("its lights: red to port (its left: +x), green to starboard, the masthead's white high forward, a second aft over 50 m, a sailing boat's at its masthead", () => {
    const big = shipLights("cargo", 300, 48);
    expect(big.find((l) => l.colour === "red")!.at[0]).toBeGreaterThan(0);
    expect(big.find((l) => l.colour === "green")!.at[0]).toBeLessThan(0);
    const masts = big.filter((l) => l.colour === "white" && l.at[1] > 30);
    expect(masts.length).toBe(2);
    expect(Math.max(...masts.map((l) => l.at[2]))).toBeGreaterThan(0);
    expect(shipLights("trawler", 24, 7).filter((l) => l.colour === "white").length).toBe(2);
    const sail = shipLights("sailboat", 12, 3.9);
    expect(sail.find((l) => l.colour === "white" && l.at[1] > 10)!.at[1]).toBeCloseTo(SHIP_MESH.sailboat.mast, 6);
  });

  test("in a 2 m sea a trawler rolls more than a container ship; in a calm none", () => {
    const amp = (len: number, beam: number, hs: number) => {
      let r = 0;
      for (let t = 0; t < 120; t += 0.1) r = Math.max(r, Math.abs(shipMotion(len, beam, hs, t, 7).roll));
      return r / D;
    };
    const trawler = amp(24, 7, 2),
      cargo = amp(300, 48, 2);
    console.log(`  rolling in a 2 m sea: a trawler ${trawler.toFixed(1)}°, a container ship ${cargo.toFixed(1)}°`);
    expect(trawler).toBeGreaterThan(3 * cargo);
    expect(amp(300, 48, 0)).toBe(0);
  });
});

/** A ship's reports every 10 s on a straight course from (lat0, lon0) at time t0, its heading `hdg` (null: none). */
function reports(mmsi: number, t0: number, cog: number, sog: number, hdg: number | null, from = -60, to = 60): Ship[] {
  const out: Ship[] = [];
  for (let k = from; k <= to; k++) {
    const t = t0 + 10 * k,
      d = sog * 10 * k;
    out.push({
      mmsi,
      name: "NORDIC STAR",
      type: 71,
      len: 300,
      beam: 48,
      dest: "",
      sog,
      cog,
      hdg,
      lat: 40.02 + (d * Math.cos(cog * D)) / 111_195,
      lon: -35.02 + (d * Math.sin(cog * D)) / (111_195 * Math.cos(40.02 * D)),
      t,
    });
  }
  return out;
}

describe("a ship on the sea", () => {
  test("a minute behind on its way, at the sea's level, its bow on its heading (a 5° drift off its course); a moored one where it lies; their wakes", () => {
    const { c } = cruise(400, 150, 0.6);
    c.s.trafficDelay = 60;
    const t0 = 1_800_000_000;
    const ships = new Map<number, { s: Ship; hist: Ship[]; heard: number }>();
    const under = reports(211000001, t0, 70, 9.5, 75);
    ships.set(211000001, { s: under.at(-1)!, hist: under, heard: t0 });
    const moored = reports(227000009, t0, 0, 0.05, 133, -6, 0);
    ships.set(227000009, { s: moored.at(-1)!, hist: moored, heard: t0 });
    c.traffic = { planes: new Map(), ships, status: "live", credit: {}, attribution: [] } as unknown as TrafficFeed;
    c.trafficClock = () => t0;
    const list = c.seaNow();
    const s = list.find((x) => x.mmsi === 211000001)!;
    const g = cartToGeodetic(WGS84_A, WGS84_F, s.p as [number, number, number]);
    // (where its report of a minute ago put it)
    const want = under.find((q) => q.t === t0 - 60)!;
    const miss = Math.hypot((g.lat / D - want.lat) * 111_195, (g.lon / D - want.lon) * 111_195 * Math.cos(40.02 * D));
    // (its bow's way: the heading, not the course)
    const up = s.p.map((x) => x / Math.hypot(...s.p));
    const east = [-Math.sin(g.lon), Math.cos(g.lon), 0];
    const north = [up[1]! * east[2]! - up[2]! * east[1]!, up[2]! * east[0]! - up[0]! * east[2]!, up[0]! * east[1]! - up[1]! * east[0]!];
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const head = (Math.atan2(dot(s.fwd, east), dot(s.fwd, north)) / D + 360) % 360;
    console.log(
      `  a minute behind: ${miss.toFixed(1)} m from its report then, at ${g.h.toFixed(2)} m, its bow on ${head.toFixed(1)}° (heading 75°, course 70°)`,
    );
    expect(miss).toBeLessThan(3);
    expect(Math.abs(g.h)).toBeLessThan(1.5);
    expect(Math.abs(head - 75)).toBeLessThan(1.5);
    expect(s.sog).toBeCloseTo(9.5, 0);
    const m = list.find((x) => x.mmsi === 227000009)!;
    expect(m.sog).toBe(0);
    // the wakes: the one under way alone, its heading level, its speed and size
    const W = c.seaWakes();
    expect(W.length).toBe(1);
    expect(W[0]!.U).toBeCloseTo(9.5, 0);
    expect(W[0]!.len).toBe(300);
    expect(Math.abs(dot(W[0]!.fwd, up))).toBeLessThan(1e-6);
  });
});
