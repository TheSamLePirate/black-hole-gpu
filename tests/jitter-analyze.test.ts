import { describe, expect, test } from "bun:test";
import { analyze, residuals, rotationBetween } from "../src/jitter/analyze";
import type { JitterSample, V3 } from "../src/jitter/probe";

// The jitter's analysis (src/jitter/analyze.ts): each cause found in its own channel, in pixels a frame.

const I3: [V3, V3, V3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
/** the axes turned by `a` about y (a yaw) then `b` about x (a pitch) */
function axes(a: number, b: number): [V3, V3, V3] {
  const ca = Math.cos(a),
    sa = Math.sin(a),
    cb = Math.cos(b),
    sb = Math.sin(b);
  const right: V3 = [ca, 0, -sa];
  const up0: V3 = [0, 1, 0];
  const fwd0: V3 = [sa, 0, ca];
  const up: V3 = [up0[0] * cb - fwd0[0] * sb, up0[1] * cb - fwd0[1] * sb, up0[2] * cb - fwd0[2] * sb];
  const fwd: V3 = [fwd0[0] * cb + up0[0] * sb, fwd0[1] * cb + up0[1] * sb, fwd0[2] * cb + up0[2] * sb];
  return [right, up, fwd];
}

function flight(o: {
  fps: number;
  seconds: number;
  turn: number;
  wobble?: number;
  wobbleHz?: number;
  ds?: number;
  dsHz?: number;
  uneven?: boolean;
}) {
  const out: JitterSample[] = [];
  let t = 0;
  let sim = 0;
  for (let i = 0; i < o.fps * o.seconds; i++) {
    const dt = o.uneven ? (i % 2 ? 1.5 : 0.5) / o.fps : 1 / o.fps;
    t += dt * 1000;
    sim += dt;
    const yaw = o.turn * sim + (o.wobble ?? 0) * Math.sin(2 * Math.PI * (o.wobbleHz ?? 5) * sim);
    const k = (o.ds ?? 0) * Math.sin(2 * Math.PI * (o.dsHz ?? 9) * sim);
    out.push({
      t,
      dt,
      rendered: true,
      sub: t + 1,
      done: t + 20,
      sim,
      cam: axes(yaw, 0.1),
      S: I3,
      sh: [0, 0, 0],
      ds: [k, 0],
      fov: 60,
      W: 1920,
      H: 1080,
      scale: 1,
      rate: 1,
      phase: "realtime",
      groundPx: 0,
      speed: 200,
      q: 20000,
      omega: [0, 0, 0],
      gpuMs: 20,
      refreshMs: 16.7,
    });
  }
  return out;
}

describe("the jitter's analysis", () => {
  test("a rotation's vector between two sets of axes", () => {
    const w = rotationBetween(axes(0, 0), axes(0.01, 0));
    expect(Math.hypot(...w)).toBeCloseTo(0.01, 6);
    expect(Math.abs(w[1])).toBeCloseTo(0.01, 6); // about y
  });

  test("the residuals of a smooth ramp are nothing, a step's are its size", () => {
    const n = 60;
    const time = Array.from({ length: n }, (_, i) => i / 30);
    const tau = time.map(() => 1 / 30);
    const d = time.map((t) => 0.5 + t * 0.2); // a growing rate
    expect(Math.max(...residuals(d, tau, time).slice(5, -5).map(Math.abs))).toBeLessThan(1e-6);
    const d2 = [...d];
    d2[30] = d2[30]! + 3;
    expect(residuals(d2, tau, time)[30]).toBeCloseTo(3, 1);
  });

  test("a steady turn has no jitter; the craft's wobble lands in the flight's channel", () => {
    const smooth = analyze(flight({ fps: 30, seconds: 4, turn: 0.3 }));
    expect(smooth.channels.view.rms).toBeLessThan(0.05);
    const wob = analyze(flight({ fps: 30, seconds: 4, turn: 0.3, wobble: 0.002, wobbleHz: 6 }));
    expect(wob.channels.flight.rms).toBeGreaterThan(1);
    expect(wob.channels.display.rms).toBeLessThan(0.01);
    expect(wob.ranking[0]![0]).toBe("flight");
    expect(Math.abs(wob.channels.flight.freqHz - 6)).toBeLessThan(1);
  });

  test("the display's shake is told apart, its frequency folded by the frame rate", () => {
    const r = analyze(flight({ fps: 25, seconds: 4, turn: 0.2, ds: 0.003, dsHz: 11.3 }));
    expect(r.ranking[0]![0]).toBe("display");
    expect(r.channels.display.rms).toBeGreaterThan(3);
    expect(r.channels.flight.rms).toBeLessThan(0.05);
    // (11.3 Hz under 12.5: shown as such)
    expect(Math.abs(r.channels.display.freqHz - 11.3)).toBeLessThan(1);
  });

  test("uneven steps shown in the steps' figures, not as a turn's jitter", () => {
    const r = analyze(flight({ fps: 30, seconds: 4, turn: 0.3, uneven: true }));
    expect(r.dt.cov).toBeGreaterThan(0.4);
    expect(r.dt.irregular).toBeGreaterThan(0.4);
    expect(r.channels.flight.rms).toBeLessThan(0.05);
  });
});
