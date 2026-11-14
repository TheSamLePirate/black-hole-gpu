import { expect, test } from "bun:test";
import { noteUnclonable } from "../src/ui/hud/clone-probe";

// The HUD's frame data checked for what a structuredClone would refuse (hud/clone-probe.ts — the measure before drawing the HUD in a
// worker): functions and class instances found by path; plain data, maps and typed arrays pass.
test("noteUnclonable finds the functions and the class instances, not the plain data", () => {
  class P {
    x = 1;
  }
  const out = new Set<string>();
  noteUnclonable(
    { a: 1, b: [1, 2], c: new Float32Array(3), d: new Map([["k", { e: () => 0 }]]), f: { at: (x: number) => x }, g: [new P()] },
    out,
  );
  expect([...out].sort()).toEqual(["d{}.e (function)", "f.at (function)", "g[] (class P)"]);
});
