import { describe, expect, test } from "bun:test";
import { AIRPORT_SHOTS, type AirportShot, AirportDirector, autoShot, framing, type Lander, type RunwayWay } from "../src/cine/airport";
import { add3, dot3, len3, scale3, sub3, unit3, type V3 } from "../src/cine/rig";
import { arrivalsOf, departuresOf, etaOf, movementsOf } from "../src/controller/airportview";
import type { TrafficCraft } from "../src/controller/traffic";

// The airport view (docs/PLAN-AEROPORT-AAA.md V1–V2): its director films an airliner landing — every frame the
// aircraft in the frame, the shots held three seconds at least, Auto's phases in their order (the tower far out, the
// chase on final, the threshold on short final, the touchdown zone, the chase rolling out), the ground cameras on one
// side of the runway —; its arrivals, those lined up on final or rolling out, by their seconds to touchdown.

const D = Math.PI / 180;
/** a runway landing east at 0° N 0° E (its threshold on the equator), 3 km long: up x, east y, north z */
const W: RunwayWay = { o: [6_378_137, 0, 0], d: [0, 1, 0], r: [0, 0, -1], up: [1, 0, 0], len: 3000, name: "TEST 09" };
const place = (a: number, c: number, h: number): V3 => add3(add3(add3(W.o, W.d, a), W.r, c), W.up, h);

/** An A320 on a 3° final at 70 m/s, its touchdown 400 m past the threshold at t = 0, braking at 2.6 m/s² after. */
function lander(t: number): Lander {
  const gs = 70,
    k = Math.tan(3 * D);
  let a: number, h: number, v: number, vs: number;
  if (t < 0) {
    a = 400 + gs * t;
    h = -gs * t * k;
    v = gs;
    vs = -gs * k;
  } else {
    const tt = Math.min(t, gs / 2.6);
    a = 400 + gs * tt - 1.3 * tt * tt;
    h = 0;
    v = Math.max(gs - 2.6 * t, 0);
    vs = 0;
  }
  const p = place(a, 0, h + 3.9);
  return {
    p,
    v: add3(scale3(W.d, v), W.up, vs),
    fwd: W.d,
    up: W.up,
    right: W.r,
    len: 37.6,
    gnd: t >= 0,
    over: h,
    eta: -t,
  };
}

describe("the airport's director", () => {
  test("the lens frames the aircraft: its length a share of the field, within limits", () => {
    expect(framing(37.6, 1000, 0.5, 1, 60)).toBeCloseTo((2 * Math.atan(37.6 / 1000)) / D, 3);
    expect(framing(37.6, 1e6, 0.5, 1.2, 60)).toBe(1.2);
    expect(framing(37.6, 5, 0.5, 1.2, 60)).toBe(60);
  });

  test("Auto by the phase: the tower far out, the chase on final, the threshold on short final, the touchdown zone, the chase rolling out", () => {
    expect(autoShot(lander(-90))).toBe("tower");
    expect(autoShot(lander(-30))).toBe("chase");
    expect(autoShot(lander(-10))).toBe("threshold");
    expect(autoShot(lander(-3))).toBe("touchdown");
    expect(autoShot(lander(4))).toBe("touchdown");
    expect(autoShot(lander(15))).toBe("chase");
  });

  test("Auto filming a landing at 30 images a second: the aircraft in the frame every image, each shot held 3 s, the ground cameras on one side", () => {
    const dir = new AirportDirector();
    dir.follow("a");
    const shots: { shot: AirportShot; at: number }[] = [];
    let worst = 0,
      shortest = 1e9,
      wrongSide = 0;
    let last: { shot: AirportShot; at: number } | null = null;
    for (let t = -80; t < 25; t += 1 / 30) {
      const L = lander(t);
      const V = dir.step(1 / 30, W, place, L);
      if (!last || V.shot !== last.shot) {
        if (last) shortest = Math.min(shortest, t - last.at);
        last = { shot: V.shot, at: t };
        shots.push(last);
      }
      // (the aircraft's centre within the field: its angle off the look under half the field — the vertical one;
      // the frame's wider)
      const look = unit3(sub3(V.aim, V.eye));
      const to = unit3(sub3(add3(L.p, L.up, 0.15 * L.len), V.eye));
      const off = Math.acos(Math.min(1, dot3(look, to))) / D;
      if (V.shot !== "cockpit") worst = Math.max(worst, off / (V.fov / 2));
      if (["tower", "threshold", "touchdown"].includes(V.shot) && dot3(sub3(V.eye, W.o), W.r) <= 0) wrongSide++;
    }
    console.log(
      `  ${shots.map((s) => `${s.shot}@${s.at.toFixed(1)}`).join(" → ")}; the aircraft at ${(worst * 100).toFixed(0)} % of the half field off the centre at worst; the shortest shot ${shortest.toFixed(1)} s`,
    );
    expect(shots.map((s) => s.shot)).toEqual(["tower", "chase", "threshold", "touchdown", "chase"]);
    expect(worst).toBeLessThan(0.8);
    expect(shortest).toBeGreaterThanOrEqual(3);
    expect(wrongSide).toBe(0);
  });

  test("Cinema filming a landing (V9): its shots drawn by turns — four at least, never the same twice running, each 3 s at least —, the threshold and the touchdown never missed, the aircraft in the frame", () => {
    const dir = new AirportDirector();
    dir.mode = "cinema";
    dir.follow("DAL2534");
    const shots: { shot: AirportShot; at: number }[] = [];
    let worst = 0,
      shortest = 1e9;
    let last: { shot: AirportShot; at: number } | null = null;
    for (let t = -150; t < 20; t += 1 / 30) {
      const L = lander(t);
      const V = dir.step(1 / 30, W, place, L);
      if (!last || V.shot !== last.shot) {
        if (last) shortest = Math.min(shortest, t - last.at);
        last = { shot: V.shot, at: t };
        shots.push(last);
      }
      const look = unit3(sub3(V.aim, V.eye));
      const to = unit3(sub3(add3(L.p, L.up, 0.15 * L.len), V.eye));
      const off = Math.acos(Math.min(1, dot3(look, to))) / D;
      if (V.shot !== "cockpit" && t > last.at + 1) worst = Math.max(worst, off / (V.fov / 2));
    }
    console.log(
      `  ${shots.map((s) => `${s.shot}@${s.at.toFixed(0)}`).join(" → ")}; worst ${(worst * 100).toFixed(0)} %, shortest ${shortest.toFixed(1)} s`,
    );
    const names = shots.map((s) => s.shot);
    expect(new Set(names).size).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < names.length; i++) expect(names[i]).not.toBe(names[i - 1]);
    expect(shortest).toBeGreaterThanOrEqual(3);
    // (on short final under it at the threshold, then the touchdown from the runway's side: there at the moments that matter)
    const at = (t: number) => [...shots].reverse().find((s) => s.at <= t)!.shot;
    expect(at(-8)).toBe("threshold");
    expect(at(1)).toBe("touchdown");
    expect(worst).toBeLessThan(1);
  });

  test("each shot on its own: the aircraft framed from far final to the rollout", () => {
    for (const shot of AIRPORT_SHOTS) {
      if (shot === "cockpit") continue;
      const dir = new AirportDirector();
      dir.mode = shot;
      dir.follow("a");
      let worst = 0;
      for (let t = -60; t < 20; t += 1 / 30) {
        const L = lander(t);
        const V = dir.step(1 / 30, W, place, L);
        const look = unit3(sub3(V.aim, V.eye));
        const to = unit3(sub3(add3(L.p, L.up, 0.15 * L.len), V.eye));
        if (t > -59) worst = Math.max(worst, Math.acos(Math.min(1, dot3(look, to))) / D / (V.fov / 2));
      }
      console.log(`  ${shot}: the aircraft at ${(worst * 100).toFixed(0)} % of the half field off the centre at worst`);
      expect(worst).toBeLessThan(0.9);
    }
  });

  test("none landing: the tower looking down the approach", () => {
    const V = new AirportDirector().step(1 / 30, W, place, null);
    expect(V.shot).toBe("tower");
    expect(dot3(unit3(sub3(V.aim, V.eye)), W.d)).toBeLessThan(-0.5);
    expect(len3(sub3(V.eye, W.o))).toBeGreaterThan(400);
  });
});

describe("the airport's arrivals", () => {
  test("its seconds to touchdown: by the way left far out, by its height and sink close in", () => {
    // (far out, 700 m up: by the way; 60 m up — landing 1.5 km long —: by the height; level: by the way)
    expect(etaOf(8000, 70, 700, 3.7)).toBeCloseTo(8000 / 70, 3);
    expect(etaOf(2500, 70, 60, 3.7)).toBeCloseTo((60 + 10) / 3.7 + 2, 0);
    expect(etaOf(2500, 70, 60, 0.5)).toBeCloseTo(2500 / 70, 3);
  });

  /** a craft as the traffic draws it, `a` m past the threshold, `c` across, `h` over the ground, at `v` along `dir` */
  const craft = (
    id: string,
    a: number,
    c: number,
    h: number,
    v: V3,
    gnd = false,
    phase?: TrafficCraft["phase"],
    sinceTd = Number.NaN,
  ): TrafficCraft =>
    ({
      id,
      cs: id.toUpperCase(),
      reg: "",
      type: "A320",
      mesh: "a320t",
      len: 37.6,
      span: 34,
      p: place(a, c, h),
      v,
      fwd: unit3(v),
      up: W.up,
      right: W.r,
      alt: h,
      msl: h,
      gnd,
      phase: phase ?? (gnd ? "landing" : "approach"),
      gear: 1,
      gearWanted: 1,
      runway: null,
      bank: 0,
      age: 0,
      over: h,
      alpha: 0,
      pitch: 0,
      sinceTd: phase ? sinceTd : gnd ? 5 : Number.NaN,
      landing: null,
    }) as TrafficCraft;
  const final = (s: number): V3 => add3(scale3(W.d, s), W.up, -s * Math.tan(3 * D));

  test("those on final by their seconds to touchdown, one rolling out; a departure, one off the axis, one too high, one passing over: left out", () => {
    const list = [
      craft("far", -9000, 120, 470, final(75)),
      craft("near", -2500, 20, 130, final(70)),
      craft("rolling", 900, 2, 0, scale3(W.d, 40), true),
      craft("climbing", 1500, 0, 200, add3(scale3(W.d, 80), W.up, 8)),
      craft("aside", -3000, 1500, 150, final(70)),
      craft("high", -20000, 0, 2600, final(120)),
      // (lined up 2 km short, 340 m up — 9° —: passing over, not landing now)
      craft("over", -2000, 0, 340, final(64)),
    ];
    const A = arrivalsOf(list, [W, { ...W, name: "TEST 27", o: place(3000, 0, 0), d: scale3(W.d, -1), r: scale3(W.r, -1) }], 0);
    console.log(`  ${A.map((x) => `${x.c.id} ${x.way.name} ${x.eta.toFixed(0)} s`).join(" · ")}`);
    expect(A.map((x) => x.c.id)).toEqual(["rolling", "near", "far"]);
    expect(A.every((x) => x.way.name === "TEST 09")).toBe(true);
    expect(A[1]!.eta).toBeCloseTo((130 + 10) / (70 * Math.tan(3 * D)) + 2, 0);
  });

  test("the departures (PLAN-AEROPORT-AAA V7): lined up still, rolling for the take-off, climbing out — by their seconds to lift-off; a landing's rollout, one taxiing across, an arrival: left out", () => {
    const list = [
      craft("lined", 60, 3, 0, [0, 0, 0], true, "parked"),
      craft("roll", 600, -2, 0, scale3(W.d, 40), true, "takeoff"),
      craft("climb", 3300, 10, 120, add3(scale3(W.d, 80), W.up, 9), false, "climb"),
      craft("rollout", 1200, 1, 0, scale3(W.d, 45), true, "landing", 8),
      craft("across", 900, 30, 0, scale3(W.r, 8), true, "taxi"),
      craft("near", -2500, 20, 130, final(70)),
    ];
    // (lined up still: lined up but its nose along the runway — its fwd the runway's)
    list[0]!.fwd = W.d;
    const D0 = departuresOf(list, [W]);
    console.log(`  ${D0.map((x) => `${x.c.id} ${x.eta.toFixed(0)} s`).join(" · ")}`);
    expect(D0.map((x) => x.c.id)).toEqual(["climb", "roll", "lined"]);
    expect(D0.every((x) => x.dep)).toBeTrue();
    // (rolling at 40 m/s: (74 − 40) / 2 = 17 s to VR; climbing 120 m up at 9 m/s: 15 s since)
    expect(D0[1]!.eta).toBeCloseTo(17, 0);
    expect(D0[0]!.eta).toBeCloseTo(-(120 / 9 + 2), 0);
    // (the queue: arrivals and departures together, each once, by their seconds)
    const M = movementsOf(list, [W], 0);
    expect(M.map((x) => x.c.id)).toEqual(["climb", "rollout", "roll", "near", "lined"]);
  });
});

test("automatic cameras change view when obstructed, manual cameras stay selected", () => {
  const director = new AirportDirector();
  director.mode = "auto";
  const first = director.step(1, W, place, lander(-100));
  director.avoidObstruction();
  const next = director.step(1 / 60, W, place, lander(-100));
  expect(next.shot).not.toBe(first.shot);
  expect(next.cut).toBe(true);
  director.mode = "tower";
  director.avoidObstruction();
  expect(director.step(1, W, place, lander(-100)).shot).toBe("tower");
});
