import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { presets } from "../src/settings";
import { bearing, fovOf35mm, LANDSCAPES, landscapeFov, photoUtc, viewHeading } from "../src/system/landscapes";
import { bodyView, ourState } from "../src/system/our-side";
import { bodyFixedOf, fromBodyFixed } from "../src/system/our-surface";
import { M_SECONDS } from "../src/units";

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The point d metres from a along the bearing b [°] (a sphere: enough for a direction a kilometre off). */
function along(a: [number, number], b: number, d: number): [number, number] {
  const r = Math.PI / 180,
    k = d / 6371000;
  const p1 = a[0] * r,
    l1 = a[1] * r,
    t = b * r;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(k) + Math.cos(p1) * Math.sin(k) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(k) * Math.cos(p1), Math.cos(k) - Math.sin(p1) * Math.sin(p2));
  return [p2 / r, l2 / r];
}

test("the lens and the clock: 35 mm focal lengths, EXIF local times, bearings", () => {
  expect(fovOf35mm(24)).toBeCloseTo(53.13, 2);
  expect(fovOf35mm(50)).toBeCloseTo(27.0, 1);
  const p = { page: "", author: "", licence: "", focal35: 24, taken: "2019:07:14 06:05:30", utcOffset: 2 };
  expect(new Date(photoUtc(p)).toISOString()).toBe("2019-07-14T04:05:30.000Z");
  expect(new Date(photoUtc({ ...p, taken: "2019-07-14 06:05", utcOffset: -7 })).toISOString()).toBe("2019-07-14T13:05:00.000Z");
  expect(() => photoUtc({ ...p, taken: "July 14" })).toThrow();
  expect(bearing([0, 0], [1, 0])).toBeCloseTo(0, 6);
  expect(bearing([0, 0], [0, 1])).toBeCloseTo(90, 6);
  expect(bearing([0, 0], [-1, 0])).toBeCloseTo(180, 6);
  expect(bearing([0, 0], [0, -1])).toBeCloseTo(270, 6);
});

test("every landscape is a scene: on the ground where the photographer stood, at their moment, through their lens", () => {
  expect(LANDSCAPES.length).toBeGreaterThanOrEqual(12);
  const names = new Set<string>();
  for (const l of LANDSCAPES) {
    expect(names.has(l.scene)).toBe(false);
    names.add(l.scene);
    expect(l.scene.startsWith("Earth: ")).toBe(true);
    expect(l.photo.page).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    expect(l.photo.author.length).toBeGreaterThan(0);
    expect(l.photo.licence).toMatch(/CC|Public domain|GFDL/i);
    expect(Math.abs(l.photo.utcOffset)).toBeLessThanOrEqual(14);
    expect(l.photo.focal35).toBeGreaterThan(10);
    expect(Math.abs(l.pitch)).toBeLessThan(30);
    // (the view looks at its subject: within the photo's half width)
    const off = Math.abs(((viewHeading(l) - bearing(l.at, l.subject) + 540) % 360) - 180);
    expect(off).toBeLessThan((landscapeFov(l) * 1.5) / 2);

    const p = presets[l.scene]!;
    expect(p).toBeDefined();
    expect(p.ship).toBe(false);
    expect(p.target).toBe("earth");
    expect(p.fov).toBeCloseTo(landscapeFov(l), 6);
    expect(p.time! * M_SECONDS * 1000 + Date.UTC(2067, 0, 1)).toBeCloseTo(photoUtc(l.photo), -1);
    const pose = p.pose as Parameters<typeof bodyView>[1];
    expect(pose.at).toEqual(l.at);
    expect(pose.off).toEqual([0, l.pitch]);

    // the tripod: landed where it says, level, the nose along the heading
    const v = bodyView(p.time!, pose);
    expect(v.landed?.body).toBe("earth");
    const E = ourState("earth", p.time!).pos;
    const here = fromBodyFixed("earth", bodyFixedOf("earth", l.at[0], l.at[1], 0), p.time!);
    const up = unit([v.X[0] - E[0], v.X[1] - E[1], v.X[2] - E[2]]);
    expect(dot(up, unit([here[0] - E[0], here[1] - E[1], here[2] - E[2]]))).toBeGreaterThan(1 - 1e-9);
    expect(Math.abs(dot(v.fwd, v.up))).toBeLessThan(1e-9);
    const ahead = along(l.at, viewHeading(l), 2000);
    const P = fromBodyFixed("earth", bodyFixedOf("earth", ahead[0], ahead[1], 0), p.time!);
    const d = unit([P[0] - v.X[0], P[1] - v.X[1], P[2] - v.X[2]]);
    const h = unit([d[0] - v.up[0] * dot(d, v.up), d[1] - v.up[1] * dot(d, v.up), d[2] - v.up[2] * dot(d, v.up)]);
    expect(dot(h, v.fwd)).toBeGreaterThan(Math.cos((0.5 * Math.PI) / 180));
  }
});

test("the landscapes are listed in the gallery under their own group", async () => {
  const { PRESET_INFO, SCENE_GROUPS } = await import("../src/ui/schema");
  expect(SCENE_GROUPS.some((g) => g.id === "landscapes")).toBe(true);
  for (const l of LANDSCAPES) {
    const i = PRESET_INFO[l.scene]!;
    expect(i.group).toBe("landscapes");
    expect(i.title).toBe(l.title);
    expect(i.description).toBe(l.description);
  }
});
