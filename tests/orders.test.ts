import { afterEach, describe, expect, test } from "bun:test";
import { parseOrders } from "../src/ai/offline-orders";
import { bankAccel, type FormCraft } from "../src/game/formation";
import { formationSlot } from "../src/game/formations";
import { wrapPi } from "../src/game/jet";
import { orderOf, type Order } from "../src/game/orders";
import { holdRadius, racetrackHeading, racetrackLength, racetrackPoint } from "../src/game/racetrack";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The leader's orders (docs/PLAN-AVIATION-AAA.md, F2; game/orders.ts, controller/orders.ts): the racetrack's
// shape and its following; the orders said to TARS offline; given as leader — our notion changed, sent —; heard
// in formation and carried out: the shape, the spacing, the break, the hold stacked by our place, home.

afterEach(resetFlights);

const D = Math.PI / 180;

describe("the racetrack", () => {
  const R = { inbound: 90 * D, leg: 8000, radius: 6000 };
  // (flown at 220 m/s with 30° of bank: its turns' own radius)
  const R2 = { ...R, radius: holdRadius(220) };
  test("its shape: the inbound leg to the fix, the right turn, the outbound leg 2 radii to the right", () => {
    const p = (s: number) => racetrackPoint(R, s);
    // (the fix at the inbound leg's end; the outbound leg 12 km south of the inbound one — the right of east)
    expect(p(8000)[0]).toBeCloseTo(0, 6);
    expect(p(8000)[1]).toBeCloseTo(0, 6);
    expect(p(8000 + Math.PI * 6000)[1]).toBeCloseTo(-12_000, 3);
    expect(racetrackLength(R)).toBeCloseTo(16_000 + 12_000 * Math.PI, 3);
  });

  test("flown by its carrot from 20 km off: on it within 500 m, round it the right way", () => {
    let x = 20_000,
      y = 15_000,
      hdg = 0;
    const V = 220,
      dt = 0.5,
      maxRate = bankAccel(30 * D) / V;
    let worst = 0;
    for (let t = 0; t < 1200; t += dt) {
      const c = racetrackHeading(R2, [x, y], V * 10);
      hdg += Math.max(-maxRate * dt, Math.min(maxRate * dt, wrapPi(c.hdg - hdg)));
      x += V * Math.sin(hdg) * dt;
      y += V * Math.cos(hdg) * dt;
      if (t > 300) worst = Math.max(worst, c.off);
    }
    console.log(`  after 5 min: within ${worst.toFixed(0)} m of the pattern`);
    expect(worst).toBeLessThan(500);
  });
});

describe("said to TARS offline", () => {
  const o = (q: string) => parseOrders(q).map((x) => `${x.tool} ${JSON.stringify(x.args)}`);
  test("the formation, the break, rejoin, home, tighten", () => {
    expect(o("Patrouille, en losange")).toEqual(['flight_lead {"action":"order","order":"shape","shape":"diamond"}']);
    expect(o("Dégagez à gauche !")).toEqual(['flight_lead {"action":"order","order":"breakL"}']);
    expect(o("Flight, rejoin")).toEqual(['flight_lead {"action":"order","order":"rejoin"}']);
    expect(o("Patrouille, retour base")).toEqual(['flight_lead {"action":"order","order":"rtb"}']);
    expect(o("Serrez")).toEqual(['flight_lead {"action":"order","order":"tighten"}']);
    expect(o("go echelon left")).toEqual(['flight_lead {"action":"order","order":"shape","shape":"echelonL"}']);
    // (the autopilot's own words untouched)
    expect(o("hold position")).toEqual(['autopilot {"mode":"hover"}']);
  });
});

describe("given as leader", () => {
  test("the shape: ours changed, sent; tighten steps the spacing; attack needs a lock; the network's checked", () => {
    const { c } = cruise(9000, 220, 0.7);
    const sent: Order[] = [];
    c.orderSinks.set("t", (x) => sent.push(x));
    expect(c.flightOrder("shape", "diamond")).toBe("Flight, go Diamond");
    expect(c.s.formShape).toBe("diamond");
    c.flightOrder("tighten");
    expect(c.s.formSpacing).toBe("tight");
    expect(c.flightOrder("attack")).toContain("lock");
    expect(sent.map((x) => x.id)).toEqual(["shape", "tighten"]);
    expect(sent[0]!.shape).toBe("diamond");
    expect(orderOf({ id: "nope" })).toBeNull();
    expect(orderOf({ id: "hold", fix: { lat: 1, lon: 2 }, inbound: 1, junk: 3 })).toEqual({
      id: "hold",
      fix: { lat: 1, lon: 2 },
      inbound: 1,
    });
  });
});

/** Our F-35 at 9 km in formation on a leader flying east (place `pos` of `shape`), settled. */
function inFormation(shape: "fingertip" | "diamond" = "fingertip", pos = 2) {
  const run = cruise(9000, 220, 0.7);
  const { c, fly } = run;
  c.s.wind = 0;
  c.jetToggle("ap");
  c.jetToggle("athr");
  c.s.formShape = shape;
  c.s.formPos = pos;
  c.s.formSpacing = "normal";
  const fix = c.radarFix()!;
  const R0 = Math.hypot(...fix.p);
  const st = { x: 150, t: 0 };
  const lead = (): FormCraft => {
    const q = [0, 1, 2].map((k) => fix.p[k]! + fix.E[k]! * st.x);
    const l = Math.hypot(...q);
    const p = q.map((x) => (x / l) * R0);
    const up = p.map((x) => x / R0);
    const wu = fix.E[0]! * up[0]! + fix.E[1]! * up[1]! + fix.E[2]! * up[2]!;
    const w = fix.E.map((x, k) => x - wu * up[k]!);
    const wl = Math.hypot(...w);
    return { p, v: w.map((x) => (x / wl) * 220), aLat: 0 };
  };
  c.form = {
    slot: 7,
    name: "Ana",
    at: formationSlot(shape, pos),
    shape,
    pos,
    spacing: "normal",
    kspan: 1,
    since: 0,
    armed: false,
    last: null,
    lead,
  };
  const step = (s: number, each?: () => void) => {
    for (let i = 0; i < s * 30; i++) {
      st.x += 220 / 30;
      st.t += 1 / 30;
      fly(1 / 30);
      each?.();
    }
  };
  step(60);
  return { ...run, step };
}

describe("heard in formation, carried out", () => {
  const ana = { name: "Ana", slot: 7 };
  test("go diamond: the shape and the slot moved — #2 still on the left, flown to it", () => {
    const { c, step } = inFormation("echelonR" as "fingertip", 2);
    expect(c.form!.at.right).toBeGreaterThan(0);
    const said = c.orderHeard({ id: "shape", shape: "diamond", spacing: "normal" }, ana);
    expect(said).toBe("Ana : Flight, go Diamond");
    expect(c.s.formShape).toBe("diamond");
    expect(c.form!.at.right).toBeLessThan(0);
    let k = 0;
    step(40, () => {
      if (process.env.DBG && k++ % 60 === 0) {
        const F = c.form!;
        console.log(
          `    ${(k / 30).toFixed(0)}s now ${JSON.stringify(Object.values(F.now ?? {}).map((x) => Math.round(x)))} dist ${F.last?.dist.toFixed(1)} along ${F.last?.along.toFixed(1)} cross ${F.last?.cross.toFixed(1)} up ${F.last?.up.toFixed(1)} phase ${F.phase}`,
        );
      }
    });
    console.log(`  diamond #2 reached: ${c.form!.last!.dist.toFixed(1)} m off`);
    expect(c.form!.last!.dist).toBeLessThan(5);
  }, 120_000);

  test("break left: out of formation, a hard turn 90° to the left, then the heading held", () => {
    const { c, step } = inFormation();
    const h0 = c.jetFigures()!.hdg;
    c.orderHeard({ id: "breakL" }, ana);
    expect(c.form).toBeNull();
    expect(c.jetModes.order === undefined || c.brk !== null).toBe(true);
    let bank = 0;
    step(30, () => {
      const L = c.airFlight.last;
      bank = Math.max(bank, Math.abs((c.attitudeNow() as { bank?: number }).bank ?? 0));
      void L;
    });
    const turned = wrapPi(c.jetFigures()!.hdg - h0) / D;
    console.log(`  turned ${turned.toFixed(0)}°, banked up to ${(bank / D).toFixed(0)}°; break done: ${c.brk === null}`);
    expect(turned).toBeGreaterThan(-100);
    expect(turned).toBeLessThan(-80);
    expect(bank / D).toBeGreaterThan(60);
    expect(c.brk).toBeNull();
  }, 120_000);

  test("break right, then rejoin: the slot far off — the run to it, its turn, then the formation law — reached", () => {
    const { c, step } = inFormation("diamond", 2);
    const F0 = { ...c.form! };
    c.orderHeard({ id: "breakR" }, ana);
    step(25);
    // (rejoin heard out of formation: on his wing again — ui/netsession.ts's formation, its place the same)
    c.form = { ...F0, phase: undefined, mem: undefined, last: null, armed: false };
    let t = Number.NaN;
    let k = 0;
    step(240, () => {
      k++;
      if (Number.isNaN(t) && (c.form?.last?.dist ?? Infinity) < 15) t = k / 30;
    });
    console.log(`  rejoined after the break: within 15 m in ${t.toFixed(0)} s, then ${c.form!.last!.dist.toFixed(1)} m`);
    expect(t).toBeLessThan(200);
    expect(c.form!.last!.dist).toBeLessThan(3);
  }, 120_000);

  test("hold here: out of formation, the racetrack over the leader's fix, 300 m above for #2", () => {
    const { c, step } = inFormation();
    const g = c.geoNow()!;
    const h0 = c.jetFigures()!.h;
    c.orderHeard({ id: "hold", fix: { lat: g.lat, lon: g.lon }, inbound: g.track }, ana);
    expect(c.form).toBeNull();
    expect(c.holdPat).not.toBeNull();
    let far = 0;
    step(420, () => {
      const q = c.geoNow()!;
      const e = (q.lon - g.lon) * D * 6_371_008.8 * Math.cos(g.lat * D),
        n = (q.lat - g.lat) * D * 6_371_008.8;
      far = Math.max(far, Math.hypot(e, n));
    });
    const dh = c.jetFigures()!.h - h0;
    console.log(`  7 min holding: at most ${(far / 1000).toFixed(1)} km from the fix, ${dh.toFixed(0)} m above`);
    expect(far).toBeLessThan(40_000);
    expect(dh).toBeGreaterThan(250);
    expect(dh).toBeLessThan(350);
    expect(c.jetModes.order).toBe("HOLD");
  }, 120_000);

  test("RTB: a plan to the nearest airfield, LNAV and VNAV on", () => {
    const { c } = inFormation();
    c.orderHeard({ id: "rtb" }, ana);
    expect(c.form).toBeNull();
    expect(c.nav.route.wps.length).toBe(2);
    expect(c.nav.route.wps[1]!.field).toBeDefined();
    expect(c.nav.on.l && c.nav.on.v).toBe(true);
    console.log(`  home: ${c.nav.route.wps[1]!.name}`);
  }, 120_000);

  test("attack my target: heard, not flown (a human's own to carry out)", () => {
    const { c } = inFormation();
    expect(c.orderHeard({ id: "attack", target: "cmb:1" }, ana)).toBe("Ana : Attack my target");
    expect(c.form).not.toBeNull();
  }, 120_000);
});
