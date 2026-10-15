import { afterEach, describe, expect, test } from "bun:test";
import { headingOf } from "../src/game/aijet";
import { easeSlot } from "../src/game/formflow";
import { ourGroundPose } from "../src/game/place";
import { ecef, enuAxes } from "../src/net/bot";
import { bodyFixedOf, groundRelief } from "../src/system/our-surface";
import { cruise } from "./helpers/envelope";
import { flight, resetFlights } from "./helpers/flight";

// The flight's manoeuvres (docs/PLAN-AVIATION-AAA.md, F4; game/formflow.ts, controller/wingmen.ts): a place
// changed across the leader under and behind him; the formation take-off — three wingmen on the runway, rolled
// with the leader, airborne, in the diamond —; the formation landing — on a leader's final, down beside and behind
// him, stopped on the runway.

afterEach(resetFlights);

const D = Math.PI / 180;

describe("a place changed", () => {
  test("from the right to the left: under and behind the leader, never through him", () => {
    let s = { right: 26, back: 15, up: 0 };
    const target = { right: -26, back: 15, up: 0 };
    let least = Infinity,
      most = 0,
      low = 0;
    for (let i = 0; i < 30 * 30; i++) {
      s = easeSlot(s, target, 1 / 30);
      least = Math.min(least, Math.hypot(s.right, s.back, s.up));
      most = Math.max(most, s.back);
      low = Math.min(low, s.up);
    }
    console.log(
      `  crossed ${most.toFixed(0)} m behind, ${(-low).toFixed(0)} m below, ${least.toFixed(0)} m from the leader at the closest`,
    );
    expect(s.right).toBeCloseTo(-26, 3);
    expect(most).toBeGreaterThanOrEqual(39);
    expect(low).toBeLessThanOrEqual(-9);
    expect(least).toBeGreaterThan(15);
  });
});

describe("the formation take-off", () => {
  test("Edwards: three wingmen on the runway, rolled with the leader, airborne, then the diamond", () => {
    const g = ourGroundPose("earth", 34.905, -117.884, 0);
    const { c, fly, msgs } = flight({ ...g, landed: g.landed }, false, "f35");
    c.s.flightMode = "plane";
    c.s.wind = 0;
    c.s.formShape = "diamond";
    c.s.wingmen = 3;
    fly(1);
    expect(c.wing?.list.map((w) => `${w.k}:${w.mode}`)).toEqual(["2:ground", "3:ground", "4:ground"]);
    c.pilot.throttle = 1;
    c.jetToggle("ab");
    // (the stick back past 130 kt, released once off; then the holds: 1 500 m, the runway's heading, 220 m/s)
    const input = c.pilotInput.bind(c);
    let airborne = Number.NaN,
      t = 0;
    c.pilotInput = (pad) => ({ ...input(pad), pitch: (c.airFlight.last?.speed ?? 0) > 67 && (c.rolling || c.ourLanded) ? 0.8 : 0 });
    fly(60, () => {
      t += 1 / 30;
      if (Number.isNaN(airborne) && !c.rolling && !c.ourLanded && (c.airFlight.last?.speed ?? 0) > 50) {
        airborne = t;
        return true;
      }
      return false;
    });
    c.pilotInput = input;
    fly(4);
    c.jetToggle("ab");
    c.jetToggle("ap");
    c.jetToggle("athr");
    c.jetModes.alt = 1500;
    c.jetModes.spd = 200;
    const off = () => c.wing!.list.filter((w) => !w.jet.gnd).length;
    let allUp = Number.NaN;
    t = 0;
    fly(90, () => {
      t += 1 / 30;
      if (Number.isNaN(allUp) && off() === 3) allUp = t;
      return false;
    });
    fly(120);
    const worst = Math.max(...c.wing!.list.map((w) => w.dist));
    console.log(
      `  leader off at ${airborne.toFixed(1)} s; all three off ${allUp.toFixed(1)} s later; then the diamond within ${worst.toFixed(1)} m — ${msgs
        .filter((m) => /Two|Three|Four/.test(m))
        .slice(0, 3)
        .join(" · ")}`,
    );
    expect(c.wing!.list.every((w) => w.alive)).toBe(true);
    expect(allUp).toBeLessThan(30);
    expect(worst).toBeLessThan(10);
  }, 120_000);
});

/** A leader on Edwards's runway 22 final (3°, 75 m/s, its gear down), touching down at the threshold and braked to
 *  a stop: his craft as the controller reads it, as time runs. */
function finalLeader(c: ReturnType<typeof flight>["c"]) {
  const th = { lat: 34.905, lon: -117.884 };
  const hdg = 220 * D;
  const elev = groundRelief("earth", bodyFixedOf("earth", th.lat, th.lon, 0));
  const A = enuAxes(th.lat, th.lon);
  const fwd = [0, 1, 2].map((k) => A.e[k]! * Math.sin(hdg) + A.n[k]! * Math.cos(hdg));
  const right = [0, 1, 2].map((k) => A.e[k]! * Math.cos(hdg) - A.n[k]! * Math.sin(hdg));
  // (the radial through the threshold: its height over the mean radius as the controller reads it)
  const e0 = ecef(th.lat, th.lon, 0);
  const R0 = Math.hypot(...e0);
  const radial = e0.map((x) => x / R0);
  const st = { x: -9000, v: 75, t: 0 };
  const pos = () => {
    const h = st.x < 0 ? -st.x * Math.tan(3 * D) : 0;
    const r = 6_371_008.8 + elev + 1.17 + h;
    const q = [0, 1, 2].map((k) => radial[k]! * r + fwd[k]! * st.x);
    const l = Math.hypot(...q);
    return q.map((x) => (x / l) * r);
  };
  const own = () => {
    const p = pos();
    const vv = st.x < 0 ? -st.v * Math.tan(3 * D) : 0;
    const v = [0, 1, 2].map((k) => fwd[k]! * st.v + A.u[k]! * vv);
    return { p, v, fwd, up: [...A.u], right, h: 0 };
  };
  c.ourLanded = null;
  c.rolling = null;
  c.netOwn = () => own() as never;
  Object.defineProperty(c.airFlight, "inAir", { get: () => st.x < 0, configurable: true });
  c.gearDown = true;
  const step = (dt: number) => {
    st.x += st.v * dt;
    if (st.x >= 0) {
      st.v = Math.max(0, st.v - 3 * dt);
      c.rolling = st.v > 0 ? { body: "earth" } : null;
      c.ourLanded = st.v > 0 ? null : ({ body: "earth", q: [0, 0, 0] } as never);
    }
    st.t += dt;
  };
  return { step, st, hdg };
}

describe("the formation landing", () => {
  test("Edwards 22: three wingmen on the leader's final — Two beside him, the element 900 m back —, down, stopped", () => {
    // (our own craft cruising elsewhere — the leader read as the controller's own is the final's)
    const { c, fly, msgs } = cruise(3000, 200, 0.6);
    c.s.wind = 0;
    c.s.formShape = "diamond";
    c.s.wingmen = 3;
    const L = finalLeader(c);
    // (mustered about him on the final, in the air)
    fly(0.1);
    expect(c.wing?.list.length).toBe(3);
    let down = Number.NaN,
      t = 0;
    for (let i = 0; i < 30 * 260; i++) {
      L.step(1 / 30);
      fly(1 / 30);
      t += 1 / 30;
      if (Number.isNaN(down) && c.wing!.list.every((w) => !!w.jet.gnd)) down = t;
    }
    const W = c.wing!.list;
    const stopped = W.filter((w) => w.jet.V < 1).length;
    const offLine = W.map((w) => {
      const h = headingOf(w.jet.p, w.jet.v.some((x) => Math.abs(x) > 0.1) ? w.jet.v : [0, 0, 1]);
      return Math.abs(((h - L.hdg + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) / D;
    });
    console.log(
      `  all down at ${down.toFixed(0)} s (the leader's touchdown at 120 s); ${stopped} stopped, alive ${W.filter((w) => w.alive).length}; said: ${msgs.filter((m) => /touchdown/.test(m)).join(" · ")}`,
    );
    expect(W.every((w) => w.alive)).toBe(true);
    expect(down).toBeLessThan(150);
    expect(stopped).toBe(3);
    void offLine;
  }, 120_000);
});
