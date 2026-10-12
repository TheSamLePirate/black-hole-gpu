import { expect, test } from "bun:test";
import { HUD_KIND_HOLD, HudKindChooser, hudInView, hudKindOf, nextHudKind } from "../src/game/hudkind";

const I = (o: Partial<Parameters<typeof hudKindOf>[0]> = {}) => ({ stage: null, mode: "flight", final: false, low: false, ...o });

test("the kind by the phase: the air and the entry atmosphere; the final, a hover, the ground approach; else space", () => {
  expect(hudKindOf(I({ stage: "air" }))).toBe("atmo");
  expect(hudKindOf(I({ stage: "entry" }))).toBe("atmo");
  expect(hudKindOf(I({ stage: "air", final: true }))).toBe("approach");
  expect(hudKindOf(I({ stage: "air", low: true }))).toBe("approach");
  expect(hudKindOf(I({ stage: "approach" }))).toBe("approach");
  expect(hudKindOf(I({ mode: "landed", stage: "ground" }))).toBe("approach");
  for (const stage of ["orbit", "suborbital", "escape", "space", "docking", "kerr", "throat"] as const)
    expect(hudKindOf(I({ stage }))).toBe("space");
  expect(hudKindOf(I())).toBe("space");
});

test("a change held before it shows; a flicker never shows; forced at once", () => {
  const c = new HudKindChooser();
  expect(c.step(I({ stage: "orbit" }), 0)).toBe("space");
  expect(c.step(I({ stage: "entry" }), 1)).toBe("space");
  expect(c.step(I({ stage: "entry" }), 1 + HUD_KIND_HOLD - 0.1)).toBe("space");
  expect(c.step(I({ stage: "entry" }), 1 + HUD_KIND_HOLD)).toBe("atmo");
  // (back and forth at a boundary: the kind stays)
  expect(c.step(I({ stage: "air", final: true }), 10)).toBe("atmo");
  expect(c.step(I({ stage: "air" }), 10.5)).toBe("atmo");
  expect(c.step(I({ stage: "air", final: true }), 11)).toBe("atmo");
  expect(c.step(I({ stage: "air", final: true }), 11 + HUD_KIND_HOLD)).toBe("approach");
  // (forced: at once, whatever the phase; auto again: the phase's, held)
  expect(c.step(I({ stage: "orbit" }), 20, "atmo")).toBe("atmo");
  expect(c.step(I({ stage: "orbit" }), 21)).toBe("atmo");
  expect(c.step(I({ stage: "orbit" }), 21 + HUD_KIND_HOLD)).toBe("space");
});

test("the key's cycle", () => {
  expect(nextHudKind("auto")).toBe("atmo");
  expect(nextHudKind("atmo")).toBe("space");
  expect(nextHudKind("space")).toBe("approach");
  expect(nextHudKind("approach")).toBe("auto");
});

test("the HUD in the views: chase and dorsal by default; every outside view; everywhere; a spectator bare", () => {
  expect(hudInView("chase", "chaseDorsal", false)).toBe("full");
  expect(hudInView("dorsal", "chaseDorsal", false)).toBe("full");
  for (const m of ["cockpit", "cabin", "quarter", "wing", "around", "director", "dock"])
    expect(hudInView(m, "chaseDorsal", false)).toBe("bare");
  expect(hudInView("wing", "outside", false)).toBe("full");
  expect(hudInView("cockpit", "outside", false)).toBe("bare");
  expect(hudInView("cockpit", "all", false)).toBe("full");
  expect(hudInView("chase", "all", true)).toBe("bare");
});
