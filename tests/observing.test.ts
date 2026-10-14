import { expect, test } from "bun:test";
import { nextSeen, seenAt, seenWindows, skyLight, spotOf } from "../src/system/observing";
import { NAMED_STARS } from "../src/skychart";

// What can be seen from a place and when (system/observing.ts): the windows by each thing's rule — the Sun by day,
// Jupiter at night round its opposition of 10 January 2026, Venus lost in the Sun at its conjunction, Sirius over
// Paris's southern sky on a winter's night —, each window's best moment at its highest.

const PARIS = { lat: 48.8566, lon: 2.3522 };
const JAN10 = Date.UTC(2026, 0, 10, 12);

test("the Sun: one window a day, its best at the local noon, as high as the season has it", () => {
  const w = seenWindows({ kind: "body", id: "sun" }, PARIS.lat, PARIS.lon, JAN10 - 12 * 3600e3, 3);
  expect(w.length).toBe(3);
  for (const x of w) {
    expect(x.sky).toBe("day");
    // (noon in Paris, 2.35° east, the equation of time in January: about 11:58 UTC)
    const h = new Date(x.best).getUTCHours() + new Date(x.best).getUTCMinutes() / 60;
    expect(Math.abs(h - 11.95)).toBeLessThan(0.15);
    // (90 − 48.86 − 21.9: 19.2°)
    expect(Math.abs(x.alt - 19.2)).toBeLessThan(0.6);
  }
});

test("Jupiter at its opposition: seen all night, highest about midnight, 64° up", () => {
  const w = seenWindows({ kind: "body", id: "jupiter" }, PARIS.lat, PARIS.lon, JAN10, 1);
  expect(w.length).toBe(1);
  const x = w[0]!;
  expect(x.sky).toBe("night");
  expect((x.to - x.from) / 3600e3).toBeGreaterThan(10);
  const h = new Date(x.best).getUTCHours();
  expect(h === 23 || h === 0 || h === 22).toBe(true);
  // (its declination +22.9°: 90 − 48.86 + 22.9 ≈ 64°)
  expect(Math.abs(x.alt - 64)).toBeLessThan(1.5);
  expect(Math.abs(((x.az - 180 + 540) % 360) - 180)).toBeLessThan(2);
});

test("Venus at its superior conjunction (6 January 2026): not seen for weeks; Mercury neither by night", () => {
  expect(seenWindows({ kind: "body", id: "venus" }, PARIS.lat, PARIS.lon, Date.UTC(2026, 0, 1), 10)).toEqual([]);
  expect(seenAt({ kind: "body", id: "mercury" }, PARIS.lat, PARIS.lon, Date.UTC(2026, 0, 10, 0))).toBe(false);
});

test("Sirius over Paris on a winter's night: south at its highest, 24° up; the next window found from noon", () => {
  const i = NAMED_STARS.findIndex((s) => s.name === "Sirius");
  expect(i).toBeGreaterThanOrEqual(0);
  const sirius = { kind: "star" as const, name: "Sirius", v: NAMED_STARS[i]!.v };
  const x = nextSeen(sirius, PARIS.lat, PARIS.lon, JAN10)!;
  expect(x.from).toBeGreaterThan(JAN10);
  expect(Math.abs(x.alt - 24.5)).toBeLessThan(1);
  expect(Math.abs(((x.az - 180 + 540) % 360) - 180)).toBeLessThan(2);
  expect(x.sky).toBe("night");
  // (its place now: a direction, defined at any hour)
  expect(spotOf(sirius, PARIS.lat, PARIS.lon, JAN10)).not.toBeNull();
});

test("the sky's light; the wormhole's mouth has a place in the sky like any body", () => {
  expect(skyLight(PARIS.lat, PARIS.lon, Date.UTC(2026, 5, 21, 12))).toBe("day");
  expect(skyLight(PARIS.lat, PARIS.lon, Date.UTC(2026, 0, 10, 0))).toBe("night");
  const m = spotOf({ kind: "wormhole" }, PARIS.lat, PARIS.lon, JAN10)!;
  expect(Number.isFinite(m.alt) && Number.isFinite(m.az)).toBe(true);
});
