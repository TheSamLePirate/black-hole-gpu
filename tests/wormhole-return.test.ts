import { expect, test } from "bun:test";
import { blToCartesian, cameraFrame, setHolePose } from "../src/camera";
import { CameraController } from "../src/controls";
import { theirOrbitPose } from "../src/game/place";
import { defaultSettings, presets } from "../src/settings";
import { mouth, setSceneTime } from "../src/wormhole";

// Gargantua → our side by the MISSION tab (flight lab wh-garg-orbit-to-ours): from a 30 M orbit, the
// intercept of the far mouth 300 M out, its corrections aimed in flight. The path once dove by the hole
// and missed by 277 M; its last correction once fell after the arrival its earlier ones had moved. The
// craft must pass inside the throat's own 0.05 M — not just the 0.4 M sphere about it.

test("the way back through the far mouth: the corrections before the arrival, the pass inside the throat", async () => {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["game:interstellar"]!, engine: "cinema" as const };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const p = theirOrbitPose({ body: "gargantua", rM: 30 }, 0, s.spin, s.massSolar);
  setHolePose(s, p.X, p.fwd, p.up, p.vel);
  s.motion = "geodesic";
  c.sync();
  c.setPilot(true);
  for (let i = 0; i < 3; i++) c.flyShip(1 / 30, null as never);
  const r = await c.missionPlan({ target: "wormhole" } as never);
  expect(r.ok).toBe(true);
  c.missionCommit();
  c.fcExecute();
  let low = Infinity;
  for (let i = 0; i < 30000 && c.plan.nodes.length; i++) {
    c.flyShip(1 / 30, null as never);
    const n = c.plan.nodes;
    const arrive = n[n.length - 1];
    if (arrive?.role === "arrive") for (const q of n) if (q.role === "mcc") expect(q.t).toBeLessThan(arrive.t);
    const cam = cameraFrame(s);
    const X = blToCartesian(cam.r, cam.theta, cam.phi),
      C = mouth(s, c.nowTime()).C;
    low = Math.min(low, Math.hypot(X[0] - C[0], X[1] - C[1], X[2] - C[2]));
  }
  expect(low).toBeLessThan(mouth(s).w.rho);
}, 300_000);
