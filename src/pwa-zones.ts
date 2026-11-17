// The offline zones, the page's side (docs/ANALYSE-IGN-LIDAR.md §9, I8a): a region's tiles fetched ahead into the Service
// Worker's zones' cache (src/sw.ts: kerr-zones-v1, out of the tiles' budget), a flight within it then asking the network
// nothing for its ground. Its URLs the game's own (system/zones.ts zoneUrls), rebuilt from the zone's record; fetched by
// the worker a batch at a time (`zone-fetch`: each message keeps it alive), the game first — a batch waits while the tiles
// it streams are pending —; paused, resumed, resumed again after a reload (the record keeps its cursor). The storage asked
// to persist at the first zone (navigator.storage.persist: else the browser may clear it under pressure).
// `__bh.pwa.zones` (automation): the tests', TARS's, the settings' tab's (I8b). A zone's building cells (PLAN-J8 J8-6, system/
// zone-cells.ts) prepared once its tiles are in — offline, no decoding in flight —, counted in its record (`cells`), dropped with it.

import type { ZoneRecord } from "./pwa/rules";
import {
  type ZoneChain,
  type ZoneCorridor,
  type ZoneProfileId,
  type ZoneSources,
  ZONE_PROFILES,
  ZONE_SCHEMA,
  zoneChains,
  zoneDuration,
  zoneEstimate,
  zoneLevelsAt,
  zoneTouchesSea,
} from "./system/zones";
import { FOREST_CELL_BYTES_EST, FOREST_CELL_SECONDS_EST } from "./system/forest-cells";
import { MESH_CELL_BYTES_EST, MESH_CELL_SECONDS_EST } from "./system/mesh-cells";
import { cellsOnlyIn, type ZoneCells, zoneCellTiles, zoneMeshTiles, zoneStreetTiles } from "./system/zone-cells";

export interface Zones {
  /** what a zone would hold: its tiles' chains of fetches, their links, its size [bytes] by the kinds' means, its download
   *  time [s] */
  estimate(o: { lat: number; lon: number; radiusKm: number; profile: ZoneProfileId; coreKm?: number; corridor?: ZoneCorridor }): {
    chains: number;
    urls: number;
    bytes: number;
    seconds: number;
    /** its near meshes' cells (PLAN-J8 J8-8: a corridor's, within MESH_NEAR_M of its track) — in `bytes` and `seconds` already, an
     *  estimate (mesh-cells.ts MESH_CELL_BYTES_EST) */
    meshes: { cells: number; bytes: number };
    /** its forest cells (PLAN-J8 J8-8b: the meshes' selection) — in `bytes` and `seconds` already, measured means (forest-cells.ts) */
    forests: { cells: number; bytes: number };
  };
  /** a zone added and its download started; its id */
  /** a zone added — with a corridor (PLAN-J8 J8-9 (2)): the airfield's levels along its track — and its download started; its id */
  add(o: {
    name: string;
    lat: number;
    lon: number;
    radiusKm: number;
    profile: ZoneProfileId;
    coreKm?: number;
    corridor?: ZoneCorridor;
  }): Promise<string | null>;
  list(): Promise<ZoneRecord[]>;
  /** the finest levels the zones hold with the camera at a place [°] (system/zones.ts zoneLevelsAt; the zones as last
   *  read or saved): null out of every zone */
  heldAt(lat: number, lon: number): { reliefZ1: number; orthoZ1: number } | null;
  /** resolves once its batch under way is in: nothing more asked from then */
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  /** a zone fetched again from its start, every tile asked anew (the sources' new vintage), the old kept where it fails */
  update(id: string): Promise<void>;
  /** a zone dropped: its tiles no other zone holds deleted */
  remove(id: string): Promise<void>;
  /** the zone downloading, if any */
  readonly active: string | null;
  /** the storage persistent (navigator.storage.persisted) */
  persisted(): Promise<boolean>;
}

/** chains a batch (the worker fetches sixteen at once: four rounds) */
const BATCH = 64;
/** a batch's answer within [ms] (a WMS-R grid 0.3–3 s, spaced 8 a second) */
const BATCH_MS = 120_000;
/** the pause before the failed chains are asked again at the end [ms] */
export const RETRY_PAUSE_MS = 30_000;

export function createZones(o: {
  talk: <T>(msg: object, timeoutMs?: number) => Promise<T | null>;
  /** the game streaming its own tiles: the download waits */
  busy: () => boolean;
  /** the sources the game's tiles follow now */
  sources: () => ZoneSources;
  /** the e2e harness's alone (tests/e2e/lib/app.ts, when the e2e's disk serves the Earth's data): « the WMS-R's spacing lifted: the data
   *  come from the e2e's disk » — each batch tells the worker to skip its WMS-R spacing (sw.ts gentle), nothing else changed; a player
   *  never has it (off unless the page global `__e2eWmsSpacingLifted` is true) */
  wmsSpacingLifted?: () => boolean;
  /** PLAN-J8 J8-A, the offline relief's rule: whether a place is at sea (true), on land (false), unknown (null) — the page's coarse
   *  relief (renderer.earthLandAt); a zone that touches the sea holds RGE ALTI at the LiDAR's levels (zones.ts seaCheck); none given:
   *  every zone judged on the coast (the safe side) */
  seaAt?: (lat: number, lon: number) => boolean | null;
  /** the pause before the failed are asked again (RETRY_PAUSE_MS; the tests' 0) */
  retryPauseMs?: number;
  /** the building cells (PLAN-J8 J8-6): prepared into the prepared cache once a zone's tiles are in, dropped from it */
  cells?: {
    prepare(tiles: { x: number; y: number }[]): Promise<ZoneCells>;
    drop(tiles: { x: number; y: number }[]): Promise<void>;
    /** the street cells (PLAN-J8 J8-L): prepared after the buildings', dropped with them */
    prepareStreets?(tiles: { x: number; y: number }[]): Promise<ZoneCells>;
    dropStreets?(tiles: { x: number; y: number }[]): Promise<void>;
    /** the near meshes' cells (PLAN-J8 J8-8): within MESH_NEAR_M of a corridor's track, after the streets', dropped with them */
    prepareMeshes?(tiles: { x: number; y: number }[]): Promise<ZoneCells>;
    dropMeshes?(tiles: { x: number; y: number }[]): Promise<void>;
    /** the forest cells (PLAN-J8 J8-8b): the meshes' selection, after them, dropped with them */
    prepareForests?(tiles: { x: number; y: number }[]): Promise<ZoneCells>;
    dropForests?(tiles: { x: number; y: number }[]): Promise<void>;
  };
}): Zones {
  /** a zone's sources: the settings' now, and whether it touches the sea (judged once here, kept in its record: its chains the same
   *  on a resume, a removal) */
  const sourcesAt = (lat: number, lon: number, radiusKm: number): ZoneSources => ({
    ...o.sources(),
    seaCheck: zoneTouchesSea(lat, lon, radiusKm * 1000, o.seaAt ?? (() => null)),
  });
  let active: string | null = null;
  const paused = new Set<string>();
  const queue: string[] = [];
  const chainsOf = (z: ZoneRecord) =>
    zoneChains(
      z.lat,
      z.lon,
      z.radiusKm * 1000,
      ZONE_PROFILES[z.profile as ZoneProfileId] ?? ZONE_PROFILES.low,
      z.sources,
      (z.coreKm ?? 0) * 1000,
      z.corridor ?? null,
    );
  // (the zones as last read or saved: the game's levels offline follow them, at once — heldAt)
  let known: ZoneRecord[] = [];
  const zones = async () => {
    const all = await o.talk<ZoneRecord[]>({ type: "zones" });
    if (all) known = all;
    return all ?? [];
  };
  const save = (zone: ZoneRecord) => {
    known = [...known.filter((z) => z.id !== zone.id), zone];
    return o.talk({ type: "zone-save", zone });
  };
  const get = async (id: string) => (await zones()).find((z) => z.id === id) ?? null;
  async function run() {
    if (active) return;
    while (queue.length) {
      const id = queue.shift()!;
      const zone = await get(id);
      if (!zone || zone.state === "ready" || paused.has(id)) continue;
      active = id;
      const urls = chainsOf(zone);
      const failed: ZoneChain[] = [];
      let silent = 0;
      zone.state = "downloading";
      zone.total = urls.length;
      await save(zone);
      while (zone.cursor < urls.length && !paused.has(id)) {
        // (the game's own tiles first)
        const w0 = Date.now();
        while (o.busy() && !paused.has(id)) await new Promise((r) => setTimeout(r, 1000));
        zone.waitMs = (zone.waitMs ?? 0) + (Date.now() - w0);
        if (paused.has(id)) break;
        const batch = urls.slice(zone.cursor, zone.cursor + BATCH);
        const b0 = Date.now();
        const r = await o.talk<{ done: number; bytes: number; none: number; failed: ZoneChain[]; why?: string[] }>(
          { type: "zone-fetch", id, chains: batch, fresh: !!zone.fresh, wmsSpacingLifted: !!o.wmsSpacingLifted?.() },
          BATCH_MS,
        );
        zone.batchMs = (zone.batchMs ?? 0) + (Date.now() - b0);
        if (!r) {
          // (a batch that never answered in its time — the IGN's grids slow at times: one took more than 120 s on kerr-mini,
          // 11 Nov 2026, and the download stood paused for good at 3 456 of 8 620 —: its chains asked again at the end, the
          // next batch on; three in a row — no worker —: given up for now, resumed later)
          if (++silent >= 3) {
            paused.add(id);
            break;
          }
          failed.push(...batch);
          zone.cursor += batch.length;
          await save(zone);
          continue;
        }
        silent = 0;
        zone.cursor += batch.length;
        zone.done += r.done;
        zone.bytes += r.bytes;
        zone.none += r.none;
        failed.push(...r.failed);
        await save(zone);
      }
      // (the failed asked once more at the end, after a pause — a source over its rate given the time to calm —; those still failing
      // counted, asked again on a resume)
      if (zone.cursor >= urls.length && failed.length && !paused.has(id)) {
        await new Promise((r) => setTimeout(r, o.retryPauseMs ?? RETRY_PAUSE_MS));
        const r = await o.talk<{ done: number; bytes: number; none: number; failed: ZoneChain[]; why?: string[] }>(
          { type: "zone-fetch", id, chains: failed, fresh: !!zone.fresh, wmsSpacingLifted: !!o.wmsSpacingLifted?.() },
          BATCH_MS * Math.ceil(failed.length / BATCH),
        );
        if (r) {
          zone.done += r.done;
          zone.bytes += r.bytes;
          zone.none += r.none;
          zone.failed = r.failed.length;
          zone.failedUrls = r.why?.length ? r.why : r.failed.slice(0, 8).map((c) => String(c[0] ?? "").slice(0, 240));
        } else {
          // (no answer to the last try either: all still counted failed — asked again on a resume —, never "ready" without them)
          zone.failed = failed.length;
          zone.failedUrls = failed.slice(0, 8).map((c) => String(c[0] ?? "").slice(0, 240));
        }
      }
      zone.state = paused.has(id) ? "paused" : zone.failed ? "paused" : "ready";
      // (its building cells prepared from its tiles now in — an update's: its old cells dropped first, the sources' new vintage)
      if (zone.state === "ready" && o.cells) {
        const tiles = zoneCellTiles(urls);
        if (tiles.length) {
          if (zone.fresh) await o.cells.drop(tiles);
          zone.cells = await o.cells.prepare(tiles);
        }
        // (its street cells after its buildings' — J8-L: their town is the building cells')
        const streets = zoneStreetTiles(urls);
        if (streets.length && o.cells.prepareStreets) {
          if (zone.fresh) await o.cells.dropStreets?.(streets);
          const r = await o.cells.prepareStreets(streets);
          zone.streets = { count: r.count, bytes: r.bytes, failed: r.failed, ms: r.ms };
        }
        // (its near meshes along its corridor — J8-8: from its building cells, their ranks)
        const meshes = zoneMeshTiles(urls, zone);
        if (meshes.length && o.cells.prepareMeshes) {
          if (zone.fresh) await o.cells.dropMeshes?.(meshes);
          zone.meshes = await o.cells.prepareMeshes(meshes);
        }
        // (its forest cells on the same — J8-8b: the trees the near scene assembles)
        if (meshes.length && o.cells.prepareForests) {
          if (zone.fresh) await o.cells.dropForests?.(meshes);
          zone.forests = await o.cells.prepareForests(meshes);
        }
      }
      if (zone.state === "ready") {
        zone.updated = Date.now();
        zone.fresh = false;
        // (its sources' version: what this download followed — system/zones.ts ZONE_SCHEMA)
        zone.schema = ZONE_SCHEMA;
      }
      await save(zone);
      active = null;
    }
  }
  // (a download a reload cut short: taken up again)
  void (async () => {
    for (const z of await zones()) if (z.state === "downloading") queue.push(z.id);
    void run();
  })();
  return {
    estimate({ lat, lon, radiusKm, profile, coreKm = 0, corridor }) {
      const chains = zoneChains(
        lat,
        lon,
        radiusKm * 1000,
        ZONE_PROFILES[profile],
        sourcesAt(lat, lon, radiusKm),
        coreKm * 1000,
        corridor ?? null,
      );
      // (its near meshes along its corridor: prepared after its tiles, on the disk beside them — J8-8)
      const cells = zoneMeshTiles(chains, { lat, lon, corridor: corridor ?? null }).length;
      const meshes = { cells, bytes: cells * MESH_CELL_BYTES_EST };
      // (its forest cells on the same — J8-8b)
      const forests = { cells, bytes: cells * FOREST_CELL_BYTES_EST };
      return {
        chains: chains.length,
        urls: chains.reduce((s, c) => s + c.length, 0),
        bytes: zoneEstimate(chains) + meshes.bytes + forests.bytes,
        seconds: zoneDuration(chains) + cells * (MESH_CELL_SECONDS_EST + FOREST_CELL_SECONDS_EST),
        meshes,
        forests,
      };
    },
    async add({ name, lat, lon, radiusKm, profile, coreKm, corridor }) {
      try {
        await navigator.storage?.persist?.();
      } catch {
        /* refused: the zone kept all the same, at the browser's mercy */
      }
      const id = `zone-${Date.now().toString(36)}`;
      const zone: ZoneRecord = {
        id,
        name,
        lat,
        lon,
        radiusKm,
        profile,
        ...(coreKm ? { coreKm } : {}),
        ...(corridor
          ? { corridor: { points: corridor.points.map((p) => [p[0], p[1]] as [number, number]), halfWidthM: corridor.halfWidthM } }
          : {}),
        total: 0,
        done: 0,
        bytes: 0,
        none: 0,
        failed: 0,
        state: "downloading",
        cursor: 0,
        sources: sourcesAt(lat, lon, radiusKm),
        created: Date.now(),
      };
      if (!(await save(zone))) return null;
      queue.push(id);
      void run();
      return id;
    },
    list: zones,
    heldAt: (lat, lon) => zoneLevelsAt(known, lat, lon),
    async pause(id) {
      paused.add(id);
      // (its batch under way let finish: nothing more asked once this resolves)
      while (active === id) await new Promise((r) => setTimeout(r, 200));
      const z = await get(id);
      if (z && z.state !== "ready") await save({ ...z, state: "paused" });
    },
    async resume(id) {
      paused.delete(id);
      const z = await get(id);
      if (!z) return;
      // (a finished zone's failed: its list asked again from the start — the tiles in only marked, counted again: its tally from
      // nothing, else its links counted twice)
      const again = z.state === "ready" || z.cursor >= z.total;
      await save({
        ...z,
        state: "downloading",
        cursor: again ? 0 : z.cursor,
        ...(again ? { done: 0, bytes: 0, none: 0, waitMs: 0, batchMs: 0 } : {}),
        failed: 0,
      });
      if (!queue.includes(id)) queue.push(id);
      void run();
    },
    async update(id) {
      paused.add(id);
      while (active === id) await new Promise((r) => setTimeout(r, 200));
      paused.delete(id);
      const z = await get(id);
      if (!z) return;
      // (from the start, its figures counted anew: the sources' now — the settings', the fine windows' side)
      await save({
        ...z,
        state: "downloading",
        cursor: 0,
        done: 0,
        bytes: 0,
        none: 0,
        failed: 0,
        waitMs: 0,
        batchMs: 0,
        fresh: true,
        sources: sourcesAt(z.lat, z.lon, z.radiusKm),
      });
      if (!queue.includes(id)) queue.push(id);
      void run();
    },
    async remove(id) {
      paused.add(id);
      while (active === id) await new Promise((r) => setTimeout(r, 200));
      // (its building cells no other zone holds dropped from the prepared cache)
      if (o.cells) {
        const all = await zones();
        const z = all.find((q) => q.id === id);
        if (z?.cells)
          await o.cells.drop(
            cellsOnlyIn(
              zoneCellTiles(chainsOf(z)),
              all.filter((q) => q.id !== id).map((q) => zoneCellTiles(chainsOf(q))),
            ),
          );
        if (z?.streets && o.cells.dropStreets)
          await o.cells.dropStreets(
            cellsOnlyIn(
              zoneStreetTiles(chainsOf(z)),
              all.filter((q) => q.id !== id).map((q) => zoneStreetTiles(chainsOf(q))),
            ),
          );
        if (z?.meshes && o.cells.dropMeshes)
          await o.cells.dropMeshes(
            cellsOnlyIn(
              zoneMeshTiles(chainsOf(z), z),
              all.filter((q) => q.id !== id).map((q) => zoneMeshTiles(chainsOf(q), q)),
            ),
          );
        if (z?.forests && o.cells.dropForests)
          await o.cells.dropForests(
            cellsOnlyIn(
              zoneMeshTiles(chainsOf(z), z),
              all.filter((q) => q.id !== id).map((q) => zoneMeshTiles(chainsOf(q), q)),
            ),
          );
      }
      await o.talk({ type: "zone-delete", id }, 60_000);
      known = known.filter((z) => z.id !== id);
      paused.delete(id);
    },
    get active() {
      return active;
    },
    persisted: async () => (await navigator.storage?.persisted?.()) ?? false,
  };
}
