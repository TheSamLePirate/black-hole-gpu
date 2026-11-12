import { expect, test } from "bun:test";
import { probePublished } from "../src/system/earth-tiles";
import { eventStep, scaleDips, type SharpRowT } from "./e2e/lib/j2-probes";

// PLAN-J2 J2-0 — the probes' pure parts: the leak probe's published rectangle (earth-tiles.ts probePublished) and the sharpness's
// dips at a change of scale (tests/e2e/lib/j2-probes.ts scaleDips).

test("the leak probe: a whole window loses one column and one row (the wrap's sentinel), a partial one keeps its rectangle", () => {
  // (a 4-tile window whole: its last tile on each axis left to the sentinel — both edges meet it across the wrap)
  expect(probePublished({ x0: 10, y0: 20, x1: 14, y1: 24 }, 4)).toEqual({ x0: 10, y0: 20, x1: 13, y1: 23 });
  // (whole along x only: y kept)
  expect(probePublished({ x0: -2, y0: 5, x1: 2, y1: 7 }, 4)).toEqual({ x0: -2, y0: 5, x1: 1, y1: 7 });
  // (partial: the slots outside it are the unpublished ones — no shrink)
  expect(probePublished({ x0: 0, y0: 0, x1: 3, y1: 2 }, 4)).toEqual({ x0: 0, y0: 0, x1: 3, y1: 2 });
  // (the camera in the last row and column — the windows led ahead of the craft —: the first ones taken off instead, the ground
  // under the camera kept covered)
  expect(probePublished({ x0: 10, y0: 20, x1: 14, y1: 24 }, 4, { x: 13, y: 23 })).toEqual({ x0: 11, y0: 21, x1: 14, y1: 24 });
  expect(probePublished({ x0: 10, y0: 20, x1: 14, y1: 24 }, 4, { x: 11, y: 21 })).toEqual({ x0: 10, y0: 20, x1: 13, y1: 23 });
  // (an 8-tile window)
  expect(probePublished({ x0: 100, y0: 40, x1: 108, y1: 48 }, 8)).toEqual({ x0: 100, y0: 40, x1: 107, y1: 47 });
});

test("the sharpness at a change of scale: its dip, its peak, where it settles", () => {
  const rows: SharpRowT[] = [];
  const push = (sharp: number, renderScale: number) =>
    rows.push({
      frame: rows.length,
      t: rows.length * 16,
      sharp,
      width: 1,
      height: 1,
      scale: 1,
      renderScale,
      source: "hdr",
      phase: "realtime",
    });
  for (let i = 0; i < 30; i++) push(10, 0.75);
  // (the change: a pulse at 6, a spike at 15, then 9 — where it settles)
  push(6, 1);
  push(15, 1);
  for (let i = 0; i < 60; i++) push(9, 1);
  const d = scaleDips(rows);
  expect(d.length).toBe(1);
  expect(d[0]!.from).toBe(0.75);
  expect(d[0]!.to).toBe(1);
  expect(d[0]!.dip).toBeCloseTo(-0.4, 4);
  expect(d[0]!.peak).toBeCloseTo(0.5, 4);
  expect(d[0]!.settled).toBeCloseTo(-0.1, 4);
  // (an event at a time: the same measure)
  expect(eventStep(rows, 30 * 16)?.peak).toBeCloseTo(0.5, 4);
});
