import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  collinearGamma,
  defaultHaloAzM,
  haloOrbitLoop,
  haloState,
  isLagrangeId,
  lagrangeFromStates,
  lagrangeName,
  lagrangeShortName,
  lagrangeStability,
  lagrangeState,
  matchHaloPhase,
  parseLagrangeId,
  refineHaloOrbit,
  resolveLagrangeName,
  ROUTH_MU,
  synodicRelState,
  testLagrangeStabilityNBody,
} from "../src/system/lagrange";
import { planOurTransfer, stateAt } from "../src/system/our-plan";
import { lagrangeGoalState } from "../src/system/lagrange-plan";
import { jwstAxes, jwstHaloLoop, jwstOrbit, jwstStart, JwstTracker } from "../src/system/jwst";
import { ourOrbitPose } from "../src/game/place";
import { readSpace } from "../src/net/instruments-space";
import { readCrewCmd } from "../src/net/crewcmd";
import { systemScene } from "../src/crew/sys3d/scene";
import type { InstrumentSnapshot } from "../src/net/instruments";
import { predictOurs } from "../src/system/our-predict";
import { EPOCH_DATE, M_METRES, M_SECONDS, solarState } from "../src/system/solar";
import { dot, len, sub, unit } from "../src/math/vec3";
import { C_MPS } from "../src/units";

// (N-body planning and century sweeps take seconds alone, tens of seconds on a loaded Mac or a parallel CI runner: 60 s, not the 5 s default)
setDefaultTimeout(60_000);

describe("Lagrange points: exact Euler quintics, positions & IDs", () => {
  test("ID parsing, naming, and multilingual resolution", () => {
    expect(isLagrangeId("lag:earth:2")).toBe(true);
    expect(isLagrangeId("lag:moon:4")).toBe(true);
    expect(isLagrangeId("lag:earth:6")).toBe(false);
    expect(isLagrangeId("earth")).toBe(false);
    expect(parseLagrangeId("lag:earth:2")).toEqual({ primary: "sun", secondary: "earth", index: 2 });
    expect(parseLagrangeId("lag:moon:1")).toEqual({ primary: "earth", secondary: "moon", index: 1 });
    expect(lagrangeShortName("lag:earth:2")).toBe("SE-L2");
    expect(lagrangeShortName("lag:moon:4")).toBe("EM-L4");
    expect(lagrangeName("lag:earth:2")).toContain("L2");
    expect(resolveLagrangeName("Sun-Earth L2")).toBe("lag:earth:2");
    expect(resolveLagrangeName("Soleil–Terre L2")).toBe("lag:earth:2");
    expect(resolveLagrangeName("SE-L1")).toBe("lag:earth:1");
    expect(resolveLagrangeName("Terre-Lune L4")).toBe("lag:moon:4");
    expect(resolveLagrangeName("EM-L2")).toBe("lag:moon:2");
    expect(resolveLagrangeName("Jupiter L5")).toBe("lag:jupiter:5");
    expect(resolveLagrangeName("L2", "earth")).toBe("lag:earth:2");
    expect(resolveLagrangeName("L1", "moon")).toBe("lag:moon:1");
  });

  test("collinear Euler quintics converge to < 1e-13 residual across mass ratios", () => {
    for (const mu of [3.0404e-6, 0.0121505856, 0.00095459, 0.1087]) {
      const m1 = 1 - mu;
      const g1 = collinearGamma(mu, 1);
      expect(Math.abs(m1 / (1 - g1) ** 2 - mu / g1 ** 2 - (m1 - g1))).toBeLessThan(1e-13);
      const g2 = collinearGamma(mu, 2);
      expect(Math.abs(m1 / (1 + g2) ** 2 + mu / g2 ** 2 - (m1 + g2))).toBeLessThan(1e-13);
      const g3 = collinearGamma(mu, 3);
      expect(Math.abs(m1 / g3 ** 2 + mu / (1 + g3) ** 2 - (mu + g3))).toBeLessThan(1e-13);
    }
  });

  test("Sun–Earth L1/L2 and Earth–Moon L1/L2/L4/L5 match real astrophysical distances", () => {
    const seL1 = lagrangeState("lag:earth:1", 0)!;
    const seL2 = lagrangeState("lag:earth:2", 0)!;
    const seL1Km = (seL1.distSecondary * M_METRES) / 1e3;
    const seL2Km = (seL2.distSecondary * M_METRES) / 1e3;
    // Real Sun–Earth L1 ≈ 1.49M km, L2 ≈ 1.50M km (varies ±1.7% with Earth's eccentricity)
    expect(seL1Km).toBeGreaterThan(1.44e6);
    expect(seL1Km).toBeLessThan(1.54e6);
    expect(seL2Km).toBeGreaterThan(1.45e6);
    expect(seL2Km).toBeLessThan(1.56e6);

    const emL1 = lagrangeState("lag:moon:1", 0)!;
    const emL2 = lagrangeState("lag:moon:2", 0)!;
    const emL1Km = (emL1.distSecondary * M_METRES) / 1e3;
    const emL2Km = (emL2.distSecondary * M_METRES) / 1e3;
    // Real Earth–Moon L1 ≈ 55–61k km from Moon, L2 ≈ 60–68k km from Moon
    expect(emL1Km).toBeGreaterThan(52_000);
    expect(emL1Km).toBeLessThan(64_000);
    expect(emL2Km).toBeGreaterThan(57_000);
    expect(emL2Km).toBeLessThan(71_000);

    // L4 and L5 form exact equilateral triangles with primary and secondary
    const emL4 = lagrangeState("lag:moon:4", 0)!;
    const emL5 = lagrangeState("lag:moon:5", 0)!;
    const E = solarState("earth", 0).pos;
    const M = solarState("moon", 0).pos;
    const dEM = len(sub(M, E));
    expect(Math.abs(len(sub(emL4.pos, E)) / dEM - 1)).toBeLessThan(1e-12);
    expect(Math.abs(len(sub(emL4.pos, M)) / dEM - 1)).toBeLessThan(1e-12);
    expect(Math.abs(len(sub(emL5.pos, E)) / dEM - 1)).toBeLessThan(1e-12);
    expect(Math.abs(len(sub(emL5.pos, M)) / dEM - 1)).toBeLessThan(1e-12);
  });

  test("lagrangeFromStates is unit-invariant (works identically in km for Crew Console)", () => {
    const L = lagrangeState("lag:moon:2", 0)!;
    const E = solarState("earth", 0);
    const M = solarState("moon", 0);
    const KM = M_METRES / 1e3;
    const s = (v: readonly number[]) => [v[0]! * KM, v[1]! * KM, v[2]! * KM] as [number, number, number];
    const fromKm = lagrangeFromStates(s(E.pos), s(E.vel), 398600.44, s(M.pos), s(M.vel), 4902.8, 2);
    const errKm = len(sub(fromKm.pos, s(L.pos)));
    expect(errKm).toBeLessThan(1e-2);
  });
});

describe("Lagrange points: linear stability, Routh criterion & real N-body stability tests", () => {
  test("linear stability eigenvalues match CR3BP theory (SE-L2 τ≈23 d, EM-L2 τ≈3.2 d, Routh criterion)", () => {
    const seL2 = lagrangeStability("lag:earth:2", 0)!;
    expect(seL2.linearlyStable).toBe(false);
    expect(seL2.kind).toBe("saddle");
    // Real Sun–Earth L2 e-folding time ≈ 23 days, in-plane Halo period ≈ 178 days
    expect(seL2.eFoldDays).toBeGreaterThan(20);
    expect(seL2.eFoldDays).toBeLessThan(26);
    expect(seL2.inPlanePeriodDays).toBeGreaterThan(165);
    expect(seL2.inPlanePeriodDays).toBeLessThan(190);

    const emL2 = lagrangeStability("lag:moon:2", 0)!;
    expect(emL2.linearlyStable).toBe(false);
    expect(emL2.eFoldDays).toBeGreaterThan(1.5);
    expect(emL2.eFoldDays).toBeLessThan(4.5);

    const seL4 = lagrangeStability("lag:earth:4", 0)!;
    expect(seL4.linearlyStable).toBe(true);
    expect(seL4.kind).toBe("stable");
    expect(seL4.mu).toBeLessThan(ROUTH_MU);

    const sjL4 = lagrangeStability("lag:jupiter:4", 0)!;
    expect(sjL4.linearlyStable).toBe(true);
    expect(sjL4.mu).toBeLessThan(ROUTH_MU);

    // Pluto–Charon has μ ≈ 0.1087 > ROUTH_MU ≈ 0.03852 -> linearly UNSTABLE L4/L5!
    const pcL4 = lagrangeStability("lag:charon:4", 0)!;
    expect(pcL4.linearlyStable).toBe(false);
    expect(pcL4.kind).toBe("unstable-triangular");
    expect(pcL4.mu).toBeGreaterThan(ROUTH_MU);
    expect(pcL4.eFoldDays).toBeGreaterThan(0.5);
    expect(pcL4.eFoldDays).toBeLessThan(10);
  });

  test("N-body stability: Sun–Earth L4/L5 & Sun–Jupiter L4 remain stably bound; Sun–Earth L2 diverges exponentially", () => {
    // 1. Sun–Earth L4: 180 days in full N-body predictor with 500 km perturbation stays well bounded (Trojan stability!)
    const l4 = testLagrangeStabilityNBody("lag:earth:4", 0, 180, 500)!;
    expect(l4.linear.linearlyStable).toBe(true);
    // Eccentricity + Jupiter perturbations cause gentle libration (< 300,000 km vs 150,000,000 km orbit = <0.2%)
    expect(l4.maxOffsetKm).toBeLessThan(400_000);

    // 2. Sun–Jupiter L4 (Trojans): 365 days with 1,000 km perturbation stays tightly bound (< 0.1% of Jupiter's orbit)
    const jl4 = testLagrangeStabilityNBody("lag:jupiter:4", 0, 365, 1000)!;
    expect(jl4.linear.linearlyStable).toBe(true);
    expect(jl4.maxOffsetKm).toBeLessThan(1_000_000);

    // 3. Sun–Earth L2: 120 days (~5.2 e-folding times) with 500 km radial perturbation exhibits real saddle divergence!
    const l2 = testLagrangeStabilityNBody("lag:earth:2", 0, 120, 500)!;
    expect(l2.linear.linearlyStable).toBe(false);
    // e^(120/23) ≈ 180 -> final offset grows by > 20× over 120 days!
    expect(l2.growthRatio).toBeGreaterThan(20);
  });

  test("N-body Halo orbit around Sun–Earth L2 (JWST-style): Richardson + differential correction stays in Halo orbit", () => {
    const azM = defaultHaloAzM("lag:earth:2", 0);
    const loop = haloOrbitLoop("lag:earth:2", 0, { azM, branch: -1 }, 64);
    expect(loop.length).toBe(65);
    const h0 = haloState("lag:earth:2", 0, { azM, branch: -1, phase0: 0 })!;
    expect(h0.periodDays).toBeGreaterThan(165);
    expect(h0.periodDays).toBeLessThan(195);

    // Phase matcher recovers phase0 accurately
    const matched = matchHaloPhase("lag:earth:2", h0.pos, 0, azM, -1)!;
    const phErr = Math.abs(Math.atan2(Math.sin(matched.phase0 - 0), Math.cos(matched.phase0 - 0)));
    expect(phErr).toBeLessThan(0.05);

    // Full N-body differential correction finds a periodic Halo initial condition around Sun–Earth L2
    const refined = refineHaloOrbit("lag:earth:2", 0, { azM, branch: -1 })!;
    expect(refined).not.toBeNull();
    expect(refined.ok).toBe(true);
    expect(Math.abs(refined.residualVxMs)).toBeLessThan(1.0);
    // Propagate the corrected Halo state for a full half-period (~89 days) in full N-body gravity
    const prop = predictOurs(refined.X0, refined.V0, 0, [], { tMax: refined.halfPeriodM, maxSteps: 10000, step: 0.015 });
    expect(prop.fate).toBe("continues");
    // Must stay in the L2 Halo envelope (between 100k km and 1.1M km of L2 throughout the entire half-revolution!)
    let minD = Infinity,
      maxD = 0;
    for (let i = 0; i < prop.pts.length; i += Math.max(1, Math.floor(prop.pts.length / 40))) {
      const rel = synodicRelState("lag:earth:2", prop.pts[i]!, prop.vels[i]!, prop.times[i]!)!;
      const km = rel.distM / 1e3;
      if (km < minD) minD = km;
      if (km > maxD) maxD = km;
    }
    expect(minD).toBeGreaterThan(100_000);
    expect(maxD).toBeLessThan(1_150_000);
  });

  test("N-body Halo orbit around Earth–Moon L2 stays bound through half-revolution", () => {
    const azM = defaultHaloAzM("lag:moon:2", 0);
    const refined = refineHaloOrbit("lag:moon:2", 0, { azM, branch: -1 })!;
    expect(refined).not.toBeNull();
    expect(refined.ok).toBe(true);
    const prop = predictOurs(refined.X0, refined.V0, 0, [], { tMax: refined.halfPeriodM, maxSteps: 10000, step: 0.015 });
    expect(prop.fate).toBe("continues");
    const last = prop.pts.length - 1;
    const relEnd = synodicRelState("lag:moon:2", prop.pts[last]!, prop.vels[last]!, prop.times[last]!)!;
    expect(relEnd.distM / 1e3).toBeLessThan(50_000);
  });
});

describe("JWST orbit, sun-shielding attitude & near-field N-body tracker", () => {
  test("JWST flies on a real Southern Halo orbit around Sun–Earth L2 with sunshield (−Y) toward Sun", () => {
    const st = jwstOrbit(0)!;
    expect(st).not.toBeNull();
    const l2 = lagrangeState("lag:earth:2", 0)!;
    const distFromL2Km = (len(sub(st.X, l2.pos)) * M_METRES) / 1e3;
    // Real JWST orbits between ~250,000 and ~832,000 km from Sun–Earth L2
    expect(distFromL2Km).toBeGreaterThan(200_000);
    expect(distFromL2Km).toBeLessThan(900_000);

    // Attitude: −Y faces Sun (within 15° elongation tilt), +Y cold gold mirror away from Sun
    const [ex, ey, ez] = jwstAxes(st.X, st.V, 0);
    const toSun = unit(sub(solarState("sun", 0).pos, st.X));
    expect(dot(ey, toSun)).toBeLessThan(-0.95); // −ey within ~18° of Sun
    // Orthonormal right-handed frame
    expect(Math.abs(dot(ex, ey))).toBeLessThan(1e-10);
    expect(Math.abs(dot(ey, ez))).toBeLessThan(1e-10);
    expect(Math.abs(dot(ez, ex))).toBeLessThan(1e-10);

    // Starting pose 60 m away on cold mirror side, velocity-matched
    const pose = jwstStart(0, 60)!;
    expect(pose).not.toBeNull();
    expect(len(sub(pose.X, st.X)) * M_METRES).toBeCloseTo(60, 0);
    expect(len(sub(pose.vel, st.V)) * C_MPS).toBeLessThan(1e-3);

    // Near-field Verlet tracker matches orbit cleanly within 50 km
    const tr = new JwstTracker();
    const near0 = tr.state(0, pose.X)!;
    expect(tr.near).toBe(true);
    expect(len(sub(near0.X, st.X)) * M_METRES).toBeLessThan(1);

    const loop = jwstHaloLoop(0, 48);
    expect(loop.length).toBe(49);
  });
});

describe("Lagrange & JWST N-body mission planner (Flight Computer)", () => {
  const opts = { lead: 60 / M_SECONDS, mouthR: 0 };
  const goal = (target: string, arrival: "halo" | "station") => ({ kind: "transfer" as const, target, arrival, altM: 0, returnAltM: 0 });
  const sumDvKms = (nodes: { dv: [number, number, number] }[]) => (nodes.reduce((s, n) => s + Math.hypot(...n.dv), 0) * C_MPS) / 1e3;
  /** Where the planned path (its burns, the insertion's included) is at the arrival against the orbit or point aimed at:
   *  the miss [km] and the velocity left to match [m/s] — what the autopilot then takes over. */
  const arrival = (plan: Exclude<ReturnType<typeof planOurTransfer>, { error: string }>) => {
    const m = plan.mission;
    const g = lagrangeGoalState(m.goal.target, m.goal.arrival, m.goal.altM, m.tArrive!, m.haloPhase0 ?? 0, m.haloBranch ?? -1)!;
    const st = stateAt(plan.path, m.tArrive!)!;
    return { missKm: (len(sub(st.X, g.pos)) * M_METRES) / 1e3, dvLeftMs: len(sub(st.V, g.vel)) * C_MPS };
  };

  test("plans Earth LEO → Sun–Earth L2 Halo orbit (JWST-style) with realistic Δv and Halo insertion", () => {
    const leo = ourOrbitPose({ body: "earth", altKm: 400, inc: 28.5 }, 0);
    const plan = planOurTransfer(leo.X, leo.vel, 0, goal("lag:earth:2", "halo"), opts);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.mission.type).toBe("lagrange");
    expect(plan.nodes.length).toBeGreaterThanOrEqual(2);
    // Departure + capture insertion with Halo orbit autopilot handoff
    const cap = plan.nodes.find((n) => n.role === "capture");
    expect(cap).toBeTruthy();
    expect(cap!.then).toBe("orbit");
    expect(cap!.body).toBe("lag:earth:2");
    // Realistic LEO -> SE-L2 Halo total Δv: ~3.2 km/s departure + ~0.4 km/s insertion (the arrival's phase chosen —
    // lagrange-plan.ts: at the x–z crossing it took 6.7 + 0.5)
    const dvKms = sumDvKms(plan.nodes);
    expect(dvKms).toBeGreaterThan(3.0);
    expect(dvKms).toBeLessThan(4.5);
    // …and it arrives: on the Halo within 50 km (aimed at 500 km, then the mid-course), its velocity matched
    const a = arrival(plan);
    console.log(
      `  LEO → SE-L2 Halo: ${dvKms.toFixed(2)} km/s, arrival ${a.missKm.toFixed(1)} km off, ${a.dvLeftMs.toFixed(3)} m/s left · ${plan.note}`,
    );
    expect(a.missKm).toBeLessThan(50);
    expect(a.dvLeftMs).toBeLessThan(1);
    expect(plan.note).toContain("A_z 260,000 km");
  });

  test("at the present date (2026-11-24): LEO → Sun–Earth L2 Halo, the same Δv and arrival", () => {
    const now = (Date.UTC(2026, 10, 24) - EPOCH_DATE) / 1000 / M_SECONDS;
    const leo = ourOrbitPose({ body: "earth", altKm: 400, inc: 28.5 }, now);
    const plan = planOurTransfer(leo.X, leo.vel, now, goal("lag:earth:2", "halo"), opts);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    const dvKms = sumDvKms(plan.nodes);
    const a = arrival(plan);
    console.log(
      `  2026-11-24 LEO → SE-L2 Halo: ${dvKms.toFixed(2)} km/s, arrival ${a.missKm.toFixed(1)} km off, ${a.dvLeftMs.toFixed(3)} m/s left`,
    );
    expect(dvKms).toBeGreaterThan(3.0);
    expect(dvKms).toBeLessThan(4.5);
    expect(a.missKm).toBeLessThan(50);
    expect(a.dvLeftMs).toBeLessThan(1);
  });

  test("an amplitude beyond the point's orbits: flown at the range's edge, the note says both", () => {
    const leo = ourOrbitPose({ body: "earth", altKm: 300 }, 0);
    const plan = planOurTransfer(leo.X, leo.vel, 0, { ...goal("lag:moon:2", "halo"), altM: 900_000e3 }, opts);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.note).toContain("asked 900,000 km");
    expect(plan.mission.goal.altM).toBeLessThan(900_000e3);
  });

  test("plans Earth LEO → Earth–Moon L2 Halo orbit & Earth–Moon L4 station-keeping", () => {
    const leo = ourOrbitPose({ body: "earth", altKm: 300 }, 0);
    const emL2 = planOurTransfer(leo.X, leo.vel, 0, goal("lag:moon:2", "halo"), opts);
    expect("error" in emL2).toBe(false);
    if (!("error" in emL2)) {
      expect(emL2.nodes.some((n) => n.role === "capture" && n.then === "orbit" && n.body === "lag:moon:2")).toBe(true);
      const dvEmL2 = sumDvKms(emL2.nodes);
      expect(dvEmL2).toBeGreaterThan(2.8);
      expect(dvEmL2).toBeLessThan(6.5);
      const a = arrival(emL2);
      console.log(
        `  LEO → EM-L2 Halo: ${dvEmL2.toFixed(2)} km/s, arrival ${a.missKm.toFixed(1)} km off, ${a.dvLeftMs.toFixed(3)} m/s left`,
      );
      expect(a.missKm).toBeLessThan(20);
      expect(a.dvLeftMs).toBeLessThan(1);
    }

    const emL4 = planOurTransfer(leo.X, leo.vel, 0, goal("lag:moon:4", "station"), opts);
    expect("error" in emL4).toBe(false);
    if (!("error" in emL4)) {
      expect(emL4.nodes.some((n) => n.role === "capture" && n.then === "keep" && n.body === "lag:moon:4")).toBe(true);
      const a = arrival(emL4);
      expect(a.missKm).toBeLessThan(20);
      expect(a.dvLeftMs).toBeLessThan(1);
    }
  });

  test("plans Earth LEO → JWST rendezvous at Sun–Earth L2", () => {
    const leo = ourOrbitPose({ body: "earth", altKm: 400 }, 0);
    const jwstPlan = planOurTransfer(leo.X, leo.vel, 0, goal("jwst", "halo"), opts);
    expect("error" in jwstPlan).toBe(false);
    if ("error" in jwstPlan) return;
    const cap = jwstPlan.nodes.find((n) => n.role === "capture");
    expect(cap).toBeTruthy();
    expect(cap!.then).toBe("keep");
    expect(cap!.body).toBe("jwst");
    // at the 200 m standoff on its mirror side (+Z: in front of the primary) within the station keeping's reach (5 km)
    const a = arrival(jwstPlan);
    console.log(`  LEO → JWST: arrival ${a.missKm.toFixed(2)} km off the standoff, ${a.dvLeftMs.toFixed(3)} m/s left`);
    expect(a.missKm).toBeLessThan(5);
    expect(a.dvLeftMs).toBeLessThan(1);
  });
});

describe("Network & Crew Console Lagrange / JWST integration", () => {
  test("readSpace preserves jwst vector & Lagrange target ids; readCrewCmd accepts halo & station missions", () => {
    const sp = readSpace({
      jwst: [1.51e8, 2.5e5, -2.6e5],
      target: { id: "lag:earth:2", name: "Sun–Earth L2", dist: 1500000, rate: -120, ca: 10000, caIn: 86400 },
    });
    expect(sp.jwst).toEqual([1.51e8, 2.5e5, -2.6e5]);
    expect(sp.target?.id).toBe("lag:earth:2");

    const cmdHalo = readCrewCmd({
      v: 1,
      id: "c1",
      to: 0,
      act: "sp.mission",
      args: { target: "lag:earth:2", arrival: "halo", execute: false },
    });
    expect(cmdHalo.ok).toBe(true);
    if (cmdHalo.ok) expect(cmdHalo.cmd.act).toBe("sp.mission");
    const cmdStation = readCrewCmd({
      v: 1,
      id: "c2",
      to: 0,
      act: "sp.mission",
      args: { target: "lag:moon:4", arrival: "station", execute: true },
    });
    expect(cmdStation.ok).toBe(true);
    const cmdTgt = readCrewCmd({ v: 1, id: "c3", to: 0, act: "sp.target", args: { name: "lag:earth:2" } });
    expect(cmdTgt.ok).toBe(true);
  });

  test("Crew Console 3D systemScene computes L1–L5 marks, 3D Halo loop, and JWST with zero simulator imports", () => {
    const MU_SUN = 1.32712440018e11;
    const MU_EARTH = 398600.4418;
    const AU = 1.495978707e8;
    const vc = (mu: number, r: number) => Math.sqrt(mu / r);
    const snap: InstrumentSnapshot = {
      v: 1,
      t: 0,
      body: "earth",
      metrics: {},
      geo: null,
      radar: null,
      route: [],
      ahead: [],
      bodies: [
        { id: "sun", r: [0, 0, 0], v: [0, 0, 0], mu: MU_SUN, radius: 696000, parent: "" },
        { id: "earth", r: [AU, 0, 0], v: [0, vc(MU_SUN, AU), 0], mu: MU_EARTH, radius: 6371, parent: "sun" },
        { id: "moon", r: [AU + 384400, 0, 0], v: [0, vc(MU_SUN, AU) + vc(MU_EARTH, 384400), 0], mu: 4902.8, radius: 1737, parent: "earth" },
      ],
      state: { body: "earth", r: [6771, 0, 0], v: [0, vc(MU_EARTH, 6771), 0], mu: MU_EARTH, radius: 6371, soi: 924000 },
      jwst: [AU + 1.5e6, 2e5, -2.6e5],
      target: { id: "lag:earth:2", name: "Sun–Earth L2", dist: 1.5e6, rate: 0, ca: NaN, caIn: NaN },
    };
    const scene = systemScene(snap, "body", 0)!;
    expect(scene).not.toBeNull();
    const lagMarks = scene.marks.filter((m) => m.kind === "lag-unstable" || m.kind === "lag-stable");
    // Sun–Earth L1–L5 + Earth–Moon L1–L5 = 10 Lagrange points
    expect(lagMarks.length).toBeGreaterThanOrEqual(10);
    expect(lagMarks.find((m) => m.id === "lag:earth:2")?.kind).toBe("lag-unstable");
    expect(lagMarks.find((m) => m.id === "lag:earth:4")?.kind).toBe("lag-stable");
    expect(lagMarks.find((m) => m.id === "lag:moon:2")?.kind).toBe("lag-unstable");
    expect(scene.marks.find((m) => m.kind === "jwst")?.id).toBe("jwst");
  });
});
