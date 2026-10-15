import { afterEach, describe, expect, test } from "bun:test";
import { headingOf } from "../src/game/aijet";
import { ourGroundPoseOn } from "../src/game/place";
import { SCENARIOS } from "../src/game/scenarios";
import { wrapPi } from "../src/game/jet";
import { add, scale } from "../src/math/vec3";
import { groundVelocity } from "../src/system/our-surface";
import { C_MPS, M_METRES } from "../src/units";
import { cruise } from "./helpers/envelope";
import { flight, resetFlights } from "./helpers/flight";

// The AI wingmen (docs/PLAN-AVIATION-AAA.md, F3; game/aijet.ts, controller/wingmen.ts): mustered at their places,
// flown with the real aircraft's forces, holding the diamond straight and in the leader's turn; the orders — the
// break, the rejoin, the hold stacked, home —; in the drone hunt, engaged: their missiles fired, the drones down.

afterEach(resetFlights);

const D = Math.PI / 180;

/** Our F-35 at 6 km, 230 m/s east on its holds, `n` wingmen in the diamond. */
function flightOf(n: number) {
  const run = cruise(6000, 230, 0.7);
  const { c } = run;
  c.s.wind = 0;
  c.jetToggle("ap");
  c.jetToggle("athr");
  c.s.formShape = "diamond";
  c.s.formSpacing = "normal";
  c.s.wingmen = n;
  return run;
}

const worstOf = (c: ReturnType<typeof cruise>["c"]) => Math.max(...c.wing!.list.filter((w) => w.alive).map((w) => w.dist));

describe("the wingmen in formation", () => {
  test("three mustered at their places; the diamond held straight, then in the leader's 90° turn", () => {
    const { c, fly, msgs } = flightOf(3);
    fly(1);
    expect(c.wing?.list.map((w) => w.k)).toEqual([2, 3, 4]);
    fly(60);
    let straight = 0;
    fly(30, () => ((straight = Math.max(straight, worstOf(c))), false));
    // (the leader turns 90° right on his heading hold — 30° of bank)
    c.jetModes.hdg = (c.jetModes.hdg ?? 0) + 90 * D;
    let turn = 0;
    fly(40, () => ((turn = Math.max(turn, worstOf(c))), false));
    console.log(
      `  diamond: straight ≤ ${straight.toFixed(1)} m, in the 90° turn ≤ ${turn.toFixed(1)} m; said: ${msgs.slice(0, 3).join(" · ")}`,
    );
    expect(straight).toBeLessThan(5);
    expect(turn).toBeLessThan(25);
    expect(c.wing!.list.every((w) => w.alive)).toBe(true);
  }, 120_000);

  test("the radar: the wingmen by the datalink, friends", () => {
    const { c, fly } = flightOf(2);
    fly(3);
    const T = [...c.radar.tracks.values()].filter((x) => x.id.startsWith("wng:"));
    expect(T.length).toBe(2);
    expect(T.every((x) => x.iff === "friend" && x.datalink)).toBe(true);
  }, 60_000);
});

describe("their orders", () => {
  test("break left: each turns 90° left; rejoin: back at its place", () => {
    const { c, fly } = flightOf(2);
    fly(40);
    const h0 = c.wing!.list.map((w) => headingOf(w.jet.p, w.jet.v));
    expect(c.flightOrder("breakL")).toBe("Break left!");
    fly(25);
    const turned = c.wing!.list.map((w, i) => wrapPi(headingOf(w.jet.p, w.jet.v) - h0[i]!) / D);
    console.log(`  broke: ${turned.map((x) => x.toFixed(0)).join("°, ")}°`);
    for (const x of turned) {
      expect(x).toBeLessThan(-75);
      expect(x).toBeGreaterThan(-105);
    }
    c.flightOrder("rejoin");
    let t = Number.NaN,
      k = 0;
    fly(240, () => {
      k++;
      if (Number.isNaN(t) && worstOf(c) < 15) t = k / 30;
      return false;
    });
    console.log(`  rejoined within 15 m in ${t.toFixed(0)} s; then ≤ ${worstOf(c).toFixed(1)} m`);
    expect(t).toBeLessThan(220);
  }, 120_000);

  test("hold here: stacked 300 m a place over the leader's fix; RTB: home to the nearest field", () => {
    const { c, fly } = flightOf(2);
    fly(20);
    const h = c.jetFigures()!.h;
    c.flightOrder("hold");
    fly(240);
    const alts = c.wing!.list.map((w) => w.alt - h);
    console.log(`  holding at +${alts.map((x) => x.toFixed(0)).join(" m, +")} m`);
    expect(alts[0]).toBeCloseTo(300, -1);
    expect(alts[1]).toBeCloseTo(600, -1);
    expect(c.wing!.list.every((w) => w.mode === "hold")).toBe(true);
    c.flightOrder("rtb");
    expect(c.wing!.list.every((w) => w.mode === "rtb" && !!w.home)).toBe(true);
    console.log(`  home: ${c.wing!.list[0]!.home!.name}`);
  }, 120_000);
});

describe("in a fight", () => {
  test("the drone hunt, two wingmen engaged: their missiles fired, drones down", () => {
    const sc = SCENARIOS.find((x) => x.id === "drones")!;
    const lat = sc.anchor.lat + sc.start.n / (D * 6_371_008.8);
    const lon = sc.anchor.lon + sc.start.e / (D * 6_371_008.8 * Math.cos(sc.anchor.lat * D));
    const g = ourGroundPoseOn("earth", lat, lon, 0, null, sc.start.hdg);
    const X = add(g.X, scale(g.up, (sc.start.agl + 800) / M_METRES));
    const { c, fly, msgs } = flight(
      { ...g, X, vel: add(groundVelocity("earth", X, 0), scale(g.fwd, sc.start.speed / C_MPS)), landed: undefined },
      false,
      "f35",
    );
    c.s.flightMode = "plane";
    c.s.wind = 0;
    c.pilot.throttle = c.pilot.engineNow = 0.85;
    c.s.wingmen = 2;
    fly(0.5);
    c.combatStart(sc);
    c.jetToggle("ap");
    c.jetToggle("athr");
    fly(10);
    expect(c.flightOrder("engage")).toBe("Engage bandits");
    const W = c.combat!.world;
    const alive0 = W.targets.filter((q) => q.alive && q.ai).length;
    fly(150, () => W.targets.filter((q) => q.alive && q.ai).length <= alive0 - 2);
    const down = alive0 - W.targets.filter((q) => q.alive && q.ai).length;
    const said = msgs.filter((m) => /Fox|splash|engaged/i.test(m));
    console.log(`  ${down} drones down; said: ${said.slice(0, 6).join(" · ")}`);
    expect(down).toBeGreaterThanOrEqual(2);
    expect(said.some((m) => /Fox three/.test(m))).toBe(true);
    expect(said.some((m) => /splash/i.test(m))).toBe(true);
  }, 120_000);
});
