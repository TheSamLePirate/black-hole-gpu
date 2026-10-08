import { expect, test } from "bun:test";
import { MetarFeed, nearestStation, parseMetar } from "../src/metar";
import { ceilingOf, flightCategory } from "../src/weather";

// PLAN-METEO W7: real METARs (metar.vatsim.net, 08/10/2026) decoded into the weather's state.

test("Edwards: light wind, 10 statute miles, a scattered layer at 12 000 ft — VFR", () => {
  const w = parseMetar("KEDW 081155Z AUTO 22004KT 10SM SCT120 18/05 A2993 RMK AO2 SLP110 T01830045 10242 20183 56002 $")!;
  expect(w.source).toBe("metar");
  expect(w.wind.from).toBe(220);
  expect(w.wind.u10).toBeCloseTo(4 * 0.514444, 4);
  expect(w.visibility).toBeCloseTo(10 * 1609.344, 0);
  expect(w.layers).toEqual([{ base: 12000 * 0.3048, top: 12000 * 0.3048 + 800, cover: 0.45 }]);
  expect(w.kind).toBe("cloudy");
  expect(flightCategory(w)).toBe("VFR");
  expect(w.report).toStartWith("KEDW 081155Z");
});

test("Le Bourget: 9999, three layers — a ceiling at 5 600 ft, the variable wind's sector skipped", () => {
  const w = parseMetar("LFPB 081230Z AUTO 32011KT 270V360 9999 SCT047 BKN056 BKN068 15/05 Q1021 NOSIG")!;
  expect(w.wind.from).toBe(320);
  expect(w.visibility).toBe(15e3);
  expect(w.layers.map((l) => l.cover)).toEqual([0.45, 0.75, 0.75]);
  expect(ceilingOf(w)).toBeCloseTo(5600 * 0.3048, 4);
  expect(w.kind).toBe("overcast");
});

test("metres a second, CAVOK, NCD, the cumulonimbus' tops", () => {
  const k = parseMetar("UAOO 081230Z 27004MPS CAVOK 23/03 Q1022 NOSIG RMK QFE755/1007")!;
  expect(k.wind.u10).toBe(4);
  expect(k.visibility).toBe(15e3);
  expect(k.layers).toEqual([]);
  expect(k.kind).toBe("fair");
  const c = parseMetar("UACC 081230Z 26007MPS 9999 SCT030CB BKN040 11/05 Q1012 NOSIG")!;
  expect(c.layers[0]!.top).toBeGreaterThanOrEqual(9000);
  expect(parseMetar("RJFG 081200Z AUTO 06004KT 310V120 9999 NCD 20/14 Q1022")!.layers).toEqual([]);
});

test("a thunderstorm with heavy rain and gusts; fog with the sky hidden; drizzle; fractions of a mile", () => {
  const s = parseMetar("KTTS 081755Z 18018G32KT 1 1/2SM +TSRA BR BKN008 OVC025CB 24/23 A2980")!;
  expect(s.kind).toBe("storm");
  expect(s.rain).toBe(1);
  expect(s.wind.gust).toBeCloseTo((32 - 18) * 0.514444, 4);
  expect(s.visibility).toBeCloseTo(1.5 * 1609.344, 3);
  expect(flightCategory(s)).toBe("IFR");
  const f = parseMetar("LFPB 080600Z 00000KT 0150 FG VV001 08/08 Q1025")!;
  expect(f.kind).toBe("fog");
  expect(f.visibility).toBe(150);
  expect(f.fogTop).toBeCloseTo(100 * 0.3048, 4);
  expect(f.wind.u10).toBe(0);
  expect(f.wind.from).toBeNull();
  expect(flightCategory(f)).toBe("LIFR");
  const d = parseMetar("KEDW 081155Z VRB03KT M1/4SM -DZ OVC002 10/10 A2990")!;
  expect(d.wind.from).toBeNull();
  expect(d.visibility).toBeCloseTo(0.25 * 1609.344, 3);
  expect(d.rain).toBeGreaterThan(0);
  expect(d.rain).toBeLessThan(0.3);
  // (in the vicinity: not here)
  expect(parseMetar("KEDW 081155Z 22004KT 10SM VCSH SCT120 18/05 A2993")!.rain).toBe(0);
  expect(parseMetar("not a report")).toBeNull();
});

test("the nearest station: Le Bourget's for Paris, none in mid-ocean", () => {
  expect(nearestStation({ lat: 48.86, lon: 2.35 })?.icao).toBe("LFPB");
  expect(nearestStation({ lat: 28.5, lon: -80.8 })?.icao).toBe("KTTS");
  expect(nearestStation({ lat: 0, lon: -30 })).toBeNull();
});

test("the feed: a report kept half an hour, a failure five minutes, one request at a time", async () => {
  let now = 0,
    calls = 0,
    fail = false;
  const feed = new MetarFeed(
    async () => {
      calls++;
      if (fail) throw new Error("offline");
      return "KEDW 081155Z AUTO 22004KT 10SM SCT120 18/05 A2993\n";
    },
    () => now,
  );
  const [a, b] = await Promise.all([feed.weather("KEDW"), feed.weather("KEDW")]);
  expect(calls).toBe(1);
  expect(a?.wind.from).toBe(220);
  expect(b).toBe(a);
  now = 29 * 60e3;
  await feed.weather("KEDW");
  expect(calls).toBe(1);
  now = 31 * 60e3;
  fail = true;
  expect(await feed.weather("KEDW")).toBeNull();
  expect(calls).toBe(2);
  now += 4 * 60e3;
  await feed.weather("KEDW");
  expect(calls).toBe(2);
});
