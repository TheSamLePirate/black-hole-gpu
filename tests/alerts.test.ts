import { expect, test } from "bun:test";
import { type AlertInput, alertsOf, MasterCaution } from "../src/ui/hud/alerts";

const calm = (): AlertInput => ({
  path: null,
  landed: false,
  surface: null,
  air: null as unknown as AlertInput["air"],
  ergo: false,
  region: "throat",
  r: NaN,
  photon: 3,
  isco: 6,
  auto: "none",
  target: "moon",
  engine: { kind: "crew", max: 1, fuel: { budget: 1, left: 1, dvLeft: 1, fraction: 1, empty: false } },
  status: null,
  animate: true,
  fmtM: (t) => `${t} M`,
});

test("nothing to say in a calm flight; the levels ranked, the gravest first", () => {
  expect(alertsOf(calm())).toEqual([]);
  const a = alertsOf({
    ...calm(),
    animate: false,
    engine: { kind: "crew", max: 1, fuel: { budget: 1, left: 0.05, dvLeft: 1, fraction: 0.05, empty: false } },
    path: { pts: [[0, 0, 0]], fate: "horizon", at: 0, dt: 2 },
  });
  expect(a.map((x) => [x.id, x.level])).toEqual([
    ["horizon", "warning"],
    ["fuel-low", "caution"],
    ["paused", "advisory"],
  ]);
});

test("the air's limits: caution near, warning at", () => {
  const air = (m: { shield: number; hull: number; g: number }) =>
    alertsOf({
      ...calm(),
      air: {
        inAir: true,
        margins: m,
        shield: 1500,
        hull: 600,
        g: 4,
        failure: null,
        stalled: false,
        mach: 10,
        heat: 0,
      } as unknown as AlertInput["air"],
    });
  expect(air({ shield: 0.9, hull: 0, g: 0 })[0]).toMatchObject({ id: "shield", level: "caution" });
  expect(air({ shield: 0.97, hull: 0, g: 0 })[0]).toMatchObject({ id: "shield", level: "warning" });
  expect(air({ shield: 0, hull: 0, g: 0.8 })[0]).toMatchObject({ id: "load", level: "caution" });
});

test("the master caution: lit until acknowledged, again for a new one or one back", () => {
  const mc = new MasterCaution();
  const w = { id: "stall", level: "warning" as const, text: "STALL" };
  const c = { id: "fuel-low", level: "caution" as const, text: "LOW" };
  expect(mc.update([w])).toMatchObject({ lamp: "warning", sound: true });
  mc.acknowledge();
  expect(mc.update([w])).toMatchObject({ lamp: null, sound: false });
  // (a caution comes: amber, no sound)
  expect(mc.update([w, c])).toMatchObject({ lamp: "caution", sound: false });
  mc.acknowledge();
  // (the stall cleared, then back: lit again)
  mc.update([c]);
  expect(mc.update([w, c])).toMatchObject({ lamp: "warning", sound: true });
  // (advisories never light it)
  const mc2 = new MasterCaution();
  expect(mc2.update([{ id: "paused", level: "advisory", text: "" }]).lamp).toBeNull();
});

test("each alert says why it is on and what to do", () => {
  const a = alertsOf({
    ...calm(),
    animate: false,
    ergo: true,
    engine: { kind: "crew", max: 1, fuel: { budget: 1, left: 0.05, dvLeft: 1, fraction: 0.05, empty: false } },
    path: { pts: [[0, 0, 0]], fate: "horizon", at: 0, dt: 2 },
  });
  expect(a.length).toBeGreaterThan(2);
  for (const x of a) {
    expect(x.why.length, x.id).toBeGreaterThan(10);
    expect(x.todo.length, x.id).toBeGreaterThan(10);
  }
});
