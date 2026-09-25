import { describe, expect, test } from "bun:test";
import { basis, cameraFrame } from "../src/camera";
import { defaultSettings, type Settings } from "../src/settings";
import {
  aimFrame, apparentDirection, bodyLook, composeOffset, geometricLook, offsetFrom, pick, QUAT_ID, quatAngle, slerp,
  starCentre, type Quat,
} from "../src/targeting";
import type { Vec3 } from "../src/physics";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, dot(a, b) / Math.hypot(...a) / Math.hypot(...b)));

function scene(patch: Partial<Settings> = {}): Settings {
  return {
    ...defaultSettings(), wormhole: false, sun: true, sunOrbit: 70, sunRadius: 2.5, sunPhase: 0, spin: 0.9,
    disk: true, diskOuter: 18, anchor: "hole", motion: "static", yaw: 0, pitch: 0, roll: 0, ...patch,
  };
}

describe("aiming at bodies through curved spacetime", () => {
  test("orientation offsets: compose ∘ offsetFrom = identity, and the identity offset looks along the aim", () => {
    const aim = aimFrame([0.3, -0.5, 0.8]);
    for (const [y, p, r] of [[10, 20, 30], [170, -80, -120], [0, 0, 0]]) {
      const b = basis(y!, p!, r!);
      const q = offsetFrom(aim, b.fwd, b.up);
      const back = composeOffset(aim, q);
      for (let i = 0; i < 3; i++) {
        expect(back.fwd[i]!).toBeCloseTo(b.fwd[i]!, 10);
        expect(back.up[i]!).toBeCloseTo(b.up[i]!, 10);
      }
    }
    const c = composeOffset(aim, QUAT_ID);
    expect(angle(c.fwd, aim.F)).toBeLessThan(1e-9);
    const q: Quat = offsetFrom(aim, basis(40, 10, 0).fwd, basis(40, 10, 0).up);
    expect(quatAngle(slerp(q, QUAT_ID, 1))).toBeLessThan(1e-6);
    expect(quatAngle(slerp(q, QUAT_ID, 0.5))).toBeCloseTo(0.5 * quatAngle(q), 6);
  });

  test("the star's image: the traced ray passes through its centre; lensing moves it off the straight line", () => {
    // camera on the far side of the hole from the star, slightly off the line: strong bending
    const s = scene({ distance: 60, inclination: 84, azimuth: 180 });
    const cam = cameraFrame(s);
    const C = (t: number) => starCentre(s, t);
    const geo = geometricLook(s, cam, C(0));
    const b = bodyLook(s, cam, "star", 0);
    expect(b.lensed).toBe(true);
    const r = apparentDirection(s, cam, C, 0, b.look, 1e-4)!;
    expect(r.miss).toBeLessThan(1e-3);
    expect(angle(r.look, geo)).toBeGreaterThan(0.05); // the straight line falls into the shadow
    expect(pick(s, cam, r.look, 0)).toBe("star");
    expect(pick(s, cam, geo, 0)).toBe("hole");
  });

  test("near the star (weak field), the image is where the straight line points", () => {
    const s = scene({ distance: 80, inclination: 90.5, azimuth: 8 });
    const cam = cameraFrame(s);
    const b = bodyLook(s, cam, "star", 0);
    expect(b.lensed).toBe(true);
    // (seen where it was a light-travel time ago: ≈ 15 M)
    const d = Math.hypot(...starCentre(s, 0).map((v, i) => v - [80 * Math.cos(8 * Math.PI / 180), 80 * Math.sin(8 * Math.PI / 180), 0][i]!));
    expect(angle(b.look, geometricLook(s, cam, starCentre(s, -d)))).toBeLessThan(0.01);
    expect(angle(b.look, geometricLook(s, cam, starCentre(s, 0)))).toBeGreaterThan(0.05);
  });

  test("picking: the hole's centre, the sky, the disk, the wormhole's mouth", () => {
    const s = scene({ distance: 40, inclination: 80, azimuth: 60, wormhole: true, whDist: 22, whIncl: 70, whAzimuth: -160 });
    const cam = cameraFrame(s);
    expect(pick(s, cam, bodyLook(s, cam, "hole", 0).look, 0)).toBe("hole");
    expect(pick(s, cam, [1, 0, 0], 0)).toBeNull(); // straight away from the hole
    // from beyond the mouth, on the same side as it
    const s2 = { ...s, distance: 36, inclination: 72, azimuth: -150 };
    const cam2 = cameraFrame(s2);
    const w = bodyLook(s2, cam2, "wormhole", 0);
    expect(w.lensed).toBe(true);
    expect(pick(s2, cam2, w.look, 0)).toBe("wormhole");
  });

  test("a secondary image followed by the warm start gives way to the primary", () => {
    // camera 16 M from the hole, the mouth 16 M away on the other side of the line to the hole
    const X: Vec3 = [-8.41, 4.06, 12.49];
    const r = Math.hypot(...X);
    const s = scene({
      wormhole: true, whDist: 22, whIncl: 70, whAzimuth: -160, anchor: "hole",
      distance: r, inclination: (Math.acos(X[2] / r) * 180) / Math.PI, azimuth: (Math.atan2(X[1], X[0]) * 180) / Math.PI,
    });
    const cam = cameraFrame(s);
    const primary = bodyLook(s, cam, "wormhole", 0);
    // a secondary image: seeded next to the hole's direction, bent around it
    const hole: Vec3 = [-1, 0, 0];
    const C = (): Vec3 => {
      const th = (70 * Math.PI) / 180, ph = (-160 * Math.PI) / 180;
      return [22 * Math.sin(th) * Math.cos(ph), 22 * Math.sin(th) * Math.sin(ph), 22 * Math.cos(th)];
    };
    let secondary: Vec3 | null = null;
    for (const [y, z] of [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25], [0.18, 0.18], [-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18]]) {
      const g = [hole[0], y!, z!] as Vec3;
      const sol = apparentDirection(s, cam, C, 0, g, 1e-4);
      if (sol && sol.miss < 1e-2 && angle(sol.look, primary.look) > 0.3) {
        secondary = sol.look;
        break;
      }
    }
    expect(secondary).not.toBeNull();
    const again = bodyLook(s, cam, "wormhole", 0, secondary);
    expect(angle(again.look, primary.look)).toBeLessThan(1e-3);
    expect(angle(primary.look, geometricLook(s, cam, C()))).toBeLessThan(0.3);
  });

  test("the star is seen where it was: the aim follows the light-travel delay", () => {
    const s = scene({ distance: 30, inclination: 90.5, azimuth: 100, sunOrbit: 70 });
    const cam = cameraFrame(s);
    const now = apparentDirection(s, cam, (t) => starCentre(s, t), 0, geometricLook(s, cam, starCentre(s, 0)), 1e-4)!;
    // a static target at the star's present position would be aimed at differently
    const frozen = apparentDirection(s, cam, () => starCentre(s, 0), 0, now.look, 1e-4)!;
    expect(angle(now.look, frozen.look)).toBeGreaterThan(1e-3);
  });
});
