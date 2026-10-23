import { expect, test } from "bun:test";
import { LEVELS, orthoColour, orthoLayers, orthoQuadrant, orthoUrl, ORTHO_LEVELS } from "../src/system/earth-tiles";

test("the orthophotos' colours: the survey's brightness brought to the Earth's, a white kept white, a dark field greened", () => {
  const [r, g, b] = orthoColour(255, 255, 255);
  expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
  expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
  // (a mid grey darkened — the survey 2.7 times the ground's light on average —, its hue barely moved)
  const grey = orthoColour(128, 128, 128);
  expect(grey[1]).toBeLessThan(110);
  expect(Math.abs(grey[0] - grey[1])).toBeLessThan(12);
  // (a dark green field: darker, its blue taken down as the Blue Marble's ground has it)
  const field = orthoColour(70, 90, 60);
  expect(field[1]).toBeLessThan(90);
  expect(field[2]).toBeLessThan(field[0]);
  expect(orthoColour(0, 0, 0)).toEqual([0, 0, 0]);
});

test("the orthophotos' levels in the texture: a 1024² quadrant each, after the relief's layers", () => {
  // (the normal reach — 1024² layers —: one level a layer; the far one — 2048² —: the four in one layer)
  expect(orthoLayers(1024)).toBe(ORTHO_LEVELS);
  expect(orthoLayers(2048)).toBe(1);
  expect([0, 1, 2, 3].map((k) => orthoQuadrant(k, 1024))).toEqual([0, 1, 2, 3].map((k) => ({ layer: LEVELS + k, x: 0, y: 0 })));
  expect([0, 1, 2, 3].map((k) => orthoQuadrant(k, 2048))).toEqual([
    { layer: LEVELS, x: 0, y: 0 },
    { layer: LEVELS, x: 1024, y: 0 },
    { layer: LEVELS, x: 0, y: 1024 },
    { layer: LEVELS, x: 1024, y: 1024 },
  ]);
  expect(orthoUrl(17, 66391, 45092)).toContain(
    "LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=17&TILEROW=45092&TILECOL=66391",
  );
});
