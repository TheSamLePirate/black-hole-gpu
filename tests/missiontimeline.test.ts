import { expect, test } from "bun:test";
import { buildTimeline } from "../src/game/missiontimeline";
import { fmtIn, fmtLen } from "../src/ui/missionplan";

// PLAN-VAISSEAUX X1e: a spacecraft's mission plan as a timeline — the burns in time's order with their length at full
// thrust, the spheres the path enters, an impact, the end's autopilot; the Δv planned against the tanks'.

test("a lunar mission: departure, a sphere entered, the capture, then an orbit; the margin", () => {
  const T = buildTimeline({
    now: 1000,
    burns: [
      { t: 4000, dv: 3100, role: "depart" },
      { t: 200000, dv: 850, role: "capture", body: "moon" },
      { t: 500, dv: 12, role: "mcc" },
    ],
    path: { times: [1000, 90000, 190000, 260000], refs: ["earth", "earth", "moon", "moon"], fate: "continues" },
    then: "orbit",
    dvLeft: 4500,
    accel: 10,
  });
  expect(T.events.map((e) => e.kind)).toEqual(["burn", "soi", "burn", "then"]);
  expect(fmtLen(T.events[0]!.burnS)).toBe("5 min 10 s");
  expect(fmtLen(0)).toBe("—");
  expect(T.events[0]!.burnS).toBeCloseTo(310, 9);
  expect(T.events[1]!.body).toBe("moon");
  expect(T.dv).toBe(3950);
  expect(T.margin).toBe(550);
  expect(T.next).toBe(0);
});

test("short of propellant: a negative margin; an impact at the path's end", () => {
  const T = buildTimeline({
    now: 0,
    burns: [{ t: 100, dv: 900 }],
    path: { times: [0, 50, 3000], refs: ["moon", "moon", "moon"], fate: "impact", hit: "moon" },
    dvLeft: 600,
    accel: 3,
  });
  expect(T.margin).toBe(-300);
  expect(T.events.at(-1)).toMatchObject({ kind: "impact", body: "moon", in: 3000 });
});

test("times from now in words", () => {
  expect(fmtIn(42)).toBe("T−42 s");
  expect(fmtIn(3725)).toBe("T−1 h 02 min");
  expect(fmtIn(-20)).toBe("T+20 s");
  expect(fmtIn(86400 * 5)).toBe("T−5.0 d");
});
