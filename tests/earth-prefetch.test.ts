import { expect, test } from "bun:test";
import { earthPrefetchWanted, prefetchEarthMaps } from "../src/system/earth-maps";

test("no Earth prefetch on a connection the user asked to spare (Save-Data)", () => {
  expect(earthPrefetchWanted({ connection: { saveData: true } })).toBe(false);
  expect(earthPrefetchWanted({ connection: { saveData: false } })).toBe(true);
  expect(earthPrefetchWanted({})).toBe(true);
  expect(earthPrefetchWanted(undefined)).toBe(true);
});

test("Earth prefetch shares requests, retries failures and selects medium assets for the GPU", async () => {
  const compressed = { features: new Set<GPUFeatureName>(["texture-compression-bc"]) };
  const uncompressed = { features: new Set<GPUFeatureName>() };
  const calls: string[] = [];
  let fail = true;
  const get = async (url: string) => {
    calls.push(url);
    if (url.endsWith("med-rt.ktx2") && fail) return new Response("unavailable", { status: 503 });
    return new Response("prefetched");
  };
  const first = await Promise.allSettled([prefetchEarthMaps(compressed, get), prefetchEarthMaps(compressed, get)]);
  expect(first.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  expect(calls).toHaveLength(14); // six packed day/cloud faces, six night faces, ocean, relief
  expect(new Set(calls).size).toBe(14);
  expect(calls.filter((url) => url.endsWith(".ktx2"))).toHaveLength(6);
  expect(calls.some((url) => url.includes("high"))).toBe(false);
  fail = false;
  await prefetchEarthMaps(compressed, get);
  expect(calls).toHaveLength(15); // only the failed face was retried
  await prefetchEarthMaps(compressed, get);
  expect(calls).toHaveLength(15);
  await prefetchEarthMaps(uncompressed, get);
  expect(calls).toHaveLength(27); // twelve JPEG day/cloud faces; common night/ocean/relief already warmed
  expect(calls.filter((url) => /\/(day|cloud)-med\//.test(url))).toHaveLength(12);
});
