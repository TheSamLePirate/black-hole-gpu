import { expect, test } from "bun:test";
import { DelayLine, linkFor, Outbox, STATIONS, stationOf } from "../src/crew/station";

// PLAN-VAISSEAUX K5: the crew's stations — aboard live, on the ground the light's time late, behind the wormhole cut —;
// the delayed queue (every snapshot for the Moon's 1.3 s, one a second for Mars's minutes); recorded messages.

test("the stations: three aboard, five on the ground; the link: aboard live, the ground late by the room's delay, cut behind the wormhole", () => {
  expect(STATIONS.filter((s) => s.place === "aboard").map((s) => s.id)).toEqual(["copilot", "nav", "engineer"]);
  expect(STATIONS.filter((s) => s.place === "ground").map((s) => s.call)).toEqual(["FLIGHT", "FIDO", "GUIDO", "EECOM", "CAPCOM"]);
  expect(stationOf("nope").id).toBe("copilot");
  const moon = { light: 1.28, delay: 1.28, cut: false };
  expect(linkFor(stationOf("nav"), moon)).toEqual({ delay: 0, cut: false });
  expect(linkFor(stationOf("fido"), moon)).toEqual({ delay: 1.28, cut: false });
  // (the pilot's setting: a tenth, none — the delay the room plays)
  expect(linkFor(stationOf("capcom"), { light: 750, delay: 75, cut: false }).delay).toBe(75);
  expect(linkFor(stationOf("capcom"), { light: 0, cut: true })).toEqual({ delay: 0, cut: true });
  expect(linkFor(stationOf("engineer"), { light: 0, cut: true })).toEqual({ delay: 0, cut: false });
});

test("the delay line: nothing before the light arrives, then the newest due; Mars's minutes thinned to one a second", () => {
  const q = new DelayLine<number>();
  for (let k = 0; k < 20; k++) q.push(k, k * 0.25, 1.3);
  expect(q.take(1.0, 1.3)).toBeNull();
  expect(q.take(2.0, 1.3)).toBe(2);
  expect(q.take(6.0, 1.3)).toBe(18);
  const mars = new DelayLine<number>();
  for (let k = 0; k < 4 * 600; k++) mars.push(k, k * 0.25, 750);
  expect(mars.size).toBeLessThanOrEqual(601);
  expect(mars.take(100, 750)).toBeNull();
  expect(mars.take(750 + 300, 750)).toBeGreaterThan(1150);
});

test("recorded messages: kept in order (twenty at most), flushed once", () => {
  const o = new Outbox();
  for (let k = 0; k < 25; k++) o.record(`m${k}`, k);
  expect(o.waiting.length).toBe(20);
  expect(o.flush().map((m) => m.text)[0]).toBe("m5");
  expect(o.waiting.length).toBe(0);
});
