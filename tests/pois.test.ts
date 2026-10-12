// The Atlas's destinations (game/pois.ts) and the addresses (game/geocode.ts: Photon, Nominatim, coordinates).
import { expect, test } from "bun:test";
import { parseCoords, parseNominatim, parsePhoton } from "../src/game/geocode";
import { POI_KINDS, POIS, searchPois } from "../src/game/pois";

test("every destination: a unique id, its place on its world, its names and its line in both languages", () => {
  const ids = new Set<string>();
  for (const p of POIS) {
    expect(ids.has(p.id)).toBe(false);
    ids.add(p.id);
    expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
    expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    expect(POI_KINDS[p.kind]).toBeDefined();
    for (const k of ["fr", "en"] as const) expect(p.name[k].length && p.about[k].length).toBeGreaterThan(0);
  }
  for (const b of ["earth", "moon", "mars"]) expect(POIS.filter((p) => p.body === b).length).toBeGreaterThanOrEqual(15);
});

test("the search: the name's start first, either language, accents ignored, by world", () => {
  expect(searchPois("olymp")[0]!.id).toBe("olympus-mons");
  expect(searchPois("everest")[0]!.id).toBe("everest");
  expect(searchPois("tranquillite", POIS, "moon")[0]!.id).toBe("apollo-11");
  expect(searchPois("tranquility")[0]!.id).toBe("apollo-11");
  expect(searchPois("apollo", POIS, "moon").length).toBe(6);
  expect(searchPois("apollo", POIS, "mars").length).toBe(0);
  expect(searchPois("").length).toBe(POIS.length);
});

test("Photon's answer: the name, the line under it, the place, the kind, the box", () => {
  const r = parsePhoton({
    features: [
      {
        geometry: { coordinates: [2.2945, 48.8584] },
        properties: {
          name: "Tour Eiffel",
          city: "Paris",
          country: "France",
          osm_key: "tourism",
          osm_value: "attraction",
          extent: [2.29, 48.86, 2.3, 48.85],
        },
      },
      {
        geometry: { coordinates: [2.35, 48.85] },
        properties: { street: "Rue de Rivoli", housenumber: "1", postcode: "75001", city: "Paris" },
      },
      { geometry: {}, properties: { name: "nowhere" } },
    ],
  });
  expect(r.length).toBe(2);
  expect(r[0]).toMatchObject({
    name: "Tour Eiffel",
    detail: "Paris, France",
    lat: 48.8584,
    lon: 2.2945,
    kind: "tourism/attraction",
    box: [48.85, 48.86, 2.29, 2.3],
  });
  expect(r[1]).toMatchObject({ name: "1 Rue de Rivoli", detail: "75001, Paris" });
  expect(parsePhoton(null)).toEqual([]);
});

test("Nominatim's answer", () => {
  const r = parseNominatim([
    {
      lat: "45.8326",
      lon: "6.8652",
      name: "Mont Blanc",
      display_name: "Mont Blanc, Chamonix, France",
      category: "natural",
      type: "peak",
      boundingbox: ["45.82", "45.84", "6.85", "6.87"],
    },
    { lat: "x", lon: "1" },
  ]);
  expect(r).toEqual([
    {
      name: "Mont Blanc",
      detail: "Chamonix, France",
      lat: 45.8326,
      lon: 6.8652,
      kind: "natural/peak",
      box: [45.82, 45.84, 6.85, 6.87],
      source: "nominatim",
    },
  ]);
});

test("coordinates typed: decimal, hemispheres, degrees-minutes-seconds; nonsense refused", () => {
  expect(parseCoords("48.8566, 2.3522")).toEqual({ lat: 48.8566, lon: 2.3522 });
  expect(parseCoords("-33.86 151.21")).toEqual({ lat: -33.86, lon: 151.21 });
  expect(parseCoords("33.86 S 70.5 W")).toEqual({ lat: -33.86, lon: -70.5 });
  const p = parseCoords(`48°51'24"N 2°21'08"E`)!;
  expect(p.lat).toBeCloseTo(48.8567, 4);
  expect(p.lon).toBeCloseTo(2.3522, 4);
  expect(parseCoords("95 10")).toBeNull();
  expect(parseCoords("paris")).toBeNull();
});
