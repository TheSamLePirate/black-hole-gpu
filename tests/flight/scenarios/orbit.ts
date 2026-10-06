// The orbital autopilots, flown and graded (docs/FLIGHTLAB.md): the CIRC autopilot from ellipses of every
// kind (a low periapsis, a high apoapsis, polar, retrograde, nearly circular already, about the Moon), a
// node executed (the planner's Hohmann), the approach that ends in orbit about the Moon, the orbit held,
// the warp under the pilot's authority, a craft switched mid-orbit. The circle is judged as flown: the
// radius's spread over a revolution afterwards (the Earth's J2 alone leaves ~2 km at 51.6°), its height
// against the apsis it was asked at, the Δv against the plan's.
//
// The family's page helpers live here (missions.ts and dock.ts use them too): the osculating elements
// from the flight computer's context, the radius's extremes tracked step by step.
import type { Lab } from "../lib/lab";
import { engage, said, scene, type Scenario, type Verdict } from "./helpers";

/** The page side: elements, the radius tracker (every fixed step), the docking geometry's last look. */
const PAGE = `(() => {
  if (window.__orb) return true;
  const c = __bh.camera, s = __bh.settings, C = 299792458;
  const el = () => {
    const f = c.fcContext();
    if (!f) return null;
    const x = f.ctx, r = Math.hypot(...x.r), v2 = x.v[0] ** 2 + x.v[1] ** 2 + x.v[2] ** 2;
    const h = [x.r[1] * x.v[2] - x.r[2] * x.v[1], x.r[2] * x.v[0] - x.r[0] * x.v[2], x.r[0] * x.v[1] - x.r[1] * x.v[0]];
    const hl = Math.hypot(...h), a = 1 / (2 / r - v2 / x.mu), e = Math.sqrt(Math.max(1 - (hl * hl) / (x.mu * a), 0));
    const z = x.pole ?? [0, 0, 1];
    const inc = (Math.acos(Math.max(-1, Math.min(1, (h[0] * z[0] + h[1] * z[1] + h[2] * z[2]) / hl))) * 180) / Math.PI;
    const k = (q) => Math.round(q / 100) / 10;
    return { body: f.body, rp: k(a * (1 - e) - x.R), ra: e < 1 ? k(a * (1 + e) - x.R) : null, r: k(r - x.R), inc: Math.round(inc * 1000) / 1000,
      ecc: Math.round(e * 1e6) / 1e6, aKm: k(a), period: e < 1 ? 2 * Math.PI * Math.sqrt(a ** 3 / x.mu) : null };
  };
  const track = { on: false, lo: Infinity, hi: -Infinity, body: null, burn: null };
  // (the impulsive Δv to the mean circle where the craft is — the J2's swing in: the ideal a burn there
  // can do no better than; geopotential.ts meanCircular, here on the flight computer's figures)
  const gain = () => {
    const f = c.fcContext();
    if (!f) return null;
    const x = f.ctx, J2 = { earth: 1.08262668e-3, moon: 2.033e-4, mars: 1.960454e-3, jupiter: 1.4696572e-2 }[f.body] ?? 0;
    const Rq = { earth: 6378137, moon: 1738000, mars: 3396190, jupiter: 71492000 }[f.body] ?? x.R;
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dt3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const un = (a) => { const l = Math.hypot(...a); return a.map((q) => q / l); };
    const r = Math.hypot(...x.r), rh = un(x.r), hn = un(cr(x.r, x.v)), z = x.pole ?? [0, 0, 1];
    const ci = dt3(hn, z), s2i = 1 - ci * ci;
    const nd = Math.hypot(...cr(z, hn)) > 1e-9 ? un(cr(z, hn)) : rh;
    const cu = dt3(rh, nd), su = dt3(rh, cr(hn, nd)), c2 = cu * cu - su * su, s2 = 2 * su * cu;
    const X = (J2 * Rq * Rq * s2i) / (4 * r), r0 = r - X * c2;
    const n = Math.sqrt((x.mu * (1 + 1.5 * J2 * (Rq / r0) ** 2 * (1 - 1.5 * s2i))) / r0 ** 3);
    const th = cr(hn, rh), vr = -2 * n * X * s2, vh = n * (r + X * c2);
    const w = [0, 1, 2].map((k) => rh[k] * vr + th[k] * vh - x.v[k]);
    return { dv: Math.hypot(...w), rKm: (r - x.R) / 1e3 };
  };
  const step = __bh.step;
  __bh.step = (dt) => {
    // (a node's burn: where, and the ideal there — taken before the step that lit it, since that step
    // already delivers up to half of the burn)
    const pre = !c.nodeBurning && !track.burn && c.pilot.auto !== "none" ? gain() : null;
    const out = step(dt);
    if (c.nodeBurning && !track.burn && pre) track.burn = pre;
    if (track.on) {
      const f = c.fcContext();
      if (f && f.body === track.body) {
        const r = (Math.hypot(...f.ctx.r) - f.ctx.R) / 1e3;
        track.lo = Math.min(track.lo, r);
        track.hi = Math.max(track.hi, r);
      }
    }
    return out;
  };
  // (the docking's last geometry, as the capture judged it)
  const dg = c.dockGeometry;
  let dock = null;
  c.dockGeometry = function (o) {
    const g = dg.call(this, o);
    if (g) dock = { range: g.range, along: g.along, lateral: g.lateral, angle: g.angle, closing: g.closing,
      speed: Math.hypot(...g.vrel), target: g.target, port: g.port };
    return g;
  };
  window.__orb = { el, track, gain, spent: () => c.spent * C, dock: () => dock };
  return true;
})()`;

export async function orbInstall(lab: Lab) {
  await lab.js(PAGE);
}

export interface El {
  body: string;
  rp: number;
  ra: number | null;
  r: number;
  inc: number;
  ecc: number;
  aKm: number;
  period: number | null;
}

/** The osculating orbit about the body of the sphere (heights over its mean radius) [km, °, s]. */
export const elements = (lab: Lab) => lab.js<El | null>("__orb.el()");
/** The propellant's Δv spent so far (the flown craft) [m/s]. */
export const spent = (lab: Lab) => lab.js<number>("__orb.spent()");

/**
 * The orbit flown for `revs` revolutions at a warp below the rails' (the full n-body pull, the zonal
 * harmonics): its lowest and highest heights over the mean radius, as flown [km].
 */
export async function flownSpread(lab: Lab, revs = 1, warp = 30) {
  const e = await elements(lab);
  if (!e?.period) return null;
  await lab.js(
    `(__orb.track.on = true, __orb.track.lo = Infinity, __orb.track.hi = -Infinity, __orb.track.body = ${JSON.stringify(e.body)}, __bh.game.warp(${warp}), true)`,
  );
  const t1 = (lab.T.t ?? 0) + revs * e.period;
  await lab.fixed({ until: `T.t >= ${t1}`, maxSim: revs * e.period + 60, maxWall: 300 });
  const tr = await lab.js<{ lo: number; hi: number }>("(__orb.track.on = false, { lo: __orb.track.lo, hi: __orb.track.hi })");
  return { lo: round(tr.lo, 10), hi: round(tr.hi, 10), spread: round(tr.hi - tr.lo, 100) };
}

export const round = (x: number, k = 100) => (Number.isFinite(x) ? Math.round(x * k) / k : x);
/** A number in a pilot's message (the first match of `re`'s group). */
export const num = (s: string | null, re: RegExp) => Number(re.exec(s ?? "")?.[1] ?? Number.NaN);

/**
 * The CIRC autopilot from a placed orbit: the plan said (where, how much), flown to "Circular", then a
 * revolution flown to measure the circle. Judged: the circle's spread, its height against the apsis
 * planned, the Δv against the plan's (a few % over at most), the trim's share.
 */
function circ(
  id: string,
  title: string,
  body: string,
  place: Record<string, unknown>,
  o: { spreadKm?: number; heightKm?: number; dvPct?: number; tags?: string[]; maxSim?: number; target?: string } = {},
): Scenario {
  return {
    id,
    title,
    tags: ["orbit", "circularize", "ranger", ...(o.tags ?? [])],
    minutes: 4,
    async run(lab) {
      await lab.js(`(__bh.game.orbit(${JSON.stringify(body)}, ${JSON.stringify(place)}), true)`);
      await Bun.sleep(300);
      await orbInstall(lab);
      const e0 = await elements(lab);
      const sp0 = await spent(lab);
      const g0 = await lab.js<{ dv: number; rKm: number }>("(__orb.track.burn = null, __orb.gain())");
      await engage(lab, "circularize");
      const e = await lab.fixed({ until: `T.auto === "none"`, maxSim: o.maxSim ?? 4 * 3600, maxWall: 300 });
      // (the burn's place and its ideal: the node's first burning step; a trim: where it was engaged)
      const atBurn = (await lab.js<{ dv: number; rKm: number } | null>("__orb.track.burn")) ?? g0;
      const plan = said(lab, /Circularize at/);
      const where = plan ? (/apoapsis/.test(plan) ? "ap" : "pe") : "trim";
      const planKm = num(plan, /\((\d+) km\)/);
      const planDv = num(plan, /: (\d+) m\/s/);
      const done = said(lab, /^Circular:/);
      const dv = (await spent(lab)) - sp0;
      const e1 = await elements(lab);
      const fl = await flownSpread(lab);
      // (the height: where the burn was — the apsis as flown, the zonal pull having moved it from the
      // placement's two-body figures)
      const want = atBurn.rKm;
      const mid = fl ? (fl.lo + fl.hi) / 2 : Number.NaN;
      const metrics = {
        where,
        planKm,
        planDv,
        idealDv: round(atBurn.dv, 10),
        dvSpent: round(dv, 10),
        dvOverIdealPct: round((100 * (dv - atBurn.dv)) / Math.max(atBurn.dv, 1), 10),
        dvOverPlanPct: Number.isFinite(planDv) ? round((100 * (dv - planDv)) / planDv, 10) : null,
        burnKm: round(atBurn.rKm, 10),
        startRp: e0?.rp,
        startRa: e0?.ra,
        endRp: e1?.rp,
        endRa: e1?.ra,
        endEcc: e1?.ecc,
        flownLo: fl?.lo,
        flownHi: fl?.hi,
        spreadKm: fl?.spread,
        heightErrKm: round(mid - (want ?? Number.NaN), 10),
        incDrift: e0 && e1 ? round(e1.inc - e0.inc, 1000) : null,
      };
      // (the mean circle's own swing under J2, 2X = J2 R² sin²i / 2r — 3 km in a polar low orbit —, and a
      // kilometre for the burn)
      const j2R2 = ({ earth: 1.08263e-3 * 6378.137 ** 2, moon: 2.033e-4 * 1738 ** 2 } as Record<string, number>)[body] ?? 0;
      const swing = e1 ? (j2R2 * Math.sin((e1.inc * Math.PI) / 180) ** 2) / (2 * e1.aKm) : 0;
      const spreadOk = !!fl && fl.spread <= (o.spreadKm ?? swing + 1);
      const heightOk = Math.abs(metrics.heightErrKm) <= (o.heightKm ?? 5);
      const dvOk = dv <= atBurn.dv * (1 + (o.dvPct ?? 3) / 100) + 0.5;
      const ok = e.end === "until" && !!done && spreadOk && heightOk && dvOk;
      return {
        ok,
        why: `${done ?? e.why} · flown ${fl?.lo}–${fl?.hi} km (spread ${fl?.spread}) · Δv ${round(dv, 10)} (ideal ${round(atBurn.dv, 10)}, plan ${planDv})${
          spreadOk ? "" : " · SPREAD"
        }${heightOk ? "" : " · HEIGHT"}${dvOk ? "" : " · DV"}`,
        metrics,
      };
    },
  };
}

export const ORBIT: Scenario[] = [
  circ("circ-ap-200x600", "CIRC — Earth 200 × 600 km at 51.6°, at the apoapsis", "earth", { peKm: 200, apKm: 600, inc: 51.6 }),
  circ("circ-pe-300x800", "CIRC — Earth 300 × 800 km, from the apoapsis: at the periapsis", "earth", {
    peKm: 300,
    apKm: 800,
    inc: 28.5,
    nu: 180,
  }),
  circ("circ-lowpe-130x450", "CIRC — Earth 130 × 450 km, the periapsis grazing the air", "earth", { peKm: 130, apKm: 450, inc: 51.6 }),
  circ(
    "circ-highap-400x8000",
    "CIRC — Earth 400 × 8 000 km, a high apoapsis",
    "earth",
    { peKm: 400, apKm: 8000, inc: 28.5 },
    { maxSim: 8 * 3600 },
  ),
  circ("circ-polar-250x700", "CIRC — Earth 250 × 700 km polar (97.5°)", "earth", { peKm: 250, apKm: 700, inc: 97.5, raan: 40 }),
  circ("circ-retro-300x500", "CIRC — Earth 300 × 500 km retrograde (128.4°)", "earth", {
    peKm: 300,
    apKm: 500,
    inc: 51.6,
    retrograde: true,
  }),
  circ("circ-trim-400x401", "CIRC — Earth 400 × 401 km: nearly circular, the trim alone", "earth", { peKm: 400, apKm: 401, inc: 51.6 }),
  circ("circ-moon-30x200", "CIRC — Moon 30 × 200 km", "moon", { peKm: 30, apKm: 200, inc: 20 }, { tags: ["moon"], maxSim: 6 * 3600 }),
  {
    id: "node-hohmann-400-1000",
    title: "Nodes — the planner's Hohmann 400 → 1 000 km executed",
    tags: ["orbit", "node", "ranger"],
    minutes: 5,
    async run(lab) {
      await lab.js(`(__bh.game.orbit("earth", { altKm: 400, inc: 51.6 }), true)`);
      await Bun.sleep(300);
      await orbInstall(lab);
      const sp0 = await spent(lab);
      const note = await lab.js<string>(`__bh.camera.planOurs("orbit", "orbit", 1000, 0)`);
      const plan = await lab.js<{ burns: { t: number; dv: number[] }[] } | null>("__bh.camera.fcPlan()");
      const planDv = plan ? plan.burns.reduce((a, b) => a + Math.hypot(...b.dv), 0) : Number.NaN;
      // (the ideal: a two-body Hohmann between the circles)
      const mu = 3.986004418e14,
        R = 6371e3,
        r1 = R + 400e3,
        r2 = R + 1000e3,
        at = (r1 + r2) / 2;
      const ideal = Math.sqrt(mu / r1) * (Math.sqrt(r2 / at) - 1) + Math.sqrt(mu / r2) * (1 - Math.sqrt(r1 / at));
      await lab.js("(__bh.camera.fcExecute(), true)");
      const e = await lab.fixed({ until: `T.auto === "none" && T.nodes === 0`, maxSim: 4 * 3600, maxWall: 400 });
      const dv = (await spent(lab)) - sp0;
      const fl = await flownSpread(lab);
      const mid = fl ? (fl.lo + fl.hi) / 2 : Number.NaN;
      const metrics = {
        note,
        planDv: round(planDv, 10),
        idealDv: round(ideal, 10),
        dvSpent: round(dv, 10),
        dvOverIdealPct: round((100 * (dv - ideal)) / ideal, 10),
        flownLo: fl?.lo,
        flownHi: fl?.hi,
        spreadKm: fl?.spread,
        heightErrKm: round(mid - 1000, 10),
      };
      const ok = e.end === "until" && !!fl && fl.spread <= 3 && Math.abs(mid - 1000) <= 5 && dv <= ideal * 1.05;
      return {
        ok,
        why: `${said(lab, /^Circular:|Manoeuvre done/) ?? e.why} · flown ${fl?.lo}–${fl?.hi} km · Δv ${round(dv, 10)} (ideal ${round(ideal, 10)})`,
        metrics,
      };
    },
  },
  {
    id: "approach-moon-20000km",
    title: "Approach — the Moon from 20 000 km, then in orbit about it",
    tags: ["orbit", "approach", "moon", "ranger"],
    minutes: 6,
    async run(lab) {
      await lab.js(`(__bh.game.near("moon", { altKm: 20000 }), __bh.game.target("moon"), true)`);
      await Bun.sleep(300);
      await orbInstall(lab);
      const sp0 = await spent(lab);
      await engage(lab, "approach");
      const e = await lab.fixed({ until: `T.auto === "orbit"`, maxSim: 3 * 86400, maxWall: 400 });
      const arrived = said(lab, /In orbit around/);
      const dvApproach = (await spent(lab)) - sp0;
      const sp1 = await spent(lab);
      // (the orbit autopilot settles: then a revolution held, its height and spend watched)
      await lab.fixed({ until: "false", maxSim: 1800, maxWall: 120 });
      const e1 = await elements(lab);
      const fl = await flownSpread(lab, 1, 20);
      const dvHold = (await spent(lab)) - sp1;
      const metrics = {
        dvApproach: round(dvApproach, 10),
        dvSettleHold: round(dvHold, 10),
        endRp: e1?.rp,
        endRa: e1?.ra,
        flownLo: fl?.lo,
        flownHi: fl?.hi,
        spreadKm: fl?.spread,
        approachS: e.T.t - (lab.events[0]?.t ?? 0),
      };
      const ok = e.end === "until" && !!arrived && e1?.body === "moon" && !!fl && fl.spread < 10 && fl.lo > 10;
      return {
        ok,
        why: `${arrived ?? e.why} · flown ${fl?.lo}–${fl?.hi} km · Δv ${round(dvApproach, 1)} + ${round(dvHold, 10)} m/s`,
        metrics,
      };
    },
  },
  {
    id: "orbit-hold-moon-100km",
    title: "Orbit hold — the Moon at 100 km, held two hours",
    tags: ["orbit", "hold", "moon", "ranger"],
    minutes: 3,
    async run(lab) {
      await lab.js(`(__bh.game.orbit("moon", { altKm: 100, inc: 30 }), __bh.game.target("moon"), true)`);
      await Bun.sleep(300);
      await orbInstall(lab);
      const sp0 = await spent(lab);
      await engage(lab, "orbit");
      await lab.js(
        `(__orb.track.on = true, __orb.track.lo = Infinity, __orb.track.hi = -Infinity, __orb.track.body = "moon", __bh.game.warp(20), true)`,
      );
      const e = await lab.fixed({ until: "false", maxSim: 7200, maxWall: 300, fail: `T.auto !== "orbit"` });
      const tr = await lab.js<{ lo: number; hi: number }>("(__orb.track.on = false, { lo: __orb.track.lo, hi: __orb.track.hi })");
      const dv = (await spent(lab)) - sp0;
      const metrics = { dvSpent: round(dv, 10), flownLo: round(tr.lo, 10), flownHi: round(tr.hi, 10), spreadKm: round(tr.hi - tr.lo, 100) };
      const ok = e.end === "cap" && dv < 5 && tr.hi - tr.lo < 3 && Math.abs((tr.lo + tr.hi) / 2 - 100) < 5;
      return { ok, why: `held ${metrics.flownLo}–${metrics.flownHi} km · Δv ${metrics.dvSpent} m/s over 2 h`, metrics };
    },
  },
  {
    id: "warp-you-circ",
    title: "Warp YOU — the pilot's ×200 kept under the CIRC's ceilings, given back after the burn",
    tags: ["orbit", "warp", "circularize", "ranger"],
    minutes: 3,
    async run(lab) {
      await lab.js(`(__bh.game.orbit("earth", { peKm: 250, apKm: 700, inc: 51.6 }), true)`);
      await Bun.sleep(300);
      await orbInstall(lab);
      await engage(lab, "circularize");
      // (the pilot's authority: their wish asked once the plan is made)
      await lab.js(
        `(__bh.camera.setWarpAuthority(false), __bh.camera.requestWarp(200 / (4.925490947e-6 * __bh.settings.massSolar)), true)`,
      );
      const e = await lab.fixed({ until: `T.auto === "none"`, maxSim: 4 * 3600, maxWall: 300 });
      // (the warp flown: never above the wish; at the burn, near real time; after, the wish back)
      const T = await lab.js<{ warp: number; nodeWarp: string }>(
        `({ warp: __bh.settings.timeSpeed * 4.925490947e-6 * __bh.settings.massSolar, nodeWarp: __bh.camera.nodeWarp })`,
      );
      const lines = (await Bun.file(`${lab.o.dir}/telemetry.jsonl`).text())
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const maxWarp = Math.max(...lines.map((S) => S.warp ?? 0));
      const burnWarp = Math.max(0, ...lines.filter((S) => S.burning).map((S) => S.warp ?? 0));
      const metrics = { maxWarp, burnWarp, warpAfter: round(T.warp, 100), autoWarp: lines.at(-1)?.autoWarp };
      const ok = e.end === "until" && maxWarp <= 200.5 && Math.abs(T.warp - 200) < 0.5 && !!said(lab, /^Circular:/);
      return {
        ok,
        why: `${said(lab, /^Circular:/) ?? e.why} · warp max ${maxWarp}, at the burn ${burnWarp}, after ${metrics.warpAfter}`,
        metrics,
      };
    },
  },
  {
    id: "vessel-switch-lander-circ",
    title: "Vessels — the Lander's CIRC, the Endurance flown meanwhile, the Lander back and circularized",
    tags: ["orbit", "vessel", "circularize", "lander", "endurance"],
    minutes: 6,
    async run(lab): Promise<Verdict> {
      await scene(lab, "Earth: the Lander, 500 km up");
      await lab.js(`(__bh.game.orbit("earth", { peKm: 300, apKm: 520, inc: 51.6 }), true)`);
      await Bun.sleep(300);
      await orbInstall(lab);
      await engage(lab, "circularize");
      await lab.fixed({ until: "false", maxSim: 600, maxWall: 60 });
      const before = await elements(lab);
      // (switched away mid-coast: the plan dropped, the Lander coasting its ellipse)
      await lab.js(`(__bh.settings.vessel = "endurance", true)`);
      await lab.fixed({ until: `T.vessel === "endurance"`, maxSim: 30, maxWall: 30 });
      const end0 = await elements(lab);
      await lab.fixed({ until: "false", maxSim: 900, maxWall: 60 });
      const end1 = await elements(lab);
      // (taken up again: no jump — the Lander flown where the fleet's coast had it at the switch's frame,
      // place and velocity; its osculating elements swing with the Earth's J2 meanwhile, the fall itself)
      await lab.js(`(window.__snap = JSON.parse(JSON.stringify(__bh.fleet.free.lander)), true)`);
      await lab.js(`(__bh.settings.vessel = "lander", true)`);
      await lab.fixed({ until: `T.vessel === "lander"`, maxSim: 30, maxWall: 30 });
      const backJump = await lab.js<{ dX: number; dV: number }>(`(() => {
        const n = __bh.camera.activePoseNow(), p = __bh.fleet.coast(window.__snap, n.t);
        return { dX: Math.hypot(...n.X.map((x, k) => x - p.X[k])) * 1476.625 * __bh.settings.massSolar,
          dV: Math.hypot(...n.V.map((x, k) => x - p.V[k])) * 299792458 };
      })()`);
      const back = await elements(lab);
      const sp0 = await spent(lab);
      await engage(lab, "circularize");
      const e = await lab.fixed({ until: `T.auto === "none"`, maxSim: 4 * 3600, maxWall: 300 });
      const dv = (await spent(lab)) - sp0;
      const plan = [...lab.events].reverse().find((x) => x.kind === "pilot" && /Circularize at/.test(x.text))?.text ?? null;
      const planDv = num(plan, /: (\d+) m\/s/);
      const fl = await flownSpread(lab);
      const metrics = {
        landerRpBefore: before?.rp,
        landerRaBefore: before?.ra,
        landerRpBack: back?.rp,
        landerRaBack: back?.ra,
        backJumpM: round(backJump.dX, 1000),
        backJumpMps: round(backJump.dV, 1000),
        enduranceDriftKm: end0 && end1 ? round(Math.abs(end1.aKm - end0.aKm), 100) : null,
        planDv,
        dvSpent: round(dv, 10),
        spreadKm: fl?.spread,
        flownLo: fl?.lo,
        flownHi: fl?.hi,
      };
      const kept = backJump.dX < 5 && backJump.dV < 0.05;
      const ok = e.end === "until" && kept && !!fl && fl.spread <= 3 && !!said(lab, /^Circular:/) && dv <= planDv * 1.05 + 1;
      return {
        ok,
        why: `${said(lab, /^Circular:/) ?? e.why} · Lander ${before?.rp}×${before?.ra} → back ${back?.rp}×${back?.ra}, taken up ${round(backJump.dX, 100)} m · ${round(backJump.dV, 1000)} m/s off · flown ${fl?.lo}–${fl?.hi}`,
        metrics,
      };
    },
  },
];
