import { expect, test } from "bun:test";
import { Haptics, hapticMix } from "../src/input/haptics";

// PLAN-HOTAS H5: the vibrations — the continuous rumble from the flight, the impulses, the setting's scale, the
// devices that can vibrate (dual-rumble) and those that pulse (Firefox).

test("the continuous rumble: none at rest, the engine light, the plasma and the rolling heavy", () => {
  expect(hapticMix({ throttle: 0, plasma: 0, rolling: 0 })).toEqual({ strong: 0, weak: 0 });
  const eng = hapticMix({ throttle: 1, plasma: 0, rolling: 0 });
  expect(eng.weak).toBeGreaterThan(eng.strong);
  const pl = hapticMix({ throttle: 0, plasma: 1, rolling: 0 });
  expect(pl.strong).toBeGreaterThan(pl.weak);
  expect(hapticMix({ throttle: 0, plasma: 0, rolling: 80 }).strong).toBeGreaterThan(0.3);
  const all = hapticMix({ throttle: 1, plasma: 1, rolling: 200 });
  expect(all.strong).toBeLessThanOrEqual(1);
});

function rig() {
  const sent: { kind: string; o: { duration: number; strongMagnitude: number; weakMagnitude: number } }[] = [];
  const pulses: number[] = [];
  const pad = { vibrationActuator: { playEffect: (kind: string, o: never) => (sent.push({ kind, o }), Promise.resolve()) } };
  const ff = { hapticActuators: [{ pulse: (v: number) => (pulses.push(v), Promise.resolve()) }] };
  const h = new Haptics(() => [pad, ff] as unknown as Gamepad[]);
  return { h, sent, pulses };
}

test("sent to the devices that can: dual-rumble, a pulse; renewed every 100 ms; an impulse over the continuous", () => {
  const { h, sent, pulses } = rig();
  h.intensity = 1;
  h.continuous({ strong: 0.5, weak: 0.2 }, 1000);
  h.continuous({ strong: 0.5, weak: 0.2 }, 1050);
  expect(sent.length).toBe(1);
  expect(sent[0]!.kind).toBe("dual-rumble");
  expect(sent[0]!.o.strongMagnitude).toBeCloseTo(0.5, 9);
  expect(pulses).toEqual([0.5]);
  h.continuous({ strong: 0.5, weak: 0.2 }, 1101);
  expect(sent.length).toBe(2);
  h.impulse("boom", 1, 1200);
  expect(sent[2]!.o.strongMagnitude).toBeCloseTo(0.9, 9);
  // (the continuous waits for the impulse's end: 300 ms)
  h.continuous({ strong: 0.5, weak: 0.2 }, 1350);
  expect(sent.length).toBe(3);
  h.continuous({ strong: 0.5, weak: 0.2 }, 1510);
  expect(sent.length).toBe(4);
});

test("the setting scales it; 0: nothing sent; silence sent once, not over and over", () => {
  const { h, sent } = rig();
  h.intensity = 0.5;
  h.impulse("crash", 1, 0);
  expect(sent[0]!.o.strongMagnitude).toBeCloseTo(0.5, 9);
  h.intensity = 0;
  h.impulse("crash", 1, 2000);
  expect(sent.length).toBe(1);
  h.intensity = 1;
  h.continuous({ strong: 0, weak: 0 }, 5000);
  h.continuous({ strong: 0, weak: 0 }, 5200);
  h.continuous({ strong: 0, weak: 0 }, 5400);
  expect(sent.length).toBe(2);
});
