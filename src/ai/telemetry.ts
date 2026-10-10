// What TARS knows of the flight (PLAN-TARS-AGENT B2): everything the cockpit and the hub know, in figures he can
// read — the attitude (pitch, bank, heading, angle of attack, sideslip, flight path), the air (q, Mach, heat,
// load, skin temperatures and their margins), the controls (throttle, the surfaces' deflection, flaps, brake,
// gear), what each autopilot commands now (the director, the entry's commanded bank and angle of attack, its
// corridor, the approach's profile and PAPI, the powered descent's command, the burn's cue and residual,
// the docking's offsets), the hub's card (its step, its rows, the next, its graph's verdict). Read from the
// controller each call; degrees, metres, m/s, seconds. And a sampler of his own channels (the attitude and
// the commands over time) for his charts.

import type { CameraController } from "../controls";

const deg = (r: unknown) => (typeof r === "number" && Number.isFinite(r) ? Math.round(((r * 180) / Math.PI) * 10) / 10 : undefined);
const n = (v: unknown, d = 1) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : undefined);

export const TELEMETRY_GROUPS = [
  "attitude",
  "air",
  "controls",
  "autopilot",
  "hub",
  "entry",
  "approach",
  "descent",
  "burn",
  "dock",
  "sky",
] as const;
export type TelemetryGroup = (typeof TELEMETRY_GROUPS)[number];

// biome-ignore lint/suspicious/noExplicitAny: the controller's state, read loosely (each piece optional)
type Loose = any;

export function telemetry(camera: CameraController, groups: readonly TelemetryGroup[] = TELEMETRY_GROUPS) {
  const c = camera as Loose;
  const air: Loose = c.airInfo?.() ?? null;
  const out: Record<string, unknown> = {};
  const want = new Set(groups);
  if (want.has("attitude") && air)
    out.attitude = {
      pitchDeg: deg(air.pitch),
      bankDeg: deg(air.bank),
      headingDeg: deg(air.heading),
      aoaDeg: deg(air.alpha),
      sideslipDeg: deg(air.beta),
      stallAoaDeg: deg(air.stallA),
      bestAoaDeg: deg(air.bestA),
    };
  if (want.has("air") && air)
    out.air = {
      inAir: air.inAir,
      heightM: n(air.h, 0),
      airspeedMs: n(air.speed),
      mach: n(air.mach, 2),
      qPa: n(air.q, 0),
      heatWm2: n(air.heat, 0),
      g: n(air.g, 2),
      gPeak: n(air.gPeak, 2),
      shieldK: n(air.shield, 0),
      shieldMaxK: air.shieldMax,
      hullK: n(air.hull, 0),
      margins: air.margins,
      stalled: air.stalled,
      wind: air.wind,
      mode: air.mode,
    };
  if (want.has("controls")) {
    const p = c.pilot ?? {};
    out.controls = {
      throttleLever: n(p.throttle, 2),
      thrustNow: n(p.engineNow, 2),
      deflect: c.airFlight?.cfg?.deflect?.map((x: number) => n(x, 2)),
      flaps: c.airFlight?.cfg?.flaps,
      airBrake: n(c.airBrake, 2),
      gearDown: c.gearDown,
      gearExt: n(c.gearExt, 2),
      sas: p.sas,
      hold: p.hold,
      auto: p.auto,
      assist: p.assist,
      planeHolds: { gammaDeg: deg(p.gammaHold), aoaDeg: deg(p.alphaHold), bankDeg: deg(p.bankHold) },
    };
  }
  if (want.has("autopilot")) {
    const d = c.pilot?.director;
    out.autopilot = {
      mode: c.pilot?.auto,
      director: d ? { throttle: n(d.throttle, 2), align: n(d.align, 3), noseSet: !!d.nose } : null,
      sfCommand: c.sfCmd ? { speedMs: n(c.sfCmd.speed), gammaDeg: deg(c.sfCmd.gamma), headingDeg: deg(c.sfCmd.heading) } : null,
      launchGoal: c.launchGoal,
      transfer: c.transfer ? { stage: c.transfer.stage, note: c.transfer.note } : null,
    };
  }
  if (want.has("hub")) {
    const h = c.hubInfo?.();
    out.hub = h
      ? {
          title: h.title,
          step: h.phase,
          rows: h.rows,
          next: h.next,
          progress: n(h.bar, 2),
          cue: h.cue,
          callout: h.say,
          graph: h.graph ? { kind: h.graph.kind, verdict: h.graph.state, about: h.graph.about, fix: h.graph.fix } : null,
        }
      : null;
  }
  if (want.has("entry")) {
    const e = c.entryRun;
    const i = c.entryInfo?.();
    out.entry = e
      ? {
          phase: e.phase,
          site: e.site?.name,
          // (the bank commanded: the one flown — the guidance's, damped against the phugoid in the entry —; the
          // guidance's own; and the bank flown now about the velocity, the same angle)
          commandedBankDeg: deg(e.phase === "entry" ? (e.bankFlown ?? e.bank) : e.bank),
          guidanceBankDeg: deg(e.bank),
          flownBankDeg: deg(c.attitudeNow?.()?.velBank),
          commandedAoaDeg: deg(e.alpha),
          rangeToSiteKm: n((i?.range ?? Number.NaN) / 1e3),
          headingErrorDeg: deg(i?.dpsi),
          missM: n(e.guid?.lastMiss?.dist, 0),
          inCorridor: e.inCorr,
          planned: e.plan,
          deorbit: e.phase === "wait" || e.phase === "plan" || e.phase === "burn" ? { dvMs: n(e.dv), doneMs: n(e.done) } : undefined,
          reversal: e.rev,
        }
      : null;
  }
  if (want.has("approach")) {
    const r = c.runwayView?.();
    const e = c.entryRun;
    out.approach = r
      ? {
          runway: `${r.name} ${r.rwy}`,
          alongKm: n(r.along / 1e3, 2),
          acrossM: n(r.across, 0),
          aglM: n(r.agl, 0),
          final: r.final,
          papiWhite: r.papi,
          glidepathDeg: deg(r.gRef),
          flownPathDeg: deg(r.gam),
          speedMs: n(r.speed),
          flareInS: n(r.flareIn),
          wind: r.wind,
          mls: r.mls,
          leg: e?.leg,
          profilePhase: e?.prof?.phase,
          profileDeviationM: e?.app && e?.prof ? n(e.app.agl - e.prof.h, 0) : undefined,
          goAround: e?.ga?.phase,
        }
      : null;
  }
  if (want.has("descent")) {
    const l = c.landRun;
    const s = c.surfaceInfo?.();
    out.descent = {
      surface: s ? { altM: n(s.alt, 1), vVertMs: n(s.vVert, 2), vHorMs: n(s.vHor, 2), twr: n(s.twr, 2), landed: s.landed } : null,
      command: l?.cmd
        ? { vhMs: n(l.cmd.vh, 2), downMs: n(l.cmd.down, 2), distM: n(l.cmd.dist, 0), tGoS: n(l.cmd.tGo), braking: l.braking }
        : null,
      site: l?.site?.name,
    };
  }
  if (want.has("burn")) {
    const p = c.fcPlan?.();
    const h = c.hubInfo?.();
    out.burn = {
      plan: p
        ? {
            note: p.note,
            executing: p.executing,
            burns: p.burns.map((b: Loose) => ({ inS: n(b.t, 0), dvMs: n(Math.hypot(...b.dv)), label: b.label })),
          }
        : null,
      cue: h?.cue ?? null,
      burning: !!c.nodeBurning,
    };
  }
  // the sky where the camera stands (PLAN-CIEL C3, system/sky-now.ts): the Sun's and the Moon's heights, true
  // and as seen through the air, the refraction at the horizon
  if (want.has("sky")) out.sky = c.skyInfo?.() ?? null;
  if (want.has("dock")) {
    const d = c.flightInfo?.()?.dock;
    out.dock = d
      ? {
          rangeM: n(d.range, 1),
          alongM: n(d.along, 2),
          lateralM: n(d.lateral, 2),
          closingMs: n(d.closing, 3),
          angleDeg: n(d.angle, 1),
          docked: d.docked,
          phase: c.dockAuto?.phase,
        }
      : null;
  }
  return out;
}

/** His own channels (the attitude and the commands), sampled while flying: for his charts. */
export const TARS_CHANNELS = {
  bank: { label: { fr: "Inclinaison", en: "Bank" }, unit: "°" },
  pitch: { label: { fr: "Tangage", en: "Pitch" }, unit: "°" },
  heading: { label: { fr: "Cap", en: "Heading" }, unit: "°" },
  aoa: { label: { fr: "Incidence", en: "Angle of attack" }, unit: "°" },
  sideslip: { label: { fr: "Dérapage", en: "Sideslip" }, unit: "°" },
  cmdBank: { label: { fr: "Inclinaison commandée", en: "Commanded bank" }, unit: "°" },
  velBank: { label: { fr: "Inclinaison sur la vitesse", en: "Bank about the velocity" }, unit: "°" },
  cmdAoa: { label: { fr: "Incidence commandée", en: "Commanded AoA" }, unit: "°" },
  across: { label: { fr: "Écart latéral piste", en: "Runway offset" }, unit: "m" },
  profile: { label: { fr: "Écart au profil", en: "Profile deviation" }, unit: "m" },
} as const;
export type TarsChannel = keyof typeof TARS_CHANNELS;

export class AttitudeSampler {
  /** [t s, values] */
  samples: { t: number; v: Partial<Record<TarsChannel, number>> }[] = [];
  constructor(private max = 1200) {}

  sample(t: number, camera: CameraController) {
    const c = camera as Loose;
    const air = c.airInfo?.();
    const e = c.entryRun;
    const r = e?.app;
    const v: Partial<Record<TarsChannel, number>> = {
      bank: deg(air?.bank),
      pitch: deg(air?.pitch),
      heading: deg(air?.heading),
      aoa: deg(air?.alpha),
      sideslip: deg(air?.beta),
      cmdBank: deg(e ? (e.phase === "entry" ? (e.bankFlown ?? e.bank) : e.bank) : undefined),
      velBank: deg(c.attitudeNow?.()?.velBank),
      cmdAoa: deg(e?.alpha),
      across: r ? n(r.across, 0) : undefined,
      profile: r && e?.prof ? n(r.agl - e.prof.h, 0) : undefined,
    };
    const last = this.samples.at(-1);
    if (last && t < last.t) this.samples = [];
    this.samples.push({ t, v });
    if (this.samples.length > this.max) this.samples.splice(0, this.samples.length - this.max);
  }

  /** a channel over the last `seconds` (x: seconds ago) */
  series(ch: TarsChannel, seconds: number): [number, number][] {
    const now = this.samples.at(-1)?.t ?? 0;
    return this.samples.filter((s) => s.t >= now - seconds && s.v[ch] !== undefined).map((s) => [s.t - now, s.v[ch]!]);
  }
}
