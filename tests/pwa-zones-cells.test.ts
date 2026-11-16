import { expect, test } from "bun:test";
import type { ZoneRecord } from "../src/pwa/rules";
import { createZones } from "../src/pwa-zones";
import { zoneCellTiles, zoneStreetTiles } from "../src/system/zone-cells";
import { ZONE_PROFILES, zoneChains } from "../src/system/zones";

// PLAN-J8 J8-6 — the zones' download (src/pwa-zones.ts) with its building cells: a fake Service Worker (every batch in at once) and fake
// cells — once the zone is ready, its BD TOPO tiles prepared and counted in its record; an update drops them first; a removal drops only
// those no other zone holds.

const SOURCES = {
  ortho: false,
  relief: true,
  hlod: false,
  span: 4,
  scenery: { mode: "balanced" as const, satellite: false, reach: 1, overture: false },
};

function harness() {
  const store = new Map<string, ZoneRecord>();
  const prepared: string[][] = [];
  const dropped: string[][] = [];
  const streets: string[][] = [];
  const streetsDropped: string[][] = [];
  const key = (t: { x: number; y: number }) => `${t.x}/${t.y}`;
  const zones = createZones({
    talk: async <T>(m: object) => {
      const msg = m as { type: string; zone?: ZoneRecord; id?: string; chains?: string[][] };
      if (msg.type === "zones") return [...store.values()].map((z) => structuredClone(z)) as T;
      if (msg.type === "zone-save") {
        store.set(msg.zone!.id, structuredClone(msg.zone!));
        return { ok: true } as T;
      }
      if (msg.type === "zone-fetch") return { done: msg.chains!.length, bytes: msg.chains!.length, none: 0, failed: [] } as T;
      if (msg.type === "zone-delete") {
        store.delete(msg.id!);
        return { ok: true } as T;
      }
      return null;
    },
    busy: () => false,
    sources: () => SOURCES,
    retryPauseMs: 0,
    cells: {
      async prepare(tiles) {
        prepared.push(tiles.map(key));
        return { count: tiles.length, buildings: 10 * tiles.length, bytes: 1000 * tiles.length, failed: 0, ms: 1 };
      },
      async drop(tiles) {
        dropped.push(tiles.map(key));
      },
      async prepareStreets(tiles) {
        streets.push(tiles.map(key));
        return { count: tiles.length, buildings: 0, bytes: 100 * tiles.length, failed: 0, ms: 1 };
      },
      async dropStreets(tiles) {
        streetsDropped.push(tiles.map(key));
      },
    },
  });
  const ready = async (id: string) => {
    for (let i = 0; i < 500; i++) {
      const z = (await zones.list()).find((q) => q.id === id);
      if (z?.state === "ready") return z;
      await Bun.sleep(5);
    }
    throw new Error("the zone never ready");
  };
  return { zones, store, prepared, dropped, streets, streetsDropped, ready };
}

const tilesOf = (lat: number, lon: number, km: number) =>
  zoneCellTiles(zoneChains(lat, lon, km * 1000, ZONE_PROFILES.overflight, SOURCES)).map((t) => `${t.x}/${t.y}`);

test("a zone ready: its BD TOPO cells prepared and counted in its record", async () => {
  const h = harness();
  const id = (await h.zones.add({ name: "a", lat: 43.124, lon: 5.93, radiusKm: 0.5, profile: "overflight" }))!;
  const z = await h.ready(id);
  const want = tilesOf(43.124, 5.93, 0.5);
  expect(want.length).toBeGreaterThan(0);
  expect(h.prepared).toEqual([want]);
  expect(z.cells).toEqual({ count: want.length, buildings: 10 * want.length, bytes: 1000 * want.length, failed: 0, ms: 1 });
});

test("an update drops its cells before preparing them again (the sources' new vintage)", async () => {
  const h = harness();
  const id = (await h.zones.add({ name: "a", lat: 43.124, lon: 5.93, radiusKm: 0.5, profile: "overflight" }))!;
  await h.ready(id);
  await h.zones.update(id);
  await Bun.sleep(20);
  await h.ready(id);
  expect(h.dropped).toEqual([tilesOf(43.124, 5.93, 0.5)]);
  expect(h.prepared.length).toBe(2);
});

test("a removal drops only the cells no other zone holds", async () => {
  const h = harness();
  const a = (await h.zones.add({ name: "a", lat: 43.124, lon: 5.93, radiusKm: 0.5, profile: "overflight" }))!;
  await h.ready(a);
  // (a second zone 1 km east: many cells shared)
  const b = (await h.zones.add({ name: "b", lat: 43.124, lon: 5.942, radiusKm: 0.5, profile: "overflight" }))!;
  await h.ready(b);
  await h.zones.remove(a);
  const onlyA = tilesOf(43.124, 5.93, 0.5).filter((t) => !tilesOf(43.124, 5.942, 0.5).includes(t));
  expect(h.dropped).toEqual([onlyA]);
  expect(onlyA.length).toBeLessThan(tilesOf(43.124, 5.93, 0.5).length);
});

test("a zone ready: its street cells prepared after its buildings' (J8-L), dropped with it", async () => {
  const h = harness();
  const id = (await h.zones.add({ name: "a", lat: 43.124, lon: 5.93, radiusKm: 0.5, profile: "overflight" }))!;
  const z = await h.ready(id);
  const want = zoneStreetTiles(zoneChains(43.124, 5.93, 500, ZONE_PROFILES.overflight, SOURCES)).map((t) => `${t.x}/${t.y}`);
  // (the roads' z 14 tiles within the lamps' 12 km: four cells each)
  expect(want.length).toBeGreaterThan(400);
  expect(h.streets).toEqual([want]);
  expect(z.streets?.count).toBe(want.length);
  await h.zones.remove(id);
  expect(h.streetsDropped).toEqual([want]);
});
