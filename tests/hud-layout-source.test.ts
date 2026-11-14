import { afterEach, expect, test } from "bun:test";
import { fit, layoutSource, panels } from "../src/ui/hud/layout";

// The HUD's room given instead of measured on the page (hud/layout.ts layoutSource — the first step towards drawing the HUD in a worker,
// 14 Nov 2026): the panels and the view's size handed in, `fit` places a box clear of them within that view, with no DOM at all.
afterEach(() => layoutSource(null));

test("fit uses the panels and the view it is given", () => {
  layoutSource({ panels: () => [{ x: 100, y: 100, w: 200, h: 100, id: "panel" }], view: () => ({ w: 800, h: 600 }) });
  expect(panels()).toEqual([{ x: 100, y: 100, w: 200, h: 100, id: "panel" }]);
  // (wanted under the panel: moved down until clear of it, 6 px of margin)
  const b = fit({ x: 120, y: 120, w: 50, h: 20 }, "down");
  expect(b).not.toBeNull();
  expect(b!.y).toBeGreaterThanOrEqual(100 + 100 + 6);
  // (out of the view given: none)
  expect(fit({ x: 120, y: 590, w: 50, h: 20 }, "down")).toBeNull();
});
