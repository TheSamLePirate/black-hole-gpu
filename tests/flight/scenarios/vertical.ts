// Vertical flight: the powered landings (the landing autopilot, G — from a hover, from a low orbit; the
// Lander's entries ending on its engines), the take-offs to orbit (U, the launch's goal: its height and
// inclination; then the circularization) and the hover's hold — each judged on its arrival and on how
// well it flew: the touchdown's sink rate and drift, upright, on its pad, no bounce; the orbit's height and
// plane against the goal, the Δv against an impulsive ascent's, the throttle's calm, the corridor held.
import type { Lab } from "../lib/lab";
import { engage, said, scene, type Scenario, type Verdict } from "./helpers";

// ---------------------------------------------------------------------------------------------- the places

interface Pad {
  body: string;
  name: string;
  lat: number;
  lon: number;
}
const TRANQUILITY: Pad = { body: "moon", name: "Tranquility Base", lat: 0.674, lon: 23.473 };
const SHACKLETON: Pad = { body: "moon", name: "Shackleton crater's rim", lat: -89.5, lon: 0 };
const JEZERO: Pad = { body: "mars", name: "Jezero crater", lat: 18.44, lon: 77.45 };
const GALE: Pad = { body: "mars", name: "Gale crater", lat: -5.4, lon: 137.8 };
const HUYGENS: Pad = { body: "titan", name: "Huygens' landing site", lat: -10.25, lon: 192.32 };
const KSC: Pad = { body: "earth", name: "Kennedy Space Center, Shuttle Landing Facility", lat: 28.615, lon: -80.695 };

/** μ [km³/s²] and the mean radius [km] (the impulsive ascent's reference). */
const MU: Record<string, [number, number]> = {
  earth: [398600.4418, 6378.137],
  moon: [4902.8, 1737.4],
  mars: [42828.37, 3389.5],
};

/**
 * The least Δv to a circular orbit `altKm` up from the ground [m/s]: an impulsive kick onto the ellipse
 * from the surface to it, its circularization — the ground's own east speed `vRot` [m/s] taken off.
 */
export function impulsiveAscent(body: string, altKm: number, vRot = 0) {
  const [mu, R] = MU[body]!;
  const r2 = R + altKm;
  const vp = Math.sqrt((mu * 2 * r2) / (R * (R + r2)));
  const va = (vp * R) / r2;
  return (vp - vRot / 1e3 + Math.sqrt(mu / r2) - va) * 1e3;
}

// ---------------------------------------------------------------------------------------------- page side

/** The place the craft stands on now (landed): its distance to a pad [m], the body's radius used. */
const STANDING = (p: Pad) => `(() => {
  const c = __bh.camera, L = c.ourLanded;
  if (!L) return null;
  const q = L.q, f = L.body === "earth" ? 1 / 298.257223563 : 0;
  const lat = Math.atan2(q[2], (1 - f) ** 2 * Math.hypot(q[0], q[1])), lon = Math.atan2(q[1], q[0]);
  const D = Math.PI / 180, la = ${p.lat} * D, lo = ${p.lon} * D;
  const R = Math.hypot(...q) * 1476.625 * __bh.settings.massSolar;
  const h = Math.sin((lat - la) / 2) ** 2 + Math.cos(lat) * Math.cos(la) * Math.sin((lon - lo) / 2) ** 2;
  return { body: L.body, lat: lat / D, lon: lon / D, distM: 2 * R * Math.asin(Math.min(1, Math.sqrt(h))) };
})()`;

/**
 * A Δv meter (the scenes fly without a propellant gauge — the craft's `spent` stays 0): the engine's proper
 * acceleration (pilot.accel [c²/M]) times the simulated time between samples — the lab samples every step —,
 * in m/s, read with DV_READ.
 */
const DV_METER = `(() => {
  const L = window.__lab, f = L.sample, k = 299792458 ** 2 / (1476.625 * __bh.settings.massSolar);
  let last = null;
  window.__dv = 0;
  L.sample = () => { const T = f(); if (last !== null && T.t > last) window.__dv += __bh.camera.pilot.accel * k * (T.t - last); last = T.t; return T; };
  return true;
})()`;
const DV_READ = "window.__dv ?? null";

/** The craft's up axis against the local vertical [°] (its tilt), read from the camera's ship axes. */
const TILT = `(() => { const a = __bh.camera.attitudeNow(); return a && a.pitch !== undefined ? { pitch: a.pitch * 180 / Math.PI, bank: a.bank * 180 / Math.PI } : null; })()`;

// ---------------------------------------------------------------------------------------------- the judges

/** Down: the autopilot done, on the ground — standing, or on its gear still settling (the Lander on Earth
 *  in a breeze never reads as standing: noted in `standing`) —, not falling. */
const DOWN = "T.auto === 'none' && (T.landed || T.rolling) && Math.abs(T.vz ?? 0) < 0.2";

/** AAA's touchdown: ≤ 1.5 m/s down, ≤ 0.5 m/s across, on its pad (`padM`), one contact. */
async function judgeTouchdown(lab: Lab, pad: Pad | null, padM: number, e: { end: string; why: string }): Promise<Verdict> {
  const td = said(lab, /Touchdown|Hard landing|Landed on .* · /);
  const vn = Number(/([\d.]+) m\/s down/.exec(td ?? "")?.[1] ?? /· ([\d.]+) m\/s/.exec(td ?? "")?.[1] ?? Number.NaN);
  const vh = Number(/([\d.]+) m\/s along/.exec(td ?? "")?.[1] ?? Number.NaN);
  const contacts = lab.events.filter((x) => x.kind === "pilot" && /Touchdown|Hard landing|Airborne/.test(x.text)).length;
  const at = pad ? await lab.js<{ distM: number; lat: number; lon: number } | null>(STANDING(pad)) : null;
  const tilt = await lab.js<{ pitch: number; bank: number } | null>(TILT);
  const okPad = !pad || (at !== null && at.distM <= padM);
  const ok = e.end === "until" && (lab.T.landed || lab.T.rolling) && vn <= 1.5 && !(vh > 0.5) && contacts <= 1 && okPad;
  return {
    ok,
    why: `${e.why} · ${td ?? "no touchdown said"}${at ? ` · ${Math.round(at.distM)} m from ${pad!.name}` : ""}`,
    metrics: {
      sinkMps: vn,
      driftMps: vh,
      dvMps: Math.round((await lab.js<number | null>(DV_READ)) ?? Number.NaN),
      contacts,
      padM: at ? Math.round(at.distM) : null,
      pitchDeg: tilt?.pitch,
      bankDeg: tilt?.bank,
      standing: lab.T.landed,
      simS: lab.T.t,
    },
  };
}

/** A take-off judged once circular: the orbit against the goal, the plane, the Δv against an impulsive ascent's. */
async function judgeAscent(lab: Lab, body: string, altKm: number, incDeg: number | null, dvRef: number, e: { end: string; why: string }) {
  const inOrbit = said(lab, /In orbit around/);
  const circ = said(lab, /Circular/);
  const o = lab.T.orbit;
  const incErr = incDeg !== null && o ? Math.abs(o.inc - incDeg) : null;
  const dv = (await lab.js<number | null>(DV_READ)) ?? Number.NaN;
  // (the height of the circle: its semi-major axis over the equator's radius — the Earth's pe and ap are
  // geodetic, a circle's 5 km apart over its ellipsoid at 28°)
  const st = await lab.js<{ aKm: number; radiusKm: number; ecc: number } | null>(
    "(() => { const o = __bh.game.status().orbit; return o && { aKm: o.aKm, radiusKm: o.radiusKm, ecc: o.ecc }; })()",
  );
  const altErr = st ? Math.abs(st.aKm - MU[body]![1] - altKm) : Number.NaN;
  const ok = e.end === "until" && !!inOrbit && !!circ && altErr <= 5 && (st?.ecc ?? 1) < 0.002 && (incErr === null || incErr <= 0.1);
  return {
    ok,
    why: `${e.why} · ${inOrbit ?? "never in orbit"} · ${circ ?? "not circularized"} · ${o ? `${o.pe} × ${o.ap} km, i ${o.inc}°` : "no orbit"}`,
    metrics: {
      peKm: o?.pe,
      apKm: o?.ap,
      altKm: st ? Math.round((st.aKm - MU[body]![1]) * 10) / 10 : null,
      ecc: st?.ecc,
      altErrKm: Math.round(altErr * 10) / 10,
      incDeg: o?.inc,
      incErrDeg: incErr,
      dvMps: Math.round(dv),
      dvRefMps: Math.round(dvRef),
      dvOverRefPct: Math.round((100 * dv) / dvRef - 100),
      simS: lab.T.t,
      body,
    },
  };
}

// ---------------------------------------------------------------------------------------------- the flights

/** The landing autopilot from where the craft is, to a stop on the ground. */
async function landFromHere(lab: Lab, maxSim: number, maxWall: number) {
  await lab.js(DV_METER);
  await engage(lab, "land");
  return lab.fixed({ until: DOWN, maxSim, maxWall });
}

function hoverLand(id: string, pad: Pad, altKm: number, minutes = 3): Scenario {
  return {
    id,
    title: `${pad.name} — the landing autopilot from a hover ${altKm} km over it`,
    tags: ["vertical", "landing", pad.body, "ranger", "hover"],
    minutes,
    async run(lab) {
      await lab.js(`(__bh.game.hoverOver(${JSON.stringify(pad.body)}, ${pad.lat}, ${pad.lon}, ${altKm}), true)`);
      await Bun.sleep(300);
      const e = await landFromHere(lab, 900, 400);
      return judgeTouchdown(lab, pad, 10, e);
    },
  };
}

function orbitLand(id: string, pad: Pad, altKm: number, minutes = 6): Scenario {
  return {
    id,
    title: `${pad.name} — a powered descent to it (⇧G: no air) from a ${altKm} km orbit passing over it`,
    tags: ["vertical", "landing", "deorbit", pad.body, "ranger"],
    minutes,
    async run(lab) {
      // (the orbit passing over the pad now: its descent orbit half a turn before the braking, nearly a
      // turn on)
      await lab.js(
        `(__bh.game.orbitOver(${JSON.stringify(pad.body)}, ${pad.lat}, ${pad.lon}, { altKm: ${altKm}, inc: ${Math.abs(pad.lat) > 80 ? 90 : 5} }), true)`,
      );
      await Bun.sleep(300);
      await lab.js(`(__bh.camera.entrySite = ${JSON.stringify({ body: pad.body, name: pad.name, lat: pad.lat, lon: pad.lon })}, true)`);
      await lab.js(DV_METER);
      await engage(lab, "entry");
      const e = await lab.fixed({ until: DOWN, maxSim: 4 * 3600, maxWall: 600 });
      return judgeTouchdown(lab, pad, 30, e);
    },
  };
}

function takeoff(
  id: string,
  title: string,
  o: {
    body: string;
    place: () => (lab: Lab) => Promise<void>;
    altKm: number;
    incDeg: number | null;
    vRot?: number;
    minutes: number;
    tags?: string[];
  },
): Scenario {
  return {
    id,
    title,
    tags: ["vertical", "takeoff", "ascent", o.body, ...(o.tags ?? ["ranger"])],
    minutes: o.minutes,
    async run(lab) {
      await o.place()(lab);
      await lab.js(`(__bh.camera.launchGoal = { altKm: ${o.altKm}, incDeg: ${o.incDeg} }, true)`);
      await lab.js(DV_METER);
      await engage(lab, "takeoff");
      const e = await lab.fixed({ until: "T.auto === 'none' && !T.landed && !!T.orbit", maxSim: 6 * 3600, maxWall: 900 });
      return judgeAscent(lab, o.body, o.altKm, o.incDeg, impulsiveAscent(o.body, o.altKm, o.vRot ?? 0), e);
    },
  };
}

const landAt = (p: Pad) => () => async (lab: Lab) => {
  await lab.js(`(__bh.game.land(${JSON.stringify(p.body)}, ${p.lat}, ${p.lon}), true)`);
  await Bun.sleep(300);
};

/** The Lander the flown craft: the fleet's scene (the Lander 500 km over the Earth — the other craft have
 *  none of it elsewhere), from where the placements move it. */
async function lander(lab: Lab) {
  await scene(lab, "Earth: the Lander, 500 km up");
  const v = await lab.js<string>("__bh.settings.vessel");
  if (v !== "lander") throw new Error(`the Lander not flown (${v})`);
}

/** The Lander's entry from orbit to a site, its engines landing it once slow. */
function landerEntry(id: string, pad: Pad, setup: (lab: Lab) => Promise<void>, minutes: number, padM = 2000): Scenario {
  return {
    id,
    title: `Lander — entry to ${pad.name}, landed on its engines`,
    tags: ["vertical", "landing", "entry", "lander", pad.body],
    minutes,
    async run(lab) {
      await setup(lab);
      await lab.js(`(__bh.camera.entrySite = ${JSON.stringify({ body: pad.body, name: pad.name, lat: pad.lat, lon: pad.lon })}, true)`);
      await lab.js(DV_METER);
      await engage(lab, "entry");
      const e = await lab.fixed({
        until: DOWN,
        maxSim: 20 * 3600,
        maxWall: 900,
      });
      return judgeTouchdown(lab, pad, padM, e);
    },
  };
}

export const VERTICAL: Scenario[] = [
  hoverLand("moon-hover-tranquility", TRANQUILITY, 1.5),
  hoverLand("moon-hover-shackleton", SHACKLETON, 1.5),
  orbitLand("moon-orbit-tranquility", TRANQUILITY, 50),
  orbitLand("moon-orbit-shackleton", SHACKLETON, 50),
  {
    id: "moon-hover-hold",
    title: "Moon — the hover autopilot's hold 1.5 km over Tranquility, two minutes",
    tags: ["vertical", "hover", "moon", "ranger"],
    minutes: 2,
    async run(lab) {
      await lab.js(`(__bh.game.hoverOver("moon", ${TRANQUILITY.lat}, ${TRANQUILITY.lon}, 1.5), true)`);
      await Bun.sleep(300);
      const e = await lab.fixed({ until: "T.t > 1e12", maxSim: 120, maxWall: 200 });
      const n = await lab.js<{ off: number; drift: number } | null>(
        "__bh.camera.hubNote && { off: __bh.camera.hubNote.off, drift: __bh.camera.hubNote.drift }",
      );
      // (over the pad still: the place under the craft, by a landing at once — its distance)
      const ok = e.end === "cap" && !!n && n.off < 5 && n.drift < 0.2 && lab.T.auto === "hover";
      return {
        ok,
        why: `${e.why} · off ${n?.off?.toFixed(2)} m, drift ${n?.drift?.toFixed(3)} m/s`,
        metrics: { offM: n?.off, driftMps: n?.drift, altKm: lab.T.alt },
      };
    },
  },
  takeoff("moon-takeoff-tranquility", "Moon — take-off from Tranquility to a 100 km orbit, equatorial", {
    body: "moon",
    place: landAt(TRANQUILITY),
    altKm: 100,
    incDeg: 1,
    minutes: 5,
  }),
  takeoff("moon-takeoff-plains-30", "Moon — take-off from the plains (the scene) to 50 km, inclined 30°", {
    body: "moon",
    place: () => async (lab) => {
      await scene(lab, "Moon: an afternoon on the plains");
    },
    altKm: 50,
    incDeg: 30,
    minutes: 5,
  }),
  takeoff("earth-ascent-ksc-28", "Ranger — Kennedy's pad to a 300 km orbit, 28.5°", {
    body: "earth",
    place: () => async (lab) => {
      await scene(lab, "game:interstellar", Date.UTC(2067, 0, 1, 15));
    },
    altKm: 300,
    incDeg: 28.5,
    vRot: 408,
    minutes: 10,
  }),
  takeoff("earth-ascent-ksc-51", "Ranger — Kennedy's pad to a 300 km orbit, 51.6° (the station's plane)", {
    body: "earth",
    place: () => async (lab) => {
      await scene(lab, "game:interstellar", Date.UTC(2067, 0, 1, 15));
    },
    altKm: 300,
    incDeg: 51.6,
    vRot: 289,
    minutes: 10,
  }),
  takeoff("lander-moon-takeoff", "Lander — take-off from Tranquility to a 100 km orbit", {
    body: "moon",
    place: () => async (lab) => {
      await lander(lab);
      await landAt(TRANQUILITY)()(lab);
    },
    altKm: 100,
    incDeg: 1,
    minutes: 5,
    tags: ["lander"],
  }),
  takeoff("lander-mars-takeoff", "Lander — take-off from Jezero to a 250 km orbit", {
    body: "mars",
    place: () => async (lab) => {
      await lander(lab);
      await landAt(JEZERO)()(lab);
    },
    altKm: 250,
    incDeg: 25,
    vRot: 228,
    minutes: 8,
    tags: ["lander"],
  }),
  landerEntry(
    "lander-earth-entry-ksc",
    KSC,
    async (lab) => {
      await lander(lab);
    },
    12,
  ),
  landerEntry(
    "lander-mars-jezero",
    JEZERO,
    async (lab) => {
      await lander(lab);
      await lab.js(`(__bh.game.orbitOver("mars", ${JEZERO.lat - 25}, ${JEZERO.lon - 60}, { altKm: 250, inc: 25 }), true)`);
    },
    10,
  ),
  landerEntry(
    "lander-mars-gale",
    GALE,
    async (lab) => {
      await lander(lab);
      await lab.js(`(__bh.game.orbitOver("mars", ${GALE.lat}, ${GALE.lon - 60}, { altKm: 250, inc: 10 }), true)`);
    },
    10,
  ),
  landerEntry(
    "lander-titan-huygens",
    HUYGENS,
    async (lab) => {
      await lander(lab);
      await lab.js(`(__bh.game.orbitOver("titan", ${HUYGENS.lat}, ${HUYGENS.lon - 60}, { altKm: 1500, inc: 15 }), true)`);
    },
    12,
  ),
];
