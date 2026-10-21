import { expect, test } from "bun:test";
import { conicOf, conicPoints, nuAfter, radiusAt } from "../src/crew/orbitmath";
import { PROFILE_TILES, PROFILE_VIEWS, profileOf, viewIn } from "../src/crew/profile";

// PLAN-VAISSEAUX K2: the console's profile chosen by the craft followed (its K1 block, else an older pilot's families);
// the two profiles' views and tiles apart; the ORBIT view's two-body conic rebuilt from the state.

test("the profile: the craft's word, else the families; the views and tiles of each, distinct", () => {
  expect(profileOf({ craft: { id: "f35", kind: "jet", name: "F-35", lands: true, ring: false } })).toBe("jet");
  expect(profileOf({ craft: { id: "ranger", kind: "spacecraft", name: "Ranger", lands: true, ring: false } })).toBe("space");
  // (an older pilot: no craft block — the weapons say the F-35, the space family a rocket)
  expect(profileOf({ caps: { on: true, fam: ["nav", "jet", "weapons"] } })).toBe("jet");
  expect(profileOf({ caps: { on: true, fam: ["space"] } })).toBe("space");
  expect(profileOf(null)).toBe("jet");
  expect(PROFILE_VIEWS.jet[0]).toBe("air");
  expect(PROFILE_VIEWS.space[0]).toBe("sdash");
  expect(PROFILE_VIEWS.space).not.toContain("radar");
  expect(PROFILE_VIEWS.jet).not.toContain("orbit");
  expect(PROFILE_TILES.space).toContain("dv");
  expect(PROFILE_TILES.jet).not.toContain("dv");
  // (a view the other profile has kept, else its first)
  expect(viewIn("space", "globe")).toBe("globe");
  expect(viewIn("space", "radar")).toBe("sdash");
  expect(viewIn("jet", "orbit")).toBe("air");
});

test("the conic: a 420 km ISS orbit (51.6°, its period ~92.7 min); an eccentric one's apsides; a quarter period on", () => {
  const mu = 398600.4418,
    R = 6371;
  const r = R + 420;
  const v = Math.sqrt(mu / r);
  const i = (51.6 * Math.PI) / 180;
  const o = conicOf([r, 0, 0], [0, v * Math.cos(i), v * Math.sin(i)], mu)!;
  expect(o.e).toBeLessThan(1e-6);
  expect((o.inc * 180) / Math.PI).toBeCloseTo(51.6, 5);
  expect(o.period / 60).toBeCloseTo(92.6, 0);
  // an ellipse: at the periapsis 300 km, 1.1× the circular speed
  const rp = R + 300;
  const e = conicOf([rp, 0, 0], [0, 1.1 * Math.sqrt(mu / rp), 0], mu)!;
  expect(e.rp).toBeCloseTo(rp, 3);
  expect(e.e).toBeCloseTo(0.21, 2);
  expect(e.ra).toBeCloseTo((rp * (1 + e.e)) / (1 - e.e), 0);
  expect(radiusAt(e, Math.PI)).toBeCloseTo(e.ra, 3);
  // half a period on: the apoapsis
  expect(Math.abs(Math.cos(nuAfter(e, e.period / 2)) + 1)).toBeLessThan(1e-6);
  // a hyperbola: its arm cut at the radius asked
  const h = conicOf([rp, 0, 0], [0, 1.5 * Math.sqrt((2 * mu) / rp), 0], mu)!;
  expect(h.e).toBeGreaterThan(1);
  const pts = conicPoints(h, 50_000);
  expect(Math.max(...pts.map(([x, y]) => Math.hypot(x, y)))).toBeLessThanOrEqual(50_000 * 1.0001);
  expect(nuAfter(h, 3600)).toBeGreaterThan(0);
});

test("the EECOM view's checklists: the game's own, step for step, in English and as its dictionary has them", async () => {
  const { CHECKLISTS } = await import("../src/game/systems");
  const { CHECKLISTS_FR, CHECKLISTS_EN } = await import("../src/crew/checklists");
  expect(CHECKLISTS_EN).toEqual(CHECKLISTS as never);
  const dicts = await Promise.all(
    [...new Bun.Glob("src/i18n/fr-*.ts").scanSync(".")].map(async (f) => (await import(`../${f}`)).default as Record<string, string>),
  );
  const fr = (s: string) => dicts.find((d) => d[s])?.[s];
  for (const [k, c] of Object.entries(CHECKLISTS)) {
    const f = CHECKLISTS_FR[k]!;
    expect(f.title).toBe(fr(c.title)!);
    expect(f.steps).toEqual(c.steps.map((s) => fr(s)!));
    expect(f.action).toBe(fr(c.action)!);
  }
});
