import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-HOTAS H6: a flight flown with a HOTAS — the three Thrustmaster pieces simulated in the page
// (navigator.getGamepads), read through their known profiles (no test profiles: the stick's roll and pitch, the
// TWCS's lever, the pedals) — 25 km from Edwards, 1.5 km up, 180 m/s: the lever taken at idle, then set as a
// pilot sets it (200 m/s held), a climb at 10° for 15 s, a full turn banked 35°; then the approach in assisted
// mode — the computer's director followed with the stick, the lever where it asks — down to the runway. The
// whole flight stepped (__bh.step), as the lab's.

const FAKE = `(() => {
  const mk = (index, id, axes, n) => ({ index, id, connected: true, mapping: "", timestamp: 0, axes: axes.slice(),
    buttons: Array.from({ length: n }, () => ({ pressed: false, touched: false, value: 0 })), vibrationActuator: null });
  window.__hotas = [
    mk(0, "T.16000M (Vendor: 044f Product: b10a)", [0, 0, 0, 0, 0, 0], 16),
    mk(1, "TWCS Throttle (Vendor: 044f Product: b687)", [0, 0, 1, 0, 0, 0], 14),
    mk(2, "T-Rudder (Vendor: 044f Product: b679)", [-1, -1, 0, 0, 0, 0], 0),
  ];
  navigator.getGamepads = () => window.__hotas;
  return true;
})()`;

const FLY = `(() => {
  const c = __bh.camera, P = c.pilot, H = window.__hotas;
  const D = Math.PI / 180, cl = (x) => Math.max(-1, Math.min(1, x));
  __bh.freeze(true);
  __bh.game.glideTo("Edwards", 25, 1.5, 180);
  P.auto = "none"; P.hold = "none"; P.assist = false;
  const out = { climb: { h0: null, h1: null, thr: 0 }, turned: 0, landPhase: false, said: [], fail: null, landed: false };
  let phase = "climb", hdgPrev = null, t = 0;
  const step = () => { __bh.step(1 / 30); t += 1 / 30; };
  // (the lever at idle first, as a pilot takes the throttle: picked up there)
  H[1].axes[2] = 1; step();
  for (let i = 0; i < 30 * 420; i++) {
    const a = c.attitudeNow(), A = c.airInfo();
    if (phase !== "land") {
      // (the lever as a pilot sets it: 200 m/s through the air — the Ranger's engine is a rocket's)
      const thr = Math.max(0.02, Math.min(0.6, 0.12 + (200 - (A.speed ?? 0)) * 0.01));
      H[1].axes[2] = Math.max(1 - 2 * (thr * 0.96 + 0.04), Math.min(1, 1 - 2 * t));
      H[0].axes[1] = cl(3 * ((phase === "climb" ? 10 : 4) * D - a.pitch));
      H[0].axes[0] = cl(2.5 * ((phase === "turn" ? -35 : 0) * D - a.bank));
      if (hdgPrev !== null) { let d = a.heading - hdgPrev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; out.turned += d; }
      hdgPrev = a.heading;
      if (phase === "climb") {
        out.climb.h0 ??= A.h; out.climb.h1 = A.h; out.climb.thr = Math.max(out.climb.thr, P.throttle);
        if (t > 15) phase = "turn";
      }
      if (phase === "turn" && Math.abs(out.turned) > 2 * Math.PI) {
        phase = "land"; out.landPhase = true;
        H[1].axes[2] = 1; H[0].axes = [0, 0, 0, 0, 0, 0];
        P.setAuto("entry"); P.assist = true;
      }
    } else {
      // (the director followed: the stick pulled back for the nose up, rolled toward its bank; the lever where
      // it asks — none down a glide, a go-around's thrust)
      const Dc = P.director;
      if (Dc && Dc.nose) {
        const S = c.shipMatrix();
        const Z = [S[0][2], S[1][2], S[2][2]], Y = [S[0][1], S[1][1], S[2][1]];
        const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
        const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const ep = Math.atan2(dot(Dc.nose, Y), dot(Dc.nose, Z));
        let er = 0;
        if (Dc.up) { const k = dot(Dc.up, Z), up = [Dc.up[0] - k * Z[0], Dc.up[1] - k * Z[1], Dc.up[2] - k * Z[2]]; er = Math.atan2(dot(cross(Y, up), Z), dot(Y, up)); }
        H[0].axes[1] = cl(8 * ep);
        H[0].axes[0] = cl(-3 * er);
        H[1].axes[2] = Dc.throttle > 0.01 ? 1 - 2 * (Dc.throttle * 0.96 + 0.04) : 1;
      }
    }
    step();
    if (c.ourLanded || c.airFlight.failure) break;
  }
  __bh.freeze(false);
  out.landed = !!c.ourLanded; out.fail = c.airFlight.failure ?? null;
  out.said = __bh.game.log.events.filter((e) => e.kind === "pilot").map((e) => e.text);
  return out;
})()`;

describe.skipIf(!E2E)("a flight flown with a HOTAS", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    // (Edwards's ground in: the approach reads it)
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
    await app.js(FAKE);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("climbed, turned and landed: the stick, the lever, the director followed", async () => {
    const devices = await app.js<{ profile: string | null }[]>(
      "new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(__bh.camera.padControls.last.devices))))",
    );
    expect(devices.map((d) => d.profile)).toEqual(["Thrustmaster T.16000M", "Thrustmaster TWCS Throttle", "Thrustmaster rudder pedals"]);
    const r = await app.js<{
      climb: { h0: number; h1: number; thr: number };
      turned: number;
      landPhase: boolean;
      said: string[];
      fail: string | null;
      landed: boolean;
    }>(FLY);
    console.log(JSON.stringify({ ...r, said: r.said.slice(-4) }));
    // (the lever picked up at idle, then set: the engine on; the stick's climb)
    expect(r.climb.thr).toBeGreaterThan(0.05);
    expect(r.climb.h1 - r.climb.h0).toBeGreaterThan(150);
    // (the full turn, banked by the stick)
    expect(r.landPhase).toBe(true);
    expect(Math.abs(r.turned)).toBeGreaterThan(2 * Math.PI);
    // (down to the runway, no go-around: on the wheels at under 1.5 m/s)
    expect(r.fail).toBeNull();
    expect(r.landed).toBe(true);
    expect(r.said.some((s) => /go-around/i.test(s))).toBe(false);
    const td = r.said.map((s) => /([\d.]+) m\/s down/.exec(s)).find(Boolean);
    expect(td).toBeTruthy();
    expect(Number(td![1])).toBeLessThan(1.5);
  }, 900_000);
});
