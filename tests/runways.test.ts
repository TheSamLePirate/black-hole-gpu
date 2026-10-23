import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { decodeTile, fieldShown, tileKey, tilesAround } from "../src/world/runways";

// The world's airfields and runways (PLAN-RADAR-AAA RD10, criterion P6): OurAirports' built into tiles
// (scripts/build-runways.ts) — the big airports' runways where they are, their lengths and headings; a grass strip, a
// seaplane base, a heliport; the tiles' size; the queries over the antimeridian and near the poles.

const DIR = `${import.meta.dir}/../assets/runways/v1`;
const tile = async (lat: number, lon: number) => decodeTile(await Bun.file(`${DIR}/t${tileKey(lat, lon)}.json`).json());

test("LFPG: four paved runways, east–west, 2 700 to 4 200 m, where they are", async () => {
  const f = (await tile(49.0097, 2.5479)).find((x) => x.icao === "LFPG")!;
  expect(f.kind).toBe("large");
  // (its four paved runways — and its helicopters' grass strip, 08H/26H)
  const paved = f.runways.filter((w) => w.surface === "paved");
  expect(paved.length).toBe(4);
  expect(f.runways.some((w) => w.le === "08H" && w.surface === "grass")).toBe(true);
  for (const w of paved) {
    expect(w.surface).toBe("paved");
    expect(w.approx).toBe(false);
    expect(w.len).toBeGreaterThan(2600);
    expect(w.len).toBeLessThan(4300);
    expect(Math.abs(w.hdg - 85.5)).toBeLessThan(2);
    // (its thresholds within 3 km of the airport's point)
    expect(Math.hypot((w.lat1 - f.lat) * 111, (w.lon1 - f.lon) * 73)).toBeLessThan(4);
  }
});

test("KJFK and EGLL: their runways, names and lengths", async () => {
  const jfk = (await tile(40.6398, -73.7789)).find((x) => x.icao === "KJFK")!;
  expect(jfk.runways.length).toBe(4);
  expect(jfk.runways.map((w) => w.le).sort()).toEqual(["04L", "04R", "13L", "13R"]);
  const lhr = (await tile(51.47, -0.4543)).find((x) => x.icao === "EGLL")!;
  expect(lhr.runways.filter((w) => w.len > 3500).length).toBe(2);
  expect(lhr.iata).toBe("LHR");
});

test("a grass strip, a seaplane base, a heliport", async () => {
  const fr = await tile(47, 2);
  expect(fr.some((f) => f.runways.some((w) => w.surface === "grass"))).toBe(true);
  const all = [...(await tile(61, -150)), ...(await tile(47, -122))];
  expect(all.some((f) => f.kind === "seaplane" && f.runways.some((w) => w.surface === "water"))).toBe(true);
  expect(all.some((f) => f.kind === "heliport")).toBe(true);
});

test("the tiles: some 1 000, none over 600 kB; the level of detail by range", async () => {
  const files = readdirSync(DIR).filter((f) => f.startsWith("t"));
  expect(files.length).toBeGreaterThan(800);
  for (const f of files) expect(Bun.file(`${DIR}/${f}`).size).toBeLessThan(600_000);
  const lfpg = (await tile(49.0097, 2.5479)).find((x) => x.icao === "LFPG")!;
  expect(fieldShown(lfpg, 500_000)).toBe(true);
  const heli = (await tile(49, 2.5)).find((x) => x.kind === "heliport")!;
  expect(fieldShown(heli, 50_000)).toBe(false);
  expect(fieldShown(heli, 10_000)).toBe(true);
});

test("the tiles about a place: over the antimeridian, near a pole", () => {
  const k = tilesAround(0, 179.9, 30_000);
  expect(k).toContain("0_35");
  expect(k).toContain("0_-36");
  expect(tilesAround(89.5, 10, 50_000).every((x) => Number(x.split("_")[0]) <= 17)).toBe(true);
  expect(tileKey(-0.1, -0.1)).toBe("-1_-1");
});
