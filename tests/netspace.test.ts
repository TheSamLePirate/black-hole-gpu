import { expect, test } from "bun:test";
import { dvText, fleetRows, orderAsk, orderPlan, proximity, rangeText, spaceTelOf, whereText } from "../src/net/spacefleet";

// PLAN-VAISSEAUX N1: the room's fleet of spacecraft — a pilot's craft heard checked, said; the fleet's rows (us first,
// then the nearest); an order's autopilot by how far; the proximity warning by range and closing.

const T = { vsl: "ranger", body: "earth", alt: 412.3, st: "orbit", dv: 1830, fails: 1, docked: false, o2h: 52.4, bat: 0.81, side: "ours" };

test("a craft heard: checked (a wrong one refused), said where and how it flies", () => {
  expect(spaceTelOf(T)).toEqual(T as never);
  expect(spaceTelOf({ ...T, vsl: "f35" })).toBeNull();
  expect(spaceTelOf({ ...T, body: "<script>" })).toBeNull();
  expect(spaceTelOf({ ...T, bat: 2 })).toBeNull();
  expect(spaceTelOf({ ...T, dv: null, o2h: null, bat: null })?.dv).toBeNull();
  expect(whereText(spaceTelOf(T)!)).toBe("in orbit · the Earth · 412 km");
  expect(whereText(spaceTelOf({ ...T, st: "landed", body: "moon" })!)).toBe("landed · the Moon");
  expect(whereText(spaceTelOf({ ...T, docked: true })!)).toBe("docked · the Earth");
  expect(rangeText(180)).toBe("180 m");
  expect(rangeText(2345)).toBe("2.35 km");
  expect(rangeText(45_000)).toBe("45 km");
  expect(dvText(1830.4)).toBe("1830 m/s");
  expect(dvText(89_809_794)).toBe("89,810 km/s");
  expect(dvText(null)).toBe("∞");
});

test("the fleet's rows: the pilots in spacecraft only, us first, then by distance; their figures said", () => {
  const members = [
    { slot: 0, name: "Ana", colour: "#f00", role: "pilot" },
    { slot: 1, name: "Ben", colour: "#0f0", role: "pilot" },
    { slot: 2, name: "Cal", colour: "#00f", role: "pilot" },
    { slot: 3, name: "Dee", colour: "#ff0", role: "pilot" },
    { slot: 4, name: "Eve", colour: "#0ff", role: "instruments" },
  ];
  const tel = new Map([
    [0, spaceTelOf(T)!],
    [1, spaceTelOf({ ...T, vsl: "endurance", fails: 0 })!],
    [2, spaceTelOf({ ...T, vsl: "lander", body: "moon", alt: 12 })!],
    [4, spaceTelOf(T)!],
  ]);
  const near = new Map([
    [1, { range: 5200, closing: -0.4 }],
    [2, { range: 380, closing: 1.2 }],
  ]);
  const R = fleetRows(members, tel, 1, near);
  expect(R.map((r) => r.name)).toEqual(["Ben", "Cal", "Ana"]);
  expect(R[0]!.me).toBe(true);
  expect(R[0]!.range).toBeNull();
  expect(R[1]).toMatchObject({ craft: "Lander", where: "in orbit · the Moon · 12.0 km", range: 380, closing: 1.2 });
  expect(R[2]).toMatchObject({ dv: "1830 m/s", life: "O₂ 52.4 h · battery 81 %", fails: 1, range: null });
});

test("an order: asked in words; its autopilot within the docking autopilot's reach only", () => {
  expect(orderAsk("dock", "Ana")).toBe("Ana asks you to dock to their craft");
  expect(orderPlan("dock", 800).auto).toBe("dock");
  expect(orderPlan("dock", 12_000).auto).toBeNull();
  expect(orderPlan("hold", 2000).auto).toBe("keep");
  expect(orderPlan("come", null)).toEqual({ auto: null, say: "Their craft targeted: plan the rendezvous (the map)" });
});

test("proximity: near and closing warned, the further and slower a caution, moving apart nothing", () => {
  expect(proximity(150, 1.5)).toBe("warning");
  expect(proximity(800, 20)).toBe("warning");
  expect(proximity(1500, 10)).toBe("caution");
  expect(proximity(150, -2)).toBe("none");
  expect(proximity(5000, 30)).toBe("none");
  expect(proximity(150, 0.5)).toBe("none");
});
