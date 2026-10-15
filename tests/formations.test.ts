import { afterEach, describe, expect, test } from "bun:test";
import { formReshape } from "../src/controller/formation";
import { bankAccel, type FormCraft } from "../src/game/formation";
import { CLEAR, FORMATION_IDS, FORMATIONS, type FormationId, formationSlot, SPACINGS, type Spacing } from "../src/game/formations";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The formations (docs/PLAN-AVIATION-AAA.md, F1; game/formations.ts): every place of every formation clear of
// the others at every spacing; the F-35 flown by the formation law to its place — 2, 3 or 4 — on a leader flying
// straight then turning at 30° of bank, held; the shape changed in flight (an order's), the slot moved.

afterEach(resetFlights);

const D = Math.PI / 180;
type P3 = [number, number, number];

describe("the table", () => {
  test("every formation, every spacing: the four places a wingspan and a margin apart, close ones close", () => {
    for (const id of FORMATION_IDS)
      for (const sp of SPACINGS) {
        const at: P3[] = [[0, 0, 0], ...[2, 3, 4].map((n) => formationSlot(id, n, sp)).map((s) => [s.right, -s.back, s.up] as P3)];
        let least = Infinity,
          most = 0;
        for (let i = 0; i < 4; i++)
          for (let j = i + 1; j < 4; j++) {
            const d = Math.hypot(at[i]![0] - at[j]![0], at[i]![1] - at[j]![1], at[i]![2] - at[j]![2]);
            least = Math.min(least, d);
            most = Math.max(most, d);
          }
        expect(least).toBeGreaterThan(CLEAR);
        if (FORMATIONS[id].close) expect(most).toBeLessThan(200);
        else expect(least).toBeGreaterThan(100);
      }
  });

  test("the spacings: tighter, wider; the echelons mirror each other", () => {
    const n = formationSlot("fingertip", 4, "normal");
    expect(formationSlot("fingertip", 4, "tight").right).toBeLessThan(n.right);
    expect(formationSlot("fingertip", 4, "wide").right).toBeGreaterThan(n.right);
    for (const k of [2, 3, 4]) expect(formationSlot("echelonL", k).right).toBe(-formationSlot("echelonR", k).right);
  });
});

/** A leader flying east from 150 m before our F-35 (9 km, 220 m/s), level, then banked 30° to the left: its craft
 *  for the formation, fixed to the Earth, as `t` [s] runs. */
function leader(c: ReturnType<typeof cruise>["c"], turnAt: number) {
  const fix = c.radarFix()!;
  const R0 = Math.hypot(...fix.p);
  const V = 220;
  const st = { x: 150, y: 0, psi: 90 * D, t: 0 };
  const phi = () => (st.t >= turnAt ? -30 * D : 0);
  const at = (): FormCraft => {
    const q = [0, 1, 2].map((k) => fix.p[k]! + fix.E[k]! * st.x + fix.N[k]! * st.y);
    const l = Math.hypot(...q);
    const p = q.map((x) => (x / l) * R0);
    // (its way flat where it is: the start's frame's, the vertical there taken off)
    const w = [0, 1, 2].map((k) => Math.sin(st.psi) * fix.E[k]! + Math.cos(st.psi) * fix.N[k]!);
    const up = p.map((x) => x / R0);
    const wu = w[0]! * up[0]! + w[1]! * up[1]! + w[2]! * up[2]!;
    const wf = w.map((x, k) => x - wu * up[k]!);
    const wl = Math.hypot(...wf);
    const v = wf.map((x) => (x / wl) * V);
    return { p, v, fwd: v.map((x) => x / V), aLat: bankAccel(phi()) };
  };
  const step = (dt: number) => {
    st.psi += (bankAccel(phi()) / V) * dt;
    st.x += V * Math.sin(st.psi) * dt;
    st.y += V * Math.cos(st.psi) * dt;
    st.t += dt;
  };
  return { at, step, st };
}

/** Our F-35 flying place `pos` of a formation on that leader: the slot's error [m] at worst settled straight,
 *  at worst in the turn; the time to the slot. */
function flown(shape: FormationId, pos: number, spacing: Spacing = "normal", wind: 0 | 1 = 0) {
  const { c, fly } = cruise(9000, 220, 0.7);
  c.s.wind = wind;
  c.jetToggle("ap");
  c.jetToggle("athr");
  c.s.formShape = shape;
  c.s.formPos = pos;
  c.s.formSpacing = spacing;
  const L = leader(c, 120);
  c.form = {
    slot: 99,
    name: "LEAD",
    at: formationSlot(shape, pos, spacing),
    shape,
    pos,
    spacing,
    kspan: 1,
    since: performance.now() / 1000,
    armed: false,
    last: null,
    lead: L.at,
  };
  const dt = 1 / 30;
  const run = (s: number, each?: () => void) => {
    for (let i = 0; i < s * 30 && c.form; i++) {
      L.step(dt);
      fly(dt);
      each?.();
    }
  };
  let reached = Number.NaN;
  run(90, () => {
    if (Number.isNaN(reached) && (c.form?.last?.dist ?? Infinity) < 5) reached = L.st.t;
  });
  let straight = 0;
  run(30, () => {
    straight = Math.max(straight, c.form?.last?.dist ?? Infinity);
    if (process.env.DBG && Math.round(L.st.t * 30) % 90 === 0) {
      const E = c.form?.last;
      console.log(
        `    t ${L.st.t.toFixed(0)} along ${E?.along.toFixed(2)} cross ${E?.cross.toFixed(2)} up ${E?.up.toFixed(2)} mem ${JSON.stringify(c.form?.mem)}`,
      );
    }
  });
  const E = c.form?.last;
  if (process.env.DBG) console.log(`    straight: along ${E?.along.toFixed(2)} cross ${E?.cross.toFixed(2)} up ${E?.up.toFixed(2)}`);
  // (the turn: its roll-in let settle 10 s, then 40 s of it)
  run(10);
  let turn = 0;
  run(40, () => (turn = Math.max(turn, c.form?.last?.dist ?? Infinity)));
  return { reached, straight, turn, on: !!c.form, c };
}

describe("flown to its place", () => {
  for (const [shape, pos] of [
    ["diamond", 4],
    ["fingertip", 4],
    ["echelonL", 3],
    ["vic", 3],
    ["trail", 2],
    ["line", 3],
    ["spread", 2],
  ] as const)
    test(`${FORMATIONS[shape].en} #${pos}: reached, held straight and in a 30° turn`, () => {
      const r = flown(shape, pos);
      console.log(
        `  ${FORMATIONS[shape].en} #${pos}: within 5 m at ${r.reached.toFixed(0)} s; straight ≤ ${r.straight.toFixed(1)} m, in the turn ≤ ${r.turn.toFixed(1)} m`,
      );
      expect(r.on).toBe(true);
      expect(r.reached).toBeLessThan(90);
      expect(r.straight).toBeLessThan(2);
      // (a tactical one's outside place flies faster in the turn, its inside one slower: held within a third of its
      // distance — its geometry kept by the crossings of F4)
      const s = formationSlot(shape, pos);
      expect(r.turn).toBeLessThan(FORMATIONS[shape].close ? 12 : Math.hypot(s.right, s.back, s.up) / 3);
    }, 120_000);

  test("in the light wind's turbulence: diamond #4 held within 8 m", () => {
    const r = flown("diamond", 4, "normal", 1);
    console.log(`  light wind: straight ≤ ${r.straight.toFixed(1)} m, in the turn ≤ ${r.turn.toFixed(1)} m`);
    expect(r.straight).toBeLessThan(8);
    expect(r.turn).toBeLessThan(15);
  }, 120_000);

  test("the shape changed in flight (an order): fingertip #2 → echelon right #2, the slot moved to the other side", () => {
    const r = flown("fingertip", 2);
    const F = r.c.form!;
    expect(F.at.right).toBeLessThan(0);
    expect(formReshape(F, { shape: "echelonR" })).toBe("Echelon right");
    expect(F.at.right).toBeGreaterThan(0);
  }, 120_000);
});
