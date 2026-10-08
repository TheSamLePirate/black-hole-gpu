// Which thrusters fire now, and how hard (PLAN-AUDIO S3): the ship's jets' levels from the thrust asked —
// both main engines at the throttle; each attitude thruster by how much its push helps the translation
// asked and its torque the rotation asked, pulsed (as real RCS valves are) when that is little. Pure: the
// renderer draws these plumes (ship.ts writeJets), the sound plays these valves (audio/director.ts) — the
// ear hears the jets the eye sees.

import type { JetDef, VesselDef } from "./vessels";

type V3 = [number, number, number];

/** The thrust asked (ship frame): the main engine's throttle, the translation's force and the rotation's
 *  torque (their command's share 0…1), the air's density 0…1, a clock [s] (the valves' pulses). */
export interface ThrustAsked {
  throttle: number;
  force: V3;
  torque: V3;
  air: number;
  time: number;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** One jet's level now (0: quiet), the i-th of its vessel's. */
export function jetLevel(V: VesselDef, J: JetDef, i: number, th: ThrustAsked): number {
  if (J.main) {
    const level = Math.min(Math.max(th.throttle, 0), 1);
    return level < 0.01 ? 0 : level;
  }
  const tq = th.torque;
  const tl = Math.hypot(...tq);
  const F: V3 = [-J.d[0], -J.d[1], -J.d[2]];
  const arm: V3 = [J.p[0] - V.com[0], J.p[1] - V.com[1], J.p[2] - V.com[2]];
  // (the flight computer's rates turn the ship the other way round from the right-hand rule in its frame
  // — +y turns the nose right, +x lifts it: pilot.ts — so its torque, likewise)
  const tau = cross(F, arm);
  const taul = Math.hypot(...tau);
  const push = Math.max(0, dot(F, th.force));
  const turn = tl > 0.02 && taul > 1e-6 ? smooth(0.35, 0.85, dot(tau, tq) / (taul * tl)) * Math.min(tl, 1) : 0;
  const want = Math.min(1, push + turn);
  if (want < 0.03) return 0;
  // (pulse-width modulated below full demand: ~9 pulses a second)
  const phase = (th.time * 9 + i * 0.37) % 1;
  if (want < 0.9 && phase > Math.max(want, 0.2)) return 0;
  return Math.min(1, 0.55 + want);
}

/**
 * The attitude thrusters gathered by where they sit (within `r` metres of a cluster's first): the quads at
 * the corners, the fore and aft pairs — each cluster's place, its jets' indices.
 */
export function rcsClusters(V: VesselDef, r = 1.2): { p: V3; jets: number[] }[] {
  const out: { p: V3; jets: number[] }[] = [];
  V.jets.forEach((J, i) => {
    if (J.main) return;
    const c = out.find((q) => Math.hypot(q.p[0] - J.p[0], q.p[1] - J.p[1], q.p[2] - J.p[2]) < r);
    if (c) c.jets.push(i);
    else out.push({ p: [...J.p] as V3, jets: [i] });
  });
  for (const c of out) {
    const ps = c.jets.map((i) => V.jets[i]!.p);
    c.p = [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k]!, 0) / ps.length) as V3;
  }
  return out;
}
