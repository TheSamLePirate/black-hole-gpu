import { expect, test } from "bun:test";
import { Chrono } from "../src/cockpit/chrono";
import { CONTROLS } from "../src/cockpit/controls";
import { clickValue, CockpitInput, LEVER_PX, settle } from "../src/cockpit/input";

// PLAN-COCKPIT K2: the pointer working the controls — a lever's detents, a click's next position, a drag, the
// wheel; the chronometer's one button.

const ctl = (id: string) => CONTROLS.find((c) => c.id === id)!;

/** A host: one control under the pointer, the values kept, the acts recorded. */
function host(over: string | null) {
  const v: Record<string, number> = {};
  const acts: [string, number | undefined][] = [];
  const h = {
    target: () => (over ? { kind: "control" as const, id: over, t: 0.6 } : null),
    value: (id: string) => v[id] ?? 0,
    act: (id: string, x?: number) => {
      acts.push([id, x]);
      if (x !== undefined) v[id] = x;
    },
  };
  return { h, v, acts };
}

test("detents and clicks: the flaps 0 → ½ → full → 0, the gear up ↔ down, a switch flipped, a button pushed", () => {
  expect(settle(ctl("flaps"), 0.3)).toBe(0.5);
  expect(settle(ctl("flaps"), 0.2)).toBe(0);
  expect(settle(ctl("airBrake"), 0.37)).toBeCloseTo(0.37, 9);
  expect(clickValue(ctl("flaps"), 0)).toBe(0.5);
  expect(clickValue(ctl("flaps"), 0.5)).toBe(1);
  expect(clickValue(ctl("flaps"), 1)).toBe(0);
  expect(clickValue(ctl("gear"), 0)).toBe(1);
  expect(clickValue(ctl("gear"), 1)).toBe(0);
  expect(clickValue(ctl("navLights"), 0)).toBe(1);
  expect(clickValue(ctl("sas"), 0)).toBeUndefined();
});

test("a click: the control's own; a drag: the lever follows, through its detents; nothing held off a control", () => {
  const a = host("sas");
  const i = new CockpitInput(a.h);
  expect(i.down(0, 0)).toBe(true);
  expect(i.pressed).toBe("sas");
  i.up(true);
  expect(a.acts).toEqual([["sas", undefined]]);
  expect(i.pressed).toBeNull();

  const f = host("flaps");
  const j = new CockpitInput(f.h);
  j.down(0, 0);
  // (dragged down half its travel and a little: the ½ detent; then all the way: full)
  j.drag(0, LEVER_PX * 0.55);
  expect(f.v.flaps).toBe(0.5);
  j.drag(0, LEVER_PX * 0.5);
  expect(f.v.flaps).toBe(1);
  j.up(false);
  expect(f.acts.map((x) => x[1])).toEqual([0.5, 1]);

  const b = host("airBrake");
  const k = new CockpitInput(b.h);
  k.down(0, 0);
  k.drag(0, LEVER_PX * 0.3);
  expect(b.v.airBrake).toBeCloseTo(0.3, 6);
  k.up(false);

  const n = new CockpitInput(host(null).h);
  expect(n.down(0, 0)).toBe(false);
});

test("the wheel: the knob turned, the flaps a detent; not over a button", () => {
  const d = host("dimmer");
  d.v.dimmer = 1;
  const i = new CockpitInput(d.h);
  i.move(0, 0);
  expect(i.wheel(1)).toBe(true);
  expect(d.v.dimmer).toBeCloseTo(0.95, 9);
  const f = host("flaps");
  const j = new CockpitInput(f.h);
  j.move(0, 0);
  j.wheel(1);
  expect(f.v.flaps).toBe(0.5);
  const s = new CockpitInput(host("sas").h);
  s.move(0, 0);
  expect(s.wheel(1)).toBe(false);
});

test("the chronometer: started, stopped (its time held), reset", () => {
  const c = new Chrono();
  expect(c.push(1000)).toBe("started");
  expect(c.seconds(4000)).toBeCloseTo(3, 9);
  expect(c.push(5000)).toBe("stopped");
  expect(c.seconds(99000)).toBeCloseTo(4, 9);
  expect(c.push(100000)).toBe("reset");
  expect(c.seconds(100000)).toBe(0);
});
