import { expect, test } from "bun:test";
import { CamShake } from "../src/camshake";
import { VESSELS } from "../src/vessels";

// PLAN-VAISSEAUX X7: each craft its voice (the Lander lower than the Ranger, the Endurance lower still); the
// spacecraft's shakes — the rocket through the frame, the re-entry's plasma, the ring's groan — on top of the planes'.

test("the voices: the Ranger's the reference, the Lander heavier, the Endurance deepest", () => {
  const p = (id: "ranger" | "lander" | "endurance") => VESSELS[id].sound?.pitch ?? 1;
  expect(p("lander")).toBeLessThan(p("ranger"));
  expect(p("endurance")).toBeLessThan(p("lander"));
  expect(VESSELS.endurance.sound!.sub).toBeLessThan(1);
});

test("the shakes: none at rest; the rocket, the plasma and the ring each shake the view", () => {
  const rms = (inp: Partial<Parameters<CamShake["step"]>[0]>) => {
    const S = new CamShake();
    let sum = 0;
    for (let k = 0; k < 300; k++) {
      const s = S.step({ dt: 1 / 60, roll: 0, buffet: 0, transonic: 0, ab: 0, engine: 0, jolt: 0, ...inp });
      sum += s.pitch ** 2 + s.roll ** 2 + s.yaw ** 2;
    }
    return Math.sqrt(sum / 300);
  };
  expect(rms({})).toBe(0);
  expect(rms({ rocket: 1 })).toBeGreaterThan(5e-4);
  expect(rms({ plasma: 1 })).toBeGreaterThan(rms({ rocket: 1 }));
  expect(rms({ ring: 1 })).toBeGreaterThan(5e-4);
});
