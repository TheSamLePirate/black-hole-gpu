import { expect, test } from "bun:test";
import { ArrivalLog, spread } from "../src/system/tile-arrivals";

test("CM0: a tile's stages timed from its request, by source; the halo's loads apart", () => {
  let t = 1000;
  const log = new ArrivalLog(16, () => t);
  log.begin("12/1/2", "terrarium");
  t = 1100;
  log.mark("12/1/2", "got");
  t = 1120;
  log.mark("12/1/2", "put");
  log.mark("12/1/2", "put", 5000); // (the first time kept)
  t = 1500;
  log.national("12/1/2", "ign");
  log.mark("12/1/2", "nat");
  t = 1130;
  log.mark("12/1/2", "drawn");
  log.begin("12/9/9", "terrarium", true);
  log.mark("12/9/9", "put");
  const s = log.stats();
  expect(s.terrarium!.tiles).toBe(1);
  expect(s.terrarium!.got.p50).toBe(100);
  expect(s.terrarium!.put.p50).toBe(120);
  expect(s.terrarium!.drawnAfter.p50).toBe(130);
  expect(s["nat:ign"]!.nat.p50).toBe(500);
  expect(log.stats(true).terrarium!.tiles).toBe(2);
});

test("CM0: a retried tile keeps its first request; failures and stand-ins counted; the oldest dropped past the limit", () => {
  let t = 0;
  const log = new ArrivalLog(2, () => t);
  log.begin("a", "terrarium");
  log.fail("a");
  t = 3000;
  log.begin("a", "terrarium");
  log.standIn("a");
  t = 3500;
  log.mark("a", "put");
  const a = log.get("a")!;
  expect(a.req).toBe(0);
  expect(a.fails).toBe(1);
  expect(log.stats().terrarium!.standIns).toBe(1);
  expect(log.stats().terrarium!.failed).toBe(0);
  log.begin("b", "terrarium");
  log.begin("c", "terrarium");
  expect(log.get("a")).toBeUndefined();
  log.reset();
  expect(log.list().length).toBe(0);
});

test("spread: median and 95th percentile", () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  expect(spread(v)).toEqual({ n: 100, p50: 50, p95: 95, max: 100 });
  expect(spread([])).toEqual({ n: 0, p50: 0, p95: 0, max: 0 });
});
