import { expect, test } from "bun:test";
import { hudMode, shownSpeed } from "../src/ui/hud/model";
import type { FlightPhase } from "../src/game/phase";
import { C_MPS } from "../src/units";

const base = {
  speedMode: "orbit" as const,
  region: "throat" as const,
  landed: false,
  surface: null,
  air: null,
  speed: 7670 / C_MPS,
  target: "moon" as const,
  ref: "earth",
};
const ph = (mode: FlightPhase["mode"], stage: FlightPhase["stage"]): FlightPhase => ({ mode, control: "manual", stage, detail: "" });
// biome-ignore lint/suspicious/noExplicitAny: a partial frame for the model's inputs
const at = (x: object) => ({ ...base, ...x }) as any;

test("in orbit: the speed about the body", () => {
  const s = shownSpeed(at({}), ph("flight", "orbit"));
  expect(s.mode).toBe("ORB");
  expect(s.v * C_MPS).toBeCloseTo(7670);
  expect(s.ref).toBe("rel. Earth");
});

test("on the pad: the ground's speed, not the Earth's turn (audit #24)", () => {
  const pad = at({ landed: true, speed: 408 / C_MPS, surface: { landed: true, vHor: 0, vVert: 0 } });
  expect(hudMode(pad, ph("landed", "ground"))).toBe("SRF");
  const s = shownSpeed(pad, ph("landed", "ground"));
  expect(s.v).toBe(0);
  expect(s.ref).toBe("ground");
  // (no phase — a cockpit screen —: the same, from the figures)
  expect(shownSpeed(pad).v).toBe(0);
});

test("in the air: the airspeed; on demand: the target's", () => {
  const air = at({ air: { inAir: true, speed: 250 }, surface: { landed: false, vHor: 240, vVert: -10 } });
  expect(shownSpeed(air, ph("flight", "approach"))).toMatchObject({ mode: "SRF", ref: "air" });
  expect(shownSpeed(air, ph("flight", "approach")).v * C_MPS).toBeCloseTo(250);
  expect(shownSpeed(at({ speedMode: "target" }), ph("flight", "orbit"))).toMatchObject({ mode: "TGT", ref: "rel. Moon (target)" });
  expect(hudMode(at({ region: "hole" }), ph("flight", "kerr"))).toBe("KERR");
});
