import { afterEach, describe, expect, test } from "bun:test";
import { fromAdsbLol } from "../server/traffic";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { geoidDeg } from "../src/system/geoid-grid";
import { setGroundRelief } from "../src/system/our-surface";
import { GROUNDED, groundedReport, type Plane, TrafficFeed } from "../src/traffic/feed";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The real traffic on the ground (traffic/feed.ts GROUNDED, controller/traffic.ts): a report whose source does not flag
// it on the ground — N796UA, a 777 parked at SFO, 0.7 kt, alt_baro −200 ft (e2e campaign of 24 Nov 2026: drawn 23 m
// under the ground) — told on the ground by its speed and the airfield's ground about it; a taxiing one too; a take-off
// roll at 140 kt, a low approach, a hovering helicopter, a slow aircraft high up left flying; and none drawn under the
// world's ground.

afterEach(() => {
  setGroundRelief("earth", null);
  resetFlights();
});

const SFO = { lat: 37.6152, lon: -122.39, elevFt: 13 };
/** SFO's ground over the ellipsoid [m]: its elevation over the sea raised by the geoid (its grid, where loaded) */
const sfoH = SFO.elevFt * 0.3048 + geoidDeg(SFO.lat, SFO.lon);
const NOW = 1_800_000_000;

/** an adsb.lol aircraft at SFO, its fields overridden */
const adsb = (o: Record<string, unknown>) =>
  fromAdsbLol(
    { hex: "aad012", flight: "AA1234", r: "N796UA", t: "B772", category: "A5", lat: SFO.lat, lon: SFO.lon, track: 280, ...o },
    NOW,
  )!;

/** a report through the feed's own merge (its geoid, its grounding), the airfield at SFO known */
async function merged(p: Plane, fieldAt: (lat: number, lon: number) => number | null = () => sfoH): Promise<Plane> {
  const F = new TrafficFeed(
    () => "http://relay",
    async () => new Response(JSON.stringify({ planes: [p], attribution: "test" })),
    () => true,
    fieldAt,
  );
  F.tick(0, { lat: SFO.lat, lon: SFO.lon }, true);
  for (let i = 0; i < 20 && !F.planes.size; i++) await Bun.sleep(1);
  return F.planes.get(p.id)!.p;
}

describe("a report the source did not flag on the ground", () => {
  test("parked: N796UA, 0.7 kt, alt_baro −200 ft at SFO — on the ground, at the airfield's height", async () => {
    const raw = adsb({ gs: 0.7, alt_baro: -200 });
    expect(raw.gnd).toBe(false);
    expect(raw.baro).toBe(true);
    const p = await merged(raw);
    console.log(
      `  N796UA: reported ${(-200 * 0.3048).toFixed(0)} m baro, SFO's ground ${sfoH.toFixed(1)} m over the ellipsoid → gnd ${p.gnd}`,
    );
    expect(p.gnd).toBe(true);
    expect(p.alt).toBeCloseTo(sfoH, 3);
    expect(p.vs).toBe(0);
  });

  test("taxiing at 15 kt, its geometric altitude a few metres off the field: on the ground", async () => {
    const p = await merged(adsb({ gs: 15, alt_baro: 25, alt_geom: (sfoH + 8) / 0.3048, geom_rate: 0 }));
    expect(p.gnd).toBe(true);
  });

  test("its source's flag: on the ground whatever the field", async () => {
    const p = await merged(adsb({ gs: 3, alt_baro: "ground" }), () => null);
    expect(p.gnd).toBe(true);
  });

  test("rotating at 140 kt, alt_baro 0: flying (its speed)", async () => {
    const p = await merged(adsb({ gs: 140, alt_baro: 0, baro_rate: 0 }));
    expect(p.gnd).toBe(false);
  });

  test("a low approach at 135 kt, 200 ft over the field, descending: flying", async () => {
    const p = await merged(adsb({ gs: 135, alt_baro: 200, baro_rate: -700 }));
    expect(p.gnd).toBe(false);
  });

  test("a helicopter hovering at 30 ft by the field (A7): flying, as its source says", async () => {
    const p = await merged(adsb({ t: "EC35", category: "A7", gs: 0, alt_baro: 30 }));
    expect(p.gnd).toBe(false);
  });

  test("slow but high (30 kt into the wind at 5 000 ft), or slow with no airfield known: flying", async () => {
    expect((await merged(adsb({ gs: 30, alt_baro: 5000, baro_rate: 0 }))).gnd).toBe(false);
    expect((await merged(adsb({ gs: 0.7, alt_baro: -200 }), () => null)).gnd).toBe(false);
  });

  test("the rule's bounds: 35 kt, level, the barometric margin wider than the geometric one", () => {
    const base = { gnd: false, gs: 5, vs: 0, cat: "A3" };
    expect(GROUNDED.gsMax).toBeLessThan(20);
    expect(groundedReport({ ...base, alt: 100 }, 0, true)).toBe(true);
    expect(groundedReport({ ...base, alt: 100 }, 0, false)).toBe(false);
    expect(groundedReport({ ...base, alt: 0, vs: 5 }, 0, false)).toBe(false);
    expect(groundedReport({ ...base, alt: 0, gs: 25 }, 0, false)).toBe(false);
  });
});

describe("drawn", () => {
  test("a flying report under the world's ground: drawn on its wheels on it, not under it", () => {
    const { c } = cruise(3000, 200, 0.6);
    c.s.trafficDelay = 0;
    // (the world's ground there: 12 m over the ellipsoid)
    setGroundRelief("earth", () => 12);
    const p: Plane = { ...adsb({ gs: 60, alt_geom: -75, geom_rate: 0 }), t: NOW };
    expect(p.alt).toBeLessThan(0);
    const F = {
      planes: new Map([[p.id, { p, prev: null, hist: [p], heard: 0 }]]),
      ships: new Map(),
      status: "live",
      credit: {},
      attribution: [],
    } as unknown as TrafficFeed;
    c.traffic = F;
    c.trafficClock = () => NOW + 1;
    const k = c.trafficNow()[0]!;
    const g = cartToGeodetic(WGS84_A, WGS84_F, k.p as [number, number, number]);
    console.log(`  reported ${p.alt.toFixed(1)} m over the ellipsoid, the ground at 12 m: drawn at ${g.h.toFixed(1)} m`);
    expect(g.h).toBeGreaterThanOrEqual(12);
    expect(k.alt).toBeGreaterThanOrEqual(12);
  });
});
