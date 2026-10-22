import { describe, expect, test } from "bun:test";
import { limits, newEngine, stepEngine } from "../src/a320/fadec";
import type { Props } from "../src/a320/rig";
import { A320Sound } from "../src/a320/sound/model";
import { SoundInputs } from "../src/a320/sound/soundinputs";
import type { CraftVoice } from "../src/a320/sound/types";
import { A320Systems, type SysFrame } from "../src/a320/systems";

// The A320's sound (docs/PLAN-A320.md, A12 — src/a320/sound: FlightGear's sound files and their property rules as
// SimGear plays them) on the systems' bag: cold and dark — no engine heard; the engines at idle — the CFM56's cockpit
// idle loops at FlightGear's own volume and pitch; at take-off power — its buzz louder, higher; outside — the engines'
// external loops placed on them, their cones; the gear moving — its in-transit sound —; a start — the starter, the
// light-up; the ECAM's chime, a button's click — once each, as FlightGear's triggers pulse.

type Eng = ReturnType<typeof newEngine>;
const frame = (es: Eng[], o: Partial<SysFrame> = {}): SysFrame => ({
  elapsed: 0,
  lat: 48.7,
  lon: 2.4,
  altFt: 300,
  aglFt: 0,
  vsFpm: 0,
  onGround: true,
  gear: 1,
  ias: 0,
  gs: 0,
  mach: 0,
  tatC: 15,
  oatC: 15,
  staticInHg: 29.6,
  alphaDeg: 0,
  flapDeg: 0,
  slatDeg: 0,
  engines: es,
  tanks: [690, 5000, 0, 5000, 690],
  detent: "IDLE",
  ...o,
});
const air = { altFt: 0, densFt: 0, tatC: 15, mach: 0, onGround: true, flapLever: 0 };
/** the captain's ear in the ship's frame; one outside, 30 m ahead of the left engine, and one 30 m behind it */
const EYE: [number, number, number] = [0.45, 3.22, 16.193];

function bench(state: "cold" | "ready") {
  const P: Props = {};
  const S = new A320Systems(P, { rand: () => 0.5 });
  let es: Eng[] = [newEngine(state === "ready"), newEngine(state === "ready")];
  S.reset(state, frame(es));
  const I = new SoundInputs();
  const M = new A320Sound();
  M.reset(P);
  let voices: CraftVoice[] = [];
  const view = { inside: true, ear: EYE as [number, number, number] | undefined };
  let gear = 1;
  const run = (s: number, o: { n1?: number; until?: () => boolean; gearTo?: number } = {}) => {
    for (let k = 0; k < s * 30; k++) {
      const L = limits(air);
      const c = S.engineCtl();
      es = es.map((e, i) => stepEngine(e, { n1: o.n1 ?? L.idle, reverse: 0 }, air, 1 / 30, c[i]));
      if (o.gearTo !== undefined) gear += Math.max(-1 / 30 / 10, Math.min(1 / 30 / 10, o.gearTo - gear));
      S.step(1 / 30, frame(es, { gear }));
      I.step(P, 1 / 30, { inside: view.inside, ear: view.ear, aglFt: 0, flapLever: 0, flapNorm: 0 });
      voices = M.step(P, 1 / 30, view);
      if (o.until?.()) return;
    }
  };
  return {
    P,
    S,
    run,
    view,
    get voices() {
      return voices;
    },
    get es() {
      return es;
    },
  };
}
const named = (vs: CraftVoice[], name: string) => vs.filter((v) => v.id.endsWith(`:${name}`));
const one = (vs: CraftVoice[], name: string) => named(vs, name)[0];

describe("A320 sound (FlightGear's files)", () => {
  test("cold and dark: no engine heard", () => {
    const B = bench("cold");
    B.run(2);
    const eng = B.voices.filter((v) => /a320_(cockpit|external|wing)/.test(v.id));
    console.log(`  cold: ${B.voices.map((v) => v.id).join(", ") || "silence"}`);
    expect(eng).toEqual([]);
  });

  test("idle, then take-off power: the cockpit's idle loops at FlightGear's volume and pitch; the buzz louder and higher", () => {
    const B = bench("ready");
    B.run(4);
    const n1 = B.es[0]!.n1;
    const idle = one(B.voices, "a320_cockpit_idle_1")!;
    console.log(`  idle N1 ${n1.toFixed(1)}: idle_1 gain ${idle.gain.toFixed(3)} rate ${idle.rate.toFixed(3)}; ${B.voices.length} voices`);
    // (cfm56-sound.xml's rules: idle-1-v by N1 — 18.9 → 0.900, 41.7 → 0.673 —; idle-1-p 18.9 → 1.10, 42.5 → 1.65)
    const lerp = (x: number, x0: number, y0: number, x1: number, y1: number) => y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    expect(idle.gain).toBeCloseTo(n1 <= 18.9 ? lerp(n1, 12, 0, 18.9, 0.9) : lerp(n1, 18.9, 0.9, 41.7, 0.673), 3);
    expect(idle.rate).toBeCloseTo(n1 <= 18.9 ? 1.1 : lerp(n1, 18.9, 1.1, 42.5, 1.65), 3);
    expect(idle.loop).toBeTrue();
    expect(idle.where).toBe("inside");
    // (the left engine's recordings on its side: x > 0, the ship's left)
    expect(idle.pos![0]).toBeGreaterThan(5);
    expect(one(B.voices, "a320_cockpit_idle_2")!.pos![0]).toBeLessThan(-5);
    const buzzAt = (vs: CraftVoice[]) => named(vs, "a320_cockpit_buzz_1")[0];
    const b0 = buzzAt(B.voices);
    B.run(30, { n1: 90 });
    const b1 = buzzAt(B.voices)!;
    console.log(
      `  TOGA N1 ${B.es[0]!.n1.toFixed(1)}: buzz gain ${b0?.gain.toFixed(3) ?? "—"} → ${b1.gain.toFixed(3)}, rate ${b0?.rate.toFixed(3) ?? "—"} → ${b1.rate.toFixed(3)}; idle_1 ${one(B.voices, "a320_cockpit_idle_1")?.gain.toFixed(3) ?? "silent"}`,
    );
    expect(b1.gain).toBeGreaterThan(b0?.gain ?? 0);
    expect(b1.rate).toBeGreaterThan(b0?.rate ?? 0);
    expect(one(B.voices, "a320_cockpit_idle_1")).toBeUndefined();
  });

  test("outside: the engines' external loops on them, the rear sound's cone", () => {
    const B = bench("ready");
    B.view.inside = false;
    const ahead: [number, number, number] = [5.5, 2.6, 40],
      behind: [number, number, number] = [5.5, 2.6, -30];
    B.view.ear = ahead;
    B.run(3);
    expect(B.voices.filter((v) => v.id.includes("a320_cockpit_"))).toEqual([]);
    const front = one(B.voices, "a320_external_idle_1")!;
    const rearAhead = one(B.voices, "a320_external_idle_rear_1");
    B.view.ear = behind;
    B.run(0.2);
    const rearBehind = one(B.voices, "a320_external_idle_rear_1")!;
    console.log(
      `  outside: idle_1 ${front.gain.toFixed(3)} at ${front.pos!.map((x) => x.toFixed(1))}, ref ${front.refDist} m; rear: ahead ${rearAhead?.gain.toFixed(4) ?? "silent"}, behind ${rearBehind.gain.toFixed(3)}`,
    );
    expect(front.where).toBe("outside");
    expect(front.refDist).toBe(90);
    expect(rearBehind.gain).toBeGreaterThan(20 * (rearAhead?.gain ?? 0));
  });

  test("the gear in transit; a start: the starter, then the light-up", () => {
    const B = bench("cold");
    B.run(1);
    B.run(3, { gearTo: 0 });
    const g = one(B.voices, "gear0");
    expect(g?.loop).toBeTrue();
    console.log(`  gear moving: ${g?.gain.toFixed(2)} × ${g?.rate.toFixed(2)}`);
    B.run(30, { gearTo: 0 });
    expect(one(B.voices, "gear0")).toBeUndefined();
    // (the start: batteries, the APU, its bleed, ENG MODE IGN/START, ENG 1 MASTER ON)
    const P = B.P;
    P["controls/electrical/switches/bat-1"] = P["controls/electrical/switches/bat-2"] = 1;
    P["controls/apu/master"] = 1;
    B.run(4);
    B.S.call("systems.APUController.APU.startCommand", []);
    B.run(90, { until: () => Number(P["systems/apu/available"]) === 1 });
    expect(one(B.voices, "apu_in")).toBeDefined();
    P["controls/pneumatics/switches/apu"] = 1;
    P["controls/ignition/start-sw"] = 2;
    B.run(3);
    P["controls/engines/engine/cutoff-switch"] = 0;
    const seen: string[] = [];
    B.run(90, {
      until: () => {
        for (const v of B.voices) if (/a320_(starter|startup)_left/.test(v.id) && !seen.includes(v.id)) seen.push(v.id);
        return B.es[0]!.running;
      },
    });
    console.log(`  start: ${seen.join(" → ")}`);
    expect(seen[0]).toContain("a320_starter_left");
    expect(seen).toContainEqual(expect.stringContaining("a320_startup_left"));
    const st = one(B.voices, "a320_startup_left") ?? one(B.voices, "a320_starter_left");
    expect(st?.loop ?? false).toBeFalse();
  });

  test("the ECAM's chime; a button's click — once each, its trigger's pulse", () => {
    const B = bench("ready");
    B.run(1);
    B.P["sim/sound/warnings/chime"] = 1;
    B.run(0.1);
    const c = one(B.voices, "Chime")!;
    expect(c.loop).toBeFalse();
    expect(c.shot).toBe(1);
    B.P["sim/sound/warnings/chime"] = 0;
    B.P["sim/sound/btn1"] = 1;
    B.run(1 / 30);
    expect(one(B.voices, "Button")?.shot).toBe(1);
    // (sounds.nas clears it 0.05 s later: the voice leaves, a second press is a second shot)
    B.run(0.2);
    expect(Number(B.P["sim/sound/btn1"])).toBe(0);
    expect(one(B.voices, "Button")).toBeUndefined();
    B.P["sim/sound/btn1"] = 1;
    B.run(1 / 30);
    expect(one(B.voices, "Button")?.shot).toBe(2);
  });
});
