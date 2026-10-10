import { expect, test } from "bun:test";
import { cellOf, hourAt, modelWeather, OpenMeteoFeed, openMeteoUrl, parseOpenMeteo } from "../src/openmeteo";
import { msOfDays, RealWeather } from "../src/realweather";
import { MetarFeed } from "../src/metar";
import { flightCategory } from "../src/weather";
import burgos from "./data/openmeteo-2026-08-12-burgos.json";
import paris from "./data/openmeteo-1999-08-11-paris.json";

// PLAN-CIEL C1: the real weather anywhere at the game's date — Open-Meteo's answers (saved 10/10/2026): the
// forecast's for Burgos on the eclipse of 12/08/2026, the ERA5 archive's for Paris on that of 11/08/1999.

const NOW = Date.UTC(2026, 9, 10, 12);
const DAY = 86400e3;

test("where a day is served: the forecast near today, the archive before, nothing beyond", () => {
  expect(openMeteoUrl(42.5, -2.5, Date.UTC(2026, 7, 12, 18), NOW)!.kind).toBe("forecast");
  expect(openMeteoUrl(42.5, -2.5, NOW + 14 * DAY, NOW)!.kind).toBe("forecast");
  expect(openMeteoUrl(42.5, -2.5, NOW + 20 * DAY, NOW)).toBeNull();
  expect(openMeteoUrl(48.95, 2.5, Date.UTC(1999, 7, 11, 10), NOW)!.url).toStartWith("https://archive-api.open-meteo.com/v1/archive?");
  expect(openMeteoUrl(0, 0, Date.UTC(1939, 11, 31), NOW)).toBeNull();
  expect(openMeteoUrl(0, 0, Date.UTC(2067, 0, 1), NOW)).toBeNull();
  const u = openMeteoUrl(42.5, -2.5, Date.UTC(2026, 7, 12, 18), NOW)!.url;
  expect(u).toContain("start_date=2026-08-12&end_date=2026-08-12");
  expect(u).toContain("wind_speed_unit=ms");
  expect(cellOf(42.61, -2.38)).toEqual({ lat: 42.5, lon: -2.5 });
  expect(cellOf(10, 179.9).lon).toBe(180 - 360);
});

test("Burgos at the 2026 eclipse (18:30 UTC): clear and hot — VFR, no deck, the air read for the refraction", () => {
  const p = parseOpenMeteo(burgos)!;
  expect(p.hours.length).toBe(24);
  const h = hourAt(p.hours, Date.UTC(2026, 7, 12, 18, 30))!;
  expect(h.T).toBeGreaterThan(30);
  const w = modelWeather(h, "forecast", { lat: 42.5, lon: -2.5 });
  expect(w.source).toBe("model");
  expect(w.layers).toEqual([]);
  expect(w.rain).toBe(0);
  expect(w.visibility).toBeGreaterThan(40e3);
  expect(flightCategory(w)).toBe("VFR");
  expect(w.wind.from).toBeGreaterThan(90);
  expect(w.wind.from).toBeLessThan(115);
  expect(w.model!.p).toBeCloseTo(967, 0);
  expect(w.report).toContain("Open-Meteo forecast 2026-08-12T18:30Z");
});

test("Paris at the 1999 eclipse (10:15 UTC): low clouds and drizzle (the archive: no visibility given, guessed)", () => {
  const p = parseOpenMeteo(paris)!;
  const w = modelWeather(hourAt(p.hours, Date.UTC(1999, 7, 11, 10, 15))!, "archive", { lat: 49, lon: 2.5 });
  expect(w.layers[0]!.cover).toBeGreaterThan(0.45);
  expect(w.layers[0]!.base).toBeGreaterThan(400);
  expect(w.layers[0]!.base).toBeLessThan(1000);
  expect(w.layers.length).toBeGreaterThanOrEqual(2);
  expect(w.rain).toBeGreaterThan(0);
  expect(w.rain).toBeLessThan(0.3);
  expect(w.visibility).toBeGreaterThan(3000);
  expect(w.visibility).toBeLessThan(30e3);
  expect(w.model!.kind).toBe("archive");
});

test("between two hours, the weather between; the wind's direction the short way round", () => {
  const a = { t: 0, low: 0, mid: 0, high: 0, vis: 10e3, precip: 0, code: 0, u10: 2, dir: 350, gust: 4, T: 10, Td: 5, p: 1000, cape: 0 };
  const b = { ...a, t: 3600e3, low: 1, dir: 10, u10: 4, code: 61 };
  const h = hourAt([a, b], 1800e3)!;
  expect(h.low).toBeCloseTo(0.5);
  expect(h.u10).toBeCloseTo(3);
  expect(Math.min(h.dir, 360 - h.dir)).toBeLessThan(1e-9);
  expect(hourAt([a, b], -5)!.t).toBe(0);
});

test("a storm, fog, a cumulus tower: the codes and the convection's energy", () => {
  const base = {
    t: 0,
    low: 0.8,
    mid: 0,
    high: 0,
    vis: 20e3,
    precip: 0,
    code: 3,
    u10: 5,
    dir: 200,
    gust: 9,
    T: 25,
    Td: 15,
    p: 1010,
    cape: 0,
  };
  const storm = modelWeather({ ...base, code: 95, precip: 12, cape: 2500 });
  expect(storm.kind).toBe("storm");
  expect(storm.rain).toBe(1);
  expect(storm.layers[0]!.top).toBeGreaterThanOrEqual(9000);
  expect(storm.wind.turb).toBe(3);
  const fog = modelWeather({ ...base, code: 45, vis: 250, T: 8, Td: 8, low: 1 });
  expect(fog.kind).toBe("fog");
  expect(fog.fogTop).toBe(150);
  expect(fog.layers[0]!.base).toBe(150);
  expect(flightCategory(fog)).toBe("LIFR");
  const towering = modelWeather({ ...base, cape: 1200 });
  expect(towering.layers[0]!.top - towering.layers[0]!.base).toBe(3000);
  expect(towering.layers[0]!.base).toBe(1250);
});

test("the feed: one request per cell and day, a failure retried later, the state read at any hour", async () => {
  const asked: string[] = [];
  let now = Date.UTC(2026, 7, 12, 18);
  const feed = new OpenMeteoFeed(
    async (url) => {
      asked.push(url);
      return burgos;
    },
    () => NOW,
  );
  const first = feed.peek(42.55, -2.45, now);
  expect(first.state).toBeNull();
  await first.fetched;
  const r = feed.peek(42.55, -2.45, now);
  expect(r.state!.source).toBe("model");
  now += 3600e3;
  expect(feed.peek(42.6, -2.4, now).state).not.toBeNull();
  expect(asked.length).toBe(1);
  const off = new OpenMeteoFeed(
    async () => {
      throw new Error("offline");
    },
    () => NOW,
  );
  const f = off.peek(0, 0, NOW);
  await f.fetched;
  expect(off.peek(0, 0, NOW)).toEqual({ state: null, reachable: true, fetched: undefined });
  expect(feed.peek(0, 0, Date.UTC(2067, 0, 1)).reachable).toBe(false);
});

test("the real weather chosen: METAR now near a runway, the model elsewhere or another day, a draw out of reach", async () => {
  const days = (ms: number) => (ms - Date.UTC(2000, 0, 1, 12)) / DAY;
  expect(msOfDays(days(NOW))).toBe(NOW);
  const metar = new MetarFeed(
    async () => "LFPB 101200Z 03003KT 0300 FG VV002 08/08 Q1025 NOSIG\n",
    () => NOW,
  );
  const model = new OpenMeteoFeed(
    async () => burgos,
    () => NOW,
  );
  const rw = new RealWeather(metar, model, () => NOW);
  let updates = 0;
  rw.onUpdate = () => updates++;
  const bourget = { body: "earth", lat: 48.955, lon: 2.43, days: days(NOW), h: 0 };
  rw.at(bourget, 1);
  await Bun.sleep(5);
  const m = rw.at(bourget, 1);
  expect(m.info.why).toBe("metar");
  expect(m.info.station!.icao).toBe("LFPB");
  expect(m.state!.kind).toBe("fog");
  expect(rw.owns(m.state)).toBe(true);
  expect(updates).toBeGreaterThan(0);
  // (the same place another day: the model)
  const other = { ...bourget, days: days(Date.UTC(2026, 7, 12, 18)) };
  expect(rw.at(other, 1).info.why).toBe("pending");
  await Bun.sleep(5);
  const mo = rw.at(other, 1);
  expect(mo.info.why).toBe("model");
  // (the same hour asked again: the same state — the image not redone)
  expect(rw.at(other, 1).state).toBe(mo.state);
  // (out of reach: a plausible draw; Mars: a draw)
  const far = rw.at({ ...bourget, days: days(Date.UTC(2067, 0, 1)) }, 1);
  expect(far.info.why).toBe("out-of-range");
  expect(far.state!.source).toBe("random");
  expect(rw.at({ body: "mars", lat: 0, lon: 0, days: 0, h: 0 }, 1).info.why).toBe("other-world");
  // (a state set by a script is not its own)
  expect(rw.owns({ ...mo.state! })).toBe(false);
});
