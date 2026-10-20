import { expect, test } from "bun:test";
import { VESSELS } from "../src/vessels";

// PLAN-VAISSEAUX X6b–c: the Lander's and the Endurance's cockpits are the Ranger's cabin placed in their frames — its
// pilot's eye on their cockpit's mount, its look the same way.

test("each craft's cabin: the Ranger's pilot's eye moved by its offset is its cockpit's eye; the look along the same way", () => {
  const R = VESSELS.ranger.mounts.cockpit;
  for (const id of ["lander", "endurance"] as const) {
    const V = VESSELS[id];
    const o = V.cabin!.offset;
    const eye = R.eye.map((x, i) => x + o[i]!);
    V.mounts.cockpit.eye.forEach((x, i) => expect(x).toBeCloseTo(eye[i]!, 6));
    const look = (m: { eye: number[]; aim: number[] }) => m.aim.map((x, i) => x - m.eye[i]!);
    look(V.mounts.cockpit).forEach((x, i) => expect(x).toBeCloseTo(look(R)[i]!, 6));
  }
  expect(VESSELS.ranger.cabin).toBeUndefined();
  expect(VESSELS.f35.cabin).toBeUndefined();
});
