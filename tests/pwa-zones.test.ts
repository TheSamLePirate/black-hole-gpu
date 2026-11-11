import { expect, test } from "bun:test";
import { createZones } from "../src/pwa-zones";
import type { ZoneRecord } from "../src/pwa/rules";

// The offline zones' download (src/pwa-zones.ts) against a fake worker: a batch that never answers in its time — the IGN's
// grids slow at times — no longer stands the download paused for good (11 Nov 2026: 3 456 of 8 620 on kerr-mini); its chains
// are asked again at the end, and the zone comes in whole.
test("a batch that never answers: asked again at the end, the zone ready", async () => {
  let zones: ZoneRecord[] = [];
  let fetches = 0;
  const asked = new Set<string>();
  const talk = async <T>(msg: object): Promise<T | null> => {
    const m = msg as { type: string; zone?: ZoneRecord; chains?: string[][] };
    if (m.type === "zones") return structuredClone(zones) as T;
    if (m.type === "zone-save") {
      zones = [...zones.filter((z) => z.id !== m.zone!.id), structuredClone(m.zone!)];
      return { ok: true } as T;
    }
    if (m.type === "zone-fetch") {
      fetches++;
      // (the second batch: no answer — the talk's time out)
      if (fetches === 2) return null;
      for (const c of m.chains!) asked.add(c[0]!);
      return { done: m.chains!.length, bytes: 1000 * m.chains!.length, none: 0, failed: [] } as T;
    }
    return null;
  };
  const Z = createZones({ talk, busy: () => false, sources: () => ({ ortho: true, relief: false, hlod: false }) });
  const est = Z.estimate({ lat: 45.92, lon: 6.87, radiusKm: 0.5, profile: "low" });
  expect(est.chains).toBeGreaterThan(128);
  const id = await Z.add({ name: "test", lat: 45.92, lon: 6.87, radiusKm: 0.5, profile: "low" });
  expect(id).toBeTruthy();
  for (let i = 0; i < 400 && zones.find((z) => z.id === id)?.state === "downloading"; i++) await Bun.sleep(5);
  const z = zones.find((z) => z.id === id)!;
  expect(z.state).toBe("ready");
  expect(z.failed).toBe(0);
  expect(z.cursor).toBe(z.total);
  // (every chain asked and answered once at least — the silent batch's at the end)
  expect(asked.size).toBe(est.chains);
  expect(z.done).toBe(est.chains);
});

test("three batches in a row with no answer: paused (no worker), resumed later", async () => {
  let zones: ZoneRecord[] = [];
  const talk = async <T>(msg: object): Promise<T | null> => {
    const m = msg as { type: string; zone?: ZoneRecord };
    if (m.type === "zones") return structuredClone(zones) as T;
    if (m.type === "zone-save") {
      zones = [...zones.filter((z) => z.id !== m.zone!.id), structuredClone(m.zone!)];
      return { ok: true } as T;
    }
    return null;
  };
  const Z = createZones({ talk, busy: () => false, sources: () => ({ ortho: true, relief: false, hlod: false }) });
  const id = await Z.add({ name: "test", lat: 45.92, lon: 6.87, radiusKm: 0.5, profile: "low" });
  for (let i = 0; i < 400 && zones.find((z) => z.id === id)?.state === "downloading"; i++) await Bun.sleep(5);
  const z = zones.find((z) => z.id === id)!;
  expect(z.state).toBe("paused");
  expect(z.cursor).toBe(2 * 64);
});

test("a zone left with failed chains: paused; a resume asks them again — its tally counted once", async () => {
  let zones: ZoneRecord[] = [];
  let broken = true;
  let badUrl: string | null = null;
  const talk = async <T>(msg: object): Promise<T | null> => {
    const m = msg as { type: string; zone?: ZoneRecord; chains?: string[][] };
    if (m.type === "zones") return structuredClone(zones) as T;
    if (m.type === "zone-save") {
      zones = [...zones.filter((z) => z.id !== m.zone!.id), structuredClone(m.zone!)];
      return { ok: true } as T;
    }
    if (m.type === "zone-fetch") {
      // (the first chain of all fails while `broken` — an IGN grid answering an error —, the others come in)
      const chains = m.chains!;
      badUrl ??= chains[0]![0]!;
      const bad = broken ? chains.filter((c) => c[0] === badUrl) : [];
      return { done: chains.length - bad.length, bytes: 1000 * (chains.length - bad.length), none: 0, failed: bad } as T;
    }
    return null;
  };
  const Z = createZones({ talk, busy: () => false, sources: () => ({ ortho: true, relief: false, hlod: false }) });
  const est = Z.estimate({ lat: 45.92, lon: 6.87, radiusKm: 0.5, profile: "low" });
  const id = await Z.add({ name: "test", lat: 45.92, lon: 6.87, radiusKm: 0.5, profile: "low" });
  const settle = async () => {
    for (let i = 0; i < 400 && zones.find((z) => z.id === id)?.state === "downloading"; i++) await Bun.sleep(5);
    return zones.find((z) => z.id === id)!;
  };
  let z = await settle();
  expect(z.state).toBe("paused");
  expect(z.failed).toBeGreaterThan(0);
  broken = false;
  await Z.resume(id!);
  z = await settle();
  expect(z.state).toBe("ready");
  expect(z.failed).toBe(0);
  expect(z.done).toBe(est.chains);
});
