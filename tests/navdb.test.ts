import { afterAll, beforeAll, expect, test } from "bun:test";
import { airwayLegs, navFind, navLoadAround, navNear, setNavBase } from "../src/world/navdb";

// The navigation database (PLAN-A320-VOL-AAA N1): scripts/build-navdb.ts's tiles read from the disk — a VOR and a fix found by their
// ident nearest a place, the aids near Paris, an airway walked from a fix to another.

const realFetch = globalThis.fetch;
beforeAll(() => {
  setNavBase("assets/nav/v1/");
  globalThis.fetch = (async (u: string | URL | Request) => {
    const f = Bun.file(String(u));
    return (await f.exists()) ? new Response(f) : new Response("", { status: 404 });
  }) as typeof fetch;
});
// (the real fetch given back: a test left with this one broke the next files' — test-suite leaks, 13 Nov 2026)
afterAll(() => {
  globalThis.fetch = realFetch;
});

test("a VOR and a fix by their ident, the nearest to a place", async () => {
  const paris = { lat: 48.97, lon: 2.44 };
  const pon = await navFind("PON", paris);
  expect(pon?.kind).toMatch(/^V/);
  expect(Math.abs(pon!.lat - 49.1)).toBeLessThan(0.3);
  const rsy = await navFind("RSY", paris);
  expect(rsy).not.toBeNull();
  expect(await navFind("ZZZZZZ", paris)).toBeNull();
});

test("the aids within 100 km of Le Bourget, once their tiles are in", async () => {
  await navLoadAround(48.97, 2.44, 100e3);
  const near = navNear(48.97, 2.44, 100e3, (k) => k !== "FIX");
  expect(near.length).toBeGreaterThan(5);
  expect(near.some((p) => p.kind === "N")).toBeTrue();
});

test("an airway walked from one of its fixes to another, in order: UN872 from EVX to LESDO through PON and KOVIN", async () => {
  const evx = await navFind("EVX", { lat: 49, lon: 1 });
  expect(evx).not.toBeNull();
  const legs = await airwayLegs("UN872", evx!, "LESDO");
  expect(legs?.map((p) => p.id)).toEqual(["EVX", "PON", "KOVIN", "LESDO"]);
  // (not on it: none)
  expect(await airwayLegs("UN872", evx!, "ZZZZZ")).toBeNull();
});
