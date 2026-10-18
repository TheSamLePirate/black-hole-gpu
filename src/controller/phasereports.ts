// A spacecraft's phases reported (PLAN-VAISSEAUX X8 — game/report.ts): watched each frame, each phase's report given
// as it ends — the ascent once in orbit (its efficiency), the insertion as CIRC lets go (its precision), the
// rendezvous within a kilometre of its target (its Δv, its time), the entry once down (its corridor). The landing's
// and the docking's own reports stay where they were (motion.ts, docking.ts).

import { cameraFrame } from "../camera";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import { gradeAscent, gradeEntry, gradeInsertion, gradeRendezvous } from "../game/report";
import type { RangerStatus } from "../game/status";
import { type RecKey, recorder } from "../game/recorder";
import { t as tr } from "../i18n";
import { solarBody } from "../system/solar";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { wgs84Inverse } from "../system/ellipsoid";

declare module "../controls" {
  interface CameraController {
    phaseReportStep: typeof phaseReportStep;
    phaseRep: PhaseRep;
  }
}

interface PhaseRep {
  /** an ascent under way: since when [s of the scene], the Δv spent then [m/s], the body, its greatest load */
  ascent: { t0: number; spent0: number; body: string; gMax: number; lat: number } | null;
  /** a rendezvous: since when, the Δv then, its target, the plan's Δv then (the least, as a mark) */
  rdv: { t0: number; spent0: number; target: string; ideal: number | null } | null;
  /** an entry: since when, its greatest load and heat flux, the body, the site aimed at */
  entry: { t0: number; gMax: number; heatMax: number; body: string; site: { name: string; lat: number; lon: number } | null } | null;
  /** CIRC flying (or the take-off): the orbit's height it aims at [km] (CIRC: its apoapsis when it began; the
   *  take-off: its launch goal), the inclination (null: any), which autopilot */
  circ: { aimKm: number; aimInc: number | null; body: string; from: string } | null;
  landed: boolean;
  auto: string;
}

/** the heights an orbit must clear to be one: above the air (the Earth's 100 km), else 5 km over the ground */
const safeKm = (body: string) => (body === "earth" ? 100 : body === "mars" ? 60 : body === "venus" ? 150 : 5);

/** The least Δv from the ground to an orbit of semi-major axis a [m] (the energies apart; the ground's turn given). */
export function idealAscent(body: string, aM: number, lat: number): number {
  const B = solarBody(body);
  if (!B) return Number.NaN;
  const mu = B.mass * M_METRES * C_MPS * C_MPS;
  const R = B.radius * M_METRES;
  const vRot = B.rotation ? (2 * Math.PI * R * Math.cos((lat * Math.PI) / 180)) / (Math.abs(B.rotation) * 3600) : 0;
  const dE = -mu / (2 * aM) - (-mu / R + (vRot * vRot) / 2);
  return dE > 0 ? Math.sqrt(2 * dE) : Number.NaN;
}

/** A channel's curve since a time [s of the scene], thinned to 60 points (the debrief's). */
function curveOf(key: RecKey, t0: number, k = 1): [number, number][] {
  const S = recorder.samples.filter((q) => q.t >= t0 - 1);
  const step = Math.max(1, Math.ceil(S.length / 60));
  return S.filter((_, i) => i % step === 0)
    .map((q) => [Math.round(q.t - t0), (q[key] as number | null | undefined) ?? Number.NaN] as [number, number])
    .filter((p) => Number.isFinite(p[1]))
    .map(([x, y]) => [x, y * k] as [number, number]);
}

/** One frame's watch (main.ts each frame, with the flight's status; a spacecraft's only). */
function phaseReportStep(this: CameraController, st: RangerStatus | null) {
  const P = (this.phaseRep ??= { ascent: null, rdv: null, entry: null, circ: null, landed: false, auto: "none" });
  if (fleet.active === "f35" || !this.piloting || cameraFrame(this.s).region === "hole") return;
  const report = (r: NonNullable<Parameters<NonNullable<CameraController["onFlightReport"]>>[0]>, curve?: NonNullable<typeof r.curve>) =>
    this.onFlightReport?.(curve && curve.pts.length > 2 ? { ...r, curve } : r);
  const t = this.nowTime() * M_SECONDS;
  const spent = this.spent * C_MPS;
  const air = this.airInfo();
  const landed = !!(this.ourLanded || this.rolling);
  const g = this.geoNow();
  const body = st?.soi ?? "";
  // the ascent: off the ground, until an orbit clear of the air
  if (P.landed && !landed && body) P.ascent = { t0: t, spent0: spent, body, gMax: 0, lat: g?.lat ?? 0 };
  if (P.ascent) {
    P.ascent.gMax = Math.max(P.ascent.gMax, Math.abs(air.g || 0));
    const o = st?.orbit;
    if (landed || body !== P.ascent.body) P.ascent = null;
    else if (o && o.ecc < 1 && o.peKm > safeKm(body)) {
      const A = P.ascent;
      report(
        gradeAscent({
          body: st!.soiName,
          dv: spent - A.spent0,
          ideal: idealAscent(body, o.aKm * 1000, A.lat),
          peKm: o.peKm,
          apKm: o.apKm,
          flightS: t - A.t0,
          gMax: A.gMax,
        }),
        { title: tr("Altitude"), unit: "km", pts: curveOf("alt", A.t0, 1e-3) },
      );
      P.ascent = null;
    }
  }
  // the insertion: CIRC begun (its aim: the apoapsis then), its report as it lets go in orbit
  const auto = this.pilot.auto;
  // (and the take-off's own: it circularizes itself — its launch goal the aim)
  if (auto === "circularize" && P.auto !== "circularize" && st?.orbit && !P.circ)
    P.circ = { aimKm: st.orbit.apKm, aimInc: null, body, from: "circularize" };
  if (auto === "takeoff" && P.auto !== "takeoff" && this.launchGoal)
    P.circ = { aimKm: this.launchGoal.altKm ?? st?.orbit?.apKm ?? 100, aimInc: this.launchGoal.incDeg ?? null, body, from: "takeoff" };
  // (the take-off hands over to its own burns: its insertion judged once all of it is done)
  if (P.circ && (P.circ.from === "takeoff" ? auto === "none" : auto !== P.circ.from)) {
    const o = st?.orbit;
    if (o && o.ecc < 1 && body === P.circ.body)
      report(
        gradeInsertion({ body: st!.soiName, peKm: o.peKm, apKm: o.apKm, incDeg: o.incDeg, aimKm: P.circ.aimKm, aimInc: P.circ.aimInc }),
      );
    P.circ = null;
  }
  // the rendezvous: the docking autopilot begun beyond 3 km of its target, its report within 1 km
  const tg = st?.target;
  if (auto === "dock" && P.auto !== "dock" && tg && tg.distKm > 3) {
    const plan = this.plan.nodes.reduce((a, n) => a + Math.hypot(...n.dv), 0) * C_MPS;
    P.rdv = { t0: t, spent0: spent, target: tg.name, ideal: plan > 0 ? plan : null };
  }
  if (P.rdv) {
    if (!tg || auto === "none") P.rdv = null;
    else if (tg.distKm < 1) {
      report(gradeRendezvous({ target: P.rdv.target, dv: spent - P.rdv.spent0, ideal: P.rdv.ideal, flightS: t - P.rdv.t0 }), {
        title: tr("Δv spent"),
        unit: "m/s",
        pts: curveOf("dv", P.rdv.t0).map(([x, y]) => [x, y - (P.rdv?.spent0 ?? 0)] as [number, number]),
      });
      P.rdv = null;
    }
  }
  // the entry: into the air fast (from space), its corridor, its report once down
  if (!P.entry && air.inAir && air.speed > 3000 && body) {
    const site = this.entryRun?.site ?? null;
    P.entry = { t0: t, gMax: 0, heatMax: 0, body, site: site ? { name: site.name, lat: site.lat, lon: site.lon } : null };
  }
  if (P.entry) {
    P.entry.gMax = Math.max(P.entry.gMax, Math.abs(air.g || 0));
    P.entry.heatMax = Math.max(P.entry.heatMax, air.heat || 0);
    if (landed) {
      const E = P.entry;
      const missM = E.site && g ? wgs84Inverse(g.lat, g.lon, E.site.lat, E.site.lon).d : null;
      report(
        gradeEntry({ body: st?.soiName ?? E.body, site: E.site?.name ?? null, gMax: E.gMax, heatMax: E.heatMax, missM, flightS: t - E.t0 }),
        {
          title: tr("Load"),
          unit: "g",
          pts: curveOf("g", E.t0),
        },
      );
      P.entry = null;
    } else if (!air.inAir && air.speed > 3000) P.entry = null; // (skipped back out: no entry)
  }
  P.landed = landed;
  P.auto = auto;
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installPhaseReports(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { phaseReportStep });
}
