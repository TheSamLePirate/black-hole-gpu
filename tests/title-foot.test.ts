import { expect, test } from "bun:test";
import { presets } from "../src/settings";
import { WORLD_MAPS } from "../src/ui/title/art";
import { footLine, HOUR_OF, lastFoot, mapPoint, placeCoords, placesOf, WORLDS } from "../src/ui/title/foot";
import { FREE_TABS, freeScenes, sceneSlug } from "../src/ui/title/free";
import { HOURS } from "../src/ui/title/plane";

// On foot and the free camera on the title (PLAN-TITRE-AAA E6): the walk's choices (the Moon's Tranquility by
// default, a place kept on each world), its line, a place on its planisphere and in words; each world's places by
// kind and found by a search; the free camera's tabs — every scene but the game's flights, each once, its picture.

test("the walk: Tranquility on the Moon, now — by default; a place on each world", () => {
  const c = lastFoot();
  expect(c.world).toBe("moon");
  expect(c.place.moon.id).toBe("apollo-11");
  expect(c.place.mars.id).toBe("curiosity");
  expect(c.place.earth.lat).toBeCloseTo(45.98, 2);
  expect(c.hour).toBe("now");
  expect(c.weather).toBeNull();
  expect(footLine(c, "en")).toBe("Moon — Apollo 11, Tranquility Base — Now");
  // (the weather only on the Earth)
  expect(footLine({ ...c, world: "earth", hour: "dusk", weather: "fog" }, "fr")).toBe(
    "Terre — Lac Blanc, face au Mont-Blanc — Crépuscule — Brouillard",
  );
  for (const w of WORLDS) expect(WORLD_MAPS[w.id]).toBeTruthy();
  // (every hour of the day but "now" has its local hour)
  for (const h of HOURS) if (h.id !== "now") expect(HOUR_OF[h.id]).toBeGreaterThan(0);
});

test("a place on its planisphere (−180° at the left, the north up) and in words", () => {
  expect(mapPoint({ lat: 0, lon: 0 })).toEqual({ x: 0.5, y: 0.5 });
  expect(mapPoint({ lat: 90, lon: -180 })).toEqual({ x: 0, y: 0 });
  expect(mapPoint({ lat: -90, lon: 90 }).x).toBeCloseTo(0.75, 6);
  // (a longitude past 180° wraps)
  expect(mapPoint({ lat: 0, lon: 270 }).x).toBeCloseTo(0.25, 6);
  const p = { id: "x", name: { fr: "x", en: "x" }, lat: -4.5895, lon: 137.4417 };
  expect(placeCoords(p, "en")).toBe("4.590° S 137.442° E");
  expect(placeCoords({ ...p, lon: -80.6 }, "fr")).toBe("4.590° S 80.600° O");
});

test("each world's places, by kind; a search, the best first", () => {
  for (const w of WORLDS) {
    const xs = placesOf(w.id);
    expect(xs.length).toBeGreaterThanOrEqual(10);
    expect(xs[0]!.group).toBeTruthy();
    const ids = xs.map((x) => x.place.id);
    expect(new Set(ids).size).toBe(ids.length);
  }
  expect(placesOf("earth", "eiffel")[0]!.place.id).toBe("eiffel");
  expect(placesOf("mars", "olympus")[0]!.place.id).toBe("olympus-mons");
  expect(placesOf("moon", "olympus")).toEqual([]);
  expect(placesOf("earth", "eiffel")[0]!.group).toBeUndefined();
});

test("the free camera: a tab per kind, every scene but the game's flights, each once, each its picture", () => {
  expect(FREE_TABS.map((x) => x.id)).toEqual(["hole", "gargantua", "wormhole", "solar", "earth", "landscapes"]);
  const all = FREE_TABS.flatMap((x) => freeScenes(x.id));
  for (const x of all) {
    expect(presets[x.name]).toBeTruthy();
    expect(x.title.length).toBeGreaterThan(2);
  }
  expect(all.filter((x) => x.art).length).toBeGreaterThanOrEqual(all.length - 2);
  expect(all.some((x) => x.name === "game:artemis")).toBe(false);
  expect(all.length).toBe(Object.keys(presets).length - 4);
  const slugs = all.map((x) => sceneSlug(x.name));
  expect(new Set(slugs).size).toBe(slugs.length);
  expect(sceneSlug("Gargantua system (10⁸ M☉, a* = 0.998)")).toMatch(/^gargantua-system-10/);
});
