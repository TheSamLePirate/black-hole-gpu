// The offline zones, the page's side (docs/ANALYSE-IGN-LIDAR.md §9, I8a): a region's tiles fetched ahead into the Service
// Worker's zones' cache (src/sw.ts: kerr-zones-v1, out of the tiles' budget), a flight within it then asking the network
// nothing for its ground. Its URLs the game's own (system/zones.ts zoneUrls), rebuilt from the zone's record; fetched by
// the worker a batch at a time (`zone-fetch`: each message keeps it alive), the game first — a batch waits while the tiles
// it streams are pending —; paused, resumed, resumed again after a reload (the record keeps its cursor). The storage asked
// to persist at the first zone (navigator.storage.persist: else the browser may clear it under pressure).
// `__bh.pwa.zones` (automation): the tests', TARS's, the settings' tab's (I8b).

import type { ZoneRecord } from "./pwa/rules";
import {
  type ZoneChain,
  type ZoneProfileId,
  type ZoneSources,
  ZONE_PROFILES,
  zoneChains,
  zoneDuration,
  zoneEstimate,
  zoneLevelsAt,
} from "./system/zones";

export interface Zones {
  /** what a zone would hold: its tiles' chains of fetches, their links, its size [bytes] by the kinds' means, its download
   *  time [s] */
  estimate(o: { lat: number; lon: number; radiusKm: number; profile: ZoneProfileId; coreKm?: number }): {
    chains: number;
    urls: number;
    bytes: number;
    seconds: number;
  };
  /** a zone added and its download started; its id */
  add(o: { name: string; lat: number; lon: number; radiusKm: number; profile: ZoneProfileId; coreKm?: number }): Promise<string | null>;
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

export function createZones(o: {
  talk: <T>(msg: object, timeoutMs?: number) => Promise<T | null>;
  /** the game streaming its own tiles: the download waits */
  busy: () => boolean;
  /** the sources the game's tiles follow now */
  sources: () => ZoneSources;
}): Zones {
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
      zone.state = "downloading";
      zone.total = urls.length;
      await save(zone);
      while (zone.cursor < urls.length && !paused.has(id)) {
        // (the game's own tiles first)
        while (o.busy() && !paused.has(id)) await new Promise((r) => setTimeout(r, 1000));
        if (paused.has(id)) break;
        const batch = urls.slice(zone.cursor, zone.cursor + BATCH);
        const r = await o.talk<{ done: number; bytes: number; none: number; failed: ZoneChain[] }>(
          { type: "zone-fetch", id, chains: batch, fresh: !!zone.fresh },
          BATCH_MS,
        );
        if (!r) {
          // (no worker, or a batch that never answered: given up for now, resumed later)
          paused.add(id);
          break;
        }
        zone.cursor += batch.length;
        zone.done += r.done;
        zone.bytes += r.bytes;
        zone.none += r.none;
        failed.push(...r.failed);
        await save(zone);
      }
      // (the failed asked once more at the end; those still failing counted, asked again on a resume)
      if (zone.cursor >= urls.length && failed.length && !paused.has(id)) {
        const r = await o.talk<{ done: number; bytes: number; none: number; failed: ZoneChain[] }>(
          { type: "zone-fetch", id, chains: failed, fresh: !!zone.fresh },
          BATCH_MS * Math.ceil(failed.length / BATCH),
        );
        if (r) {
          zone.done += r.done;
          zone.bytes += r.bytes;
          zone.none += r.none;
          zone.failed = r.failed.length;
        }
      }
      zone.state = paused.has(id) ? "paused" : zone.failed ? "paused" : "ready";
      if (zone.state === "ready") {
        zone.updated = Date.now();
        zone.fresh = false;
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
    estimate({ lat, lon, radiusKm, profile, coreKm = 0 }) {
      const chains = zoneChains(lat, lon, radiusKm * 1000, ZONE_PROFILES[profile], o.sources(), coreKm * 1000);
      return {
        chains: chains.length,
        urls: chains.reduce((s, c) => s + c.length, 0),
        bytes: zoneEstimate(chains),
        seconds: zoneDuration(chains),
      };
    },
    async add({ name, lat, lon, radiusKm, profile, coreKm }) {
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
        total: 0,
        done: 0,
        bytes: 0,
        none: 0,
        failed: 0,
        state: "downloading",
        cursor: 0,
        sources: o.sources(),
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
      // (a finished zone's failed: its list asked again from the start — the tiles in only marked)
      await save({ ...z, state: "downloading", cursor: z.state === "ready" || z.cursor >= z.total ? 0 : z.cursor, failed: 0 });
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
      await save({ ...z, state: "downloading", cursor: 0, done: 0, bytes: 0, none: 0, failed: 0, fresh: true, sources: o.sources() });
      if (!queue.includes(id)) queue.push(id);
      void run();
    },
    async remove(id) {
      paused.add(id);
      while (active === id) await new Promise((r) => setTimeout(r, 200));
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
