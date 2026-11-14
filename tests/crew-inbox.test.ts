import { expect, test } from "bun:test";
import { CrewInbox } from "../src/net/crewcmd";

// The crew's orders bounded at their arrival (audit 2026-11-10, NET-25): a burst of 8, then 4 a second, per screen; at most 16 held
// behind a ground station's delay. Another screen its own.

test("a burst of 8, then 4 a second; another screen its own; 16 held at most", () => {
  const I = new CrewInbox();
  const at0 = Array.from({ length: 20 }, () => I.pass(3, 0)).filter(Boolean).length;
  expect(at0).toBe(8);
  expect(I.pass(4, 0)).toBe(true);
  // (a second later: four more)
  expect(Array.from({ length: 10 }, () => I.pass(3, 1000)).filter(Boolean).length).toBe(4);
  const held = Array.from({ length: 30 }, () => I.hold(3)).filter(Boolean).length;
  expect(held).toBe(16);
  I.release(3);
  expect(I.hold(3)).toBe(true);
  expect(I.hold(3)).toBe(false);
});
