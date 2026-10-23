import { describe, expect, test } from "bun:test";
import { A320Callouts, type CalloutIn } from "../src/a320/sound/callouts";

// The A320's automatic callouts (docs/PLAN-A320.md, A12 — src/a320/sound/callouts.ts): an approach flown down at
// 700 ft/min from 3 000 ft to the runway — the heights in order, each once, HUNDRED ABOVE and MINIMUM at a 200 ft DH,
// RETARD at 20 ft with the levers in CL —; V1 on the take-off roll; TOO LOW GEAR, SINK RATE and their repeats.

const base = (o: Partial<CalloutIn>): CalloutIn => ({
  ra: null,
  vs: 0,
  onGround: false,
  ias: 140,
  v1: null,
  detent: 2,
  land: false,
  dh: null,
  mda: null,
  baroFt: 3000,
  gearDown: true,
  flapLever: 4,
  gsDots: 0,
  bank: 0,
  pullUp: false,
  sinkRate: false,
  t: 0,
  ...o,
});

describe("A320 callouts", () => {
  test("an approach: the heights, the minima, RETARD", () => {
    const C = new A320Callouts();
    const said: [number, string][] = [];
    for (let t = 0, h = 3000; h > 0; t += 0.1, h -= (700 / 60) * 0.1)
      for (const s of C.step(base({ ra: h, vs: -700, dh: 200, t, baroFt: h + 100 }))) said.push([Math.round(h), s]);
    console.log(`  ${said.map(([h, s]) => `${s}@${h}`).join(" ")}`);
    const names = said.map((x) => x[1]);
    expect(names.slice(0, 7)).toEqual(["altitude-2500", "1000", "500", "400", "100-above", "minimum", "100"]);
    expect(names).toContain("50");
    expect(names).toContain("10");
    expect(names.filter((n) => n === "1000").length).toBe(1);
    // (RETARD from 20 ft, the levers still in CL)
    const r = said.find((x) => x[1] === "retard");
    expect(r?.[0]).toBeLessThanOrEqual(20);
  });

  test("V1 on the take-off roll, once", () => {
    const C = new A320Callouts();
    const said: string[] = [];
    for (let ias = 0; ias < 160; ias += 1) said.push(...C.step(base({ onGround: true, ias, v1: 140, detent: 4, ra: 0 })));
    expect(said).toEqual(["V1"]);
  });

  test("too low gear, sink rate repeated while it lasts", () => {
    const C = new A320Callouts();
    const said: string[] = [];
    for (let t = 0; t < 5; t += 0.1) said.push(...C.step(base({ ra: 400, vs: -900, gearDown: false, flapLever: 2, t })));
    expect(said.filter((s) => s === "too-low-gear").length).toBe(2);
    const S = new A320Callouts();
    const s2: string[] = [];
    for (let t = 0; t < 4.1; t += 0.1) s2.push(...S.step(base({ ra: 1500, vs: -4000, sinkRate: true, t })));
    expect(s2.filter((s) => s === "sink-rate").length).toBe(3);
  });
});
