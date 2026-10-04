import { expect, test } from "bun:test";
import { burnGraph, fmtAxis, polyAt } from "../src/ui/hud/graph";

const labels = { y: "Δv left", x: "from the node", ignition: "IGN", cutoff: "CUT" };

test("a corridor's edge is read between its points and held flat beyond them", () => {
  const p: [number, number][] = [
    [0, 10],
    [10, 0],
  ];
  expect(polyAt(p, -5)).toBe(10);
  expect(polyAt(p, 5)).toBeCloseTo(5, 12);
  expect(polyAt(p, 20)).toBe(0);
});

test("a burn's optimum: the whole Δv until half the burn before the node, nothing half the burn after", () => {
  const G = burnGraph({ title: "Δv", dv: 100, left: 100, T: 40, x: -60, trace: [], burning: false, labels });
  expect(polyAt(G.ideal, -20)).toBeCloseTo(100, 9);
  expect(polyAt(G.ideal, 0)).toBeCloseTo(50, 9);
  expect(polyAt(G.ideal, 20)).toBeCloseTo(0, 9);
  // (60 s before the node, the burn 20 s off: still waiting)
  expect(G.state).toBe("wait");
  expect(G.marks.map((m) => m.x)).toEqual([-20, 20]);
});

test("burning: on the profile within the corridor, off it when late", () => {
  const on = burnGraph({ title: "Δv", dv: 100, left: 50, T: 40, x: 0, trace: [], burning: true, labels });
  expect(on.state).toBe("on");
  // (at the node with nothing yet flown: 20 s late — out of a 6 s corridor)
  const late = burnGraph({ title: "Δv", dv: 100, left: 100, T: 40, x: 0, trace: [], burning: true, labels });
  expect(late.state).toBe("off");
});

test("the axes write seconds, minutes and speeds short", () => {
  expect(fmtAxis(-30, "s")).toBe("−30 s");
  expect(fmtAxis(300, "s")).toBe("+5.0 min");
  expect(fmtAxis(2500, "m/s")).toBe("2500 m/s");
  expect(fmtAxis(25000, "m/s")).toBe("25.0 km/s");
});
