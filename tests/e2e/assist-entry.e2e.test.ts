import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The entry autopilot assisted (F4: the pilot flies, the HUD's director shows its commands), in the plane
// law, flown by a pilot who keeps the director's ring on the nose — the stick's pitch and roll against the
// ring's offset (touchInput: an analogue stick). Hypersonic, the ring asks the entry's 40° of incidence:
// the plane law's protection let the stick reach 21° only (the wing's stall), the craft dived 8 km in 15 s.
// Then the glide to Edwards: following the ring lands as the autopilot does. Stepped at fixed steps.

const FOLLOW = `(() => {
  const c = __bh.camera, P = c.pilot, D = P.director;
  if (!D || !D.nose) return { off: null };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const S = c.shipMatrix();
  const Z = [S[0][2], S[1][2], S[2][2]], Y = [S[0][1], S[1][1], S[2][1]];
  const ep = Math.atan2(dot(D.nose, Y), dot(D.nose, Z));
  let er = 0;
  if (D.up) {
    const k = dot(D.up, Z), up = [D.up[0] - k * Z[0], D.up[1] - k * Z[1], D.up[2] - k * Z[2]];
    er = Math.atan2(dot(cross(Y, up), Z), dot(Y, up));
  }
  c.touchInput = { pitch: Math.max(-1, Math.min(1, 4 * ep)), yaw: 0, roll: Math.max(-1, Math.min(1, -3 * er)) };
  return { off: Math.acos(Math.min(1, D.align)) };
})`;

describe.skipIf(!E2E)("the entry autopilot assisted: the director's ring followed", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("hypersonic (Mach 14, 55 km): the entry's 40° reached and held", async () => {
    const r = await app.js<{ mode: string; alpha: number; off: number; mach: number }>(`(() => {
      __bh.freeze(true);
      __bh.game.glideTo("Edwards", 700, 55, 4500);
      const c = __bh.camera;
      c.pilot.assist = true;
      c.pilot.throttle = 0;
      const follow = ${FOLLOW};
      let off = 0;
      for (let i = 0; i < 30 * 15; i++) {
        __bh.step(1 / 30);
        const f = follow();
        if (i > 30 * 8 && f.off !== null) off = Math.max(off, f.off);
      }
      c.touchInput = { pitch: 0, yaw: 0, roll: 0 };
      const o = c.airFlight.last?.out;
      return { mode: c.flightModeNow(), alpha: (o?.alpha ?? 0) * 180 / Math.PI, off: off * 180 / Math.PI, mach: o?.mach ?? 0 };
    })()`);
    expect(r.mode).toBe("plane");
    expect(r.mach).toBeGreaterThan(10);
    expect(r.alpha).toBeGreaterThan(38);
    expect(r.off).toBeLessThan(2);
  }, 120_000);

  test("the glide to Edwards: the ring followed to the touchdown", async () => {
    const r = await app.js<{ landed: boolean; fail: string | null; td: string | null }>(`(() => {
      __bh.game.glideTo("Edwards");
      const c = __bh.camera;
      c.pilot.assist = true;
      c.pilot.throttle = 0;
      const follow = ${FOLLOW};
      for (let i = 0; i < 30 * 200; i++) {
        __bh.step(1 / 30);
        follow();
        if (c.ourLanded || c.airFlight.failure || !c.entryRun) break;
      }
      c.touchInput = { pitch: 0, yaw: 0, roll: 0 };
      c.pilot.assist = false;
      __bh.freeze(false);
      return { landed: !c.airFlight.failure, fail: c.airFlight.failure,
        td: __bh.game.log.events.filter((e) => e.kind === "pilot").map((e) => e.text).reverse().find((l) => l.startsWith("Touchdown")) ?? null };
    })()`);
    expect(r.fail).toBeNull();
    expect(r.td).not.toBeNull();
    expect(Number(r.td!.match(/· ([-\d.]+) m\/s down/)![1])).toBeLessThan(2);
  }, 180_000);
});
