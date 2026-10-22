import { describe, expect, test } from "bun:test";
import { Contrails } from "../src/contrails";
import { A320Fx, type FxIn, humidityOf } from "../src/a320/effects";

// The A320's air and ground effects (docs/PLAN-A320.md, A13 — src/a320/effects.ts): a humid approach in CONF FULL —
// the wing's vapour, the tip and flap-edge vortices —, nothing in a dry cruise; the inlet vortex at take-off power on
// the ground in humid air, a funnel drawn whole; the tyres' smoke at a 3 m/s touchdown, the mains', half a second; a wet
// runway at 100 kt with the reversers out — the spray behind the wheels and ahead of the nacelles.

const base = (o: Partial<FxIn>): FxIn => ({
  dt: 1 / 30,
  cl: 0.5,
  rho: 1.2,
  T: 288,
  speed: 70,
  humidity: 0.6,
  flap: 0,
  onGround: false,
  gs: 70,
  vz: 0,
  engines: [
    { n1: 50, rev: 0 },
    { n1: 50, rev: 0 },
  ],
  wet: 0,
  legs: null,
  ...o,
});
const kinds = (s: { kind: number }[]) => [...new Set(s.map((x) => x.kind))].sort();

describe("A320 effects", () => {
  test("a humid approach in CONF FULL: the vapour, the vortices; a dry cruise: nothing", () => {
    const F = new A320Fx();
    const app = F.step(base({ cl: 1.9, speed: 68, humidity: 0.95, flap: 40 }));
    console.log(`  approach: ${app.length} sources, kinds ${kinds(app)}`);
    expect(app.filter((s) => s.kind === 9).length).toBe(12);
    expect(app.filter((s) => s.kind === 3).length).toBe(4);
    const tip = app.find((s) => s.key === "a320t1")!;
    expect(tip.q[0]).toBeCloseTo(17, 0);
    expect(tip.str).toBeGreaterThan(0.8);
    // (the same in dry air: none; a cruise at 230 m/s, CL 0.5: none)
    expect(F.step(base({ cl: 1.9, speed: 68, humidity: 0.45, flap: 40 })).length).toBe(0);
    expect(F.step(base({ cl: 0.5, speed: 230, rho: 0.38, T: 220, humidity: 0.5 })).length).toBe(0);
  });

  test("the inlet vortex at take-off power on the ground, a funnel drawn whole", () => {
    const F = new A320Fx();
    const s = F.step(
      base({
        onGround: true,
        gs: 2,
        speed: 2,
        humidity: 0.9,
        engines: [
          { n1: 90, rev: 0 },
          { n1: 90, rev: 0 },
        ],
      }),
    );
    const col = s.filter((x) => x.to);
    expect(col.length).toBe(2);
    expect(col[0]!.q[1]).toBeLessThan(-1.5);
    expect(col[0]!.to![1]).toBeGreaterThan(-0.1);
    // (none at idle, none rolling at 40 m/s)
    expect(F.step(base({ onGround: true, gs: 2, humidity: 0.9 })).filter((x) => x.to).length).toBe(0);
    expect(
      F.step(
        base({
          onGround: true,
          gs: 40,
          humidity: 0.9,
          engines: [
            { n1: 90, rev: 0 },
            { n1: 90, rev: 0 },
          ],
        }),
      ).filter((x) => x.to).length,
    ).toBe(0);
    // (the trails: the column's points from the ground to the inlet, formed at once)
    const C = new Contrails();
    C.step(10, "earth", (p) => p, [{ key: "c", p: [0, 0, 0], to: [0, 2, 0], kind: 3, str: 1 }]);
    const out = new Float32Array(16 * 64);
    const n = C.view(
      10,
      [0, 0, 0],
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      out,
    );
    expect(n).toBe(9);
    expect(out[9]).toBeGreaterThan(0.1);
  });

  test("the tyres' smoke at a 3 m/s touchdown: the mains, 0.8 s", () => {
    const F = new A320Fx();
    const air = { gs: 70, vz: -3, speed: 70 };
    F.step(base({ ...air, legs: [0, 0, 0] }));
    let smoke = 0;
    let first: number | null = null;
    for (let k = 0; k < 60; k++) {
      const s = F.step(base({ ...air, onGround: true, legs: [0, 2e5, 2e5] })).filter((x) => x.kind === 8);
      if (s.length) {
        smoke++;
        first ??= s[0]!.str;
      }
    }
    console.log(`  smoke ${smoke} frames, ${first?.toFixed(2)} strong`);
    expect(smoke).toBeGreaterThan(20);
    expect(smoke).toBeLessThan(28);
    expect(first).toBeGreaterThan(0.8);
  });

  test("a wet runway at 100 kt with the reversers out: the spray", () => {
    const F = new A320Fx();
    const s = F.step(
      base({
        onGround: true,
        gs: 51,
        wet: 0.8,
        legs: [1e5, 2e5, 2e5],
        engines: [
          { n1: 70, rev: 1 },
          { n1: 70, rev: 1 },
        ],
      }),
    );
    const spray = s.filter((x) => x.kind === 7);
    console.log(`  spray: ${spray.map((x) => x.key).join(" ")}`);
    expect(spray.filter((x) => x.key.startsWith("a320w")).length).toBe(3);
    expect(spray.filter((x) => x.key.startsWith("a320r")).length).toBe(4);
    // (dry: none)
    expect(F.step(base({ onGround: true, gs: 51, wet: 0, legs: [1e5, 2e5, 2e5] })).filter((x) => x.kind === 7).length).toBe(0);
  });

  test("the humidity: the model's dew point, else the weather's kind", () => {
    expect(humidityOf({ model: { T: 15, Td: 15 } })).toBeCloseTo(1, 3);
    expect(humidityOf({ model: { T: 25, Td: 10 } })).toBeCloseTo(0.39, 1);
    expect(humidityOf({ kind: "fog" })).toBe(1);
    expect(humidityOf(null)).toBe(0.6);
  });
});
