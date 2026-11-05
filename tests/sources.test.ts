import { expect, test } from "bun:test";
import { IGN, NATIONAL } from "../src/system/earth-tiles";
import { SWISSTOPO } from "../src/system/national";
import { overEllipsoid, SOURCES, sourceById } from "../src/system/sources";

// Q7 G1/G2: every source of the Earth's ground declared whole — projection, vertical datum, model, resolution, date, validity,
// fallback —, every fallback known and no fallback loop, the national sources pointing at their declarations, and the heights
// over the sea brought over the ellipsoid at the one boundary (max(H, 0) + N).

test("every declaration is whole, every fallback known, none loops", () => {
  const ids = new Set<string>();
  for (const s of SOURCES) {
    expect(ids.has(s.id)).toBe(false);
    ids.add(s.id);
    for (const k of ["provider", "projection", "date", "validity", "fallback", "reader", "licence"] as const)
      expect(String(s[k]).length).toBeGreaterThan(2);
    expect(s.resolutionM).toBeGreaterThan(0);
    if (s.vertical === "msl") expect(s.verticalName?.length ?? 0).toBeGreaterThan(2);
    if (s.kind === "heights") expect(["MNT", "MNS"]).toContain(s.model);
  }
  for (const s of SOURCES) {
    const seen = new Set<string>();
    let f = s.fallback;
    while (f !== "none") {
      expect(sourceById(f)).not.toBeNull();
      expect(seen.has(f)).toBe(false);
      seen.add(f);
      f = sourceById(f)!.fallback;
    }
  }
});

test("the national sources point at their declarations", () => {
  for (const n of NATIONAL) expect(n.declares.every((id) => sourceById(id) !== null)).toBe(true);
  expect(IGN.declares).toContain("ign-ortho");
  expect(SWISSTOPO.declares).toContain("swissalti3d");
});

test("heights over the sea: max(H, 0) + N over the ellipsoid; a canopy over its ground", () => {
  expect(overEllipsoid(sourceById("ign-heights")!, 312, 50.2)).toBeCloseTo(362.2, 6);
  expect(overEllipsoid(sourceById("terrarium")!, -40, 48)).toBeCloseTo(48, 6);
  expect(overEllipsoid(sourceById("ign-canopy")!, 18, 50, 362)).toBe(380);
  expect(Number.isNaN(overEllipsoid(sourceById("ign-ortho")!, 1, 0))).toBe(true);
});
