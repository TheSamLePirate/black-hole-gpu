import { describe, expect, test } from "bun:test";
import { bankAccel, type FormSlot, formationBank, formationStep } from "../src/game/formation";

// The formation law on a plane of points (game/formation.ts): a leader flying straight, turning, speeding up; a
// wingman flown by the law through a plane's lags — its bank and flight path reached over half a second and a
// second, its speed by the autothrottle's ±3 m/s² — in a wind: from a kilometre behind, he rejoins and holds his
// slot.

// (a flat ground: the plane flies on a flat Earth, the law reads "up" as its place's direction from the centre)
const R = 1e10;
const D = Math.PI / 180;
const G = 9.81;

interface Plane {
  x: number;
  y: number;
  z: number;
  psi: number;
  V: number;
  phi: number;
  gam: number;
  acc: number;
}
const wind = [6, -4];
const vel = (P: Plane) => [
  P.V * Math.cos(P.gam) * Math.sin(P.psi) + wind[0]!,
  P.V * Math.cos(P.gam) * Math.cos(P.psi) + wind[1]!,
  P.V * Math.sin(P.gam),
];
const pos = (P: Plane) => [P.x, P.y, R + P.z];
function fly(P: Plane, bank: number, gamma: number, spd: number, dt: number) {
  P.phi += (bank - P.phi) * Math.min(1, dt / 0.5);
  P.gam += (gamma - P.gam) * Math.min(1, dt / 1);
  // (the autothrottle: 0.25 m/s² per m/s off, ±3, reached over 0.6 s)
  const want = Math.min(3, Math.max(-3, 0.25 * (spd - P.V)));
  P.acc += (want - P.acc) * Math.min(1, dt / 0.6);
  P.V += P.acc * dt;
  P.psi += ((G * Math.tan(P.phi)) / P.V) * dt;
  const v = vel(P);
  P.x += v[0]! * dt;
  P.y += v[1]! * dt;
  P.z += v[2]! * dt;
}

function run(slot: FormSlot, start: Partial<Plane>, seconds: number, leaderPlan: (t: number) => { bank: number; spd: number }) {
  const L: Plane = { x: 0, y: 0, z: 3000, psi: 90 * D, V: 220, phi: 0, gam: 0, acc: 0 };
  const W: Plane = { x: -1000, y: -300, z: 2800, psi: 80 * D, V: 220, phi: 0, gam: 0, acc: 0, ...start };
  const dt = 1 / 60;
  const errs: { t: number; dist: number; bank: number; sep: number }[] = [];
  let vPrev = vel(L);
  for (let k = 0; k < seconds / dt; k++) {
    const t = k * dt;
    const lp = leaderPlan(t);
    // (the leader on his own holds: a bank, a speed)
    fly(L, lp.bank, 0, lp.spd, dt);
    const vL = vel(L);
    const aL = [0, 1, 2].map((i) => (vL[i]! - vPrev[i]!) / dt);
    vPrev = vL;
    // (his attitude: his top and right wing banked φ about his nose — his turn read from it)
    const rf = [Math.cos(L.psi), -Math.sin(L.psi), 0];
    const top = [Math.sin(L.phi) * rf[0]!, Math.sin(L.phi) * rf[1]!, Math.cos(L.phi)];
    const wing = [Math.cos(L.phi) * rf[0]!, Math.cos(L.phi) * rf[1]!, -Math.sin(L.phi)];
    const aLat = bankAccel(formationBank(pos(L), top, wing));
    const o = formationStep({ p: pos(W), v: vel(W) }, W.V, { p: pos(L), v: vL, a: aL, aLat }, slot);
    fly(W, o.bank, o.gamma, o.spd, dt);
    if (k % 30 === 0) errs.push({ t, dist: o.dist, bank: o.bank, sep: Math.hypot(W.x - L.x, W.y - L.y, W.z - L.z) });
  }
  return errs;
}

describe("formation flight's law", () => {
  test("from 1 km behind and 300 m below the line: rejoined within a minute and a half, held to a metre", () => {
    const e = run({ right: 30, back: 0, up: 0 }, {}, 150, () => ({ bank: 0, spd: 220 }));
    const at = (t: number) => e.find((x) => x.t >= t)!.dist;
    console.log(`  gap to the slot: ${[0, 20, 40, 60, 90, 120, 149].map((t) => `${t} s ${at(t).toFixed(1)} m`).join(", ")}`);
    expect(at(90)).toBeLessThan(5);
    expect(Math.max(...e.filter((x) => x.t > 110).map((x) => x.dist))).toBeLessThan(1);
  });

  test("the leader turns 90° at 25° of bank, then speeds up by 30 m/s: the slot held", () => {
    // (his right: the wingman on the inside of a left turn, the outside of a right one)
    const plan = (t: number) => ({ bank: t > 60 && t < 60 + 18.3 ? 25 * D : t > 100 && t < 118 ? -25 * D : 0, spd: t > 130 ? 250 : 220 });
    const e = run({ right: 30, back: 10, up: 0 }, { x: -60, y: -40, z: 2990, psi: 90 * D }, 200, plan);
    const worst = (a: number, b: number) => Math.max(...e.filter((x) => x.t >= a && x.t < b).map((x) => x.dist));
    console.log(
      `  worst gap: settled ${worst(40, 60).toFixed(2)} m, right turn ${worst(60, 100).toFixed(1)} m, left turn ${worst(100, 130).toFixed(1)} m, speeding up ${worst(130, 170).toFixed(1)} m, after ${worst(170, 200).toFixed(2)} m`,
    );
    expect(worst(40, 60)).toBeLessThan(1);
    expect(worst(60, 130)).toBeLessThan(15);
    expect(worst(130, 170)).toBeLessThan(15);
    expect(worst(170, 200)).toBeLessThan(1.5);
  });

  test("abreast on his right, the slot on his left: across behind him — never within his wings' reach", () => {
    // (30 m to his right, level with him; the slot 26 m on his left, 15 m back: crossed 35 m behind)
    const e = run({ right: -26, back: 15, up: 0 }, { x: 0, y: -30, z: 3000, psi: 90 * D }, 90, () => ({ bank: 0, spd: 220 }));
    const near = Math.min(...e.map((x) => x.sep));
    console.log(`  nearest: ${near.toFixed(1)} m from his centre; the slot reached to ${e.at(-1)!.dist.toFixed(2)} m`);
    expect(near).toBeGreaterThan(20);
    expect(e.at(-1)!.dist).toBeLessThan(1);
  });

  test("4 m off his wing, drifting in: pushed out", () => {
    const e = run({ right: 26, back: 15, up: 0 }, { x: 0, y: -4, z: 3000, psi: 89.5 * D }, 60, () => ({ bank: 0, spd: 220 }));
    const s = e.map((x) => x.sep);
    console.log(`  his centre: ${s[0]!.toFixed(1)} m, nearest ${Math.min(...s).toFixed(1)} m, 3 s on ${s[6]!.toFixed(1)} m`);
    expect(Math.min(...s)).toBeGreaterThan(3);
    expect(s[6]!).toBeGreaterThan(8);
    expect(e.at(-1)!.dist).toBeLessThan(1);
  });

  test("the slot on his left, behind and above: reached there", () => {
    const e = run({ right: -40, back: 30, up: 15 }, { x: 0, y: 200, z: 3000 }, 120, () => ({ bank: 0, spd: 220 }));
    expect(e.at(-1)!.dist).toBeLessThan(1);
  });
});
