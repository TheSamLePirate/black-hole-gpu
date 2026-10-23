import { describe, expect, test } from "bun:test";
import { MAX_STEER_DEG, type P2, Pushback, pushRoute } from "../src/a320/pushback";

// The A320's pushback (docs/PLAN-A320.md, A14 — src/a320/pushback.ts, FlightGear's Autopush): on a bicycle model of the
// aircraft (its main gear's middle the reference, the nose wheel 12.5 m ahead steering it), the tug connected, the
// push straight back then a quarter turn "tail left" — the aircraft ends near the route's end, its heading turned
// 90° to the right (the tail to the left), at FlightGear's 5.5 km/h at most; then stopped and disconnected.

const L = 12.5;

function fly(kind: "straight" | "left" | "right", hdg0 = 0) {
  const P = new Pushback();
  let pos: P2 = [0, 0],
    hdg = hdg0,
    v = 0,
    vmax = 0;
  P.connect();
  const step = (braked = false) => {
    const o = P.step({ dt: 0.05, pos, hdg, speed: v, braked });
    // (the aircraft: its speed by the tug and some rolling friction; turned by the nose wheel)
    v += (o.accel - 0.08 * Math.sign(v)) * 0.05;
    if (Math.abs(v) < 0.004 && o.accel === 0) v = 0;
    const d = ((o.steer ?? 0) * MAX_STEER_DEG * Math.PI) / 180;
    hdg += ((v * Math.tan(d)) / L) * 0.05 * (180 / Math.PI);
    const r = (hdg * Math.PI) / 180;
    pos = [pos[0] + v * Math.sin(r) * 0.05, pos[1] + v * Math.cos(r) * 0.05];
    vmax = Math.max(vmax, Math.abs(v));
    return o;
  };
  for (let k = 0; k < 200 && P.phase !== "connected"; k++) step();
  expect(P.phase).toBe("connected");
  const route = pushRoute(pos, hdg, kind);
  expect(P.push(route)).toContain("release");
  // (the parking brake still on a while: nothing moves)
  for (let k = 0; k < 40; k++) step(true);
  expect(Math.abs(v)).toBeLessThan(0.01);
  let t = 0;
  for (; t < 300 && P.phase === "pushing"; t += 0.05) step();
  for (let k = 0; k < 200; k++) step();
  return { P, pos, hdg, v, vmax, end: route.at(-1)!, t };
}

describe("A320 pushback", () => {
  test("straight back: along the axis, 5.5 km/h at most, stopped at the end", () => {
    const r = fly("straight");
    console.log(
      `  straight: ${r.t.toFixed(0)} s, end ${r.pos.map((x) => x.toFixed(1))}, hdg ${r.hdg.toFixed(1)}, vmax ${(r.vmax * 3.6).toFixed(1)} km/h`,
    );
    expect(r.P.phase).toBe("stopped");
    expect(Math.abs(r.pos[0])).toBeLessThan(1.5);
    expect(Math.hypot(r.pos[0] - r.end[0], r.pos[1] - r.end[1])).toBeLessThan(6);
    expect(Math.abs(r.hdg)).toBeLessThan(3);
    expect(r.vmax * 3.6).toBeLessThan(6.2);
    expect(r.vmax * 3.6).toBeGreaterThan(4.5);
    expect(Math.abs(r.v)).toBeLessThan(0.05);
    r.P.disconnect();
    for (let k = 0; k < 200; k++) r.P.step({ dt: 0.05, pos: r.pos, hdg: r.hdg, speed: 0, braked: true });
    expect(r.P.phase).toBe("idle");
  }, 30_000);

  test("tail left: the nose ends turned 90° right, near the route's end", () => {
    const r = fly("left", 30);
    const turned = ((r.hdg - 30 + 540) % 360) - 180;
    console.log(
      `  tail left: ${r.t.toFixed(0)} s, ${Math.hypot(r.pos[0] - r.end[0], r.pos[1] - r.end[1]).toFixed(1)} m from the end, turned ${turned.toFixed(1)}°`,
    );
    expect(r.P.phase).toBe("stopped");
    expect(Math.hypot(r.pos[0] - r.end[0], r.pos[1] - r.end[1])).toBeLessThan(8);
    expect(Math.abs(turned - 90)).toBeLessThan(15);
  }, 30_000);

  test("tail right: the nose ends turned 90° left", () => {
    const r = fly("right", 200);
    const turned = ((r.hdg - 200 + 540) % 360) - 180;
    expect(Math.abs(turned + 90)).toBeLessThan(15);
  }, 30_000);
});
