// The entry autopilot's flight recorder, the controller's side (entry-log.ts: the record): begun when the autopilot engages
// (entryRecordStart, piloting.ts entryStep), a sample each second of the flight's time — each half second low — from the frame loop
// (entryRecordStep, piloting.ts), on after the autopilot lets go at the touchdown, through the rollout, to the craft at rest; the
// autopilot's messages caught as they are said. `__bh.camera.entryLog`.

import { cameraFrame } from "../camera";
import type { CameraController } from "../controls";
import type { Site } from "../game/sites";
import { cartToGeodetic, flatteningOf } from "../system/ellipsoid";
import { gearHeight, groundVelocity, toBodyFixed } from "../system/our-surface";
import { solarBody } from "../system/solar";
import { EntryLog } from "./entry-log";
import { C_MPS } from "../units";

declare module "../controls" {
  interface CameraController {
    /** the entry autopilot's last flight's record (entry-log.ts) — null before the first engagement */
    entryLog: EntryLog | null;
    /** (the recorder's own: the flight's time at its engagement [s], its messages' hook, the rollout's last place and since when at rest) */
    entryRec?: {
      t0: number;
      prevSay: ((t: string) => void) | null;
      hook: (t: string) => void;
      still: number;
      lastAlong: number | null;
      lastT: number;
    };
  }
}

const Msec = (c: CameraController) => 4.925490947e-6 * c.s.massSolar;

/** The flight's time now [s] (the scene's clock), null off our side. */
function flightTime(c: CameraController): number | null {
  const nav = c.ourNav(cameraFrame(c.s));
  return nav ? nav.t * Msec(c) : null;
}

/** A new record: the autopilot engaged to a site (or none). */
export function entryRecordStart(c: CameraController, site: Site | null, handover: { mach: number; short: number }) {
  entryRecordStop(c, "engaged again");
  const L = new EntryLog();
  L.plan.site = site ? { name: site.name, lat: site.lat, lon: site.lon, rwy: site.rwy ?? null, runway: !!site.runway } : null;
  L.plan.handover = handover;
  c.entryLog = L;
  const t0 = flightTime(c) ?? 0;
  const prevSay = c.onPilotMessage ?? null;
  const hook = (m: string) => {
    if (!L.over) L.event((flightTime(c) ?? t0) - t0, /^Touchdown/.test(m) ? "touchdown" : "message", m);
    prevSay?.(m);
  };
  c.onPilotMessage = hook;
  c.entryRec = { t0, prevSay, hook, still: 0, lastAlong: null, lastT: -Infinity };
}

/** The record ended (why), its message hook taken off. */
export function entryRecordStop(c: CameraController, why: string) {
  const r = c.entryRec;
  if (!r) return;
  const L = c.entryLog;
  if (L && !L.over) L.end((flightTime(c) ?? r.t0) - r.t0, why);
  if (c.onPilotMessage === r.hook) c.onPilotMessage = r.prevSay ?? undefined;
  c.entryRec = undefined;
}

/** The deorbit as planned (piloting.ts planBurn): its burn's time [s of the scene], Δv, predicted peaks. */
export function entryRecordPlan(
  c: CameraController,
  p: { tBurn: number; dv: number; heat?: number; g?: number; shield?: number; reaimed: boolean },
) {
  const L = c.entryLog,
    r = c.entryRec;
  if (!L || !r) return;
  L.plan.deorbit = {
    tBurn: p.tBurn - r.t0,
    dv: p.dv,
    heat: p.heat !== undefined ? p.heat / 1e4 : null,
    g: p.g ?? null,
    shield: p.shield ?? null,
    reaimed: p.reaimed,
  };
}

/** A frame: a sample when one is due, the touchdown's and the rollout's figures, the end at rest or when the craft is lost. */
export function entryRecordStep(c: CameraController) {
  const L = c.entryLog,
    r = c.entryRec;
  if (!L || !r || L.over) return;
  const cam = cameraFrame(c.s);
  const nav = c.ourNav(cam);
  if (!nav) return;
  const tNow = nav.t * Msec(c);
  const t = tNow - r.t0;
  const R = c.entryRun;
  // (the craft lost — its limits passed —: the record ends there)
  const fail = c.airFlight.failure;
  if (fail) {
    L.event(t, "lost", fail);
    return entryRecordStop(c, "craft lost");
  }
  // (neither flying the entry nor rolling out of it: the pilot took it back, or another craft)
  const rolling = !R && (L.touchdown || L.events.some((e) => e.kind === "touchdown"));
  if (!R && !rolling) return entryRecordStop(c, "autopilot let go");
  const agl = Math.max(gearHeight(nav.ref, nav.X, nav.t), 0);
  const due = L.due(t, agl);
  const tdNew = !L.touchdown && L.events.some((e) => e.kind === "touchdown");
  // (the runway's frame — the approach's own while flying it; on the ground the runway's view): only when it is read
  let rw: { along: number; across: number } | null = null;
  if (rolling || tdNew || (due && !R?.app))
    try {
      const v = c.runwayView?.();
      if (v) rw = { along: v.along, across: v.across };
    } catch {
      rw = null;
    }
  // the touchdown's figures (its message caught by the hook)
  if (tdNew) {
    const td = L.events.find((e) => e.kind === "touchdown");
    if (td) {
      const LA = c.airFlight.last;
      L.touchdown = {
        t: td.t,
        along: rw?.along ?? R?.app?.along ?? 0,
        across: rw?.across ?? R?.app?.across ?? 0,
        // (the sink the touchdown said — its message, in the pilot's units: m/s when it says so —, else the last sample's)
        sink: (() => {
          const m = /([\d.]+) m\/s down/.exec(td.text);
          return m ? Number(m[1]) : -(L.samples.at(-1)?.vs ?? 0);
        })(),
        speed: LA?.speed ?? 0,
      };
    }
  }
  // (on the ground: at rest once it moves under 0.25 m/s along the runway for 2 s — the status's speed is against the Earth's centre)
  if (rolling && rw) {
    if (r.lastAlong !== null && t > r.lastT) {
      const gs = Math.abs(rw.along - r.lastAlong) / (t - r.lastT);
      r.still = gs < 0.25 ? r.still + (t - r.lastT) : 0;
    }
    r.lastAlong = rw.along;
    r.lastT = t;
    if (r.still >= 2) {
      L.stop = { along: rw.along, across: rw.across };
      L.event(t, "stopped", `${rw.along.toFixed(0)} m past the threshold, ${rw.across.toFixed(1)} m off the axis`);
      return entryRecordStop(c, "at rest");
    }
  }
  if (R?.dhCheck && !L.dh) L.dh = { ...R.dhCheck };
  if (R && R.phase === "entry" && L.dvFlown === null && R.done > 0) {
    L.dvFlown = R.done;
    L.burnAt = t;
  }
  if (!due) return;
  const q = toBodyFixed(nav.ref, nav.X, nav.t);
  const b = solarBody(nav.ref)!;
  const g = cartToGeodetic(b.radius, flatteningOf(nav.ref), q);
  const vg = groundVelocity(nav.ref, nav.X, nav.t);
  const vRel: [number, number, number] = [nav.V[0] - vg[0], nav.V[1] - vg[1], nav.V[2] - vg[2]];
  // (the state's velocities in c, its places in M: the speeds in m/s)
  const v = Math.hypot(...vRel) * C_MPS;
  const rr = Math.hypot(...nav.X);
  const vs = ((vRel[0] * nav.X[0] + vRel[1] * nav.X[1] + vRel[2] * nav.X[2]) / rr) * C_MPS;
  const LA = c.airFlight.last;
  const A = R?.app;
  L.add({
    t,
    phase: R ? R.phase : "rollout",
    leg: R?.phase === "glide" ? (R.leg ?? null) : null,
    lat: (g.lat * 180) / Math.PI,
    lon: (g.lon * 180) / Math.PI,
    h: g.h,
    agl,
    v,
    vAir: LA?.speed ?? null,
    mach: LA?.out.mach ?? null,
    vs,
    gamma: EntryLog.deg(A?.gam ?? Math.asin(Math.max(-1, Math.min(1, vs / Math.max(v, 1e-6))))),
    gRef: A?.gRef !== undefined ? EntryLog.deg(A.gRef) : null,
    alpha: EntryLog.deg(R?.alpha ?? LA?.out.alpha ?? 0),
    bank: EntryLog.deg(R?.bank ?? 0),
    bankFlown: R?.bankFlown !== undefined && R.phase === "entry" ? EntryLog.deg(R.bankFlown) : null,
    load: c.airFlight.g,
    q: LA?.out.q ?? null,
    heat: LA ? LA.out.heat / 1e4 : null,
    miss: R?.phase === "entry" && R.guid?.lastMiss ? { along: R.guid.lastMiss.along, across: R.guid.lastMiss.across } : null,
    app:
      A && R?.phase === "glide"
        ? { along: A.along, across: A.across, final: A.final, profH: R.prof?.h ?? null, hp: A.hp ?? null }
        : rw && !R
          ? { along: rw.along, across: rw.across, final: true, profH: null, hp: agl }
          : null,
    energy: A?.energy && R?.phase === "glide" ? { e: A.energy.e, need: A.energy.need, toGo: A.energy.toGo, low: A.energy.low } : null,
    airBrake: c.airBrake ?? 0,
    throttle: c.pilot.throttle ?? 0,
    warp: c.s.timeSpeed * Msec(c),
  });
}
